import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDuplicateProducts,
  getPriceForCustomerType,
  computeProductMargins,
  normalizeAutomotiveProduct,
  matchProductToMaster,
} from '../src/utils/products.js';
import {
  buildDoubleEntryBook,
  ACCOUNT_GROUPS,
  VOUCHER_TYPES,
  SYSTEM_LEDGERS,
} from '../src/utils/accounting.js';
import {
  parseBusyFileRecords,
  reconcileBusyImport,
  SAMPLE_BUSY_MASTERS_DAT,
} from '../src/utils/busyParser.js';

test('Automotive Product: Brand-Aware Duplicate Detection', () => {
  const existing = [
    { id: '1', name: 'Front Brake Pad', oemPartNo: 'BP-001', brand: 'Bosch' },
    { id: '2', name: 'Oil Filter', oemPartNo: 'OF-505', brand: 'Purolator' },
  ];

  // 1. Same part number AND same brand => Duplicate detected
  const dupCandidate = { name: 'Brake Pad Set', oemPartNo: 'bp-001', brand: 'BOSCH' };
  const res1 = findDuplicateProducts(dupCandidate, existing);
  assert.equal(res1.exactDuplicates.length, 1, 'Should match duplicate when partNumber and brand match');
  assert.equal(res1.exactDuplicates[0].product.id, '1');

  // 2. Same part number BUT different brand => NOT a duplicate (Cross-brand equivalent)
  const crossBrandCandidate = { name: 'Brake Pad Set TVS', oemPartNo: 'BP-001', brand: 'TVS Girling' };
  const res2 = findDuplicateProducts(crossBrandCandidate, existing);
  assert.equal(res2.exactDuplicates.length, 0, 'Must NOT merge same part numbers from different brands');
  assert.equal(res2.crossBrandEquivalents.length, 1, 'Should record as cross-brand equivalent');

  // 3. Different part number => NOT a duplicate
  const uniqueCandidate = { name: 'Air Filter', oemPartNo: 'AF-999', brand: 'Bosch' };
  const res3 = findDuplicateProducts(uniqueCandidate, existing);
  assert.equal(res3.exactDuplicates.length, 0);
  assert.equal(res3.crossBrandEquivalents.length, 0);
});

test('Automotive Product: Customer Type Price-Tier Resolution', () => {
  const product = {
    sellingPrice: 1000,
    mrp: 1200,
    mechanicPrice: 850,
    wholesalePrice: 800,
    specialPrice: 750,
    purchasePrice: 600,
  };

  assert.equal(getPriceForCustomerType(product, 'Retail').price, 1000, 'Retail gets standard selling price');
  assert.equal(getPriceForCustomerType(product, 'Mechanic').price, 850, 'Mechanic gets mechanic price');
  assert.equal(getPriceForCustomerType(product, 'Garage').price, 850, 'Garage gets mechanic price tier');
  assert.equal(getPriceForCustomerType(product, 'Workshop').price, 850, 'Workshop gets mechanic price tier');
  assert.equal(getPriceForCustomerType(product, 'Wholesaler').price, 800, 'Wholesaler gets wholesale price');
  assert.equal(getPriceForCustomerType(product, 'Dealer').price, 800, 'Dealer gets wholesale price tier');
  assert.equal(getPriceForCustomerType(product, 'Special').price, 750, 'Special gets special price');
  assert.equal(getPriceForCustomerType(product, 'Other').price, 1000, 'Fallback to standard selling price');
});

