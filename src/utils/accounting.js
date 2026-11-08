// Double-Entry Accounting Engine for Indian GST, Automotive Spare-Parts, Ledgers, Vouchers & Financial Statements
import { isCancelledBill } from '../utils.js';

export const ACCOUNT_GROUPS = [
  { id: 'Capital Account', nature: 'Liability', statement: 'BS' },
  { id: 'Loans (Liability)', nature: 'Liability', statement: 'BS' },
  { id: 'Sundry Creditors', nature: 'Liability', statement: 'BS' },
  { id: 'Duties & Taxes', nature: 'Liability', statement: 'BS' },
  { id: 'Current Liabilities', nature: 'Liability', statement: 'BS' },
  { id: 'Fixed Assets', nature: 'Asset', statement: 'BS' },
  { id: 'Stock-in-Hand', nature: 'Asset', statement: 'BS' },
  { id: 'Sundry Debtors', nature: 'Asset', statement: 'BS' },
  { id: 'Cash-in-Hand', nature: 'Asset', statement: 'BS' },
  { id: 'Bank Accounts', nature: 'Asset', statement: 'BS' },
  { id: 'Current Assets', nature: 'Asset', statement: 'BS' },
  { id: 'Sales Accounts', nature: 'Income', statement: 'PL' },
  { id: 'Direct Income', nature: 'Income', statement: 'PL' },
  { id: 'Indirect Income', nature: 'Income', statement: 'PL' },
  { id: 'Purchase Accounts', nature: 'Expense', statement: 'PL' },
  { id: 'Direct Expenses', nature: 'Expense', statement: 'PL' },
  { id: 'Indirect Expenses', nature: 'Expense', statement: 'PL' },
];

export const VOUCHER_TYPES = [
  { id: 'Payment', label: 'Payment Voucher', prefix: 'PMT', shortcut: 'F7', desc: 'Record supplier payment, expense payout, or cash/bank outflow' },
  { id: 'Receipt', label: 'Receipt Voucher', prefix: 'RCP', shortcut: '', desc: 'Record customer payment receipt or miscellaneous income' },
  { id: 'Journal', label: 'Journal Voucher', prefix: 'JRN', shortcut: '', desc: 'Non-cash adjustment entry between any two ledgers' },
  { id: 'Contra', label: 'Contra Voucher', prefix: 'CNT', shortcut: '', desc: 'Cash deposit to bank, cash withdrawal from bank, or bank-to-bank transfer' },
  { id: 'Credit Note', label: 'Credit Note', prefix: 'CNV', shortcut: '', desc: 'Credit customer account for rate diff, discount, or return' },
  { id: 'Debit Note', label: 'Debit Note', prefix: 'DNV', shortcut: '', desc: 'Debit supplier account for purchase return or claim' },
  { id: 'Sales Return', label: 'Sales Return Voucher', prefix: 'SRN', shortcut: 'F8', desc: 'Customer spare-parts return with inward stock & GST reversal' },
  { id: 'Purchase Return', label: 'Purchase Return Voucher', prefix: 'PRN', shortcut: 'F9', desc: 'Return defective/excess parts to supplier with outward stock & ITC reversal' },
  { id: 'Stock Journal', label: 'Stock Journal', prefix: 'SJN', shortcut: '', desc: 'Internal stock adjustment, kit assembly, or inter-warehouse transfer' },
];

