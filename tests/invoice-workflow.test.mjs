import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_TIERS,
  normalizePriceTier,
  getPriceForCustomerType,
  inspectTierPriceImpact,
  applyTierPricingToItems,
} from '../src/utils/products.js';

import {
  isRowPopulated,
  aggregateInvoiceStockDemand,
  validateInvoice,
  describeTaxTreatment,
  getDraftScopeKey,
  saveScopedDraft,
  loadScopedDraft,
  listCompanyDrafts,
  deleteScopedDraft,
} from '../src/utils/invoiceValidation.js';

import {
  getClientCredit,
  planCreditApplication,
} from '../src/utils/clientCredit.js';

test('Canonical price tier model aligns toolbar values, MRP, and fallback hierarchy', () => {
  assert.deepEqual(
    PRICE_TIERS.map((t) => t.value),
    ['retail', 'mechanic', 'wholesale', 'mrp', 'special'],
  );

  assert.equal(normalizePriceTier('Garage / Mechanic'), 'mechanic');
  assert.equal(normalizePriceTier('Distributor / Wholesale'), 'wholesale');
  assert.equal(normalizePriceTier('MRP / List Price'), 'mrp');
  assert.equal(normalizePriceTier('Counter / Retail'), 'retail');
  assert.equal(normalizePriceTier('unknown-value'), 'retail');

  const part = {
    id: 'p-101',
    name: 'Bosch Spark Plug',
    rate: 180,
    mrp: 220,
    retailPrice: 180,
    mechanicPrice: 155,
    wholesalePrice: 140,
    specialPrice: 130,
  };

  const mrpRes = getPriceForCustomerType(part, 'mrp');
  assert.equal(mrpRes.price, 220);
  assert.equal(mrpRes.tierKey, 'mrp');
  assert.equal(mrpRes.tierLabel, 'MRP');

  const mechRes = getPriceForCustomerType(part, 'mechanic');
  assert.equal(mechRes.price, 155);
  assert.equal(mechRes.tierKey, 'mechanic');

  const wholeRes = getPriceForCustomerType(part, 'wholesale');
  assert.equal(wholeRes.price, 140);
  assert.equal(wholeRes.tierKey, 'wholesale');
});

test('Tier price impact & applyTierPricingToItems preserve manual overrides and free-text rows', () => {
  const catalog = [
    {
      id: 'p-1',
      name: 'Brake Pad Set',
      rate: 900,
      retailPrice: 900,
      mechanicPrice: 780,
      wholesalePrice: 720,
      mrp: 1050,
    },
    {
      id: 'p-2',
      name: 'Oil Filter',
      rate: 250,
      retailPrice: 250,
      mechanicPrice: 210,
      wholesalePrice: 190,
      mrp: 300,
    },
  ];

  const items = [
    // Catalog row with automatic tier price
    { id: 1, productId: 'p-1', name: 'Brake Pad Set', quantity: 1, rate: 900, priceSource: 'tier', priceTier: 'retail' },
    // Catalog row with manual price override
    { id: 2, productId: 'p-2', name: 'Oil Filter', quantity: 2, rate: 235, priceSource: 'manual', priceTier: 'retail' },
    // Free-text row with same name as catalog item but NO productId — must NEVER match by name
    { id: 3, productId: null, name: 'Brake Pad Set', quantity: 1, rate: 500, priceSource: 'manual' },
  ];

  const impact = inspectTierPriceImpact(items, catalog, 'mechanic');
  assert.equal(impact.autoUpdatableCount, 1);
  assert.equal(impact.manualCount, 1);

  // Update automatic prices only (preserve manual override on row 2 and free-text row 3)
  const autoUpdated = applyTierPricingToItems(items, catalog, 'mechanic', { replaceManual: false });
  assert.equal(autoUpdated[0].rate, 780);
  assert.equal(autoUpdated[0].priceSource, 'tier');
  assert.equal(autoUpdated[0].priceTier, 'mechanic');
  assert.equal(autoUpdated[1].rate, 235);
  assert.equal(autoUpdated[1].priceSource, 'manual');
  assert.equal(autoUpdated[2].rate, 500);

  // Replace all (including manual catalog rows, still ignoring free-text row 3)
  const replacedAll = applyTierPricingToItems(items, catalog, 'mechanic', { replaceManual: true });
  assert.equal(replacedAll[0].rate, 780);
  assert.equal(replacedAll[1].rate, 210);
  assert.equal(replacedAll[1].priceSource, 'tier');
  assert.equal(replacedAll[1].priceTier, 'mechanic');
  assert.equal(replacedAll[2].rate, 500);
});

