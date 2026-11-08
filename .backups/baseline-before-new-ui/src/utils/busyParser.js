// BUSY Accounting Software (.DAT / .XLSX / .CSV / .JSON) Parser, Classifier & Mathematical Reconciler
import {
  findDuplicateProducts,
  normalizeAutomotiveProduct,
  KNOWN_ACCOUNT_GROUPS_RE,
  KNOWN_ACCOUNT_NAMES_RE,
} from './products.js';

export const BUSY_MASTER_TYPES = [
  'Account',
  'Item',
  'Account Group',
  'Unit Conversion',
  'Bill of Material',
  'ST Form',
  'Sale Type',
  'Standard Narrations',
  'Purchase Type',
  'Item Group',
  'Executive',
  'Bill Sundry',
  'Tax Category',
  'Unit',
  'Discount Structure',
  'Opening Balance',
  'Bill-by-Bill Reference',
];

export const BUSY_SUPPORTED_TXN_TYPES = [
  'Sales',
  'Purchase',
  'Sales Return',
  'Purchase Return',
  'Sales Order',
  'Purchase Order',
  'Stock Transfer',
  'Production',
  'Unassemble',
  'Stock Journal',
  'Material Issue to Party',
  'Material Receipt from Party',
  'Payment',
  'Receipt',
  'Journal',
  'Contra',
  'Debit Note',
  'Credit Note',
  'Sales Quotation',
  'Purchase Quotation',
];

export const BUSY_UNSUPPORTED_TXN_TYPES = [
  'Call Allocation',
  'Call Receipt',
  'Call Report',
  'Form Issued',
  'Form Received',
  'Purchase Indent',
];

export const BUSY_WIZARD_STEPS = [
  { step: 1, title: 'Select Files', desc: 'Choose BUSY Master/Transaction .DAT, .XLSX, .CSV, or .JSON files' },
  { step: 2, title: 'Upload Files', desc: 'Load files into parser buffer & verify byte integrity' },
  { step: 3, title: 'Detect File Types', desc: 'Identify BUSY Master vs Transaction structure & encoding' },
  { step: 4, title: 'Parse Records', desc: 'Extract structured records from .DAT / tabular streams' },
  { step: 5, title: 'Classify Masters & Transactions', desc: 'Bucket into 16 Master types & 26 Transaction voucher types' },
  { step: 6, title: 'Match Existing Records', desc: 'Cross-check against existing Accounts, Products, and Vouchers' },
  { step: 7, title: 'Map Fields', desc: 'Review and customize BUSY-to-Automotive field mappings' },
  { step: 8, title: 'Validate Records', desc: 'Check GSTIN format, HSN codes, numeric rates, and dates' },
  { step: 9, title: 'Identify Duplicates', desc: 'Detect duplicate part numbers (brand-aware), accounts & bills' },
  { step: 10, title: 'Review Financial Impact', desc: 'Preview impact on Debtors, Creditors, Stock Value & GST Ledgers' },
  { step: 11, title: 'Show Import Summary', desc: 'Verify mathematical reconciliation of every source record' },
  { step: 12, title: 'Confirm Import', desc: 'Review pre-import backup notice & confirm atomic commit' },
  { step: 13, title: 'Import Data', desc: 'Write records with batch ID & create automatic restore point' },
  { step: 14, title: 'Verify DB Persistence', desc: 'Read back committed files from disk & verify record counts' },
  { step: 15, title: 'Refresh UI Data', desc: 'Reload live Products, Customers, Suppliers, Invoices & Ledgers' },
  { step: 16, title: 'Final Import Report', desc: 'Complete audit log with downloadable reconciliation certificate' },
];

// Step 3: Detect file format, encoding & BUSY data category
export function detectBusyFileMetadata(fileName = '', content = '', byteLength = 0) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const sample = String(content || '').slice(0, 4000);
  let format = ext.toUpperCase() || 'DAT';
  let busyCategory = 'Mixed (Masters + Transactions)';

  const hasMasterMarkers = /MasterType|RecordType\s*[:=]\s*["']?(Account|Item|Item Group|Tax Category|Unit|Bill Sundry)|\[MASTER|<Master|<Account\b|<AccountGroup\b|<Item\b|<ItemGroup\b|<Unit\b|<TaxCategory\b|<BillSundry\b/i.test(sample);
  const hasTxnMarkers = /VoucherType|TxnType|RecordType\s*[:=]\s*["']?(Sales|Purchase|Payment|Receipt|Journal|Contra|Call Allocation)|\[VOUCHER|<Voucher|<Sales\b|<Purchase\b|<Receipt\b|<Payment\b|<Journal\b|<Contra\b/i.test(sample);

  if (hasMasterMarkers && !hasTxnMarkers) busyCategory = 'BUSY Masters (.DAT)';
  else if (hasTxnMarkers && !hasMasterMarkers) busyCategory = 'BUSY Transactions (.DAT)';
  else if (/^ms|master/i.test(fileName) && !/txn|vch|tran/i.test(fileName)) busyCategory = 'BUSY Masters (.DAT)';
  else if (/^tr|txn|vch|tran/i.test(fileName)) busyCategory = 'BUSY Transactions (.DAT)';

  let subFormat = 'Delimited / Key-Value DAT';
  const trimmed = sample.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) subFormat = 'JSON / BUSY Structured JSON';
  else if (trimmed.startsWith('<')) subFormat = 'BUSY XML / DAT Stream';
  else if (sample.includes('|')) subFormat = 'Pipe-Delimited BUSY DAT';
  else if (sample.includes('\t')) subFormat = 'Tab-Delimited BUSY Export';
  else if (ext === 'csv') subFormat = 'Comma-Separated Values (CSV)';
  else if (ext === 'xlsx' || ext === 'xls') subFormat = 'Excel Workbook (XLSX)';

  return {
    fileName,
    extension: ext,
    format,
    subFormat,
    busyCategory,
    byteLength: byteLength || String(content || '').length,
    encoding: 'UTF-8',
  };
}

