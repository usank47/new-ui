import React, { useState, useEffect, useMemo } from 'react';
import {
  getAllBills,
  getAllPurchases,
  getAllExpenses,
  getAllReceipts,
  getAllCashEntries,
  getAllVouchers,
  saveVoucher,
  deleteVoucher,
  getAllLedgers,
  saveLedger,
  getAllClients,
  getAllSuppliers,
  saveSupplier,
  deleteSupplier,
  getAllProducts,
  saveProduct,
} from '../store';
import {
  ACCOUNT_GROUPS,
  VOUCHER_TYPES,
  buildDoubleEntryBook,
  computeBrsSummary,
} from '../utils/accounting';
import { decodeHtmlEntities } from '../utils/products';
import { formatCurrency } from '../utils';
import { writeXlsxFile } from '../utils/xlsx';
import { toast } from './Toast';

const BRS_STORAGE_KEY = 'erp_brs_dates_v1';

function normalizeAccountingTab(tab) {
  if (tab === 'trial-balance') return 'trial';
  if (tab === 'profit-loss') return 'pnl';
  if (tab === 'balance-sheet') return 'bs';
  return tab || 'vouchers';
}

export default function AccountingView({ showToast = toast, initialTab = 'vouchers', initialVoucherType = '' }) {
  const [activeTab, setActiveTab] = useState(() => normalizeAccountingTab(initialTab));
  const [bills, setBills] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [cashEntries, setCashEntries] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [ledgers, setLedgers] = useState([]);
  const [clients, setClients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('sys_bank');
  const [ledgerGroupFilter, setLedgerGroupFilter] = useState('All');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerSubView, setLedgerSubView] = useState('statement'); // 'statement' | 'brs' | 'ageing'

  // Bank Reconciliation (BRS) clearing dates map { [postingId]: 'YYYY-MM-DD' }
  const [brsDatesMap, setBrsDatesMap] = useState(() => {
    try {
      const raw = localStorage.getItem(BRS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const updateBrsDate = (postingId, clearDate) => {
    setBrsDatesMap(prev => {
      const next = { ...prev };
      if (clearDate) next[postingId] = clearDate;
      else delete next[postingId];
      try {
        localStorage.setItem(BRS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  // Voucher Entry Mode: 'quick' (2-line) or 'compound' (multi-line Dr/Cr grid)
  const [voucherEntryMode, setVoucherEntryMode] = useState('quick');
  const [vForm, setVForm] = useState({
    voucherType: initialVoucherType || 'Payment',
    voucherNo: `PMT/${Date.now().toString().slice(-4)}`,
    date: new Date().toISOString().slice(0, 10),
    debitAccountId: '',
    creditAccountId: 'sys_cash',
    amount: '',
    paymentMode: 'Cash',
    billRefType: 'Against Ref',
    billRefNo: '',
    instrumentNo: '',
    productId: '',
    returnQty: 1,
    narration: '',
  });

  const [compoundLines, setCompoundLines] = useState([
    { side: 'Dr', accountId: '', amount: '', billRefType: 'Against Ref', billRefNo: '' },
    { side: 'Cr', accountId: 'sys_cash', amount: '', billRefType: 'On Account', billRefNo: '' },
  ]);

  // New Ledger Modal
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    name: '',
    code: '',
    group: 'Indirect Expenses',
    openingBalance: 0,
    openingType: 'Dr',
    gstin: '',
  });

  // Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supForm, setSupForm] = useState({
    name: '',
    accountCode: '',
    gstin: '',
    phone: '',
    email: '',
    address: '',
    state: '',
    openingBalance: 0,
    openingType: 'Cr',
    creditDays: 30,
  });

  const loadData = async () => {
    const [b, p, e, r, c, v, l, cl, sup, prod] = await Promise.all([
      getAllBills(),
      getAllPurchases(),
      getAllExpenses(),
      getAllReceipts(),
      getAllCashEntries(),
      getAllVouchers(),
      getAllLedgers(),
      getAllClients(),
      getAllSuppliers(),
      getAllProducts(),
    ]);
    setBills(b || []);
    setPurchases(p || []);
    setExpenses(e || []);
    setReceipts(r || []);
    setCashEntries(c || []);
    setVouchers(v || []);
    setLedgers(l || []);
    setClients(cl || []);
    setSuppliers(sup || []);
    setProducts(prod || []);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (initialTab) setActiveTab(normalizeAccountingTab(initialTab));
    if (initialVoucherType) {
      setActiveTab('vouchers');
      handleVoucherTypeSelect(initialVoucherType);
    }
  }, [initialTab, initialVoucherType]);

  const book = useMemo(() => {
    return buildDoubleEntryBook({
      bills,
      purchases,
      expenses,
      receipts,
      cashEntries,
      vouchers,
      ledgers,
      clients,
      suppliers,
      products,
      startDate,
      endDate,
    });
  }, [bills, purchases, expenses, receipts, cashEntries, vouchers, ledgers, clients, suppliers, products, startDate, endDate]);

  // Set default debit/credit accounts when accounts load
  useEffect(() => {
    if (!book.accounts.length) return;
    if (!vForm.debitAccountId) {
      const firstSupplierOrExpense = book.accounts.find(a => a.group === 'Sundry Creditors' || a.group === 'Indirect Expenses') || book.accounts[0];
      if (firstSupplierOrExpense) {
        setVForm(prev => ({ ...prev, debitAccountId: firstSupplierOrExpense.id }));
        setCompoundLines(prev => prev.map((l, idx) => idx === 0 && !l.accountId ? { ...l, accountId: firstSupplierOrExpense.id } : l));
      }
    }
  }, [book.accounts]);

  const handleVoucherTypeSelect = (vType) => {
    let defaultDr = vForm.debitAccountId;
    let defaultCr = vForm.creditAccountId;
    if (vType === 'Payment') {
      defaultDr = book.accounts.find(a => a.group === 'Sundry Creditors')?.id || 'sys_purchase';
      defaultCr = 'sys_cash';
    } else if (vType === 'Receipt') {
      defaultDr = 'sys_cash';
      defaultCr = book.accounts.find(a => a.group === 'Sundry Debtors')?.id || 'sys_sales';
    } else if (vType === 'Contra') {
      defaultDr = 'sys_bank';
      defaultCr = 'sys_cash';
    } else if (vType === 'Sales Return' || vType === 'Credit Note') {
      defaultDr = 'sys_sales_return';
      defaultCr = book.accounts.find(a => a.group === 'Sundry Debtors')?.id || 'sys_cash';
    } else if (vType === 'Purchase Return' || vType === 'Debit Note') {
      defaultDr = book.accounts.find(a => a.group === 'Sundry Creditors')?.id || 'sys_cash';
      defaultCr = 'sys_purchase_return';
    }
    const prefix = VOUCHER_TYPES.find(t => t.id === vType)?.prefix || 'VCH';
    setVForm(prev => ({
      ...prev,
      voucherType: vType,
      voucherNo: `${prefix}/${Date.now().toString().slice(-4)}`,
      debitAccountId: defaultDr,
      creditAccountId: defaultCr,
    }));
  };

  const compoundTotals = useMemo(() => {
    let totalDr = 0;
    let totalCr = 0;
    for (const l of compoundLines) {
      const amt = Number(l.amount) || 0;
      if (l.side === 'Dr') totalDr += amt;
      else totalCr += amt;
    }
    const diff = Math.round((totalDr - totalCr) * 100) / 100;
    return {
      totalDr: Math.round(totalDr * 100) / 100,
      totalCr: Math.round(totalCr * 100) / 100,
      diff,
      isBalanced: totalDr > 0 && Math.abs(diff) < 0.01,
    };
  }, [compoundLines]);

  const handlePostVoucher = async (e) => {
    if (e) e.preventDefault();

    if (voucherEntryMode === 'compound') {
      if (!compoundTotals.isBalanced) {
        showToast(`Voucher out of balance! Total Dr (${formatCurrency(compoundTotals.totalDr)}) must equal Total Cr (${formatCurrency(compoundTotals.totalCr)})`, 'error');
        return;
      }
      const validLines = compoundLines.filter(l => l.accountId && Number(l.amount) > 0);
      if (validLines.length < 2) {
        showToast('Select valid accounts for at least 2 voucher lines', 'error');
        return;
      }
      const formattedLines = validLines.map(l => {
        const accName = book.accountMap.get(l.accountId)?.name || l.accountId;
        const amt = Number(l.amount) || 0;
        return {
          accountId: l.accountId,
          accountName: accName,
          debit: l.side === 'Dr' ? amt : 0,
          credit: l.side === 'Cr' ? amt : 0,
          billRefType: l.billRefType || 'On Account',
          billRefNo: l.billRefNo || '',
        };
      });
      const firstDr = formattedLines.find(l => l.debit > 0);
      const firstCr = formattedLines.find(l => l.credit > 0);
      await saveVoucher({
        voucherType: vForm.voucherType,
        voucherNo: vForm.voucherNo,
        date: vForm.date,
        debitAccountId: firstDr?.accountId || '',
        creditAccountId: firstCr?.accountId || '',
        amount: compoundTotals.totalDr,
        paymentMode: vForm.paymentMode,
        instrumentNo: vForm.instrumentNo || '',
        narration: vForm.narration || `${vForm.voucherType} Compound Voucher (${formattedLines.length} lines)`,
        lines: formattedLines,
      });
      await loadData();
      setCompoundLines([
        { side: 'Dr', accountId: firstDr?.accountId || '', amount: '', billRefType: 'Against Ref', billRefNo: '' },
        { side: 'Cr', accountId: firstCr?.accountId || 'sys_cash', amount: '', billRefType: 'On Account', billRefNo: '' },
      ]);
      setVForm(prev => ({
        ...prev,
        voucherNo: `${VOUCHER_TYPES.find(t => t.id === prev.voucherType)?.prefix || 'VCH'}/${Date.now().toString().slice(-4)}`,
        narration: '',
        instrumentNo: '',
      }));
      showToast(`${vForm.voucherType} Compound Voucher posted (${formatCurrency(compoundTotals.totalDr)})`, 'success');
      return;
    }

    const amt = Number(vForm.amount) || 0;
    if (amt <= 0) {
      showToast('Enter a valid voucher amount greater than 0', 'error');
      return;
    }
    if (!vForm.debitAccountId || !vForm.creditAccountId) {
      showToast('Select both Debit and Credit ledger accounts', 'error');
      return;
    }
    if (vForm.debitAccountId === vForm.creditAccountId) {
      showToast('Debit and Credit accounts must be different', 'error');
      return;
    }

    // If Sales Return or Purchase Return has a product selected, also adjust stock
    if ((vForm.voucherType === 'Sales Return' || vForm.voucherType === 'Purchase Return') && vForm.productId) {
      const prod = products.find(p => p.id === vForm.productId);
      const qty = Number(vForm.returnQty) || 0;
      if (prod && qty > 0) {
        const delta = vForm.voucherType === 'Sales Return' ? qty : -qty;
        await saveProduct({
          ...prod,
          stock: (Number(prod.stock) || 0) + delta,
        });
      }
    }

    const drName = book.accountMap.get(vForm.debitAccountId)?.name || vForm.debitAccountId;
    const crName = book.accountMap.get(vForm.creditAccountId)?.name || vForm.creditAccountId;
    const refSuffix = vForm.billRefNo ? ` [${vForm.billRefType}: ${vForm.billRefNo}]` : '';
    const instSuffix = vForm.instrumentNo ? ` [UTR/Chq: ${vForm.instrumentNo}]` : '';

    await saveVoucher({
      voucherType: vForm.voucherType,
      voucherNo: vForm.voucherNo,
      date: vForm.date,
      debitAccountId: vForm.debitAccountId,
      creditAccountId: vForm.creditAccountId,
      amount: amt,
      paymentMode: vForm.paymentMode,
      billRefType: vForm.billRefType,
      billRefNo: vForm.billRefNo,
      instrumentNo: vForm.instrumentNo,
      narration: (vForm.narration || `${vForm.voucherType}: Dr ${drName} / Cr ${crName}`) + refSuffix + instSuffix,
      lines: [
        { accountId: vForm.debitAccountId, accountName: drName, debit: amt, credit: 0 },
        { accountId: vForm.creditAccountId, accountName: crName, debit: 0, credit: amt },
      ],
    });

    await loadData();
    setVForm(prev => ({
      ...prev,
      voucherNo: `${VOUCHER_TYPES.find(t => t.id === prev.voucherType)?.prefix || 'VCH'}/${Date.now().toString().slice(-4)}`,
      amount: '',
      billRefNo: '',
      instrumentNo: '',
      narration: '',
    }));
    showToast(`${vForm.voucherType} Voucher posted to Double-Entry Ledger`, 'success');
  };

  // Support Ctrl+A to post voucher when on vouchers tab
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && activeTab === 'vouchers') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          e.preventDefault();
          handlePostVoucher();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, vForm, voucherEntryMode, compoundLines]);

  const handleSaveLedger = async (e) => {
    e.preventDefault();
    if (!ledgerForm.name.trim()) return;
    await saveLedger({
      ...ledgerForm,
      name: decodeHtmlEntities(ledgerForm.name.trim()),
    });
    setShowLedgerModal(false);
    setLedgerForm({ name: '', code: '', group: 'Indirect Expenses', openingBalance: 0, openingType: 'Dr', gstin: '' });
    await loadData();
    showToast('Ledger account created', 'success');
  };

  const handleSaveSupplier = async (e) => {
    e.preventDefault();
    if (!supForm.name.trim()) return;
    await saveSupplier({
      ...(editingSupplier || {}),
      ...supForm,
      name: decodeHtmlEntities(supForm.name.trim()),
      openingBalance: Number(supForm.openingBalance) || 0,
      creditDays: Number(supForm.creditDays) || 30,
    });
    setShowSupplierModal(false);
    setEditingSupplier(null);
    await loadData();
    showToast(editingSupplier ? 'Supplier updated' : 'Supplier added to master', 'success');
  };

  const selectedAccount = book.accountMap.get(selectedAccountId) || book.accounts[0] || null;

  const filteredAccounts = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return book.accounts.filter(a => {
      if (ledgerGroupFilter !== 'All' && a.group !== ledgerGroupFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.group || '').toLowerCase().includes(q) && !(a.gstin || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [book.accounts, ledgerGroupFilter, ledgerSearch]);

  const brsSummary = useMemo(() => {
    if (!selectedAccount) return null;
    return computeBrsSummary(selectedAccount, brsDatesMap);
  }, [selectedAccount, brsDatesMap]);

  const selectedAccountAgeingRows = useMemo(() => {
    if (!selectedAccount) return [];
    const nameLower = selectedAccount.name.toLowerCase();
    const recMatches = book.ageing.receivables.rows.filter(r => (r.partyName || '').toLowerCase() === nameLower);
    const payMatches = book.ageing.payables.rows.filter(r => (r.partyName || '').toLowerCase() === nameLower);
    return [...recMatches, ...payMatches];
  }, [selectedAccount, book.ageing]);

  const handleExportLedgerExcel = async () => {
    if (!selectedAccount) return;
    const headers = ['Date', 'Voucher No', 'Voucher Type', 'Particulars / Narration', 'Debit (₹)', 'Credit (₹)', 'Running Balance (₹)', 'Dr/Cr'];
    const rows = [
      ['Opening Balance', '-', '-', 'Opening Balance B/F', selectedAccount.openingType === 'Dr' ? selectedAccount.openingBalance : 0, selectedAccount.openingType === 'Cr' ? selectedAccount.openingBalance : 0, selectedAccount.openingBalance, selectedAccount.openingType],
      ...selectedAccount.postings.map(p => [
        p.date,
        p.voucherNo,
        p.voucherType,
        p.particulars,
        p.debit,
        p.credit,
        p.runningBalance,
        p.runningType,
      ]),
    ];
    await writeXlsxFile(`Ledger_${selectedAccount.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`, headers, rows, 'Ledger');
    showToast('Ledger exported to Excel', 'success');
  };

  return (
    <div className="accounting-view">
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Double-Entry Accounting, Vouchers, BRS & Financial Statements</h1>
          <p className="page-subtitle">
            TallyPrime / BUSY Standard Vouchers (F4–F9), General & Party Ledgers, Bank Reconciliation (BRS), Trial Balance, P&L & Balance Sheet
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            className="form-input"
            style={{ width: 140 }}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            title="Period Start Date"
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 140 }}
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            title="Period End Date"
          />
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLedgerModal(true)}>
            + New Ledger A/c
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingSupplier(null);
              setSupForm({ name: '', accountCode: '', gstin: '', phone: '', email: '', address: '', state: '', openingBalance: 0, openingType: 'Cr', creditDays: 30 });
              setShowSupplierModal(true);
            }}
          >
            + Add Supplier
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="glass-card" style={{ padding: 8, marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { id: 'vouchers', label: 'Vouchers & Daybook (F4–F7)' },
          { id: 'ledgers', label: 'General & Party Ledgers + BRS (Alt+L)' },
          { id: 'suppliers', label: `Suppliers Master (${suppliers.length})` },
          { id: 'ageing', label: 'Bill-Wise Ageing (0–90+ Days)' },
          { id: 'trial', label: 'Trial Balance (Alt+T)' },
          { id: 'pnl', label: 'Profit & Loss A/c (Alt+F)' },
          { id: 'bs', label: 'Balance Sheet (Alt+B)' },
        ].map(t => (
          <button
            key={t.id}
            className={`btn btn-sm ${activeTab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: VOUCHERS & DAYBOOK */}
      {activeTab === 'vouchers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>Post Double-Entry Accounting Voucher</h3>
                <div style={{ display: 'inline-flex', background: '#F1F5F9', padding: 2, borderRadius: 6, border: '1px solid #CBD5E1' }}>
                  <button
                    type="button"
                    onClick={() => setVoucherEntryMode('quick')}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      borderRadius: 4,
                      border: 'none',
                      cursor: 'pointer',
                      background: voucherEntryMode === 'quick' ? '#0F172A' : 'transparent',
                      color: voucherEntryMode === 'quick' ? '#FFFFFF' : '#475569',
                    }}
                  >
                    Single / 2-Line Entry
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoucherEntryMode('compound')}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      borderRadius: 4,
                      border: 'none',
                      cursor: 'pointer',
                      background: voucherEntryMode === 'compound' ? '#0F172A' : 'transparent',
                      color: voucherEntryMode === 'compound' ? '#FFFFFF' : '#475569',
                    }}
                  >
                    Multi-Line Dr/Cr Grid
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {VOUCHER_TYPES.filter(v => v.id !== 'Stock Journal').map(vt => (
                  <button
                    key={vt.id}
                    type="button"
                    className={`btn btn-sm ${vForm.voucherType === vt.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleVoucherTypeSelect(vt.id)}
                  >
                    {vt.id} {vt.shortcut ? `(${vt.shortcut})` : ''}
                  </button>
                ))}
              </div>
            </div>

            {voucherEntryMode === 'quick' ? (
              <form onSubmit={handlePostVoucher} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Voucher Number</label>
                  <input className="form-input num-mono" value={vForm.voucherNo} onChange={e => setVForm({ ...vForm, voucherNo: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Voucher Date</label>
                  <input type="date" className="form-input num-mono" value={vForm.date} onChange={e => setVForm({ ...vForm, date: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Debit Account (By / Dr) *</label>
                  <select className="form-input" value={vForm.debitAccountId} onChange={e => setVForm({ ...vForm, debitAccountId: e.target.value })} required>
                    <option value="">-- Select Dr Account --</option>
                    {book.accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {decodeHtmlEntities(a.name)} ({a.group}) [{a.closingType} {formatCurrency(a.closingBalance)}]
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Credit Account (To / Cr) *</label>
                  <select className="form-input" value={vForm.creditAccountId} onChange={e => setVForm({ ...vForm, creditAccountId: e.target.value })} required>
                    <option value="">-- Select Cr Account --</option>
                    {book.accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {decodeHtmlEntities(a.name)} ({a.group}) [{a.closingType} {formatCurrency(a.closingBalance)}]
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (₹) *</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    className="form-input num-mono"
                    value={vForm.amount}
                    onChange={e => setVForm({ ...vForm, amount: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Bill-by-Bill Ref Type</label>
                  <select className="form-input" value={vForm.billRefType} onChange={e => setVForm({ ...vForm, billRefType: e.target.value })}>
                    <option value="Against Ref">Against Ref (Settle Bill)</option>
                    <option value="New Ref">New Ref</option>
                    <option value="Advance">Advance</option>
                    <option value="On Account">On Account</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Bill / Invoice Ref No.</label>
                  <input
                    className="form-input num-mono"
                    value={vForm.billRefNo}
                    onChange={e => setVForm({ ...vForm, billRefNo: e.target.value })}
                    placeholder="e.g. INV/0012"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mode / Instrument</label>
                  <select className="form-input" value={vForm.paymentMode} onChange={e => setVForm({ ...vForm, paymentMode: e.target.value })}>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI / QR</option>
                    <option value="NEFT/RTGS">NEFT / RTGS / IMPS</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Journal Adjustment">Journal Adjustment</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Cheque / UTR No.</label>
                  <input
                    className="form-input num-mono"
                    value={vForm.instrumentNo}
                    onChange={e => setVForm({ ...vForm, instrumentNo: e.target.value })}
                    placeholder="Chq / UTR ref"
                  />
                </div>

                {(vForm.voucherType === 'Sales Return' || vForm.voucherType === 'Purchase Return') && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Returned Spare Part (Auto Stock Update)</label>
                      <select className="form-input" value={vForm.productId} onChange={e => setVForm({ ...vForm, productId: e.target.value })}>
                        <option value="">-- Optional: Select Returned Part --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{decodeHtmlEntities(p.name)} ({p.oemPartNo || p.brand || 'Part'}) — Stock: {p.stock ?? 0}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Return Quantity</label>
                      <input type="number" step="any" min="1" className="form-input num-mono" value={vForm.returnQty} onChange={e => setVForm({ ...vForm, returnQty: e.target.value })} />
                    </div>
                  </>
                )}

                <div className="form-group" style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="form-input"
                    style={{ flex: 1, minWidth: 240 }}
                    value={vForm.narration}
                    onChange={e => setVForm({ ...vForm, narration: e.target.value })}
                    placeholder="Being narration / bill adjustment / cheque details..."
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: '0.78rem' }}>
                    <span className="dr-badge">Dr {formatCurrency(Number(vForm.amount) || 0)}</span>
                    <span>=</span>
                    <span className="cr-badge">Cr {formatCurrency(Number(vForm.amount) || 0)}</span>
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                    Post {vForm.voucherType} (Ctrl+A)
                  </button>
                </div>
              </form>
            ) : (
              /* MULTI-LINE COMPOUND VOUCHER GRID */
              <form onSubmit={handlePostVoucher}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Voucher Number</label>
                    <input className="form-input num-mono" value={vForm.voucherNo} onChange={e => setVForm({ ...vForm, voucherNo: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Voucher Date</label>
                    <input type="date" className="form-input num-mono" value={vForm.date} onChange={e => setVForm({ ...vForm, date: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mode / Instrument</label>
                    <select className="form-input" value={vForm.paymentMode} onChange={e => setVForm({ ...vForm, paymentMode: e.target.value })}>
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI / QR</option>
                      <option value="NEFT/RTGS">NEFT / RTGS / IMPS</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Journal Adjustment">Journal Adjustment</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Instrument / UTR No.</label>
                    <input className="form-input num-mono" value={vForm.instrumentNo} onChange={e => setVForm({ ...vForm, instrumentNo: e.target.value })} placeholder="Chq / UTR" />
                  </div>
                </div>

                <div className="table-scroll" style={{ marginBottom: 12 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 90 }}>Dr / Cr</th>
                        <th>Particulars (Ledger Account & Live Balance)</th>
                        <th style={{ width: 150 }}>Bill Reference</th>
                        <th style={{ width: 140 }}>Ref No.</th>
                        <th style={{ width: 150, textAlign: 'right' }}>Debit (Dr ₹)</th>
                        <th style={{ width: 150, textAlign: 'right' }}>Credit (Cr ₹)</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {compoundLines.map((line, idx) => (
                        <tr key={idx}>
                          <td>
                            <select
                              className="form-input"
                              value={line.side}
                              onChange={e => {
                                const next = [...compoundLines];
                                next[idx] = { ...line, side: e.target.value };
                                setCompoundLines(next);
                              }}
                            >
                              <option value="Dr">By (Dr)</option>
                              <option value="Cr">To (Cr)</option>
                            </select>
                          </td>
                          <td>
                            <select
                              className="form-input"
                              value={line.accountId}
                              onChange={e => {
                                const next = [...compoundLines];
                                next[idx] = { ...line, accountId: e.target.value };
                                setCompoundLines(next);
                              }}
                            >
                              <option value="">-- Select Account --</option>
                              {book.accounts.map(a => (
                                <option key={a.id} value={a.id}>
                                  {decodeHtmlEntities(a.name)} ({a.group}) — [{a.closingType} {formatCurrency(a.closingBalance)}]
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="form-input"
                              value={line.billRefType}
                              onChange={e => {
                                const next = [...compoundLines];
                                next[idx] = { ...line, billRefType: e.target.value };
                                setCompoundLines(next);
                              }}
                            >
                              <option value="Against Ref">Against Ref</option>
                              <option value="New Ref">New Ref</option>
                              <option value="Advance">Advance</option>
                              <option value="On Account">On Account</option>
                            </select>
                          </td>
                          <td>
                            <input
                              className="form-input num-mono"
                              placeholder="Bill No"
                              value={line.billRefNo}
                              onChange={e => {
                                const next = [...compoundLines];
                                next[idx] = { ...line, billRefNo: e.target.value };
                                setCompoundLines(next);
                              }}
                            />
                          </td>
                          <td>
                            {line.side === 'Dr' ? (
                              <input
                                type="number"
                                step="any"
                                className="form-input num-mono"
                                style={{ textAlign: 'right' }}
                                placeholder="0.00"
                                value={line.amount}
                                onChange={e => {
                                  const next = [...compoundLines];
                                  next[idx] = { ...line, amount: e.target.value };
                                  setCompoundLines(next);
                                }}
                              />
                            ) : (
                              <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>—</div>
                            )}
                          </td>
                          <td>
                            {line.side === 'Cr' ? (
                              <input
                                type="number"
                                step="any"
                                className="form-input num-mono"
                                style={{ textAlign: 'right' }}
                                placeholder="0.00"
                                value={line.amount}
                                onChange={e => {
                                  const next = [...compoundLines];
                                  next[idx] = { ...line, amount: e.target.value };
                                  setCompoundLines(next);
                                }}
                              />
                            ) : (
                              <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>—</div>
                            )}
                          </td>
                          <td>
                            {compoundLines.length > 2 && (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => setCompoundLines(compoundLines.filter((_, i) => i !== idx))}
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setCompoundLines([
                        ...compoundLines,
                        { side: compoundTotals.diff > 0 ? 'Cr' : 'Dr', accountId: '', amount: Math.abs(compoundTotals.diff) > 0 ? String(Math.abs(compoundTotals.diff)) : '', billRefType: 'On Account', billRefNo: '' },
                      ])
                    }
                  >
                    + Add Dr/Cr Line
                  </button>
                  <input
                    className="form-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="Voucher Narration..."
                    value={vForm.narration}
                    onChange={e => setVForm({ ...vForm, narration: e.target.value })}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', background: compoundTotals.isBalanced ? '#F0FDF4' : '#FEF2F2', borderRadius: 6, border: `1px solid ${compoundTotals.isBalanced ? '#86EFAC' : '#FECACA'}`, fontSize: '0.8rem', fontWeight: 700 }}>
                    <span className="dr-badge">Total Dr: {formatCurrency(compoundTotals.totalDr)}</span>
                    <span className="cr-badge">Total Cr: {formatCurrency(compoundTotals.totalCr)}</span>
                    <span style={{ color: compoundTotals.isBalanced ? '#15803D' : '#DC2626' }}>
                      {compoundTotals.isBalanced ? '✓ Balanced' : `Diff: ${formatCurrency(Math.abs(compoundTotals.diff))}`}
                    </span>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={!compoundTotals.isBalanced}>
                    Post Compound Voucher (Ctrl+A)
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Chronological Daybook */}
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Complete Double-Entry Daybook ({book.daybook.length} Vouchers)</h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Includes Sales, Purchases, Receipts, Expenses, Cash Book & Journal Vouchers
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher No</th>
                    <th>Type</th>
                    <th>Debit / Credit Particulars</th>
                    <th style={{ textAlign: 'right' }}>Debit (Dr ₹)</th>
                    <th style={{ textAlign: 'right' }}>Credit (Cr ₹)</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {book.daybook.slice(0, 100).map(v => (
                    <tr key={v.id}>
                      <td className="num-mono">{v.date}</td>
                      <td><code className="num-mono">{v.voucherNo}</code></td>
                      <td><span className="tag">{v.voucherType}</span></td>
                      <td>
                        <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {v.lines.map((l, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={l.debit > 0 ? 'dr-badge' : 'cr-badge'}>
                                {l.debit > 0 ? 'Dr' : 'Cr'}
                              </span>
                              <span style={{ fontWeight: 600 }}>{decodeHtmlEntities(l.accountName)}</span>
                              <span className="num-mono" style={{ color: 'var(--text-muted)' }}>
                                {formatCurrency(l.debit || l.credit)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {v.narration && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>{decodeHtmlEntities(v.narration)}</div>}
                      </td>
                      <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(v.totalDebit)}</td>
                      <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(v.totalCredit)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {String(v.id).startsWith('vch_') && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              await deleteVoucher(v.id);
                              await loadData();
                              showToast('Voucher deleted', 'info');
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GENERAL & PARTY LEDGERS + NATIVE BANK RECONCILIATION (BRS) */}
      {activeTab === 'ledgers' && (
        <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr', gap: 14, alignItems: 'start' }}>
          {/* Constrained 270px Left Master Account List */}
          <div className="glass-card" style={{ padding: 12, maxHeight: '78vh', overflowY: 'auto' }}>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search Ledger / GSTIN..."
                value={ledgerSearch}
                onChange={e => setLedgerSearch(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <select className="form-input" value={ledgerGroupFilter} onChange={e => setLedgerGroupFilter(e.target.value)}>
                <option value="All">All Groups ({book.accounts.length})</option>
                {ACCOUNT_GROUPS.map(g => <option key={g.id} value={g.id}>{g.id}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {filteredAccounts.map(acc => (
                <div
                  key={acc.id}
                  onClick={() => {
                    setSelectedAccountId(acc.id);
                    if (acc.group !== 'Bank Accounts' && ledgerSubView === 'brs') {
                      setLedgerSubView('statement');
                    }
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: selectedAccount?.id === acc.id ? '#EFF6FF' : 'var(--bg-secondary)',
                    border: selectedAccount?.id === acc.id ? '1.5px solid #2563EB' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#0F172A', lineHeight: 1.25 }}>
                    {decodeHtmlEntities(acc.name)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{acc.group}</span>
                    <span className="num-mono" style={{ fontWeight: 700, color: '#0F172A', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {formatCurrency(acc.closingBalance)}
                      <span className={acc.closingType === 'Dr' ? 'dr-badge' : 'cr-badge'}>{acc.closingType}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right-Hand 7-Column Full-Width Ledger Statement & BRS Workspace */}
          {selectedAccount && (
            <div className="glass-card" style={{ padding: 16, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0F172A' }}>
                      {decodeHtmlEntities(selectedAccount.name)}
                    </h3>
                    <span className="tag">{selectedAccount.group}</span>
                    {selectedAccount.gstin && (
                      <span className="num-mono" style={{ fontSize: '0.75rem', background: '#F1F5F9', padding: '2px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                        GSTIN: {selectedAccount.gstin}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${ledgerSubView === 'statement' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setLedgerSubView('statement')}
                    >
                      Ledger Statement (7 Columns)
                    </button>
                    {(selectedAccount.group === 'Bank Accounts' || selectedAccount.id === 'sys_bank') && (
                      <button
                        type="button"
                        className={`btn btn-sm ${ledgerSubView === 'brs' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setLedgerSubView('brs')}
                      >
                        Bank Reconciliation (BRS)
                      </button>
                    )}
                    {(selectedAccount.group === 'Sundry Debtors' || selectedAccount.group === 'Sundry Creditors') && (
                      <button
                        type="button"
                        className={`btn btn-sm ${ledgerSubView === 'ageing' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setLedgerSubView('ageing')}
                      >
                        Bill-Wise Ageing ({selectedAccountAgeingRows.length})
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Closing Balance</div>
                    <div className="num-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      {formatCurrency(selectedAccount.closingBalance)}
                      <span className={selectedAccount.closingType === 'Dr' ? 'dr-badge' : 'cr-badge'}>
                        {selectedAccount.closingType}
                      </span>
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={handleExportLedgerExcel}>
                    Export .XLSX
                  </button>
                </div>
              </div>

              {/* SUB-VIEW 1 & 2: LEDGER STATEMENT OR BANK RECONCILIATION (BRS) */}
              {(ledgerSubView === 'statement' || ledgerSubView === 'brs') && (
                <>
                  {ledgerSubView === 'brs' && (
                    <div style={{ padding: '10px 14px', marginBottom: 12, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: '0.82rem', color: '#1E3A8A' }}>
                        <strong>Native Bank Reconciliation (BRS) Mode:</strong> Enter or pick the <strong>Bank Date</strong> when each cheque/UTR cleared in your bank statement. Uncleared entries are automatically reconciled in the footer below.
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const today = new Date().toISOString().slice(0, 10);
                          selectedAccount.postings.forEach(p => {
                            if (!brsDatesMap[p.id]) updateBrsDate(p.id, p.date || today);
                          });
                          showToast('All entries marked cleared as of voucher date', 'success');
                        }}
                      >
                        Auto-Reconcile All by Voucher Date
                      </button>
                    </div>
                  )}

                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 96 }}>Date</th>
                          <th style={{ width: 115 }}>Vch No.</th>
                          <th style={{ width: 95 }}>Type</th>
                          <th>Particulars / Contra A/c</th>
                          {ledgerSubView === 'brs' && <th style={{ width: 155 }}>Bank Clearing Date</th>}
                          <th style={{ width: 130, textAlign: 'right' }}>Debit (Dr ₹)</th>
                          <th style={{ width: 130, textAlign: 'right' }}>Credit (Cr ₹)</th>
                          <th style={{ width: 155, textAlign: 'right' }}>Running Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ background: '#F8FAFC', fontWeight: 600 }}>
                          <td className="num-mono">Opening</td>
                          <td>—</td>
                          <td>OB</td>
                          <td>Opening Balance Brought Forward</td>
                          {ledgerSubView === 'brs' && <td className="num-mono" style={{ color: '#15803D', fontSize: '0.76rem' }}>Cleared B/F</td>}
                          <td className="num-mono" style={{ textAlign: 'right' }}>
                            {selectedAccount.signedOpening > 0 ? formatCurrency(Math.abs(selectedAccount.signedOpening)) : '—'}
                          </td>
                          <td className="num-mono" style={{ textAlign: 'right' }}>
                            {selectedAccount.signedOpening < 0 ? formatCurrency(Math.abs(selectedAccount.signedOpening)) : '—'}
                          </td>
                          <td className="num-mono" style={{ textAlign: 'right' }}>
                            {formatCurrency(Math.abs(selectedAccount.signedOpening))}{' '}
                            <span className={selectedAccount.signedOpening >= 0 ? 'dr-badge' : 'cr-badge'}>
                              {selectedAccount.signedOpening >= 0 ? 'Dr' : 'Cr'}
                            </span>
                          </td>
                        </tr>
                        {selectedAccount.postings.map(p => {
                          const clearedDate = brsDatesMap[p.id] || '';
                          return (
                            <tr key={p.id}>
                              <td className="num-mono">{p.date}</td>
                              <td><code className="num-mono">{p.voucherNo}</code></td>
                              <td>{p.voucherType}</td>
                              <td>
                                <div style={{ fontWeight: 600, color: '#0F172A' }}>{decodeHtmlEntities(p.particulars)}</div>
                                {p.narration && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{decodeHtmlEntities(p.narration)}</div>}
                              </td>
                              {ledgerSubView === 'brs' && (
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input
                                      type="date"
                                      className="form-input num-mono"
                                      style={{
                                        padding: '2px 6px',
                                        height: 26,
                                        fontSize: '0.75rem',
                                        borderColor: clearedDate ? '#16A34A' : '#F59E0B',
                                        background: clearedDate ? '#F0FDF4' : '#FFFBEB',
                                      }}
                                      value={clearedDate}
                                      onChange={e => updateBrsDate(p.id, e.target.value)}
                                    />
                                    {clearedDate && (
                                      <button
                                        type="button"
                                        title="Mark Uncleared"
                                        onClick={() => updateBrsDate(p.id, '')}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B', fontSize: '0.75rem' }}
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                              <td className="num-mono" style={{ textAlign: 'right', fontWeight: p.debit > 0 ? 600 : 400 }}>
                                {p.debit > 0 ? formatCurrency(p.debit) : '—'}
                              </td>
                              <td className="num-mono" style={{ textAlign: 'right', fontWeight: p.credit > 0 ? 600 : 400 }}>
                                {p.credit > 0 ? formatCurrency(p.credit) : '—'}
                              </td>
                              <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                                {formatCurrency(p.runningBalance)}{' '}
                                <span className={p.runningType === 'Dr' ? 'dr-badge' : 'cr-badge'}>{p.runningType}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 800, borderTop: '2px solid #0F172A', background: '#F8FAFC' }}>
                          <td colSpan={ledgerSubView === 'brs' ? 5 : 4}>Period Totals & Closing Balance</td>
                          <td className="num-mono" style={{ textAlign: 'right' }}>{formatCurrency(selectedAccount.periodDebit)}</td>
                          <td className="num-mono" style={{ textAlign: 'right' }}>{formatCurrency(selectedAccount.periodCredit)}</td>
                          <td className="num-mono" style={{ textAlign: 'right' }}>
                            {formatCurrency(selectedAccount.closingBalance)}{' '}
                            <span className={selectedAccount.closingType === 'Dr' ? 'dr-badge' : 'cr-badge'}>
                              {selectedAccount.closingType}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Sticky BRS Summary Footer when in BRS mode or Bank Account */}
                  {(ledgerSubView === 'brs' || selectedAccount.group === 'Bank Accounts') && brsSummary && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: '12px 16px',
                        background: '#F8FAFC',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                          1. Balance as per Company Books
                        </div>
                        <div className="num-mono" style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                          {formatCurrency(brsSummary.companyBalance)}{' '}
                          <span className={brsSummary.companyType === 'Dr' ? 'dr-badge' : 'cr-badge'}>{brsSummary.companyType}</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                          2. Add: Unpresented Cheques ({brsSummary.unpresentedCount})
                        </div>
                        <div className="num-mono" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#15803D', marginTop: 2 }}>
                          + {formatCurrency(brsSummary.unpresentedPayments)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                          3. Less: Uncleared Deposits ({brsSummary.unclearedCount})
                        </div>
                        <div className="num-mono" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#D97706', marginTop: 2 }}>
                          - {formatCurrency(brsSummary.unclearedDeposits)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#1E3A8A', fontWeight: 700, textTransform: 'uppercase' }}>
                          4. Balance as per Bank Statement
                        </div>
                        <div className="num-mono" style={{ fontSize: '1.02rem', fontWeight: 800, color: '#1E3A8A', marginTop: 2 }}>
                          {formatCurrency(brsSummary.bankStatementBalance)}{' '}
                          <span className={brsSummary.bankStatementType === 'Dr' ? 'dr-badge' : 'cr-badge'}>
                            {brsSummary.bankStatementType}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* SUB-VIEW 3: BILL-WISE AGEING FOR SELECTED PARTY */}
              {ledgerSubView === 'ageing' && (
                <div>
                  <h4 style={{ marginBottom: 10 }}>Bill-Wise Outstanding & Ageing Breakdown — {decodeHtmlEntities(selectedAccount.name)}</h4>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Document / Bill No</th>
                          <th>Bill Date</th>
                          <th>Age (Days)</th>
                          <th>Ageing Bucket</th>
                          <th style={{ textAlign: 'right' }}>Bill Amount</th>
                          <th style={{ textAlign: 'right' }}>Balance Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAccountAgeingRows.map(r => (
                          <tr key={r.id}>
                            <td><code className="num-mono">{r.docNo}</code></td>
                            <td className="num-mono">{r.date}</td>
                            <td className="num-mono">{r.ageDays} days</td>
                            <td><span className="tag">{r.bucket} Days</span></td>
                            <td className="num-mono" style={{ textAlign: 'right' }}>{formatCurrency(r.total)}</td>
                            <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700, color: r.ageDays > 60 ? '#DC2626' : '#0F172A' }}>
                              {formatCurrency(r.due)}
                            </td>
                          </tr>
                        ))}
                        {selectedAccountAgeingRows.length === 0 && (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                              No open bill-wise overdue documents found for this party. Closing Ledger Balance: {formatCurrency(selectedAccount.closingBalance)} {selectedAccount.closingType}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SUPPLIERS MASTER */}
      {activeTab === 'suppliers' && (
        <div className="glass-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>Automotive Suppliers & Vendors Master (Sundry Creditors)</h3>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingSupplier(null);
                setSupForm({ name: '', accountCode: '', gstin: '', phone: '', email: '', address: '', state: '', openingBalance: 0, openingType: 'Cr', creditDays: 30 });
                setShowSupplierModal(true);
              }}
            >
              + Add Supplier
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Code</th>
                  <th>GSTIN</th>
                  <th>Phone</th>
                  <th>State</th>
                  <th>Credit Days</th>
                  <th style={{ textAlign: 'right' }}>Opening Bal</th>
                  <th style={{ textAlign: 'right' }}>Current Ledger Balance</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => {
                  const ldg = book.accountMap.get(`sup_${s.id}`);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{decodeHtmlEntities(s.name)}</td>
                      <td><code className="num-mono">{s.accountCode || '—'}</code></td>
                      <td><code className="num-mono">{s.gstin || '—'}</code></td>
                      <td className="num-mono">{s.phone || '—'}</td>
                      <td>{s.state || '—'}</td>
                      <td className="num-mono">{s.creditDays || 30} days</td>
                      <td className="num-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(s.openingBalance || 0)}{' '}
                        <span className={(s.openingType || 'Cr') === 'Dr' ? 'dr-badge' : 'cr-badge'}>{s.openingType || 'Cr'}</span>
                      </td>
                      <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {ldg ? (
                          <>
                            {formatCurrency(ldg.closingBalance)}{' '}
                            <span className={ldg.closingType === 'Dr' ? 'dr-badge' : 'cr-badge'}>{ldg.closingType}</span>
                          </>
                        ) : (
                          formatCurrency(s.openingBalance || 0)
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setSelectedAccountId(`sup_${s.id}`);
                              setActiveTab('ledgers');
                            }}
                          >
                            Ledger
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingSupplier(s);
                              setSupForm({ ...s });
                              setShowSupplierModal(true);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              await deleteSupplier(s.id);
                              await loadData();
                              showToast('Supplier deleted', 'info');
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {suppliers.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No suppliers saved yet. Click <strong>+ Add Supplier</strong> or import from BUSY.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: AGEING ANALYSIS */}
      {activeTab === 'ageing' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ marginBottom: 10 }}>Customer Receivable Ageing (Total: {formatCurrency(book.ageing.receivables.total)})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <div className="stat-card"><div>0–30 Days</div><strong className="num-mono">{formatCurrency(book.ageing.receivables.d0_30)}</strong></div>
              <div className="stat-card"><div>31–60 Days</div><strong className="num-mono">{formatCurrency(book.ageing.receivables.d31_60)}</strong></div>
              <div className="stat-card"><div>61–90 Days</div><strong className="num-mono" style={{ color: 'var(--warning)' }}>{formatCurrency(book.ageing.receivables.d61_90)}</strong></div>
              <div className="stat-card"><div>90+ Days</div><strong className="num-mono" style={{ color: 'var(--danger)' }}>{formatCurrency(book.ageing.receivables.d90_plus)}</strong></div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Customer</th><th>Invoice</th><th>Date</th><th>Age</th><th style={{ textAlign: 'right' }}>Balance Due</th></tr>
                </thead>
                <tbody>
                  {book.ageing.receivables.rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{decodeHtmlEntities(r.partyName)}</td>
                      <td><code className="num-mono">{r.docNo}</code></td>
                      <td className="num-mono">{r.date}</td>
                      <td className="num-mono">{r.ageDays}d ({r.bucket})</td>
                      <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{formatCurrency(r.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ marginBottom: 10 }}>Supplier Payable Ageing (Total: {formatCurrency(book.ageing.payables.total)})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <div className="stat-card"><div>0–30 Days</div><strong className="num-mono">{formatCurrency(book.ageing.payables.d0_30)}</strong></div>
              <div className="stat-card"><div>31–60 Days</div><strong className="num-mono">{formatCurrency(book.ageing.payables.d31_60)}</strong></div>
              <div className="stat-card"><div>61–90 Days</div><strong className="num-mono" style={{ color: 'var(--warning)' }}>{formatCurrency(book.ageing.payables.d61_90)}</strong></div>
              <div className="stat-card"><div>90+ Days</div><strong className="num-mono" style={{ color: 'var(--danger)' }}>{formatCurrency(book.ageing.payables.d90_plus)}</strong></div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Supplier</th><th>Bill No</th><th>Date</th><th>Age</th><th style={{ textAlign: 'right' }}>Payable Due</th></tr>
                </thead>
                <tbody>
                  {book.ageing.payables.rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{decodeHtmlEntities(r.partyName)}</td>
                      <td><code className="num-mono">{r.docNo}</code></td>
                      <td className="num-mono">{r.date}</td>
                      <td className="num-mono">{r.ageDays}d ({r.bucket})</td>
                      <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--warning)' }}>{formatCurrency(r.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: TRIAL BALANCE */}
      {activeTab === 'trial' && (
        <div className="glass-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>Trial Balance (7-Column Double-Entry Verification)</h3>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Click any account row to drill down directly into its General / Party Ledger statement
              </div>
            </div>
            <span className="dr-badge" style={{ padding: '4px 10px', fontSize: '0.78rem' }}>
              ✓ Reconciled: Total Dr = Total Cr ({formatCurrency(Math.max(book.trialBalance.totalDebit, book.trialBalance.totalCredit))})
            </span>
          </div>
          <div className="table-scroll" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>Account Group</th>
                  <th style={{ textAlign: 'right' }}>Opening Balance</th>
                  <th style={{ textAlign: 'right' }}>Period Debit (₹)</th>
                  <th style={{ textAlign: 'right' }}>Period Credit (₹)</th>
                  <th style={{ textAlign: 'right' }}>Closing Debit (Dr ₹)</th>
                  <th style={{ textAlign: 'right' }}>Closing Credit (Cr ₹)</th>
                </tr>
              </thead>
              <tbody>
                {book.trialBalance.rows.map(acc => (
                  <tr
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccountId(acc.id);
                      setActiveTab('ledgers');
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Click to drill down to Ledger Statement"
                  >
                    <td style={{ fontWeight: 600, color: '#0F172A' }}>{decodeHtmlEntities(acc.name)}</td>
                    <td>{acc.group}</td>
                    <td className="num-mono" style={{ textAlign: 'right' }}>
                      {acc.openingBalance > 0 ? (
                        <>
                          {formatCurrency(acc.openingBalance)}{' '}
                          <span className={acc.openingType === 'Dr' ? 'dr-badge' : 'cr-badge'}>{acc.openingType}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num-mono" style={{ textAlign: 'right' }}>{acc.periodDebit > 0 ? formatCurrency(acc.periodDebit) : '—'}</td>
                    <td className="num-mono" style={{ textAlign: 'right' }}>{acc.periodCredit > 0 ? formatCurrency(acc.periodCredit) : '—'}</td>
                    <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {acc.signedClosing >= 0 ? (
                        <>
                          {formatCurrency(acc.closingBalance)} <span className="dr-badge">Dr</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {acc.signedClosing < 0 ? (
                        <>
                          {formatCurrency(acc.closingBalance)} <span className="cr-badge">Cr</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {Math.abs(book.trialBalance.openingDifference) >= 0.01 && (
                  <tr style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                    <td colSpan={5}>Opening Balance Difference Adjustment (Suspense A/c)</td>
                    <td className="num-mono" style={{ textAlign: 'right' }}>
                      {book.trialBalance.openingDifference < 0 ? formatCurrency(Math.abs(book.trialBalance.openingDifference)) : '—'}
                    </td>
                    <td className="num-mono" style={{ textAlign: 'right' }}>
                      {book.trialBalance.openingDifference > 0 ? formatCurrency(book.trialBalance.openingDifference) : '—'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot style={{ position: 'sticky', bottom: 0, background: '#F8FAFC', zIndex: 5 }}>
                <tr style={{ fontWeight: 800, borderTop: '2px solid #0F172A' }}>
                  <td colSpan={5}>Grand Total (Double-Entry Verification: Total Dr = Total Cr)</td>
                  <td className="num-mono" style={{ textAlign: 'right' }}>
                    {formatCurrency(Math.max(book.trialBalance.totalDebit, book.trialBalance.totalCredit))} <span className="dr-badge">Dr</span>
                  </td>
                  <td className="num-mono" style={{ textAlign: 'right' }}>
                    {formatCurrency(Math.max(book.trialBalance.totalDebit, book.trialBalance.totalCredit))} <span className="cr-badge">Cr</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: PROFIT & LOSS ACCOUNT */}
      {activeTab === 'pnl' && (
        <div className="glass-card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Trading & Profit and Loss Account (Horizontal T-Format)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 10 }}>
                Particulars — Expenses / Debit Side (Dr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Opening Stock</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.openingStockValue)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Purchases (Net of Returns)</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.purchasesNet)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Direct Expenses (Freight / Inward)</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.directExpenses)}</strong>
                </div>
                {book.profitAndLoss.grossProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <span>To Gross Profit c/o</span>
                    <span className="num-mono">{formatCurrency(book.profitAndLoss.grossProfit)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                  <span>To Indirect / Shop & Admin Expenses</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.indirectExpenses)}</strong>
                </div>
                {book.profitAndLoss.netProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 800, fontSize: '1rem', paddingTop: 10, borderTop: '2px solid #0F172A' }}>
                    <span>To Net Profit (Transferred to Capital A/c)</span>
                    <span className="num-mono">{formatCurrency(book.profitAndLoss.netProfit)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 10 }}>
                Particulars — Revenue / Credit Side (Cr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>By Sales (Net of Returns & Output GST)</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.salesNet)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>By Closing Stock-in-Hand (At Cost)</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.closingStockValue)}</strong>
                </div>
                {book.profitAndLoss.grossProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <span>By Gross Profit b/f</span>
                    <span className="num-mono">{formatCurrency(book.profitAndLoss.grossProfit)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                  <span>By Indirect / Other Income</span>
                  <strong className="num-mono">{formatCurrency(book.profitAndLoss.indirectIncome)}</strong>
                </div>
                {book.profitAndLoss.netProfit < 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--danger)', fontWeight: 800, fontSize: '1rem', paddingTop: 10, borderTop: '2px solid #0F172A' }}>
                    <span>By Net Loss</span>
                    <span className="num-mono">{formatCurrency(Math.abs(book.profitAndLoss.netProfit))}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: BALANCE SHEET */}
      {activeTab === 'bs' && (
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Statement of Financial Position (Balance Sheet)</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '6px 12px', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem' }}>
                Working Capital: <strong className="num-mono" style={{ color: '#0F172A' }}>{formatCurrency(book.balanceSheet.workingCapital || 0)}</strong>
              </div>
              <div style={{ padding: '6px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.8rem' }}>
                Current Ratio: <strong className="num-mono" style={{ color: '#1D4ED8' }}>{book.balanceSheet.currentRatio ?? '—'} : 1</strong>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 10 }}>
                Capital & Liabilities (Cr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Capital Account</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.liabilities.capitalAccount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: book.balanceSheet.liabilities.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  <span>Add: Net Profit / (Loss)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.liabilities.netProfit)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Loans (Liability)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.liabilities.loansLiability)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sundry Creditors (Supplier Payables)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.liabilities.sundryCreditors)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Duties & Taxes (Net GST Payable)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.liabilities.gstPayable)}</strong>
                </div>
                {Math.abs(book.balanceSheet.liabilities.openingBalanceAdjustment) >= 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                    <span>Opening Balance Difference Reserve</span>
                    <span className="num-mono">{formatCurrency(book.balanceSheet.liabilities.openingBalanceAdjustment)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1rem', paddingTop: 10, borderTop: '2px solid #0F172A' }}>
                  <span>Total Capital & Liabilities</span>
                  <span className="num-mono">{formatCurrency(book.balanceSheet.liabilities.total)}</span>
                </div>
              </div>
            </div>

            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '2px solid #0F172A', paddingBottom: 8, marginBottom: 10 }}>
                Assets & Properties (Dr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Fixed Assets</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.fixedAssets)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Closing Stock-in-Hand (At Cost)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.closingStock)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sundry Debtors (Customer Receivables)</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.sundryDebtors)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Cash-in-Hand</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.cashInHand)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Bank Accounts</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.bankAccounts)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Net GST Input Tax Credit (ITC) Receivable</span>
                  <strong className="num-mono">{formatCurrency(book.balanceSheet.assets.itcReceivable)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1rem', paddingTop: 10, borderTop: '2px solid #0F172A' }}>
                  <span>Total Assets</span>
                  <span className="num-mono">{formatCurrency(book.balanceSheet.assets.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Ledger Modal */}
      {showLedgerModal && (
        <div className="modal-overlay" onClick={() => setShowLedgerModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create New Ledger Account</h2>
              <button className="modal-close" onClick={() => setShowLedgerModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveLedger}>
              <div className="form-group">
                <label className="form-label">Ledger Account Name *</label>
                <input className="form-input" value={ledgerForm.name} onChange={e => setLedgerForm({ ...ledgerForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Account Code / Alias</label>
                <input className="form-input" value={ledgerForm.code} onChange={e => setLedgerForm({ ...ledgerForm, code: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Account Group</label>
                <select className="form-input" value={ledgerForm.group} onChange={e => setLedgerForm({ ...ledgerForm, group: e.target.value })}>
                  {ACCOUNT_GROUPS.map(g => <option key={g.id} value={g.id}>{g.id} ({g.nature})</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Opening Balance (₹)</label>
                  <input type="number" step="any" className="form-input num-mono" value={ledgerForm.openingBalance} onChange={e => setLedgerForm({ ...ledgerForm, openingBalance: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Dr / Cr</label>
                  <select className="form-input" value={ledgerForm.openingType} onChange={e => setLedgerForm({ ...ledgerForm, openingType: e.target.value })}>
                    <option value="Dr">Dr (Debit)</option>
                    <option value="Cr">Cr (Credit)</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowLedgerModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Ledger</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Add/Edit Modal */}
      {showSupplierModal && (
        <div className="modal-overlay" onClick={() => setShowSupplierModal(false)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingSupplier ? 'Edit Supplier' : 'Add Automotive Supplier'}</h2>
              <button className="modal-close" onClick={() => setShowSupplierModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveSupplier} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Supplier / Vendor Firm Name *</label>
                <input className="form-input" value={supForm.name} onChange={e => setSupForm({ ...supForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Account Code</label>
                <input className="form-input num-mono" value={supForm.accountCode} onChange={e => setSupForm({ ...supForm, accountCode: e.target.value })} placeholder="SUP-101" />
              </div>
              <div className="form-group">
                <label className="form-label">GSTIN (15 chars)</label>
                <input className="form-input num-mono" maxLength={15} value={supForm.gstin} onChange={e => setSupForm({ ...supForm, gstin: e.target.value.toUpperCase() })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input num-mono" value={supForm.phone} onChange={e => setSupForm({ ...supForm, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">State</label>
                <input className="form-input" value={supForm.state} onChange={e => setSupForm({ ...supForm, state: e.target.value })} placeholder="Delhi" />
              </div>
              <div className="form-group">
                <label className="form-label">Opening Balance (₹)</label>
                <input type="number" step="any" className="form-input num-mono" value={supForm.openingBalance} onChange={e => setSupForm({ ...supForm, openingBalance: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Credit Period (Days)</label>
                <input type="number" className="form-input num-mono" value={supForm.creditDays} onChange={e => setSupForm({ ...supForm, creditDays: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Address</label>
                <input className="form-input" value={supForm.address} onChange={e => setSupForm({ ...supForm, address: e.target.value })} />
              </div>
              <div className="modal-footer" style={{ gridColumn: 'span 2' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSupplierModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