test('Double-Entry Accounting: Self-Balancing Trial Balance and Daybook', () => {
  const profile = { businessName: 'Auto Spares Hub', gstin: '07AAAAA0000A1Z5' };

  const bills = [
    {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-001',
      invoiceDate: '2026-11-01',
      clientName: 'Speedy Garage',
      status: 'unpaid',
      data: {
        total: 1180,
        taxAmount: 180,
        subTotal: 1000,
        paymentMode: 'credit',
      },
    },
    {
      id: 'inv-2',
      invoiceNumber: 'INV-2026-002',
      invoiceDate: '2026-11-02',
      clientName: 'Walk-in Retail',
      status: 'paid',
      data: {
        total: 590,
        taxAmount: 90,
        subTotal: 500,
        paymentMode: 'cash',
      },
    },
  ];

  const purchases = [
    {
      id: 'pur-1',
      billNumber: 'PB-2026-101',
      date: '2026-10-25',
      supplierName: 'Bosch Auto Parts Dist.',
      totalAmount: 2360,
      cgst: 180,
      sgst: 180,
      paymentStatus: 'paid',
      payments: [{ amount: 2360, mode: 'Bank', date: '2026-10-25' }],
    },
  ];

  const vouchers = [
    {
      id: 'vch-1',
      voucherNo: 'RCT-001',
      voucherType: 'Receipt',
      date: '2026-11-03',
      debitAccountId: 'sys_bank',
      creditAccountId: 'ledger_speedy_garage',
      amount: 1180,
      narration: 'Full settlement from Speedy Garage',
    },
  ];

  const ledgers = [
    { id: 'ledger_speedy_garage', name: 'Speedy Garage', group: 'Sundry Debtors', openingBalance: 0, openingType: 'Dr' },
  ];

  const book = buildDoubleEntryBook({ bills, purchases, vouchers, ledgers, profile });

  // 1. Daybook must contain balanced postings
  assert.ok(book.daybook.length > 0, 'Daybook entries should be present');
  for (const entry of book.daybook) {
    const sumDr = entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const sumCr = entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
    assert.ok(Math.abs(sumDr - sumCr) < 0.01, `Voucher ${entry.voucherNo} must balance: Dr ${sumDr} === Cr ${sumCr}`);
  }

  // 2. Trial Balance must balance: Total Debit === Total Credit
  assert.ok(
    Math.abs(book.trialBalance.totalDebit - book.trialBalance.totalCredit) < 0.01,
    `Trial Balance must balance: Debit ${book.trialBalance.totalDebit} === Credit ${book.trialBalance.totalCredit}`
  );

  // 3. Balance sheet Assets and Liabilities match
  assert.equal(
    book.balanceSheet.assets.total,
    book.balanceSheet.liabilities.total,
    'Balance Sheet total assets must equal total liabilities'
  );
});

test('BUSY Accounting: .DAT Parser and Strict Mathematical Reconciliation', () => {
  // Parse the sample BUSY .DAT master content
  const records = parseBusyFileRecords('SAMPLE_MASTERS.DAT', SAMPLE_BUSY_MASTERS_DAT);
  assert.ok(records.length > 0, 'Parsed records should not be empty');

  const existingProducts = [{ oemPartNo: 'OF-770', brand: 'Mann' }];
  const existingClients = [];
  const existingSuppliers = [];

  const recon = reconcileBusyImport({
    records,
    existingProducts,
    existingClients,
    existingSuppliers,
  });

  // Verify total source equality
  assert.equal(recon.counts.reconciled, true, 'Import batch must be mathematically reconciled');
  assert.equal(
    recon.counts.totalSource,
    recon.counts.accountedFor,
    'totalSource must equal accountedFor'
  );

  assert.ok(recon.counts.newCount >= 1, 'Should detect new masters');
});