// Parse CSV line respecting quotes
function splitDelimitedLine(line, delimiter = ',') {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// Decode basic XML entities in BUSY .DAT XML values
function decodeXmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

// BUSY numeric MasterType codes used inside <MasterType> or <Type> in BUSY .DAT exports
const BUSY_NUMERIC_MASTER_CODE_MAP = {
  '1': 'Account',
  '2': 'Account',
  '3': 'Cost Centre',
  '4': 'Standard Narrations',
  '5': 'Item Group',
  '6': 'Item',
  '7': 'Unit',
  '8': 'Unit',
  '9': 'Bill Sundry',
  '11': 'Sale Type',
  '12': 'Purchase Type',
  '13': 'Tax Category',
  '15': 'Executive',
  '16': 'Discount Structure',
};

// Map XML outer tag names directly to canonical BUSY Master/Transaction types
const BUSY_XML_TAG_MAP = {
  account: { domain: 'Master', subType: 'Account' },
  accountmaster: { domain: 'Master', subType: 'Account' },
  accountgroup: { domain: 'Master', subType: 'Account Group' },
  item: { domain: 'Master', subType: 'Item' },
  itemmaster: { domain: 'Master', subType: 'Item' },
  itemgroup: { domain: 'Master', subType: 'Item Group' },
  unit: { domain: 'Master', subType: 'Unit' },
  unitmaster: { domain: 'Master', subType: 'Unit' },
  unitconversion: { domain: 'Master', subType: 'Unit Conversion' },
  taxcategory: { domain: 'Master', subType: 'Tax Category' },
  billsundry: { domain: 'Master', subType: 'Bill Sundry' },
  saletype: { domain: 'Master', subType: 'Sale Type' },
  purchasetype: { domain: 'Master', subType: 'Purchase Type' },
  billofmaterial: { domain: 'Master', subType: 'Bill of Material' },
  godown: { domain: 'Master', subType: 'Unit' },
  materialcentre: { domain: 'Master', subType: 'Unit' },
  executive: { domain: 'Master', subType: 'Executive' },
  sales: { domain: 'Transaction', subType: 'Sales' },
  sale: { domain: 'Transaction', subType: 'Sales' },
  purchase: { domain: 'Transaction', subType: 'Purchase' },
  salesreturn: { domain: 'Transaction', subType: 'Sales Return' },
  purchasereturn: { domain: 'Transaction', subType: 'Purchase Return' },
  salesorder: { domain: 'Transaction', subType: 'Sales Order' },
  purchaseorder: { domain: 'Transaction', subType: 'Purchase Order' },
  payment: { domain: 'Transaction', subType: 'Payment' },
  receipt: { domain: 'Transaction', subType: 'Receipt' },
  journal: { domain: 'Transaction', subType: 'Journal' },
  contra: { domain: 'Transaction', subType: 'Contra' },
  debitnote: { domain: 'Transaction', subType: 'Debit Note' },
  creditnote: { domain: 'Transaction', subType: 'Credit Note' },
  stocktransfer: { domain: 'Transaction', subType: 'Stock Transfer' },
  stockjournal: { domain: 'Transaction', subType: 'Stock Journal' },
  production: { domain: 'Transaction', subType: 'Production' },
  unassemble: { domain: 'Transaction', subType: 'Unassemble' },
  salesquotation: { domain: 'Transaction', subType: 'Sales Quotation' },
  purchasequotation: { domain: 'Transaction', subType: 'Purchase Quotation' },
};

// Step 4: Parse raw content (.DAT, .JSON, .CSV, or XLSX row array) into normalized source records
export function parseBusyFileRecords(fileName = '', rawContent = '') {
  // If already an array of objects (e.g., from XLSX parser)
  if (Array.isArray(rawContent)) {
    return rawContent.map((row, idx) => normalizeRawBusyRow(row, fileName, idx + 1));
  }

  const text = String(rawContent || '').replace(/^\uFEFF/, '').trim();
  if (!text) return [];

  // 1. JSON array or object with records/masters/transactions
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : [
            ...(parsed.records || []),
            ...(parsed.masters || []),
            ...(parsed.transactions || []),
            ...(parsed.vouchers || []),
            ...(parsed.items || []),
            ...(parsed.accounts || []),
          ];
      return list.map((row, idx) => normalizeRawBusyRow(row, fileName, idx + 1));
    } catch {
      // Fall through to line-based parser
    }
  }

  // 2. XML-like BUSY .DAT export (e.g. 20261103_MSAll.DAT / TRAll.DAT with <Account>, <Item>, <AccountGroup>, <Voucher>, <Record>, etc.)
  if (text.startsWith('<')) {
    const records = [];
    const blockRegex = /<(Record|Master|Account|AccountMaster|AccountGroup|Item|ItemMaster|ItemGroup|Unit|UnitMaster|UnitConversion|TaxCategory|BillSundry|SaleType|PurchaseType|BillOfMaterial|Godown|MaterialCentre|Executive|Voucher|Transaction|Sales|Sale|Purchase|SalesReturn|PurchaseReturn|SalesOrder|PurchaseOrder|Payment|Receipt|Journal|Contra|DebitNote|CreditNote|StockTransfer|StockJournal|Production|Unassemble|SalesQuotation|PurchaseQuotation)\b([^>]*)>([\s\S]*?)<\/\1>|<Record\b([^>]*)\/>/gi;
    let match;
    let idx = 1;
    while ((match = blockRegex.exec(text)) !== null) {
      const tagName = match[1] || 'Record';
      const obj = { _xmlTag: tagName };
      const attrStr = match[2] || match[4] || '';
      const innerStr = match[3] || '';
      const attrRe = /(\w+)\s*=\s*["']([^"']*)["']/g;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) obj[am[1]] = decodeXmlEntities(am[2]);
      // Extract all leaf <Tag>Value</Tag> pairs (including nested leaf tags inside <Address> or <ItemDetails>)
      const tagRe = /<([A-Za-z0-9_]+)>([^<>]*)<\/\1>/g;
      let tm;
      while ((tm = tagRe.exec(innerStr)) !== null) {
        const key = tm[1];
        const val = decodeXmlEntities(tm[2]);
        // Preserve the first non-empty occurrence (usually header/main level) or fill if empty
        if (obj[key] === undefined || obj[key] === '') {
          obj[key] = val;
        }
      }
      if (Object.keys(obj).length > 1) {
        records.push(normalizeRawBusyRow(obj, fileName, idx++));
      }
    }
    if (records.length > 0) return records;
  }

  // 3. Pipe-delimited, Tab-delimited, CSV, or INI/Key-Value .DAT blocks
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith(';'));
  if (!lines.length) return [];

  // Check if INI / Block style [RECORD]
  if (lines.some(l => /^\[(MASTER|VOUCHER|RECORD|ACCOUNT|ITEM|TXN)/i.test(l))) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
      const sec = line.match(/^\[(.+)\]$/);
      if (sec) {
        if (current && Object.keys(current).length) blocks.push(current);
        current = { _section: sec[1] };
      } else if (current) {
        const kv = line.match(/^([^=:]+)[=:](.*)$/);
        if (kv) current[kv[1].trim()] = kv[2].trim();
      }
    }
    if (current && Object.keys(current).length) blocks.push(current);
    return blocks.map((b, i) => normalizeRawBusyRow(b, fileName, i + 1));
  }

  // Delimited table (.DAT with `|`, `\t`, or `,`)
  const firstLine = lines[0];
  const delimiter = firstLine.includes('|') ? '|' : firstLine.includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(firstLine, delimiter).map(h => h.replace(/^["']|["']$/g, '').trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitDelimitedLine(lines[i], delimiter);
    if (vals.length === 1 && !vals[0]) continue;
    const obj = {};
    headers.forEach((h, colIdx) => {
      if (h) obj[h] = vals[colIdx] !== undefined ? vals[colIdx] : '';
    });
    rows.push(normalizeRawBusyRow(obj, fileName, i));
  }
  return rows;
}

function getField(row, candidates = []) {
  for (const k of candidates) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
  }
  const lowerMap = {};
  for (const [k, v] of Object.entries(row || {})) {
    lowerMap[k.toLowerCase().replace(/[\s_-]+/g, '')] = v;
  }
  for (const k of candidates) {
    const norm = k.toLowerCase().replace(/[\s_-]+/g, '');
    if (lowerMap[norm] !== undefined && lowerMap[norm] !== null && String(lowerMap[norm]).trim() !== '') {
      return lowerMap[norm];
    }
  }
  return '';
}