test('validateInvoice enforces rules on both new and edited invoices and checks every populated row', () => {
  const validClient = { name: 'Sharma Auto Works', state: 'Rajasthan' };
  const validDetails = {
    invoiceNumber: 'INV-2026-001',
    invoiceDate: '2026-11-08',
    dueDate: '2026-11-15',
  };

  // Row 1 is valid, Row 2 is populated (quantity changed to 3) but missing item name
  const itemsWithIncompleteSecondRow = [
    { id: 'r1', name: 'Clutch Plate', quantity: 1, rate: 1200, discount: 0, taxPercent: 18 },
    { id: 'r2', name: '', quantity: 3, rate: 450, discount: 0, taxPercent: 18 },
  ];

  // New invoice validation
  const resNew = validateInvoice({
    client: validClient,
    details: validDetails,
    items: itemsWithIncompleteSecondRow,
    invoiceType: 'tax-invoice',
  });
  assert.equal(resNew.valid, false);
  assert.ok(resNew.rowErrors.r2?.name);

  // Editing an existing invoice MUST NOT bypass validation
  const resEdit = validateInvoice({
    client: validClient,
    details: validDetails,
    items: itemsWithIncompleteSecondRow,
    invoiceType: 'tax-invoice',
    editingBill: { id: 'bill-existing-1', invoiceNumber: 'INV-2026-001' },
  });
  assert.equal(resEdit.valid, false);
  assert.ok(resEdit.rowErrors.r2?.name);
});

test('validateInvoice checks date ordering and discount bounds', () => {
  const res = validateInvoice({
    client: { name: 'A1 Motors' },
    details: {
      invoiceNumber: 'INV-002',
      invoiceDate: '2026-11-10',
      dueDate: '2026-11-05', // before invoiceDate
    },
    items: [
      { id: 'r1', name: 'Headlamp Bulb', quantity: 2, rate: 100, discount: 120, discountMode: 'pct', taxPercent: 18 },
    ],
    invoiceOptions: {
      invoiceDiscountType: 'percent',
      invoiceDiscountValue: 150,
    },
  });

  assert.equal(res.valid, false);
  assert.ok(res.fieldErrors.dueDate);
  assert.ok(res.rowErrors.r1?.discount);
  assert.ok(res.fieldErrors.invoiceDiscountValue);
});

test('validateInvoice aggregates stock demand across multiple rows of the same productId and accounts for editingBill stock', () => {
  const savedProducts = [
    { id: 'prod-1', name: 'Alternator Belt', trackStock: true, stock: 5 },
  ];

  // Two lines for prod-1: 3 + 4 = 7 > 5 available
  const items = [
    { id: 'r1', productId: 'prod-1', name: 'Alternator Belt', quantity: 3, rate: 300, taxPercent: 18 },
    { id: 'r2', productId: 'prod-1', name: 'Alternator Belt (Spare)', quantity: 4, rate: 300, taxPercent: 18 },
  ];

  const demand = aggregateInvoiceStockDemand(items);
  assert.equal(demand.get('prod-1').totalQty, 7);

  const resNew = validateInvoice({
    client: { name: 'Walk-in' },
    details: { invoiceNumber: 'INV-003', invoiceDate: '2026-11-08' },
    items,
    invoiceType: 'tax-invoice',
    savedProducts,
    allowNegativeStock: false,
  });
  assert.equal(resNew.valid, false);
  assert.ok(resNew.rowErrors.r1?.quantity);
  assert.ok(resNew.rowErrors.r2?.quantity);

  // When editing a bill that ALREADY deducted 4 units of prod-1, effective available stock is 5 + 4 = 9 >= 7
  const resEdit = validateInvoice({
    client: { name: 'Walk-in' },
    details: { invoiceNumber: 'INV-003', invoiceDate: '2026-11-08' },
    items,
    invoiceType: 'tax-invoice',
    savedProducts,
    editingBill: {
      id: 'b-10',
      invoiceType: 'tax-invoice',
      stockApplied: true,
      stockDelta: { 'prod-1': 4 },
    },
    allowNegativeStock: false,
  });
  assert.equal(resEdit.valid, true);
});