export const SYSTEM_LEDGERS = [
  { id: 'sys_cash', name: 'Cash-in-Hand A/c', code: 'CASH-01', group: 'Cash-in-Hand', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_bank', name: 'Primary Bank A/c', code: 'BANK-01', group: 'Bank Accounts', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_sales', name: 'GST Sales A/c', code: 'SALE-01', group: 'Sales Accounts', isSystem: true, openingBalance: 0, openingType: 'Cr' },
  { id: 'sys_sales_return', name: 'Sales Return A/c', code: 'SALE-RET', group: 'Sales Accounts', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_purchase', name: 'GST Purchases A/c', code: 'PUR-01', group: 'Purchase Accounts', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_purchase_return', name: 'Purchase Return A/c', code: 'PUR-RET', group: 'Purchase Accounts', isSystem: true, openingBalance: 0, openingType: 'Cr' },
  { id: 'sys_out_cgst', name: 'Output CGST A/c', code: 'TAX-OCGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Cr' },
  { id: 'sys_out_sgst', name: 'Output SGST A/c', code: 'TAX-OSGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Cr' },
  { id: 'sys_out_igst', name: 'Output IGST A/c', code: 'TAX-OIGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Cr' },
  { id: 'sys_in_cgst', name: 'Input CGST (ITC) A/c', code: 'TAX-ICGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_in_sgst', name: 'Input SGST (ITC) A/c', code: 'TAX-ISGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_in_igst', name: 'Input IGST (ITC) A/c', code: 'TAX-IIGST', group: 'Duties & Taxes', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_freight', name: 'Freight & Forwarding A/c', code: 'EXP-FRT', group: 'Direct Expenses', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_discount', name: 'Discount Allowed / Received A/c', code: 'EXP-DISC', group: 'Indirect Expenses', isSystem: true, openingBalance: 0, openingType: 'Dr' },
  { id: 'sys_capital', name: 'Proprietor / Partner Capital A/c', code: 'CAP-01', group: 'Capital Account', isSystem: true, openingBalance: 0, openingType: 'Cr' },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normKey = (s) => String(s || '').trim().toLowerCase();

export const isCashMode = (mode = '') => {
  const m = String(mode || '').toLowerCase();
  return m === 'cash' || m === 'petty cash';
};

export function buildDoubleEntryBook({
  bills = [],
  purchases = [],
  expenses = [],
  receipts = [],
  cashEntries = [],
  vouchers = [],
  ledgers = [],
  clients = [],
  suppliers = [],
  products = [],
  startDate = '',
  endDate = '',
} = {}) {
  const accountMap = new Map();

  const registerAccount = (acc) => {
    if (!acc || !acc.id) return null;
    if (accountMap.has(acc.id)) return accountMap.get(acc.id);
    const openAmt = round2(acc.openingBalance);
    const openType = acc.openingType === 'Cr' ? 'Cr' : 'Dr';
    const signedOpening = openType === 'Dr' ? openAmt : -openAmt; // Positive = Dr, Negative = Cr
    const entry = {
      id: acc.id,
      name: acc.name || 'Unnamed Account',
      code: acc.code || '',
      group: acc.group || 'Current Assets',
      partyType: acc.partyType || null,
      gstin: acc.gstin || '',
      phone: acc.phone || '',
      creditLimit: Number(acc.creditLimit) || 0,
      creditDays: Number(acc.creditDays) || 0,
      isSystem: !!acc.isSystem,
      openingBalance: openAmt,
      openingType: openType,
      signedOpening,
      periodDebit: 0,
      periodCredit: 0,
      postings: [],
    };
    accountMap.set(acc.id, entry);
    return entry;
  };

  // 1. Register system ledgers
  for (const sys of SYSTEM_LEDGERS) registerAccount(sys);

  // 2. Register user-defined ledgers
  for (const l of ledgers || []) {
    registerAccount({
      id: l.id,
      name: l.name,
      code: l.code || l.accountCode || '',
      group: l.group || 'Indirect Expenses',
      gstin: l.gstin || '',
      phone: l.phone || '',
      openingBalance: Number(l.openingBalance) || 0,
      openingType: l.openingType || (['Sundry Creditors', 'Capital Account', 'Loans (Liability)', 'Sales Accounts', 'Duties & Taxes'].includes(l.group) ? 'Cr' : 'Dr'),
    });
  }

  // 3. Register Customer ledgers (Sundry Debtors)
  const clientByName = new Map();
  const clientByGstin = new Map();
  for (const c of clients || []) {
    if (!c) continue;
    const accId = `cli_${c.id}`;
    const acc = registerAccount({
      id: accId,
      name: c.name || 'Walk-in Customer',
      code: c.accountCode || c.code || '',
      group: 'Sundry Debtors',
      partyType: c.customerType || 'Retail',
      gstin: c.gstin || '',
      phone: c.phone || '',
      creditLimit: Number(c.creditLimit) || 0,
      creditDays: Number(c.creditDays) || 0,
      openingBalance: Number(c.openingBalance) || 0,
      openingType: c.openingType || 'Dr',
    });
    if (c.name) clientByName.set(normKey(c.name), acc);
    if (c.gstin) clientByGstin.set(normKey(c.gstin), acc);
  }

  // 4. Register Supplier ledgers (Sundry Creditors)
  const supplierByName = new Map();
  const supplierByGstin = new Map();
  for (const s of suppliers || []) {
    if (!s) continue;
    const accId = `sup_${s.id}`;
    const acc = registerAccount({
      id: accId,
      name: s.name || 'General Supplier',
      code: s.accountCode || s.code || '',
      group: 'Sundry Creditors',
      partyType: 'Supplier',
      gstin: s.gstin || '',
      phone: s.phone || '',
      creditLimit: Number(s.creditLimit) || 0,
      creditDays: Number(s.creditDays) || 0,
      openingBalance: Number(s.openingBalance) || 0,
      openingType: s.openingType || 'Cr',
    });
    if (s.name) supplierByName.set(normKey(s.name), acc);
    if (s.gstin) supplierByGstin.set(normKey(s.gstin), acc);
  }

  const getOrCreateClientAccount = (name, gstin) => {
    if (gstin && clientByGstin.has(normKey(gstin))) return clientByGstin.get(normKey(gstin));
    if (name && clientByName.has(normKey(name))) return clientByName.get(normKey(name));
    const cleanName = String(name || 'Walk-in Customer').trim();
    const id = `cli_auto_${normKey(cleanName).replace(/[^a-z0-9]/g, '_')}`;
    const acc = registerAccount({
      id,
      name: cleanName,
      group: 'Sundry Debtors',
      gstin: gstin || '',
      openingBalance: 0,
      openingType: 'Dr',
    });
    clientByName.set(normKey(cleanName), acc);
    if (gstin) clientByGstin.set(normKey(gstin), acc);
    return acc;
  };

  const getOrCreateSupplierAccount = (name, gstin) => {
    if (gstin && supplierByGstin.has(normKey(gstin))) return supplierByGstin.get(normKey(gstin));
    if (name && supplierByName.has(normKey(name))) return supplierByName.get(normKey(name));
    const cleanName = String(name || 'General Supplier').trim();
    const id = `sup_auto_${normKey(cleanName).replace(/[^a-z0-9]/g, '_')}`;
    const acc = registerAccount({
      id,
      name: cleanName,
      group: 'Sundry Creditors',
      gstin: gstin || '',
      openingBalance: 0,
      openingType: 'Cr',
    });
    supplierByName.set(normKey(cleanName), acc);
    if (gstin) supplierByGstin.set(normKey(gstin), acc);
    return acc;
  };

  const getOrCreateExpenseAccount = (category) => {
    const cat = String(category || 'General Expense').trim();
    const id = `exp_cat_${normKey(cat).replace(/[^a-z0-9]/g, '_')}`;
    return registerAccount({
      id,
      name: `${cat} A/c`,
      group: 'Indirect Expenses',
      openingBalance: 0,
      openingType: 'Dr',
    });
  };

  const daybook = [];

  const inDateRange = (dateStr) => {
    if (!dateStr) return true;
    const d = String(dateStr).slice(0, 10);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const postVoucher = ({ id, date, voucherNo, voucherType, narration, refId, lines = [] }) => {
    const validLines = lines
      .map(l => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
      .filter(l => l.accountId && (l.debit > 0 || l.credit > 0));
    if (!validLines.length) return;

    const dStr = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const beforeStart = startDate && dStr < startDate;
    const afterEnd = endDate && dStr > endDate;
    if (afterEnd) return;

    const totalDebit = round2(validLines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(validLines.reduce((s, l) => s + l.credit, 0));

    for (const line of validLines) {
      const acc = accountMap.get(line.accountId);
      if (!acc) continue;
      if (beforeStart) {
        acc.signedOpening = round2(acc.signedOpening + line.debit - line.credit);
      } else {
        acc.periodDebit = round2(acc.periodDebit + line.debit);
        acc.periodCredit = round2(acc.periodCredit + line.credit);
        const contraNames = validLines
          .filter(x => x.accountId !== line.accountId)
          .map(x => accountMap.get(x.accountId)?.name || x.accountName || '')
          .filter(Boolean);
        acc.postings.push({
          id: `${id}_${line.accountId}`,
          voucherId: id,
          date: dStr,
          voucherNo: voucherNo || id,
          voucherType,
          particulars: line.particulars || contraNames.join(', ') || narration || voucherType,
          narration: narration || '',
          debit: line.debit,
          credit: line.credit,
          refId: refId || id,
        });
      }
    }

    if (!beforeStart && inDateRange(dStr)) {
      daybook.push({
        id,
        date: dStr,
        voucherNo: voucherNo || id,
        voucherType,
        narration: narration || '',
        totalDebit,
        totalCredit,
        balanced: Math.abs(totalDebit - totalCredit) < 0.05,
        lines: validLines.map(l => ({
          ...l,
          accountName: accountMap.get(l.accountId)?.name || l.accountName || l.accountId,
        })),
      });
    }
  };

  // 5. Post Sales Invoices & Credit Notes
  for (const bill of bills || []) {
    if (!bill || isCancelledBill(bill)) continue;
    const invType = bill.invoiceType || bill.data?.invoiceType || 'tax-invoice';
    if (invType === 'estimate' || invType === 'proforma' || invType === 'delivery-challan') continue;

    const clientName = bill.clientName || bill.data?.client?.name || 'Walk-in Customer';
    const clientGstin = bill.clientGstin || bill.data?.client?.gstin || '';
    const clientAcc = getOrCreateClientAccount(clientName, clientGstin);
    const total = round2(bill.totalAmount ?? bill.data?.totalAmount ?? bill.data?.total ?? 0);
    if (total <= 0) continue;

    const cgst = round2(bill.cgst ?? bill.data?.cgst ?? (bill.data?.taxAmount ? bill.data.taxAmount / 2 : 0));
    const sgst = round2(bill.sgst ?? bill.data?.sgst ?? (bill.data?.taxAmount ? bill.data.taxAmount / 2 : 0));
    const igst = round2(bill.igst ?? bill.data?.igst ?? 0);
    const taxTotal = round2(cgst + sgst + igst);
    const netSales = round2(Math.max(0, total - taxTotal));
    const date = bill.invoiceDate || bill.data?.invoiceDate || '';
    const invNo = bill.invoiceNumber || bill.id;

    if (invType === 'credit-note') {
      postVoucher({
        id: `bill_${bill.id}`,
        date,
        voucherNo: invNo,
        voucherType: 'Credit Note',
        narration: `Sales Credit Note against ${clientName}`,
        refId: bill.id,
        lines: [
          { accountId: 'sys_sales_return', debit: netSales, credit: 0 },
          { accountId: 'sys_out_cgst', debit: cgst, credit: 0 },
          { accountId: 'sys_out_sgst', debit: sgst, credit: 0 },
          { accountId: 'sys_out_igst', debit: igst, credit: 0 },
          { accountId: clientAcc.id, debit: 0, credit: total },
        ],
      });
    } else {
      postVoucher({
        id: `bill_${bill.id}`,
        date,
        voucherNo: invNo,
        voucherType: 'Sales',
        narration: `GST Sales Invoice to ${clientName}`,
        refId: bill.id,
        lines: [
          { accountId: clientAcc.id, debit: total, credit: 0 },
          { accountId: 'sys_sales', debit: 0, credit: netSales },
          { accountId: 'sys_out_cgst', debit: 0, credit: cgst },
          { accountId: 'sys_out_sgst', debit: 0, credit: sgst },
          { accountId: 'sys_out_igst', debit: 0, credit: igst },
        ],
      });

      // Payments recorded directly on the bill
      const payments = bill.payments || bill.data?.payments || [];
      payments.forEach((pmt, idx) => {
        const amt = round2(pmt.amount);
        if (amt <= 0 || pmt.mode === 'credit-applied') return;
        const cashOrBank = isCashMode(pmt.mode) ? 'sys_cash' : 'sys_bank';
        postVoucher({
          id: `bill_pmt_${bill.id}_${idx}`,
          date: pmt.date || date,
          voucherNo: `${invNo}/RCP-${idx + 1}`,
          voucherType: 'Receipt',
          narration: `Payment received (${pmt.mode || 'Cash/Bank'}) for ${invNo}`,
          refId: bill.id,
          lines: [
            { accountId: cashOrBank, debit: amt, credit: 0 },
            { accountId: clientAcc.id, debit: 0, credit: amt },
          ],
        });
      });
    }
  }

  // 6. Post Standalone Receipt Vouchers (`/api/receipts`)
  for (const rcp of receipts || []) {
    if (!rcp) continue;
    const amt = round2(rcp.amount);
    if (amt <= 0) continue;
    // Avoid double-posting if receipt was already linked into bill.payments
    if (rcp.invoiceId || rcp.billId) continue;
    const clientAcc = getOrCreateClientAccount(rcp.clientName || 'Walk-in Customer', rcp.clientGstin || '');
    const cashOrBank = isCashMode(rcp.mode || rcp.paymentMode) ? 'sys_cash' : 'sys_bank';
    postVoucher({
      id: `rcp_${rcp.id}`,
      date: rcp.date,
      voucherNo: rcp.receiptNumber || rcp.id,
      voucherType: 'Receipt',
      narration: rcp.notes || `Receipt from ${clientAcc.name}`,
      refId: rcp.id,
      lines: [
        { accountId: cashOrBank, debit: amt, credit: 0 },
        { accountId: clientAcc.id, debit: 0, credit: amt },
      ],
    });
  }

  // 7. Post Purchase Bills (`/api/purchases`)
  for (const pur of purchases || []) {
    if (!pur) continue;
    const supName = pur.supplierName || pur.vendorName || 'General Supplier';
    const supGstin = pur.supplierGstin || pur.gstin || '';
    const supAcc = getOrCreateSupplierAccount(supName, supGstin);

    const total = round2(pur.totalAmount || pur.amount || 0);
    if (total <= 0) continue;
    const cgst = round2(pur.cgst || 0);
    const sgst = round2(pur.sgst || 0);
    const igst = round2(pur.igst || 0);
    const freight = round2(pur.freight || 0);
    const taxTotal = round2(cgst + sgst + igst);
    const netPurchase = round2(Math.max(0, total - taxTotal - freight));
    const date = pur.date || '';
    const billNo = pur.billNumber || pur.invoiceNumber || pur.id;

    postVoucher({
      id: `pur_${pur.id}`,
      date,
      voucherNo: billNo,
      voucherType: 'Purchase',
      narration: `Purchase Bill from ${supName}`,
      refId: pur.id,
      lines: [
        { accountId: 'sys_purchase', debit: netPurchase, credit: 0 },
        { accountId: 'sys_freight', debit: freight, credit: 0 },
        { accountId: 'sys_in_cgst', debit: cgst, credit: 0 },
        { accountId: 'sys_in_sgst', debit: sgst, credit: 0 },
        { accountId: 'sys_in_igst', debit: igst, credit: 0 },
        { accountId: supAcc.id, debit: 0, credit: total },
      ],
    });

    // Supplier payments recorded on the purchase bill
    const payments = pur.payments || [];
    payments.forEach((pmt, idx) => {
      const amt = round2(pmt.amount);
      if (amt <= 0) return;
      const cashOrBank = isCashMode(pmt.mode) ? 'sys_cash' : 'sys_bank';
      postVoucher({
        id: `pur_pmt_${pur.id}_${idx}`,
        date: pmt.date || date,
        voucherNo: `${billNo}/PMT-${idx + 1}`,
        voucherType: 'Payment',
        narration: `Payment to ${supName} (${pmt.mode || 'Bank/Cash'}) against ${billNo}`,
        refId: pur.id,
        lines: [
          { accountId: supAcc.id, debit: amt, credit: 0 },
          { accountId: cashOrBank, debit: 0, credit: amt },
        ],
      });
    });
  }

  // 8. Post Expenses (`/api/expenses`)
  for (const exp of expenses || []) {
    if (!exp) continue;
    const amt = round2(exp.amount);
    if (amt <= 0) continue;
    const expAcc = getOrCreateExpenseAccount(exp.category || 'Shop Expense');
    const cashOrBank = isCashMode(exp.paymentMethod || exp.mode) ? 'sys_cash' : 'sys_bank';
    postVoucher({
      id: `exp_${exp.id}`,
      date: exp.date,
      voucherNo: exp.id,
      voucherType: 'Payment',
      narration: exp.description || `${exp.category || 'Expense'} paid`,
      refId: exp.id,
      lines: [
        { accountId: expAcc.id, debit: amt, credit: 0 },
        { accountId: cashOrBank, debit: 0, credit: amt },
      ],
    });
  }

  // 9. Post Cash Book manual entries (`/api/cash-book`)
  for (const ce of cashEntries || []) {
    if (!ce) continue;
    const amt = round2(ce.amount);
    if (amt <= 0) continue;
    const isIn = ce.type === 'in';
    postVoucher({
      id: `cash_${ce.id}`,
      date: ce.date,
      voucherNo: ce.id,
      voucherType: isIn ? 'Receipt' : 'Payment',
      narration: ce.description || (isIn ? 'Cash Inward' : 'Cash Outward'),
      refId: ce.id,
      lines: isIn
        ? [
            { accountId: 'sys_cash', debit: amt, credit: 0 },
            { accountId: 'sys_capital', debit: 0, credit: amt },
          ]
        : [
            { accountId: getOrCreateExpenseAccount('Petty Cash Expense').id, debit: amt, credit: 0 },
            { accountId: 'sys_cash', debit: 0, credit: amt },
          ],
    });
  }

  // 10. Post Explicit Double-Entry Vouchers (`/api/vouchers`)
  for (const v of vouchers || []) {
    if (!v || v.voucherType === 'Stock Journal') continue;
    if (Array.isArray(v.lines) && v.lines.length >= 2) {
      postVoucher({
        id: v.id,
        date: v.date,
        voucherNo: v.voucherNo || v.id,
        voucherType: v.voucherType || 'Journal',
        narration: v.narration || '',
        refId: v.id,
        lines: v.lines,
      });
    } else if (v.debitAccountId && v.creditAccountId && Number(v.amount) > 0) {
      const amt = round2(v.amount);
      postVoucher({
        id: v.id,
        date: v.date,
        voucherNo: v.voucherNo || v.id,
        voucherType: v.voucherType || 'Journal',
        narration: v.narration || '',
        refId: v.id,
        lines: [
          { accountId: v.debitAccountId, debit: amt, credit: 0 },
          { accountId: v.creditAccountId, debit: 0, credit: amt },
        ],
      });
    }
  }

  // Sort postings & compute running balances per account
  const accounts = [];
  let totalTrialDebit = 0;
  let totalTrialCredit = 0;

  for (const acc of accountMap.values()) {
    acc.postings.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.voucherNo).localeCompare(String(b.voucherNo)));
    let running = acc.signedOpening;
    for (const p of acc.postings) {
      running = round2(running + p.debit - p.credit);
      p.runningBalance = Math.abs(running);
      p.runningType = running >= 0 ? 'Dr' : 'Cr';
    }
    acc.signedClosing = running;
    acc.closingBalance = Math.abs(running);
    acc.closingType = running >= 0 ? 'Dr' : 'Cr';

    if (acc.closingBalance > 0 || acc.periodDebit > 0 || acc.periodCredit > 0 || acc.openingBalance > 0 || acc.isSystem) {
      if (acc.signedClosing > 0) totalTrialDebit = round2(totalTrialDebit + acc.closingBalance);
      else if (acc.signedClosing < 0) totalTrialCredit = round2(totalTrialCredit + acc.closingBalance);
      accounts.push(acc);
    }
  }

  accounts.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  daybook.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.voucherNo).localeCompare(String(a.voucherNo)));

  // Calculate Inventory Valuation (Opening Stock & Closing Stock)
  let openingStockValue = 0;
  let closingStockValue = 0;
  for (const p of products || []) {
    if (!p || p.kind === 'service') continue;
    const cost = Number(p.avgPurchaseCost || p.purchasePrice || p.sellingPrice || p.rate || 0);
    const openQty = Number(p.openingStock) || 0;
    const closeQty = Number(p.stock) || 0;
    if (openQty > 0) openingStockValue = round2(openingStockValue + openQty * cost);
    if (closeQty > 0) closingStockValue = round2(closingStockValue + closeQty * cost);
  }

  // Profit & Loss Account
  const salesNet = round2(
    accounts
      .filter(a => a.group === 'Sales Accounts')
      .reduce((s, a) => s + (a.signedClosing < 0 ? Math.abs(a.signedClosing) : -a.signedClosing), 0)
  );
  const purchasesNet = round2(
    accounts
      .filter(a => a.group === 'Purchase Accounts')
      .reduce((s, a) => s + (a.signedClosing >= 0 ? a.signedClosing : -Math.abs(a.signedClosing)), 0)
  );
  const directExpenses = round2(
    accounts
      .filter(a => a.group === 'Direct Expenses')
      .reduce((s, a) => s + Math.max(0, a.signedClosing), 0)
  );
  const indirectExpenses = round2(
    accounts
      .filter(a => a.group === 'Indirect Expenses')
      .reduce((s, a) => s + Math.max(0, a.signedClosing), 0)
  );
  const indirectIncome = round2(
    accounts
      .filter(a => a.group === 'Indirect Income' || a.group === 'Direct Income')
      .reduce((s, a) => s + (a.signedClosing < 0 ? Math.abs(a.signedClosing) : 0), 0)
  );

  const grossProfit = round2(salesNet + closingStockValue - (openingStockValue + purchasesNet + directExpenses));
  const netProfit = round2(grossProfit + indirectIncome - indirectExpenses);

  // Balance Sheet
  const debtorsTotal = round2(
    accounts.filter(a => a.group === 'Sundry Debtors' && a.signedClosing > 0).reduce((s, a) => s + a.closingBalance, 0)
  );
  const customerAdvances = round2(
    accounts.filter(a => a.group === 'Sundry Debtors' && a.signedClosing < 0).reduce((s, a) => s + a.closingBalance, 0)
  );
  const creditorsTotal = round2(
    accounts.filter(a => a.group === 'Sundry Creditors' && a.signedClosing < 0).reduce((s, a) => s + a.closingBalance, 0)
  );
  const supplierAdvances = round2(
    accounts.filter(a => a.group === 'Sundry Creditors' && a.signedClosing > 0).reduce((s, a) => s + a.closingBalance, 0)
  );
  const cashBalance = round2(accountMap.get('sys_cash')?.signedClosing || 0);
  const bankBalance = round2(
    accounts.filter(a => a.group === 'Bank Accounts').reduce((s, a) => s + a.signedClosing, 0)
  );
  const fixedAssetsTotal = round2(
    accounts.filter(a => a.group === 'Fixed Assets').reduce((s, a) => s + Math.max(0, a.signedClosing), 0)
  );
  const loansLiabilityTotal = round2(
    accounts.filter(a => a.group === 'Loans (Liability)').reduce((s, a) => s + (a.signedClosing < 0 ? a.closingBalance : 0), 0)
  );
  const capitalBase = round2(
    accounts.filter(a => a.group === 'Capital Account').reduce((s, a) => s + (a.signedClosing < 0 ? a.closingBalance : -a.closingBalance), 0)
  );
  const dutiesNet = round2(
    accounts.filter(a => a.group === 'Duties & Taxes').reduce((s, a) => s + (-a.signedClosing), 0) // positive = net payable, negative = net ITC receivable
  );

  const totalAssets = round2(
    fixedAssetsTotal +
    closingStockValue +
    debtorsTotal +
    supplierAdvances +
    Math.max(0, cashBalance) +
    Math.max(0, bankBalance) +
    (dutiesNet < 0 ? Math.abs(dutiesNet) : 0)
  );

  const totalLiabilitiesBeforeDiff = round2(
    capitalBase +
    netProfit +
    loansLiabilityTotal +
    creditorsTotal +
    customerAdvances +
    (cashBalance < 0 ? Math.abs(cashBalance) : 0) +
    (bankBalance < 0 ? Math.abs(bankBalance) : 0) +
    (dutiesNet > 0 ? dutiesNet : 0)
  );

  const openingDiff = round2(totalAssets - totalLiabilitiesBeforeDiff);

  // Ageing analysis (0-30, 31-60, 61-90, 90+ days)
  const todayMs = Date.now();
  const buildAgeing = (items, isReceivable) => {
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, rows: [] };
    for (const item of items) {
      if (!item || (isReceivable && isCancelledBill(item))) continue;
      const total = round2(item.totalAmount ?? item.data?.totalAmount ?? item.amount ?? 0);
      const payments = item.payments || item.data?.payments || [];
      const paid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
      const status = item.status || item.data?.status || '';
      const due = status === 'Paid' && paid === 0 ? 0 : round2(Math.max(0, total - paid));
      if (due <= 0) continue;

      const dateStr = isReceivable ? (item.invoiceDate || item.data?.invoiceDate) : item.date;
      const ageDays = dateStr ? Math.max(0, Math.floor((todayMs - new Date(dateStr).getTime()) / 86400000)) : 0;
      if (ageDays <= 30) buckets.d0_30 = round2(buckets.d0_30 + due);
      else if (ageDays <= 60) buckets.d31_60 = round2(buckets.d31_60 + due);
      else if (ageDays <= 90) buckets.d61_90 = round2(buckets.d61_90 + due);
      else buckets.d90_plus = round2(buckets.d90_plus + due);
      buckets.total = round2(buckets.total + due);

      buckets.rows.push({
        id: item.id,
        partyName: isReceivable ? (item.clientName || item.data?.client?.name || 'Walk-in') : (item.supplierName || 'Supplier'),
        docNo: isReceivable ? (item.invoiceNumber || item.id) : (item.billNumber || item.id),
        date: dateStr || '',
        total,
        paid,
        due,
        ageDays,
        bucket: ageDays <= 30 ? '0-30 Days' : ageDays <= 60 ? '31-60 Days' : ageDays <= 90 ? '61-90 Days' : '90+ Days',
      });
    }
    buckets.rows.sort((a, b) => b.ageDays - a.ageDays);
    return buckets;
  };

  return {
    accounts,
    accountMap,
    daybook,
    trialBalance: {
      rows: accounts.filter(a => a.closingBalance > 0 || a.periodDebit > 0 || a.periodCredit > 0),
      totalDebit: totalTrialDebit,
      totalCredit: totalTrialCredit,
      openingDifference: round2(totalTrialDebit - totalTrialCredit),
    },
    profitAndLoss: {
      openingStockValue,
      purchasesNet,
      directExpenses,
      salesNet,
      closingStockValue,
      grossProfit,
      indirectExpenses,
      indirectIncome,
      netProfit,
    },
    balanceSheet: {
      assets: {
        fixedAssets: fixedAssetsTotal,
        closingStock: closingStockValue,
        sundryDebtors: debtorsTotal,
        supplierAdvances,
        cashInHand: Math.max(0, cashBalance),
        bankAccounts: Math.max(0, bankBalance),
        itcReceivable: dutiesNet < 0 ? Math.abs(dutiesNet) : 0,
        total: totalAssets,
      },
      liabilities: {
        capitalAccount: capitalBase,
        netProfit,
        loansLiability: loansLiabilityTotal,
        sundryCreditors: creditorsTotal,
        customerAdvances,
        bankOverdraft: (bankBalance < 0 ? Math.abs(bankBalance) : 0) + (cashBalance < 0 ? Math.abs(cashBalance) : 0),
        gstPayable: dutiesNet > 0 ? dutiesNet : 0,
        openingBalanceAdjustment: openingDiff,
        total: round2(totalLiabilitiesBeforeDiff + openingDiff),
      },
    },
    ageing: {
      receivables: buildAgeing(bills.filter(b => !['estimate', 'proforma', 'delivery-challan', 'credit-note'].includes(b.invoiceType || b.data?.invoiceType)), true),
      payables: buildAgeing(purchases, false),
    },
  };
}
