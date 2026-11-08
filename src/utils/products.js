// v1.10.77 (#85) - product helpers for bulk edit, stock report, and Automotive Spare-Parts Product Master.
import { appliedStock, isCancelledBill, isServiceProduct } from '../utils.js';

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

export const AUTOMOTIVE_CATEGORIES = [
  'Engine Parts',
  'Braking System',
  'Suspension & Steering',
  'Filters & Fluids',
  'Electrical & Ignition',
  'Clutch & Transmission',
  'Cooling & Radiator',
  'Body & Lighting',
  'Bearings & Seals',
  'Exhaust & Emission',
  'AC & Heating',
  'Tyres, Wheels & Service',
  'Lubricants & Oils',
  'Accessories & Fasteners',
  'General / Other',
];

export const PART_TYPES = [
  'OEM Genuine',
  'OES (Original Equipment Supplier)',
  'Aftermarket Standard',
  'Aftermarket Performance',
  'Remanufactured',
  'Consumable / Lubricant',
];

export const CUSTOMER_TYPES = [
  'Retail',
  'Mechanic',
  'Garage',
  'Workshop',
  'Wholesaler',
  'Dealer',
  'Other',
];

export const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric / EV', 'Hybrid', 'Universal'];

const cleanToken = (s) => String(s || '').trim().toUpperCase().replace(/[\s\-_/\\.]+/g, '');
const cleanText = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const KNOWN_ACCOUNT_GROUPS_RE = /\b(sundry\s*debtors?|sundry\s*creditors?|duties\s*(?:&|and)\s*taxes|current\s*assets?|current\s*liabilities|bank\s*accounts?|bank\s*o\/d|bank\s*od|cash[\s-]*in[\s-]*hand|expenses?\s*\(indirect|expenses?\s*\(direct|indirect\s*expenses?|direct\s*expenses?|income\s*\(indirect|income\s*\(direct|indirect\s*income|direct\s*income|revenue\s*accounts?|sales\s*accounts?|purchase\s*accounts?|fixed\s*assets?|capital\s*accounts?|loans?\s*\(liability\)|loans?\s*(?:&|and)\s*advances?|secured\s*loans?|unsecured\s*loans?|securities\s*(?:&|and)\s*deposits?|provisions?|reserves?\s*(?:&|and)\s*surplus|branch\s*\/?\s*divisions?|suspense\s*a\/c|suspense\s*account|stock[\s-]*in[\s-]*hand|investments?|misc\.?\s*expenses?|primary\s*group)\b/i;

export const KNOWN_ACCOUNT_NAMES_RE = /^(add\.?\s*cess|cess\s+on\s+gst|cgst\s*(input|output|payable|receivable|on\s+|adjustable|a\/c|%|$)|sgst\s*(input|output|payable|receivable|on\s+|adjustable|a\/c|%|$)|igst\s*(input|output|payable|receivable|on\s+|adjustable|a\/c|%|$)|utgst|gst\s+(input|output|payable|receivable| adjustable)|central\s+sales\s+tax|vat\s+(input|output|payable)|service\s+tax|tds\s+(payable|receivable|on\s+|by\s+)|tcs\s+(payable|receivable|on\s+|by\s+)|busy\s+infotech|advertisement\s*(?:&|and)\s*publicity|audit\s+fees?|bad\s+debts?\s*(written\s+off)?|bank\s+charges?|bank\s+interest|books\s*(?:&|and)\s*periodicals|cash$|cash\s+in\s+hand|cash\s+a\/c|charity\s*(?:&|and)\s*donations?|commission\s+on\s+(sales|purchases)|computers?$|conveyance\s+expenses?|customer\s+entertainment\s+expenses?|depreciation\s*a\/c|depreciation\s+account|discount\s+(allowed|received|a\/c)|donations?$|earnest\s+money|electricity\s+(charges?|expenses?)|entertainment\s+expenses?|festival\s+celebration\s+expenses?|freight\s*(?:&|and)\s*(cartage|forwarding|inward|outward)|furniture\s*(?:&|and)\s*fixtures?|general\s+expenses?|godown\s+rent|interest\s+on\s+(loan|od|capital|late\s+payment)|interest\s+(paid|received|a\/c)|job\s+work\s+charges?|labour\s+charges?|legal\s+expenses?|machinery\s*(?:&|and)\s*equipments?|medical\s+expenses?|membership\s*(?:&|and)\s*subscriptions?|misc\.?\s+expenses?|miscellaneous\s+expenses?|newspaper\s*(?:&|and)\s*periodicals|office\s+equipments?|office\s+expenses?|office\s+maint(ainance|enance)|packing\s+(charges?|expenses?)|penalty\s*(?:&|and)\s*fines?|petrol\s*(?:&|and)\s*diesel\s+expenses?|postage\s*(?:&|and)\s*(telegram|courier)|power\s*(?:&|and)\s*fuel|preliminary\s+expenses?|printing\s*(?:&|and)\s*station(ery|ary)|professional\s+(charges?|fees?)|profit\s*(?:&|and)\s*loss|provident\s+fund|purchase\s+account|rebate\s*(?:&|and)\s*discount|refreshment\s+expenses?|rent\s+(paid|received|a\/c|expenses?)|repair\s*(?:&|and)\s*maint|round(ing)?\s+off|salary\s*(?:&|and)\s*(bonus|wages)|sales\s+account|sales\s+promotion\s+expenses?|security\s+deposit|service\s+charges?|software\s+expenses?|staff\s+welfare\s+expenses?|station(ery|ary)\s+expenses?|sundry\s+(debtors?|creditors?)|suspense\s*(account|a\/c)?$|tea\s*(?:&|and)\s*coffee\s+expenses?|telephone\s+expenses?|tour\s*(?:&|and)\s*travelling|transport(ation)?\s+charges?|travelling\s*(?:&|and)?\s*(conveyance\s+)?expenses?|uniform\s+expenses?|vehicle\s+running\s*(?:&|and)?\s*maint|wages\s*(a\/c|expenses?)?$|water\s*(?:&|and)\s*electricity)/i;

// Returns true if a record sitting in products is actually a BUSY Accounting ledger / party master
export const isMisclassifiedAccountProduct = (p = {}, { clients = [], suppliers = [], ledgers = [] } = {}) => {
  if (!p || typeof p !== 'object') return false;
  const name = String(p.name || '').trim();
  if (!name) return false;

  // Explicit domain/subType marker if present
  if (p.subType && p.subType !== 'Item') return true;
  if (/^(Account Group|Tax Category|Bill Sundry|Sale Type|Purchase Type|Item Group|Material Centre):/i.test(name)) {
    return true;
  }

  // Known standard BUSY account names (e.g. Add. Cess on GST Input, CGST Output, Cash, Busy Infotech, etc.)
  if (KNOWN_ACCOUNT_NAMES_RE.test(name)) return true;

  // Known accounting group stored in accountGroup, parentGroup, category, productGroup, or brand
  const groupFields = [p.accountGroup, p.parentGroup, p.category, p.productGroup, p.brand, p.manufacturer]
    .map(v => String(v || '').trim())
    .filter(Boolean);
  if (groupFields.some(g => KNOWN_ACCOUNT_GROUPS_RE.test(g))) return true;

  // Account-only attributes present with zero product pricing/HSN
  const hasNoProductPricing =
    num(p.sellingPrice) === 0 &&
    num(p.purchasePrice) === 0 &&
    num(p.mrp) === 0 &&
    !String(p.hsn || '').trim();

  if (hasNoProductPricing && (p.gstin || num(p.openingBalance) > 0 || num(p.creditLimit) > 0)) {
    return true;
  }

  if (hasNoProductPricing && num(p.stock) === 0) {
    const lowerName = name.toLowerCase();
    const inPartiesOrLedgers =
      clients.some(c => String(c?.name || '').trim().toLowerCase() === lowerName) ||
      suppliers.some(s => String(s?.name || '').trim().toLowerCase() === lowerName) ||
      ledgers.some(l => String(l?.name || '').trim().toLowerCase() === lowerName);
    if (inPartiesOrLedgers) return true;
  }

  return false;
};

// Normalize an automotive product record so UI and accounting always have consistent fields.
// In BUSY Accounting, the Alias field holds the Spare Part Number and maps to oemPartNo.
export const normalizeAutomotiveProduct = (p = {}) => {
  const name = String(p.name || '').trim();
  const rawAlias = String(p.alias || p.itemAlias || p.aliasName || p.masterAlias || '').trim();
  const rawCode = String(p.itemCode || p.sku || p.code || '').trim();
  // Avoid using internal printName/name as part code
  const validCode = rawCode && rawCode.toLowerCase() !== name.toLowerCase() ? rawCode : '';
  const oemPartNo = String(p.oemPartNo || rawAlias || p.partNo || p.partNumber || validCode || '').trim();
  const alias = String(rawAlias || oemPartNo || validCode || '').trim();
  const itemCode = String(validCode || rawAlias || oemPartNo || '').trim();

  const sellingPrice = num(p.sellingPrice ?? p.rate);
  const purchasePrice = num(p.purchasePrice);
  const stock = isServiceProduct(p) || p.stock === undefined || p.stock === null || p.stock === ''
    ? undefined
    : num(p.stock);
  const reservedStock = num(p.reservedStock);
  const availableStock = stock === undefined ? undefined : Math.round((stock - reservedStock) * 1000) / 1000;

  return {
    ...p,
    name,
    alias,
    itemCode,
    oemPartNo,
    partNo: oemPartNo,
    mfgPartNo: String(p.mfgPartNo || '').trim(),
    altPartNo: String(p.altPartNo || '').trim(),
    sku: String(p.sku || itemCode || '').trim(),
    barcode: String(p.barcode || '').trim(),
    hsn: String(p.hsn || '').trim(),
    description: String(p.description || '').trim(),
    brand: String(p.brand || '').trim(),
    manufacturer: String(p.manufacturer || p.brand || '').trim(),
    partType: p.partType || 'Aftermarket Standard',
    category: p.category || '',
    productGroup: p.productGroup || p.category || '',
    subcategory: p.subcategory || '',
    taxPercent: num(p.taxPercent ?? 18),
    unit: p.unit || 'Nos',
    purchaseUnit: p.purchaseUnit || p.unit || 'Nos',
    salesUnit: p.salesUnit || p.unit || 'Nos',
    unitConversion: num(p.unitConversion) > 0 ? num(p.unitConversion) : 1,
    purchasePrice,
    lastPurchasePrice: num(p.lastPurchasePrice || purchasePrice),
    avgPurchaseCost: num(p.avgPurchaseCost || purchasePrice),
    mrp: num(p.mrp || sellingPrice),
    sellingPrice,
    rate: sellingPrice,
    mechanicPrice: num(p.mechanicPrice || sellingPrice),
    wholesalePrice: num(p.wholesalePrice || sellingPrice),
    specialPrice: num(p.specialPrice || sellingPrice),
    minSellingPrice: num(p.minSellingPrice || purchasePrice),
    discountPercent: num(p.discountPercent),
    openingStock: num(p.openingStock),
    stock,
    reservedStock,
    availableStock,
    minStock: num(p.minStock ?? p.lowStockThreshold ?? 5),
    maxStock: num(p.maxStock ?? 100),
    reorderLevel: num(p.reorderLevel ?? p.minStock ?? 5),
    reorderQty: num(p.reorderQty ?? 10),
    rack: String(p.rack || '').trim(),
    shelf: String(p.shelf || '').trim(),
    binLocation: String(p.binLocation || '').trim(),
    materialCentre: String(p.materialCentre || 'Main Store').trim(),
    supersededPartNo: String(p.supersededPartNo || '').trim(),
    vehicleFitments: Array.isArray(p.vehicleFitments) ? p.vehicleFitments : (
      p.vehicleMake || p.vehicleModel
        ? [{
            make: String(p.vehicleMake || '').trim(),
            model: String(p.vehicleModel || '').trim(),
            generation: String(p.vehicleGeneration || '').trim(),
            year: String(p.vehicleYear || '').trim(),
            fuelType: String(p.fuelType || 'Universal').trim(),
            engine: String(p.engineSpec || '').trim(),
            variant: String(p.vehicleVariant || '').trim(),
          }]
        : []
    ),
    crossReferences: Array.isArray(p.crossReferences) ? p.crossReferences : [],
  };
};

// Margin % and Markup % calculation
export const computeProductMargins = (product = {}) => {
  const cost = num(product.avgPurchaseCost || product.purchasePrice);
  const retail = num(product.sellingPrice ?? product.rate);
  const marginAmount = Math.round((retail - cost) * 100) / 100;
  const marginPercent = retail > 0 && cost > 0 ? Math.round(((retail - cost) / retail) * 10000) / 100 : 0;
  const markupPercent = cost > 0 ? Math.round(((retail - cost) / cost) * 10000) / 100 : 0;
  return { cost, retail, marginAmount, marginPercent, markupPercent };
};

// Automatic price selection based on Customer Type
export const getPriceForCustomerType = (product = {}, customerType = 'Retail') => {
  const retail = num(product.sellingPrice ?? product.rate);
  const mechanic = num(product.mechanicPrice) || retail;
  const wholesale = num(product.wholesalePrice) || mechanic || retail;
  const special = num(product.specialPrice) || wholesale || retail;
  const type = String(customerType || 'Retail').trim().toLowerCase();

  if (type === 'mechanic' || type === 'garage' || type === 'workshop') {
    return { price: mechanic, tierLabel: 'Mechanic / Workshop Price', tierKey: 'mechanicPrice' };
  }
  if (type === 'wholesaler' || type === 'dealer') {
    return { price: wholesale, tierLabel: 'Wholesale / Dealer Price', tierKey: 'wholesalePrice' };
  }
  if (type === 'special') {
    return { price: special, tierLabel: 'Special Price', tierKey: 'specialPrice' };
  }
  return { price: retail, tierLabel: 'Retail Selling Price', tierKey: 'sellingPrice' };
};

// Duplicate detection that strictly respects Brand & Manufacturer separation:
// Two products with the same OEM/Mfg part number from DIFFERENT brands/manufacturers
// are cross-reference equivalents, NOT duplicates, and must NEVER be auto-merged.
export const findDuplicateProducts = (candidate = {}, existingProducts = []) => {
  const candId = candidate.id;
  const candName = cleanText(candidate.name);
  const candBrand = cleanText(candidate.brand || candidate.manufacturer);
  const candOem = cleanToken(candidate.oemPartNo || candidate.partNo);
  const candMfg = cleanToken(candidate.mfgPartNo);
  const candSku = cleanToken(candidate.sku || candidate.itemCode);
  const candBarcode = cleanToken(candidate.barcode);

  const exactDuplicates = [];
  const crossBrandEquivalents = [];

  for (const existing of existingProducts || []) {
    if (!existing || (candId && existing.id === candId)) continue;
    const exName = cleanText(existing.name);
    const exBrand = cleanText(existing.brand || existing.manufacturer);
    const exOem = cleanToken(existing.oemPartNo || existing.partNo);
    const exMfg = cleanToken(existing.mfgPartNo);
    const exSku = cleanToken(existing.sku || existing.itemCode);
    const exBarcode = cleanToken(existing.barcode);

    const sameBrand = !candBrand || !exBrand || candBrand === exBrand;

    // Barcode or internal SKU collision is always an exact duplicate
    if ((candBarcode && candBarcode === exBarcode) || (candSku && candSku === exSku && sameBrand)) {
      exactDuplicates.push({ product: existing, reason: candBarcode && candBarcode === exBarcode ? 'Identical Barcode' : 'Identical SKU + Brand' });
      continue;
    }

    // Part number match: check if same brand or different brand
    const partMatch =
      (candOem && (candOem === exOem || candOem === exMfg)) ||
      (candMfg && (candMfg === exMfg || candMfg === exOem));

    if (partMatch) {
      if (sameBrand) {
        exactDuplicates.push({ product: existing, reason: 'Same Part Number & Brand' });
      } else {
        crossBrandEquivalents.push({
          product: existing,
          reason: `Same Part No (${candidate.oemPartNo || candidate.mfgPartNo}) but different Brand (${existing.brand || existing.manufacturer || 'Unbranded'})`,
        });
      }
      continue;
    }

    // Exact product name + same brand
    if (candName && candName === exName && sameBrand) {
      exactDuplicates.push({ product: existing, reason: 'Same Product Name & Brand' });
    }
  }

  return { exactDuplicates, crossBrandEquivalents };
};

// Smart matching for AI Purchase Bill Extraction & BUSY Import
export const matchProductToMaster = (extractedItem = {}, existingProducts = []) => {
  const rawName = cleanText(extractedItem.name || extractedItem.description);
  const rawPart = cleanToken(extractedItem.partNumber || extractedItem.oemPartNo || extractedItem.mfgPartNo || extractedItem.sku);
  const rawAlt = cleanToken(extractedItem.altPartNumber || extractedItem.altPartNo);
  const rawBrand = cleanText(extractedItem.brand || extractedItem.manufacturer);
  const rawHsn = cleanToken(extractedItem.hsn);

  let bestMatch = null;
  let bestScore = 0;
  let matchReason = '';
  const warnings = [];

  for (const prod of existingProducts || []) {
    if (!prod) continue;
    const pName = cleanText(prod.name);
    const pBrand = cleanText(prod.brand || prod.manufacturer);
    const pOem = cleanToken(prod.oemPartNo || prod.partNo);
    const pMfg = cleanToken(prod.mfgPartNo);
    const pAlt = cleanToken(prod.altPartNo);
    const pSku = cleanToken(prod.sku || prod.itemCode);
    const pCross = (prod.crossReferences || []).map(c => cleanToken(c.partNo || c));

    const brandConflict = rawBrand && pBrand && rawBrand !== pBrand;

    // 1. Exact Part Number + Same/Compatible Brand
    if (rawPart && (rawPart === pOem || rawPart === pMfg || rawPart === pSku)) {
      if (brandConflict) {
        warnings.push(`Part # ${extractedItem.partNumber} matches "${prod.name}" (${prod.brand}), but invoice specifies brand "${extractedItem.brand}". Not auto-merged.`);
        continue;
      }
      const score = rawBrand && pBrand && rawBrand === pBrand ? 98 : 92;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = prod;
        matchReason = 'Exact OEM/Mfg Part Number match';
      }
      continue;
    }

    // 2. Alternate / Cross-Reference Part Number match (same brand)
    if ((rawPart && (rawPart === pAlt || pCross.includes(rawPart))) || (rawAlt && (rawAlt === pOem || rawAlt === pMfg || rawAlt === pAlt))) {
      if (!brandConflict && 84 > bestScore) {
        bestScore = 84;
        bestMatch = prod;
        matchReason = 'Alternate / Cross-Reference Part Number match';
      }
    }

    // 3. Exact Product Name + Brand match
    if (rawName && pName && rawName === pName) {
      if (brandConflict) {
        warnings.push(`Product name "${extractedItem.name}" exists under brand "${prod.brand}", but invoice specifies "${extractedItem.brand}".`);
        continue;
      }
      const score = rawBrand && pBrand && rawBrand === pBrand ? 94 : 86;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = prod;
        matchReason = 'Exact Product Name match';
      }
      continue;
    }

    // 4. High token overlap on name + HSN
    if (rawName && pName && (pName.includes(rawName) || rawName.includes(pName)) && rawName.length >= 5) {
      if (!brandConflict) {
        const hsnBonus = rawHsn && cleanToken(prod.hsn) === rawHsn ? 8 : 0;
        const score = 70 + hsnBonus;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = prod;
          matchReason = 'Fuzzy Name / HSN similarity (Review recommended)';
        }
      }
    }
  }

  return {
    matchedProduct: bestScore >= 75 ? bestMatch : null,
    candidateProduct: bestMatch,
    confidence: bestScore,
    uncertain: bestScore >= 65 && bestScore < 88,
    matchReason,
    warnings,
  };
};

// Search helper across all automotive attributes
export const productMatchesSearch = (product, query) => {
  if (!query || !String(query).trim()) return true;
  const q = String(query).trim().toLowerCase();
  const fields = [
    product.name,
    product.alias,
    product.itemCode,
    product.oemPartNo,
    product.partNo,
    product.mfgPartNo,
    product.altPartNo,
    product.sku,
    product.barcode,
    product.hsn,
    product.brand,
    product.manufacturer,
    product.category,
    product.productGroup,
    product.subcategory,
    product.rack,
    product.binLocation,
    product.supersededPartNo,
    product.description,
  ];
  if (fields.some(f => f && String(f).toLowerCase().includes(q))) return true;
  if (Array.isArray(product.vehicleFitments)) {
    for (const vf of product.vehicleFitments) {
      const fitStr = `${vf.make || ''} ${vf.model || ''} ${vf.generation || ''} ${vf.year || ''} ${vf.fuelType || ''} ${vf.engine || ''} ${vf.variant || ''}`.toLowerCase();
      if (fitStr.includes(q)) return true;
    }
  }
  if (Array.isArray(product.crossReferences)) {
    for (const cr of product.crossReferences) {
      const crStr = typeof cr === 'string' ? cr : `${cr.brand || ''} ${cr.partNo || ''} ${cr.notes || ''}`;
      if (crStr.toLowerCase().includes(q)) return true;
    }
  }
  return false;
};

// Fast / Slow / Dead-stock classification
export const classifyProductMovement = (products = [], bills = [], purchases = [], options = {}) => {
  const deadStockDays = Number(options.deadStockDays) || 180;
  const fastMovingMinQty = Number(options.fastMovingMinSales) || 10;
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - deadStockDays * 86400000).toISOString().slice(0, 10);

  const salesByProd = new Map();
  const lastSaleDateByProd = new Map();
  const lastPurchaseDateByProd = new Map();

  for (const b of bills || []) {
    if (!b || isCancelledBill(b)) continue;
    const d = b.invoiceDate || '';
    const items = b.items || b.data?.items || [];
    for (const it of items) {
      const key = it.productId || cleanText(it.description || it.name);
      if (!key) continue;
      salesByProd.set(key, (salesByProd.get(key) || 0) + (Number(it.quantity) || 0));
      if (d && (!lastSaleDateByProd.get(key) || d > lastSaleDateByProd.get(key))) {
        lastSaleDateByProd.set(key, d);
      }
    }
  }

  for (const p of purchases || []) {
    if (!p) continue;
    const d = p.date || '';
    for (const it of p.items || []) {
      const key = it.productId || cleanText(it.name || it.description);
      if (!key) continue;
      if (d && (!lastPurchaseDateByProd.get(key) || d > lastPurchaseDateByProd.get(key))) {
        lastPurchaseDateByProd.set(key, d);
      }
    }
  }

  return (products || []).map(prod => {
    const idKey = prod.id;
    const nameKey = cleanText(prod.name);
    const totalSold = (salesByProd.get(idKey) || 0) + (idKey !== nameKey ? (salesByProd.get(nameKey) || 0) : 0);
    const lastSaleDate = lastSaleDateByProd.get(idKey) || lastSaleDateByProd.get(nameKey) || prod.lastSaleDate || '';
    const lastPurchaseDate = lastPurchaseDateByProd.get(idKey) || lastPurchaseDateByProd.get(nameKey) || prod.lastPurchaseDate || '';
    const stock = Number(prod.stock) || 0;

    let movementClass = 'Normal';
    if (totalSold >= fastMovingMinQty) {
      movementClass = 'Fast-Moving';
    } else if (stock > 0 && totalSold === 0 && (!lastSaleDate || lastSaleDate < cutoffDate)) {
      movementClass = 'Dead-Stock';
    } else if (totalSold > 0 && totalSold <= 2) {
      movementClass = 'Slow-Moving';
    }

    return {
      ...prod,
      totalSoldQty: totalSold,
      lastSaleDate,
      lastPurchaseDate,
      movementClass,
      isDeadStock: movementClass === 'Dead-Stock',
      isLowStock: !isServiceProduct(prod) && prod.stock !== undefined && stock <= (Number(prod.reorderLevel ?? prod.minStock ?? 5)),
      isNegativeStock: !isServiceProduct(prod) && prod.stock !== undefined && stock < 0,
    };
  });
};