test('describeTaxTreatment accurately classifies B2B checksum GSTIN, invalid GSTIN warning, B2CL, and B2CS', () => {
  // Unregistered intra-state B2CS
  const b2cs = describeTaxTreatment({
    client: { name: 'Rahul', state: 'Maharashtra', gstin: '' },
    profile: { state: 'Maharashtra', country: 'India' },
    details: { placeOfSupply: 'Maharashtra' },
    totals: { isInterstate: false, isUT: false, total: 5000 },
    invoiceType: 'tax-invoice',
    showGST: true,
  });
  assert.equal(b2cs.code, 'B2CS');
  assert.equal(b2cs.taxSplitLabel, 'CGST + SGST');

  // Unregistered inter-state > ₹1,00,000 => B2CL
  const b2cl = describeTaxTreatment({
    client: { name: 'Big Buyer', state: 'Gujarat', gstin: '' },
    profile: { state: 'Maharashtra', country: 'India' },
    details: { placeOfSupply: 'Gujarat' },
    totals: { isInterstate: true, isUT: false, total: 125000 },
    invoiceType: 'tax-invoice',
    showGST: true,
  });
  assert.equal(b2cl.code, 'B2CL');
  assert.equal(b2cl.taxSplitLabel, 'IGST');

  // 15-char string with bad checksum should NOT be classified as verified B2B
  const badGstin = describeTaxTreatment({
    client: { name: 'Fake GST Co', state: 'Maharashtra', gstin: '27AAAAA0000A1Z0' },
    profile: { state: 'Maharashtra', country: 'India' },
    details: { placeOfSupply: 'Maharashtra' },
    totals: { isInterstate: false, isUT: false, total: 5000 },
    invoiceType: 'tax-invoice',
    showGST: true,
  });
  assert.equal(badGstin.code, 'B2CS');
  assert.ok(badGstin.gstinWarning);
});

test('Scoped draft helpers isolate drafts by company and document scope', () => {
  const mem = new Map();
  const mockStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  };

  saveScopedDraft({
    businessKey: 'comp-A',
    editingBillId: null,
    payload: { client: { name: 'Comp A New Draft' } },
    storage: mockStorage,
  });
  saveScopedDraft({
    businessKey: 'comp-A',
    editingBillId: 'bill-42',
    payload: { client: { name: 'Comp A Edit 42' } },
    storage: mockStorage,
  });
  saveScopedDraft({
    businessKey: 'comp-B',
    editingBillId: null,
    payload: { client: { name: 'Comp B New Draft' } },
    storage: mockStorage,
  });

  assert.equal(
    loadScopedDraft({ businessKey: 'comp-A', editingBillId: null, storage: mockStorage })?.client?.name,
    'Comp A New Draft',
  );
  assert.equal(
    loadScopedDraft({ businessKey: 'comp-A', editingBillId: 'bill-42', storage: mockStorage })?.client?.name,
    'Comp A Edit 42',
  );
  assert.equal(
    loadScopedDraft({ businessKey: 'comp-B', editingBillId: null, storage: mockStorage })?.client?.name,
    'Comp B New Draft',
  );
  assert.equal(listCompanyDrafts('comp-A', mockStorage).length, 2);

  deleteScopedDraft({ businessKey: 'comp-A', editingBillId: 'bill-42', storage: mockStorage });
  assert.equal(loadScopedDraft({ businessKey: 'comp-A', editingBillId: 'bill-42', storage: mockStorage }), null);
});

test('Client credit matches by clientId first and enforces idempotency on target bill', () => {
  const bills = [
    {
      id: 'b-source-1',
      invoiceType: 'tax-invoice',
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-10-01',
      clientId: 'cli-100',
      clientName: 'Old Name Auto',
      totalAmount: 1000,
      total: 1000,
      payments: [{ id: 'pay-1', amount: 1500, method: 'UPI', note: 'Advance' }],
    },
  ];

  // Even if customer was renamed to 'New Name Auto', matching by clientId finds the ₹500 credit
  const credit = getClientCredit(bills, { id: 'cli-100', name: 'New Name Auto' });
  assert.equal(credit.available, 500);

  const plan1 = planCreditApplication(bills, { id: 'cli-100', name: 'New Name Auto' }, 300, {
    id: 'b-target-2',
    invoiceNumber: 'INV-002',
    invoiceDate: '2026-11-08',
  });
  assert.equal(plan1.appliedAmount, 300);
  assert.equal(plan1.sourceUpdates.length, 1);

  // Idempotency: if sourceUpdates were already applied for b-target-2, re-planning for b-target-2 skips duplicate debit
  const updatedBills = [
    {
      ...bills[0],
      payments: plan1.sourceUpdates[0].payments,
    },
  ];
  const planDuplicate = planCreditApplication(updatedBills, { id: 'cli-100', name: 'New Name Auto' }, 300, {
    id: 'b-target-2',
    invoiceNumber: 'INV-002',
    invoiceDate: '2026-11-08',
  });
  assert.equal(planDuplicate.appliedAmount, 0);
});