function parseNum(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const cleaned = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parseTaxRateFromText(val, fallback = 18) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const str = String(val).trim();
  if (/exempt|nil|zero|0\s*%/i.test(str)) return 0;
  const m = str.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return fallback;
}

function normalizeRawBusyRow(row = {}, sourceFile = '', rowIndex = 1) {
  const xmlTag = String(row._xmlTag || '').trim().toLowerCase();
  const xmlMapped = BUSY_XML_TAG_MAP[xmlTag];

  const rawCategory = String(getField(row, ['recordCategory', 'categoryType', 'kind', '_section']) || '').trim();
  let rawType = String(getField(row, ['recordType', 'masterType', 'voucherType', 'txnType', 'type', 'vchType']) || '').trim();

  // If rawType is a numeric BUSY MasterType code (e.g., "1", "2", "6"), map it or prefer the explicit XML tag
  if (BUSY_NUMERIC_MASTER_CODE_MAP[rawType]) {
    rawType = xmlMapped ? xmlMapped.subType : BUSY_NUMERIC_MASTER_CODE_MAP[rawType];
  } else if (xmlMapped && (!rawType || /^\d+$/.test(rawType))) {
    rawType = xmlMapped.subType;
  }

  const nameVal = String(getField(row, ['name', 'itemName', 'accountName', 'partyName', 'printName', 'particulars']) || '').trim();
  const accountGroupVal = String(getField(row, ['accountGroup', 'parentGroup', 'parentGrp', 'groupName', 'grpName', 'accGrp', 'underGroup', 'underGrp', 'masterGroup', 'group']) || '').trim();
  const hasKnownAccountGroup = Boolean(accountGroupVal && KNOWN_ACCOUNT_GROUPS_RE.test(accountGroupVal));
  const hasKnownAccountName = Boolean(nameVal && KNOWN_ACCOUNT_NAMES_RE.test(nameVal));

  // Determine whether Master or Transaction
  let domain = xmlMapped?.domain || 'Master';
  let subType = xmlMapped?.subType || 'Item';

  const typeNorm = rawType.toLowerCase();
  const catNorm = rawCategory.toLowerCase();

  if (
    xmlMapped?.domain === 'Transaction' ||
    catNorm.includes('tran') ||
    catNorm.includes('vouch') ||
    catNorm.includes('txn') ||
    BUSY_SUPPORTED_TXN_TYPES.some(t => t.toLowerCase() === typeNorm) ||
    BUSY_UNSUPPORTED_TXN_TYPES.some(t => t.toLowerCase() === typeNorm) ||
    Boolean(getField(row, ['voucherNo', 'invoiceNumber', 'billNumber', 'vchNo', 'vchNumber']))
  ) {
    domain = 'Transaction';
    const matchedSup = BUSY_SUPPORTED_TXN_TYPES.find(t => t.toLowerCase() === typeNorm);
    const matchedUnsup = BUSY_UNSUPPORTED_TXN_TYPES.find(t => t.toLowerCase() === typeNorm);
    if (xmlMapped?.domain === 'Transaction') subType = xmlMapped.subType;
    else if (matchedSup) subType = matchedSup;
    else if (matchedUnsup) subType = matchedUnsup;
    else if (typeNorm.includes('sale') && typeNorm.includes('ret')) subType = 'Sales Return';
    else if (typeNorm.includes('pur') && typeNorm.includes('ret')) subType = 'Purchase Return';
    else if (typeNorm.includes('sale') && typeNorm.includes('ord')) subType = 'Sales Order';
    else if (typeNorm.includes('pur') && typeNorm.includes('ord')) subType = 'Purchase Order';
    else if (typeNorm.includes('sale')) subType = 'Sales';
    else if (typeNorm.includes('pur')) subType = 'Purchase';
    else if (typeNorm.includes('pay')) subType = 'Payment';
    else if (typeNorm.includes('rec')) subType = 'Receipt';
    else if (typeNorm.includes('jour')) subType = 'Journal';
    else if (typeNorm.includes('contra')) subType = 'Contra';
    else if (typeNorm.includes('debit')) subType = 'Debit Note';
    else if (typeNorm.includes('credit')) subType = 'Credit Note';
    else if (typeNorm.includes('call') || typeNorm.includes('indent') || typeNorm.includes('form')) {
      subType = rawType || 'Call Allocation';
    } else {
      subType = rawType || 'Sales';
    }
  } else {
    domain = 'Master';
    const matchedMaster = BUSY_MASTER_TYPES.find(m => m.toLowerCase() === typeNorm);
    const hasPositiveItemPricingOrStock =
      parseNum(getField(row, ['mrp', 'sellingPrice', 'salePrice', 'salesPrice', 'purPrice', 'purchasePrice', 'mechanicPrice', 'stock', 'opBalQty', 'opQty', 'clQty']), 0) > 0;
    const hasExplicitItemIdentifiers =
      Boolean(getField(row, ['oemPartNo', 'partNo', 'partNumber', 'hsn', 'hsnCode', 'unitName', 'mainUnit']));
    const hasExplicitAccountFields =
      Boolean(getField(row, ['accountGroup', 'gstin', 'gstNo', 'tinNo', 'itpNo', 'pan', 'dealerType', 'typeOfDealer', 'maintainBalBillByBill', 'address1', 'openingType'])) ||
      parseNum(getField(row, ['creditLimit', 'creditDays', 'opBal', 'openingBal', 'opBalDr', 'opBalCr']), 0) !== 0;

    if (xmlMapped?.domain === 'Master') {
      subType = xmlMapped.subType;
    } else if (hasKnownAccountName && !hasPositiveItemPricingOrStock && !hasExplicitItemIdentifiers) {
      subType = 'Account';
    } else if (hasKnownAccountGroup && matchedMaster !== 'Item' && !hasPositiveItemPricingOrStock && !hasExplicitItemIdentifiers) {
      subType = 'Account';
    } else if (matchedMaster) {
      subType = matchedMaster;
    } else if (typeNorm.includes('account') && typeNorm.includes('group')) {
      subType = 'Account Group';
    } else if (typeNorm.includes('account') || typeNorm.includes('party') || typeNorm.includes('customer') || typeNorm.includes('supplier') || typeNorm.includes('ledger')) {
      subType = 'Account';
    } else if (typeNorm.includes('item') && typeNorm.includes('group')) {
      subType = 'Item Group';
    } else if (typeNorm.includes('unit') && typeNorm.includes('conv')) {
      subType = 'Unit Conversion';
    } else if (typeNorm.includes('unit')) {
      subType = 'Unit';
    } else if (typeNorm.includes('tax')) {
      subType = 'Tax Category';
    } else if (typeNorm.includes('sundry')) {
      subType = 'Bill Sundry';
    } else if (typeNorm.includes('bom') || typeNorm.includes('material')) {
      subType = 'Bill of Material';
    } else if (hasKnownAccountGroup || hasKnownAccountName || (hasExplicitAccountFields && !hasPositiveItemPricingOrStock && !hasExplicitItemIdentifiers)) {
      subType = 'Account';
    } else if (hasPositiveItemPricingOrStock || hasExplicitItemIdentifiers || Boolean(getField(row, ['taxCatName']))) {
      subType = 'Item';
    } else {
      subType = rawType && !/^\d+$/.test(rawType) ? rawType : 'Item';
    }

    // Final safety guard: a record with a known BUSY Account Name or Accounting Group (like Duties & Taxes,
    // Sundry Debtors, Sundry Creditors, Indirect Expenses, Add. Cess on GST Input/Output) must NEVER be an Item
    if (
      subType === 'Item' &&
      (hasKnownAccountName || hasKnownAccountGroup) &&
      !hasPositiveItemPricingOrStock &&
      !getField(row, ['oemPartNo', 'partNo', 'partNumber', 'hsn', 'hsnCode'])
    ) {
      subType = 'Account';
    }
  }

  // Extract address parts from BUSY XML (<Address1>, <Address2>, <Address3>, <Address4>, <Station>, <PinCode>)
  const addrParts = [
    getField(row, ['address', 'street', 'address1', 'addr1']),
    getField(row, ['address2', 'addr2']),
    getField(row, ['address3', 'addr3']),
    getField(row, ['address4', 'addr4', 'station', 'city']),
  ].map(s => String(s || '').trim()).filter(Boolean);
  const combinedAddress = addrParts.join(', ');

  // Opening / Closing Stock in BUSY XML (<OpBalQty>, <OpQty>, <OpStock>, <ClQty>, <ClBalQty>, <Stock>)
  const openingStock = parseNum(getField(row, ['openingStock', 'openStock', 'opBalQty', 'opQty', 'opStock', 'openingQty']), 0);
  const stock = parseNum(getField(row, ['stock', 'closingStock', 'clBalQty', 'clQty', 'qty', 'quantity', 'openingStock', 'opBalQty', 'opQty', 'opStock']), openingStock);
  const opStockValue = parseNum(getField(row, ['opBalVal', 'opVal', 'openingStockVal', 'stockValue', 'clBalVal']), 0);

  // Prices in BUSY XML (<SalePrice>, <SalesPrice>, <PurPrice>, <SelfValPrice>, <MRP>, <MinSalePrice>)
  let purchasePrice = parseNum(getField(row, ['purchasePrice', 'costPrice', 'purchaseRate', 'purPrice', 'purRate', 'selfValPrice', 'stdPurPrice']), 0);
  if (purchasePrice <= 0 && stock > 0 && opStockValue > 0) {
    purchasePrice = Math.round((opStockValue / stock) * 100) / 100;
  }
  const mrp = parseNum(getField(row, ['mrp', 'itemMrp', 'maxRetailPrice']), 0);
  let sellingPrice = parseNum(getField(row, ['sellingPrice', 'salePrice', 'salesPrice', 'saleRate', 'stdSalePrice', 'rate', 'retailPrice']), 0);
  if (sellingPrice <= 0 && mrp > 0) sellingPrice = mrp;
  if (sellingPrice <= 0 && purchasePrice > 0) sellingPrice = purchasePrice;

  const mechanicPrice = parseNum(getField(row, ['mechanicPrice', 'workshopPrice', 'minSalePrice', 'splPrice']), 0);
  const wholesalePrice = parseNum(getField(row, ['wholesalePrice', 'dealerPrice']), 0);

  // Opening balance for Accounts in BUSY XML (<OpBal>, <OpeningBal>, <OpBalDr>, <OpBalCr>)
  const rawOpBal = parseNum(getField(row, ['openingBalance', 'openBal', 'opBal', 'openingBal', 'opBalance']), 0);
  const opBalDr = parseNum(getField(row, ['opBalDr', 'debitOpening']), 0);
  const opBalCr = parseNum(getField(row, ['opBalCr', 'creditOpening']), 0);
  let openingBalance = Math.abs(rawOpBal);
  let openingType = String(getField(row, ['openingType', 'drCr', 'opBalType', 'balType']) || '').trim();
  if (opBalDr > 0) {
    openingBalance = opBalDr;
    openingType = 'Dr';
  } else if (opBalCr > 0) {
    openingBalance = opBalCr;
    openingType = 'Cr';
  } else if (!openingType) {
    const grpLower = accountGroupVal.toLowerCase();
    if (rawOpBal < 0 || grpLower.includes('creditor') || grpLower.includes('supplier') || grpLower.includes('liability') || grpLower.includes('payable')) {
      openingType = 'Cr';
    } else {
      openingType = 'Dr';
    }
  }

  const rawTaxField = getField(row, ['taxPercent', 'gstRate', 'taxRate', 'taxCatName', 'taxCategory', 'gstPercent']);
  const taxPercent = parseTaxRateFromText(rawTaxField, 18);

  // In BUSY Accounting, the Alias field (<Alias> / Alias column) stores the Spare Part Number.
  // Always prioritize Alias for oemPartNo when present, followed by explicit partNo fields, then code.
  const aliasVal = String(getField(row, ['alias', 'itemAlias', 'aliasName', 'masterAlias', 'alias1', 'shortName']) || '').trim();
  const explicitOemVal = String(getField(row, ['oemPartNo', 'partNo', 'partNumber', 'oemNo']) || '').trim();
  const rawCodeVal = String(getField(row, ['code', 'itemCode', 'accountCode', 'sku']) || '').trim();
  const cleanCodeVal = rawCodeVal && rawCodeVal.toLowerCase() !== nameVal.toLowerCase() ? rawCodeVal : '';

  const oemVal = aliasVal || explicitOemVal || cleanCodeVal;
  const codeVal = aliasVal || cleanCodeVal || explicitOemVal;

  return {
    sourceId: `${sourceFile}#${rowIndex}`,
    sourceFile,
    rowIndex,
    domain,
    subType,
    name: nameVal,
    alias: aliasVal || oemVal,
    code: codeVal,
    oemPartNo: oemVal,
    mfgPartNo: String(getField(row, ['mfgPartNo', 'manufacturerPartNo', 'catNo', 'catalogueNo']) || '').trim(),
    altPartNo: String(getField(row, ['altPartNo', 'alternatePartNo', 'desc2', 'description2']) || '').trim(),
    barcode: String(getField(row, ['barcode', 'ean', 'itemBarcode']) || '').trim(),
    brand: String(getField(row, ['brand', 'makeBrand', 'itemGroup', 'groupName', 'parentGroup']) || '').trim(),
    manufacturer: String(getField(row, ['manufacturer', 'mfg', 'brand']) || '').trim(),
    category: String(getField(row, ['category', 'itemGroup', 'productGroup', 'groupName', 'parentGroup', 'group']) || '').trim(),
    accountGroup: accountGroupVal,
    customerType: String(getField(row, ['customerType', 'partyType', 'dealerType']) || 'Retail').trim(),
    hsn: String(getField(row, ['hsn', 'hsnCode', 'hsnCodeMaster', 'hsnSac', 'sac']) || '').trim(),
    gstin: (() => {
      const g = String(getField(row, ['gstin', 'gstNo', 'tinNo']) || '').trim().toUpperCase();
      if (!g || /^(URP|UNREGISTERED|NA|N\/A|NIL|NONE|0|-+)$/i.test(g)) return '';
      return g;
    })(),
    phone: String(getField(row, ['phone', 'mobile', 'mobileNo', 'telNo', 'whatsAppNo', 'contact']) || '').trim(),
    email: String(getField(row, ['email', 'emailId', 'eMail']) || '').trim(),
    address: combinedAddress,
    state: String(getField(row, ['state', 'stateName', 'posState']) || '').trim(),
    unit: String(getField(row, ['unit', 'uom', 'unitName', 'mainUnit', 'altUnit']) || 'Nos').trim(),
    taxPercent,
    purchasePrice,
    mrp,
    sellingPrice,
    mechanicPrice,
    wholesalePrice,
    openingStock,
    stock,
    minStock: parseNum(getField(row, ['minStock', 'reorderLevel', 'minLevel', 'criticalLevel']), 5),
    rack: String(getField(row, ['rack', 'rackNo', 'storageLocation']) || '').trim(),
    binLocation: String(getField(row, ['binLocation', 'bin', 'location', 'godown', 'materialCentre']) || '').trim(),
    vehicleMake: String(getField(row, ['vehicleMake', 'make', 'desc1']) || '').trim(),
    vehicleModel: String(getField(row, ['vehicleModel', 'model', 'desc3']) || '').trim(),
    vehicleYear: String(getField(row, ['vehicleYear', 'year', 'desc4']) || '').trim(),
    fuelType: String(getField(row, ['fuelType', 'fuel']) || '').trim(),
    openingBalance,
    openingType,
    creditLimit: parseNum(getField(row, ['creditLimit', 'crLimit']), 0),
    creditDays: parseNum(getField(row, ['creditDays', 'creditDaysForSale', 'creditDaysForPur', 'crDays']), 0),
    // Transaction fields
    voucherNo: String(getField(row, ['voucherNo', 'vchNo', 'vchNumber', 'invoiceNumber', 'billNumber', 'billNo', 'docNo']) || '').trim(),
    date: String(getField(row, ['date', 'voucherDate', 'vchDate', 'invoiceDate', 'billDate']) || '').trim(),
    partyName: String(getField(row, ['partyName', 'clientName', 'supplierName', 'accountName', 'party']) || '').trim(),
    amount: parseNum(getField(row, ['amount', 'totalAmount', 'netAmount', 'vchAmount', 'billAmount', 'grandTotal']), 0),
    taxAmount: parseNum(getField(row, ['taxAmount', 'gstAmount', 'totTaxAmt', 'igst', 'cgst']), 0),
    itemName: String(getField(row, ['itemName', 'productName']) || '').trim(),
    quantity: parseNum(getField(row, ['quantity', 'qty', 'billedQty']), 1),
    rate: parseNum(getField(row, ['rate', 'price', 'itemRate']), 0),
    paymentMode: String(getField(row, ['paymentMode', 'mode', 'settlementMode']) || 'Cash').trim(),
    narration: String(getField(row, ['narration', 'notes', 'remarks', 'longNarration']) || '').trim(),
    raw: row,
  };
}