test('BUSY Accounting: Native XML MSAll.DAT Parser (Accounts + Items with numeric MasterType codes)', () => {
  const xmlDat = `<BusyData>
    <Account>
      <Name>Rajesh Auto Electricals</Name>
      <PrintName>Rajesh Auto Electricals</PrintName>
      <MasterType>1</MasterType>
      <ParentGroup>Sundry Debtors</ParentGroup>
      <GSTNo>07AABCR1234F1Z5</GSTNo>
      <Mobile>9811002233</Mobile>
      <Address1>Kashmere Gate</Address1>
      <Address2>Delhi</Address2>
      <OpBal>15400</OpBal>
    </Account>
    <Account>
      <Name>Minda Corporation Ltd</Name>
      <MasterType>1</MasterType>
      <ParentGroup>Sundry Creditors</ParentGroup>
      <GSTNo>URP</GSTNo>
      <OpBal>-28000</OpBal>
    </Account>
    <Item>
      <Name>Headlight Relay 12V 90/100W</Name>
      <Alias>HL-RLY-100</Alias>
      <ParentGroup>Uno Minda</ParentGroup>
      <UnitName>Pcs</UnitName>
      <HSNCode>85364100</HSNCode>
      <TaxCatName>GST 18%</TaxCatName>
      <SalePrice>450</SalePrice>
      <PurPrice>310</PurPrice>
      <MRP>520</MRP>
      <OpBalQty>25</OpBalQty>
      <OpBalVal>7750</OpBalVal>
    </Item>
  </BusyData>`;

  const records = parseBusyFileRecords('20261103_MSAll.DAT', xmlDat);
  assert.equal(records.length, 3, 'Should parse all 3 XML blocks');
  assert.equal(records[0].subType, 'Account', 'Should classify <Account> with <MasterType>1</MasterType> as Account, not Master: 1');
  assert.equal(records[1].subType, 'Account');
  assert.equal(records[1].gstin, '', 'Should normalize URP placeholder GSTIN to empty string');
  assert.equal(records[2].subType, 'Item');
  assert.equal(records[2].stock, 25, 'Should extract OpBalQty as stock');
  assert.equal(records[2].sellingPrice, 450, 'Should extract SalePrice');
  assert.equal(records[2].purchasePrice, 310, 'Should extract PurPrice');
  assert.equal(records[2].taxPercent, 18, 'Should parse 18 from TaxCatName "GST 18%"');

  const recon = reconcileBusyImport({ records });
  assert.equal(recon.counts.reconciled, true);
  assert.equal(recon.counts.newCount, 3);
  assert.equal(recon.byMasterType['Account'], 2);
  assert.equal(recon.byMasterType['Item'], 1);
  assert.equal(recon.staged.products.length, 1);
  assert.equal(recon.staged.products[0].oemPartNo, 'HL-RLY-100', 'Should map <Alias> to oemPartNo');
  assert.equal(recon.financialImpact.newProductsStockQty, 25);
  assert.equal(recon.financialImpact.newProductsStockValue, 25 * 310);
  assert.equal(recon.financialImpact.debtorsOpeningDr, 15400);
  assert.equal(recon.financialImpact.creditorsOpeningCr, 28000);
});

test('BUSY Accounting: Tax/Expense Ledgers (Add. Cess on GST Input/Output) are NEVER imported as Products and Alias takes priority as Part Number', () => {
  const xmlDat = `<BusyData>
    <Record>
      <Name>Add. Cess Adjustable Agnst. Advance</Name>
      <PrintName>Add. Cess Adjustable Agnst. Advance</PrintName>
      <ParentGroup>Duties &amp; Taxes</ParentGroup>
      <SalePrice>0</SalePrice>
      <MRP>0</MRP>
    </Record>
    <Record>
      <Name>Add. Cess on GST Input</Name>
      <SalePrice>0</SalePrice>
    </Record>
    <Record>
      <Name>Add. Cess on GST Output</Name>
      <SalePrice>0</SalePrice>
    </Record>
    <Item>
      <Name>Clutch Release Bearing Swift</Name>
      <Code>1099</Code>
      <Alias>23265M79F00</Alias>
      <ParentGroup>Clutch &amp; Transmission</ParentGroup>
      <HSNCode>87089300</HSNCode>
      <SalePrice>890</SalePrice>
      <PurPrice>620</PurPrice>
      <OpBalQty>10</OpBalQty>
    </Item>
  </BusyData>`;

  const records = parseBusyFileRecords('20261103_MSAll.DAT', xmlDat);
  assert.equal(records.length, 4);
  assert.equal(records[0].subType, 'Account', 'Add. Cess Adjustable Agnst. Advance must be Account');
  assert.equal(records[1].subType, 'Account', 'Add. Cess on GST Input must be Account');
  assert.equal(records[2].subType, 'Account', 'Add. Cess on GST Output must be Account');
  assert.equal(records[3].subType, 'Item', 'Clutch Release Bearing Swift must be Item');
  assert.equal(records[3].oemPartNo, '23265M79F00', 'Alias must take #1 priority over numeric Code for oemPartNo');

  const recon = reconcileBusyImport({ records });
  assert.equal(recon.staged.products.length, 1, 'Only the 1 real item must be staged in products');
  assert.equal(recon.staged.products[0].name, 'Clutch Release Bearing Swift');
  assert.equal(recon.staged.products[0].oemPartNo, '23265M79F00');
  assert.equal(recon.staged.ledgers.length, 3, 'All 3 Add. Cess accounts must be staged in ledgers');
});