// One edited row of the bulk-edit grid -> the product to save, or { error }.
// Same rules as the single product form: a name is required, GST % 0-100,
// and the selling price is mirrored to `rate` for older readers.
export const bulkRowToProduct = (product, edits) => {
  const merged = { ...product, ...edits };
  const name = String(merged.name ?? '').trim();
  if (!name) return { error: 'a product needs a name' };
  const gst = num(merged.taxPercent);
  if (!Number.isFinite(gst) || gst < 0 || gst > 100) return { error: `${name}: GST % must be 0 to 100` };
  for (const k of ['purchasePrice', 'sellingPrice', 'stock']) {
    if (!Number.isFinite(num(merged[k]))) return { error: `${name}: ${k === 'stock' ? 'stock' : 'price'} must be a number` };
  }
  const sellingPrice = num(edits.sellingPrice ?? product.sellingPrice ?? product.rate);
  // #121 - a service keeps no stock; a blank stock stays "not tracked" (it
  // used to become 0, so editing a price made it "Out of Stock").
  const blank = merged.stock === '' || merged.stock === null || merged.stock === undefined;
  return {
    product: {
      ...product,
      name,
      hsn: String(merged.hsn ?? '').trim(),
      purchasePrice: num(merged.purchasePrice),
      sellingPrice,
      rate: sellingPrice,
      taxPercent: gst,
      unit: merged.unit || 'Nos',
      stock: isServiceProduct(merged) || blank ? undefined : num(merged.stock),
    },
  };
};