// Steps 5–11: Full classification, validation, duplicate detection, financial impact & mathematical reconciliation
export function reconcileBusyImport({
  records = [],
  existingClients = [],
  existingSuppliers = [],
  existingProducts = [],
  existingLedgers = [],
  existingBills = [],
  existingPurchases = [],
  duplicatePolicy = 'skip', // 'skip' | 'update' | 'keep_both'
} = {}) {
  const analyzedRows = [];
  const counts = {
    totalSource: records.length,
    newCount: 0,
    updatedCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    invalidCount: 0,
    unsupportedCount: 0,
    unresolvedCount: 0,
  };

  const byMasterType = {};
  const byTxnType = {};

  const staged = {
    clients: [],
    suppliers: [],
    products: [],
    ledgers: [],
    warehouses: [],
    bills: [],
    purchases: [],
    purchaseOrders: [],
    vouchers: [],
  };

  const financialImpact = {
    newProductsStockQty: 0,
    newProductsStockValue: 0,
    debtorsOpeningDr: 0,
    creditorsOpeningCr: 0,
    salesImportedTotal: 0,
    purchasesImportedTotal: 0,
    vouchersImportedTotal: 0,
  };

  // Track seen items within the same import batch as well
  const workingProducts = [...(existingProducts || [])];
  const clientByName = new Map((existingClients || []).map(c => [String(c.name || '').trim().toLowerCase(), c]));
  const supplierByName = new Map((existingSuppliers || []).map(s => [String(s.name || '').trim().toLowerCase(), s]));
  const ledgerByName = new Map((existingLedgers || []).map(l => [String(l.name || '').trim().toLowerCase(), l]));
  const billByNo = new Map((existingBills || []).map(b => [String(b.invoiceNumber || b.id || '').trim().toLowerCase(), b]));
  const purByNo = new Map((existingPurchases || []).map(p => [String(p.billNumber || p.id || '').trim().toLowerCase(), p]));

  for (const rec of records) {
    // Guard: ensure an Account record is never routed to Item even if custom/raw records are passed in
    if (
      rec.domain === 'Master' &&
      rec.subType === 'Item' &&
      (KNOWN_ACCOUNT_NAMES_RE.test(rec.name || '') || KNOWN_ACCOUNT_GROUPS_RE.test(rec.accountGroup || '') || KNOWN_ACCOUNT_GROUPS_RE.test(rec.category || '')) &&
      !(Number(rec.sellingPrice) > 0 || Number(rec.purchasePrice) > 0 || Number(rec.mrp) > 0 || rec.hsn)
    ) {
      rec.subType = 'Account';
    }

    if (rec.domain === 'Master') {
      byMasterType[rec.subType] = (byMasterType[rec.subType] || 0) + 1;
    } else {
      byTxnType[rec.subType] = (byTxnType[rec.subType] || 0) + 1;
    }

    // 1. Check Unsupported Transaction Types
    if (
      rec.domain === 'Transaction' &&
      (BUSY_UNSUPPORTED_TXN_TYPES.some(u => u.toLowerCase() === rec.subType.toLowerCase()) ||
        (!BUSY_SUPPORTED_TXN_TYPES.some(s => s.toLowerCase() === rec.subType.toLowerCase())))
    ) {
      counts.unsupportedCount++;
      analyzedRows.push({
        ...rec,
        status: 'Unsupported',
        reason: `BUSY transaction type "${rec.subType}" is a service/statutory form workflow not mapped to GST accounting vouchers. Flagged transparently.`,
      });
      continue;
    }

    // 2. Validate Record
    if (rec.domain === 'Master') {
      if (!rec.name) {
        counts.invalidCount++;
        analyzedRows.push({ ...rec, status: 'Invalid', reason: 'Missing master name' });
        continue;
      }
      if (rec.gstin && rec.gstin.length !== 15) {
        counts.invalidCount++;
        analyzedRows.push({ ...rec, status: 'Invalid', reason: `Invalid GSTIN length (${rec.gstin})` });
        continue;
      }
    } else {
      if (!rec.voucherNo && !rec.partyName && rec.amount <= 0) {
        counts.invalidCount++;
        analyzedRows.push({ ...rec, status: 'Invalid', reason: 'Transaction missing Voucher No, Party, and Amount' });
        continue;
      }
    }

    // 3. Handle Master Records
    if (rec.domain === 'Master') {
      if (rec.subType === 'Item') {
        const partNumberFromAlias = rec.alias || rec.oemPartNo || rec.code || '';
        const candidateProd = normalizeAutomotiveProduct({
          name: rec.name,
          alias: rec.alias || partNumberFromAlias,
          itemCode: rec.code || partNumberFromAlias,
          oemPartNo: partNumberFromAlias,
          mfgPartNo: rec.mfgPartNo,
          altPartNo: rec.altPartNo,
          sku: rec.code || partNumberFromAlias,
          barcode: rec.barcode,
          brand: rec.brand,
          manufacturer: rec.manufacturer || rec.brand,
          category: rec.category || 'Engine Parts',
          productGroup: rec.category || 'Engine Parts',
          hsn: rec.hsn,
          unit: rec.unit || 'Nos',
          taxPercent: rec.taxPercent,
          purchasePrice: rec.purchasePrice,
          mrp: rec.mrp || rec.sellingPrice,
          sellingPrice: rec.sellingPrice,
          rate: rec.sellingPrice,
          mechanicPrice: rec.mechanicPrice || rec.sellingPrice,
          wholesalePrice: rec.wholesalePrice || rec.sellingPrice,
          openingStock: rec.openingStock || rec.stock,
          stock: rec.stock,
          minStock: rec.minStock || 5,
          rack: rec.rack,
          binLocation: rec.binLocation,
          vehicleMake: rec.vehicleMake,
          vehicleModel: rec.vehicleModel,
          vehicleYear: rec.vehicleYear,
          fuelType: rec.fuelType,
        });

        const { exactDuplicates, crossBrandEquivalents } = findDuplicateProducts(candidateProd, workingProducts);
        if (exactDuplicates.length > 0) {
          const existing = exactDuplicates[0].product;
          const needsAliasPartBackfill = !existing.oemPartNo && Boolean(candidateProd.oemPartNo);
          if (duplicatePolicy === 'skip' && !needsAliasPartBackfill) {
            counts.duplicateCount++;
            analyzedRows.push({
              ...rec,
              status: 'Duplicate',
              reason: `${exactDuplicates[0].reason} (Matches existing "${existing.name}") — Skipped`,
            });
            continue;
          } else if (duplicatePolicy === 'update' || needsAliasPartBackfill) {
            counts.updatedCount++;
            const updatedProd = {
              ...existing,
              ...candidateProd,
              id: existing.id,
              oemPartNo: candidateProd.oemPartNo || existing.oemPartNo || existing.alias || existing.itemCode || '',
              alias: candidateProd.alias || existing.alias || candidateProd.oemPartNo || '',
            };
            staged.products.push(updatedProd);
            const idxInWorking = workingProducts.findIndex(w => w.id === existing.id);
            if (idxInWorking >= 0) workingProducts[idxInWorking] = updatedProd;
            analyzedRows.push({
              ...rec,
              status: 'Updated',
              reason: needsAliasPartBackfill
                ? `Updated existing product "${existing.name}" with BUSY Alias Part No (${updatedProd.oemPartNo})`
                : `Updates existing product "${existing.name}" (${exactDuplicates[0].reason})`,
            });
            continue;
          }
        }

        // Cross-brand equivalents are NEVER merged; they are imported as distinct brand products
        counts.newCount++;
        const newProd = {
          ...candidateProd,
          id: `prod_busy_${Date.now()}_${staged.products.length + 1}`,
        };
        staged.products.push(newProd);
        workingProducts.push(newProd);
        financialImpact.newProductsStockQty += Number(newProd.stock) || 0;
        financialImpact.newProductsStockValue += (Number(newProd.stock) || 0) * (Number(newProd.purchasePrice || newProd.sellingPrice) || 0);
        analyzedRows.push({
          ...rec,
          status: 'New',
          reason: crossBrandEquivalents.length > 0
            ? `New Item (${crossBrandEquivalents[0].reason} — preserved as separate brand)`
            : 'New Automotive Spare Part',
        });
        continue;
      }

      if (rec.subType === 'Account' || rec.subType === 'Opening Balance' || rec.subType === 'Bill-by-Bill Reference') {
        const grp = rec.accountGroup.toLowerCase();
        const isSupplier = grp.includes('creditor') || grp.includes('supplier') || grp.includes('vendor');
        const isLedgerGroup =
          KNOWN_ACCOUNT_NAMES_RE.test(rec.name || '') ||
          grp.includes('bank') ||
          grp.includes('cash') ||
          grp.includes('expense') ||
          grp.includes('income') ||
          grp.includes('revenue') ||
          grp.includes('duty') ||
          grp.includes('duties') ||
          grp.includes('tax') ||
          grp.includes('sale') ||
          grp.includes('purchase') ||
          grp.includes('capital') ||
          grp.includes('loan') ||
          grp.includes('asset') ||
          grp.includes('liabilit') ||
          grp.includes('branch') ||
          grp.includes('suspense') ||
          grp.includes('provision') ||
          grp.includes('reserve') ||
          grp.includes('stock');
        const isClient =
          grp.includes('debtor') ||
          grp.includes('customer') ||
          grp.includes('client') ||
          (!isSupplier && !isLedgerGroup && ['Retail', 'Mechanic', 'Garage', 'Workshop', 'Wholesaler', 'Dealer'].includes(rec.customerType));

        if (isSupplier) {
          const existing = supplierByName.get(rec.name.toLowerCase());
          if (existing && duplicatePolicy === 'skip') {
            counts.duplicateCount++;
            analyzedRows.push({ ...rec, status: 'Duplicate', reason: `Supplier "${rec.name}" already exists` });
            continue;
          }
          const supObj = {
            id: existing?.id || `sup_busy_${Date.now()}_${staged.suppliers.length + 1}`,
            name: rec.name,
            accountCode: rec.code,
            gstin: rec.gstin,
            phone: rec.phone,
            email: rec.email,
            address: rec.address,
            state: rec.state,
            openingBalance: rec.openingBalance,
            openingType: rec.openingType || 'Cr',
            creditDays: rec.creditDays,
          };
          staged.suppliers.push(supObj);
          supplierByName.set(rec.name.toLowerCase(), supObj);
          financialImpact.creditorsOpeningCr += Number(rec.openingBalance) || 0;
          if (existing) {
            counts.updatedCount++;
            analyzedRows.push({ ...rec, status: 'Updated', reason: 'Updated existing Supplier Master' });
          } else {
            counts.newCount++;
            analyzedRows.push({ ...rec, status: 'New', reason: 'New Supplier (Sundry Creditor)' });
          }
          continue;
        }

        if (isClient) {
          const existing = clientByName.get(rec.name.toLowerCase());
          if (existing && duplicatePolicy === 'skip') {
            counts.duplicateCount++;
            analyzedRows.push({ ...rec, status: 'Duplicate', reason: `Customer "${rec.name}" already exists` });
            continue;
          }
          const cliObj = {
            id: existing?.id || `cli_busy_${Date.now()}_${staged.clients.length + 1}`,
            name: rec.name,
            accountCode: rec.code,
            customerType: rec.customerType || 'Retail',
            gstin: rec.gstin,
            phone: rec.phone,
            email: rec.email,
            address: rec.address,
            state: rec.state,
            openingBalance: rec.openingBalance,
            openingType: rec.openingType || 'Dr',
            creditLimit: rec.creditLimit,
            creditDays: rec.creditDays,
          };
          staged.clients.push(cliObj);
          clientByName.set(rec.name.toLowerCase(), cliObj);
          financialImpact.debtorsOpeningDr += Number(rec.openingBalance) || 0;
          if (existing) {
            counts.updatedCount++;
            analyzedRows.push({ ...rec, status: 'Updated', reason: 'Updated existing Customer Master' });
          } else {
            counts.newCount++;
            analyzedRows.push({ ...rec, status: 'New', reason: `New Customer (${cliObj.customerType})` });
          }
          continue;
        }

        // General Ledger Account
        const existing = ledgerByName.get(rec.name.toLowerCase());
        if (existing && duplicatePolicy === 'skip') {
          counts.duplicateCount++;
          analyzedRows.push({ ...rec, status: 'Duplicate', reason: `Ledger "${rec.name}" already exists` });
          continue;
        }
        const ldgObj = {
          id: existing?.id || `ldg_busy_${Date.now()}_${staged.ledgers.length + 1}`,
          name: rec.name,
          code: rec.code,
          group: rec.accountGroup || 'Indirect Expenses',
          openingBalance: rec.openingBalance,
          openingType: rec.openingType || 'Dr',
        };
        staged.ledgers.push(ldgObj);
        ledgerByName.set(rec.name.toLowerCase(), ldgObj);
        if (existing) {
          counts.updatedCount++;
          analyzedRows.push({ ...rec, status: 'Updated', reason: 'Updated General Ledger' });
        } else {
          counts.newCount++;
          analyzedRows.push({ ...rec, status: 'New', reason: `New Ledger (${ldgObj.group})` });
        }
        continue;
      }

      // Auxiliary Master Types (Account Group, Item Group, Tax Category, Unit, Bill Sundry, etc.)
      counts.newCount++;
      staged.ledgers.push({
        id: `ldg_aux_${Date.now()}_${staged.ledgers.length + 1}`,
        name: `${rec.subType}: ${rec.name}`,
        code: rec.code,
        group: 'Current Assets',
        busyMasterType: rec.subType,
        openingBalance: 0,
        openingType: 'Dr',
      });
      analyzedRows.push({
        ...rec,
        status: 'New',
        reason: `Imported BUSY ${rec.subType} configuration master`,
      });
      continue;
    }

    // 4. Handle Supported Transactions
    const vNo = rec.voucherNo || `BUSY-${rec.subType.slice(0, 3).toUpperCase()}-${rec.rowIndex}`;
    const dStr = rec.date || new Date().toISOString().slice(0, 10);

    if (rec.subType === 'Sales' || rec.subType === 'Sales Return' || rec.subType === 'Sales Quotation' || rec.subType === 'Sales Order') {
      const existing = billByNo.get(vNo.toLowerCase());
      if (existing && duplicatePolicy === 'skip') {
        counts.duplicateCount++;
        analyzedRows.push({ ...rec, status: 'Duplicate', reason: `Invoice ${vNo} already exists` });
        continue;
      }
      const taxable = Math.max(0, rec.amount - rec.taxAmount);
      const halfTax = Math.round((rec.taxAmount / 2) * 100) / 100;
      const invoiceType = rec.subType === 'Sales Return'
        ? 'credit-note'
        : rec.subType === 'Sales Quotation' || rec.subType === 'Sales Order'
          ? 'estimate'
          : 'tax-invoice';

      const billObj = {
        id: existing?.id || vNo,
        invoiceNumber: vNo,
        invoiceDate: dStr,
        invoiceType,
        clientName: rec.partyName || 'Walk-in Customer',
        clientGstin: rec.gstin || '',
        totalAmount: rec.amount,
        cgst: halfTax,
        sgst: halfTax,
        igst: 0,
        status: rec.paymentMode.toLowerCase() === 'cash' ? 'Paid' : 'Pending',
        payments: rec.paymentMode.toLowerCase() === 'cash' ? [{ amount: rec.amount, date: dStr, mode: 'Cash' }] : [],
        items: [
          {
            description: rec.itemName || 'Automotive Spare Parts (BUSY Import)',
            hsn: rec.hsn || '8708',
            quantity: rec.quantity || 1,
            unit: rec.unit || 'Nos',
            rate: rec.rate || taxable,
            taxPercent: rec.taxPercent || 18,
            amount: taxable,
          },
        ],
      };
      staged.bills.push(billObj);
      billByNo.set(vNo.toLowerCase(), billObj);
      financialImpact.salesImportedTotal += Number(rec.amount) || 0;
      if (existing) {
        counts.updatedCount++;
        analyzedRows.push({ ...rec, status: 'Updated', reason: `Updated ${rec.subType} ${vNo}` });
      } else {
        counts.newCount++;
        analyzedRows.push({ ...rec, status: 'New', reason: `New ${rec.subType} (${vNo})` });
      }
      continue;
    }

    if (rec.subType === 'Purchase' || rec.subType === 'Purchase Order' || rec.subType === 'Purchase Quotation') {
      if (rec.subType === 'Purchase Order' || rec.subType === 'Purchase Quotation') {
        counts.newCount++;
        staged.purchaseOrders.push({
          id: `po_busy_${Date.now()}_${staged.purchaseOrders.length + 1}`,
          poNumber: vNo,
          date: dStr,
          supplierName: rec.partyName || 'Supplier',
          supplierGstin: rec.gstin || '',
          totalAmount: rec.amount,
          status: 'Open',
          items: [{ name: rec.itemName || 'Spare Part', quantity: rec.quantity || 1, rate: rec.rate || rec.amount }],
        });
        analyzedRows.push({ ...rec, status: 'New', reason: `New ${rec.subType} (${vNo})` });
        continue;
      }

      const existing = purByNo.get(vNo.toLowerCase());
      if (existing && duplicatePolicy === 'skip') {
        counts.duplicateCount++;
        analyzedRows.push({ ...rec, status: 'Duplicate', reason: `Purchase Bill ${vNo} already exists` });
        continue;
      }
      const halfTax = Math.round((rec.taxAmount / 2) * 100) / 100;
      const purObj = {
        id: existing?.id || `pur_busy_${Date.now()}_${staged.purchases.length + 1}`,
        billNumber: vNo,
        date: dStr,
        supplierName: rec.partyName || 'Automotive Supplier',
        supplierGstin: rec.gstin || '',
        totalAmount: rec.amount,
        taxableAmount: Math.max(0, rec.amount - rec.taxAmount),
        cgst: halfTax,
        sgst: halfTax,
        igst: 0,
        items: [
          {
            name: rec.itemName || 'Automotive Spare Part',
            hsn: rec.hsn || '8708',
            quantity: rec.quantity || 1,
            rate: rec.rate || Math.max(0, rec.amount - rec.taxAmount),
            taxPercent: rec.taxPercent || 18,
          },
        ],
      };
      staged.purchases.push(purObj);
      purByNo.set(vNo.toLowerCase(), purObj);
      financialImpact.purchasesImportedTotal += Number(rec.amount) || 0;
      if (existing) {
        counts.updatedCount++;
        analyzedRows.push({ ...rec, status: 'Updated', reason: `Updated Purchase Bill ${vNo}` });
      } else {
        counts.newCount++;
        analyzedRows.push({ ...rec, status: 'New', reason: `New Purchase Bill (${vNo})` });
      }
      continue;
    }

    // Remaining supported vouchers: Payment, Receipt, Journal, Contra, Debit Note, Credit Note, Purchase Return, Stock Journal, Stock Transfer, Production, Unassemble
    counts.newCount++;
    staged.vouchers.push({
      id: `vch_busy_${Date.now()}_${staged.vouchers.length + 1}`,
      voucherNo: vNo,
      date: dStr,
      voucherType: rec.subType,
      partyName: rec.partyName,
      amount: rec.amount,
      paymentMode: rec.paymentMode || 'Cash',
      narration: rec.narration || `Imported BUSY ${rec.subType} (${vNo})`,
      debitAccountId: rec.subType === 'Receipt' ? 'sys_cash' : 'sys_purchase',
      creditAccountId: rec.subType === 'Payment' ? 'sys_cash' : 'sys_sales',
    });
    financialImpact.vouchersImportedTotal += Number(rec.amount) || 0;
    analyzedRows.push({
      ...rec,
      status: 'New',
      reason: `New ${rec.subType} Voucher (${vNo})`,
    });
  }

  const accountedFor =
    counts.newCount +
    counts.updatedCount +
    counts.duplicateCount +
    counts.skippedCount +
    counts.invalidCount +
    counts.unsupportedCount +
    counts.unresolvedCount;

  return {
    counts: {
      ...counts,
      accountedFor,
      reconciled: counts.totalSource === accountedFor,
    },
    byMasterType,
    byTxnType,
    analyzedRows,
    staged,
    financialImpact,
  };
}

// Realistic Automotive Spare-Parts BUSY .DAT Sample Dataset for 1-Click Demo & Verification
export const SAMPLE_BUSY_MASTERS_DAT = `recordCategory|recordType|name|code|oemPartNo|mfgPartNo|altPartNo|brand|manufacturer|category|hsn|unit|taxPercent|purchasePrice|mrp|sellingPrice|mechanicPrice|wholesalePrice|openingStock|stock|minStock|rack|binLocation|vehicleMake|vehicleModel|vehicleYear|fuelType|accountGroup|customerType|gstin|phone|state|openingBalance|openingType|creditLimit|creditDays
Master|Item|Front Disc Brake Pad Set Swift/Dzire|BP-MS-01|55810M75J00|KBX-5581|TVS-BP75|Bosch|Bosch Automotive|Braking System|87083000|Set|18|680|1250|1050|920|840|24|24|6|R-A1|BIN-101|Maruti Suzuki|Swift / Dzire|2018-2024|Petrol|Engine Parts|||||||0|Dr|0|0
Master|Item|Front Disc Brake Pad Set Swift/Dzire|BP-MS-02|55810M75J00|TVS-5581|BOS-75J|TVS Girling|TVS Brake Linings|Braking System|87083000|Set|18|610|1120|960|850|780|18|18|5|R-A1|BIN-102|Maruti Suzuki|Swift / Dzire|2018-2024|Petrol|Braking System|||||||0|Dr|0|0
Master|Item|Spin-On Engine Oil Filter Creta/Seltos 1.5 CRDi|OF-HY-09|26300-35505|MH-W811/80|PURO-L19|Mann Filter|Mann+Hummel|Filters & Fluids|84212300|Nos|18|210|395|340|295|265|45|45|10|R-B2|BIN-204|Hyundai|Creta / Verna|2020-2025|Diesel|Filters & Fluids|||||||0|Dr|0|0
Master|Item|Clutch Plate & Cover Assembly Bolero mHawk|CL-MM-04|0801CAA04591N|VAL-402118|LUK-6223|Valeo|Valeo India|Clutch & Transmission|87089300|Kit|28|3450|5890|4950|4450|4150|8|8|3|R-C3|BIN-309|Mahindra|Bolero / Scorpio|2017-2024|Diesel|Clutch & Transmission|||||||0|Dr|0|0
Master|Item|Front Shock Absorber Strut LH Nexon|SA-TT-11|543832100101|GAB-G5109|MNR-334|Gabriel|Gabriel India|Suspension & Steering|87088000|Nos|18|1720|2850|2420|2150|1980|12|12|4|R-D1|BIN-401|Tata|Nexon|2019-2025|Petrol|Suspension & Steering|||||||0|Dr|0|0
Master|Account|Sharma Auto Garage & Service Centre|CUST-101||||||||||||||||||||||||Sundry Debtors|Workshop|07AABCS1429B1Z1|9811223344|Delhi|18500|Dr|75000|30
Master|Account|Highway Motors Wholesale Spares|CUST-102||||||||||||||||||||||||Sundry Debtors|Wholesaler|06AABCH8821C1Z8|9818009911|Haryana|42000|Dr|200000|45
Master|Account|Kashmere Gate OEM Distributors Pvt Ltd|SUP-201||||||||||||||||||||||||Sundry Creditors|Supplier|07AAACK5519P1Z3|9810112233|Delhi|64000|Cr|500000|45
Master|Tax Category|GST 18% Auto Spares|TAX-18|||||||||18||||||||||||||||||||||0|Cr|0|0
Master|Unit|Set of 4 Pieces|UOM-SET||||||||Set|||||||||||||||||||||||0|Dr|0|0`;