// Closing stock of each product at the end of a day (YYYY-MM-DD), worked
// back from today's stock: take off what purchases dated after it brought in,
// and add back what invoices dated after it took out (each invoice's own
// stock record, see appliedStock). Stock typed in by hand on the Products
// screen has no date, so it counts as if it happened today.
// v1.10.83 (#115) - production entries dated after it are undone the same
// way, from each entry's own stock record (raw materials back, made goods out).
// v1.10.83 (#121) - services have no stock and are left out.
// Returns Map(productId -> quantity).
export const closingStock = (products, bills, purchases, asOf, productions = []) => {
  const qty = new Map((products || []).filter((p) => !isServiceProduct(p)).map((p) => [p.id, Number(p.stock) || 0]));
  const byName = new Map((products || []).map((p) => [String(p.name || '').trim().toLowerCase(), p.id]));
  for (const pur of purchases || []) {
    if (!pur?.date || pur.date <= asOf) continue;
    for (const it of pur.items || []) {
      const id = it.productId || byName.get(String(it.name || '').trim().toLowerCase());
      if (id && qty.has(id)) qty.set(id, qty.get(id) - (Number(it.quantity) || 0));
    }
  }
  for (const b of bills || []) {
    if (!b?.invoiceDate || b.invoiceDate <= asOf || isCancelledBill(b)) continue;
    for (const [id, change] of Object.entries(appliedStock(b))) {
      if (qty.has(id)) qty.set(id, qty.get(id) - change);
    }
  }
  for (const pr of productions || []) {
    if (!pr?.date || pr.date <= asOf) continue;
    for (const [id, change] of Object.entries(pr.stockApplied || {})) {
      if (qty.has(id)) qty.set(id, qty.get(id) - (Number(change) || 0));
    }
  }
  for (const [id, q] of qty) qty.set(id, Math.round(q * 1000) / 1000);
  return qty;
};

// Value of a quantity at the product's purchase price (cost), or at its
// selling price when no purchase price is known.
export const stockValueOf = (product, quantity) => {
  const cost = Number(product?.purchasePrice) || 0;
  const price = cost > 0 ? cost : (Number(product?.sellingPrice) || Number(product?.rate) || 0);
  return { price, value: Math.round(price * (Number(quantity) || 0) * 100) / 100, atCost: cost > 0 };
};