export const SAMPLE_BUSY_TXNS_DAT = `recordCategory|recordType|voucherNo|date|partyName|gstin|itemName|hsn|quantity|unit|rate|taxPercent|taxAmount|amount|paymentMode|narration
Transaction|Sales|BUSY/INV/26-27/0101|2026-04-02|Sharma Auto Garage & Service Centre|07AABCS1429B1Z1|Front Disc Brake Pad Set Swift/Dzire|87083000|4|Set|920|18|662.4|4342.4|Credit|Counter credit sale to workshop
Transaction|Purchase|KGD/PUR/2026/0881|2026-04-01|Kashmere Gate OEM Distributors Pvt Ltd|07AAACK5519P1Z3|Spin-On Engine Oil Filter Creta/Seltos 1.5 CRDi|84212300|30|Nos|210|18|1134|7434|Credit|Stock inward against supplier tax invoice
Transaction|Receipt|BUSY/RCP/2026/0041|2026-04-03|Sharma Auto Garage & Service Centre|07AABCS1429B1Z1||||||0|0|10000|UPI|Part payment received via UPI
Transaction|Payment|BUSY/PMT/2026/0019|2026-04-03|Kashmere Gate OEM Distributors Pvt Ltd|07AAACK5519P1Z3||||||0|0|25000|NEFT|NEFT payout to OEM distributor
Transaction|Call Allocation|BUSY/CALL/0009|2026-04-03|Field Technician Desk||||||||0|0|Cash|Service call allocation (unsupported BUSY CRM type)`;
