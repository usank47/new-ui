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
} from '../utils/accounting';
import { formatCurrency } from '../utils';
import { writeXlsxFile } from '../utils/xlsx';
import { toast } from './Toast';

export default function AccountingView({ showToast = toast, initialTab = 'vouchers', initialVoucherType = '' }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'vouchers'); // 'vouchers' | 'ledgers' | 'suppliers' | 'trial' | 'pnl' | 'bs' | 'ageing'
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
  const [selectedAccountId, setSelectedAccountId] = useState('sys_cash');
  const [ledgerGroupFilter, setLedgerGroupFilter] = useState('All');

  // Voucher Entry Form
  const [vForm, setVForm] = useState({
    voucherType: initialVoucherType || 'Payment',
    voucherNo: `VCH/${Date.now().toString().slice(-4)}`,
    date: new Date().toISOString().slice(0, 10),
    debitAccountId: '',
    creditAccountId: 'sys_cash',
    amount: '',
    paymentMode: 'Cash',
    productId: '',
    returnQty: 1,
    narration: '',
  });

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
    if (initialTab) setActiveTab(initialTab);
    if (initialVoucherType) {
      setActiveTab('vouchers');
      setVForm(prev => ({ ...prev, voucherType: initialVoucherType }));
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

  // Set default debit/credit accounts when voucherType changes
  useEffect(() => {
    if (!book.accounts.length) return;
    if (!vForm.debitAccountId) {
      const firstSupplierOrExpense = book.accounts.find(a => a.group === 'Sundry Creditors' || a.group === 'Indirect Expenses') || book.accounts[0];
      if (firstSupplierOrExpense) {
        setVForm(prev => ({ ...prev, debitAccountId: firstSupplierOrExpense.id }));
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

  const handlePostVoucher = async (e) => {
    e.preventDefault();
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

    await saveVoucher({
      voucherType: vForm.voucherType,
      voucherNo: vForm.voucherNo,
      date: vForm.date,
      debitAccountId: vForm.debitAccountId,
      creditAccountId: vForm.creditAccountId,
      amount: amt,
      paymentMode: vForm.paymentMode,
      narration: vForm.narration || `${vForm.voucherType}: Dr ${drName} / Cr ${crName}`,
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
      narration: '',
    }));
    showToast(`${vForm.voucherType} Voucher posted to Double-Entry Ledger`, 'success');
  };

  const handleSaveLedger = async (e) => {
    e.preventDefault();
    if (!ledgerForm.name.trim()) return;
    await saveLedger(ledgerForm);
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
    return book.accounts.filter(a => ledgerGroupFilter === 'All' || a.group === ledgerGroupFilter);
  }, [book.accounts, ledgerGroupFilter]);

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
          <h1 className="page-title">Double-Entry Accounting, Vouchers & Financial Statements</h1>
          <p className="page-subtitle">
            Payment, Receipt, Journal, Contra, Credit/Debit Notes, Party Ledgers, Trial Balance, P&L & Balance Sheet
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            className="form-input"
            style={{ width: 145 }}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            title="Period Start Date"
          />
          <span style={{ color: 'var(--text-muted)' }}>to</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 145 }}
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
            + Add Supplier (F5)
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="glass-card" style={{ padding: 10, marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { id: 'vouchers', label: 'Vouchers & Daybook' },
          { id: 'ledgers', label: 'General & Party Ledgers' },
          { id: 'suppliers', label: `Suppliers (${suppliers.length})` },
          { id: 'ageing', label: 'Receivable / Payable Ageing' },
          { id: 'trial', label: 'Trial Balance' },
          { id: 'pnl', label: 'Profit & Loss A/c' },
          { id: 'bs', label: 'Balance Sheet' },
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
          <div className="glass-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Post Double-Entry Accounting Voucher</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

            <form onSubmit={handlePostVoucher} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Voucher Number</label>
                <input className="form-input" value={vForm.voucherNo} onChange={e => setVForm({ ...vForm, voucherNo: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Voucher Date</label>
                <input type="date" className="form-input" value={vForm.date} onChange={e => setVForm({ ...vForm, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Debit Account (Dr) *</label>
                <select className="form-input" value={vForm.debitAccountId} onChange={e => setVForm({ ...vForm, debitAccountId: e.target.value })} required>
                  <option value="">-- Select Dr Account --</option>
                  {book.accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.group}) — Bal: {formatCurrency(a.closingBalance)} {a.closingType}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Credit Account (Cr) *</label>
                <select className="form-input" value={vForm.creditAccountId} onChange={e => setVForm({ ...vForm, creditAccountId: e.target.value })} required>
                  <option value="">-- Select Cr Account --</option>
                  {book.accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.group}) — Bal: {formatCurrency(a.closingBalance)} {a.closingType}
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
                  className="form-input"
                  value={vForm.amount}
                  onChange={e => setVForm({ ...vForm, amount: e.target.value })}
                  placeholder="0.00"
                  required
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

              {(vForm.voucherType === 'Sales Return' || vForm.voucherType === 'Purchase Return') && (
                <>
                  <div className="form-group">
                    <label className="form-label">Returned Spare Part (Auto Stock Update)</label>
                    <select className="form-input" value={vForm.productId} onChange={e => setVForm({ ...vForm, productId: e.target.value })}>
                      <option value="">-- Optional: Select Returned Part --</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.oemPartNo || p.brand || 'Part'}) — Stock: {p.stock ?? 0}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Return Quantity</label>
                    <input type="number" step="any" min="1" className="form-input" value={vForm.returnQty} onChange={e => setVForm({ ...vForm, returnQty: e.target.value })} />
                  </div>
                </>
              )}

              <div className="form-group" style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
                <input
                  className="form-input"
                  value={vForm.narration}
                  onChange={e => setVForm({ ...vForm, narration: e.target.value })}
                  placeholder="Narration / Bill reference / Cheque number..."
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  Post {vForm.voucherType} Voucher
                </button>
              </div>
            </form>
          </div>

          {/* Chronological Daybook */}
          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ marginBottom: 10 }}>Complete Double-Entry Daybook ({book.daybook.length} Vouchers)</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher No</th>
                    <th>Type</th>
                    <th>Debit / Credit Particulars</th>
                    <th style={{ textAlign: 'right' }}>Debit (₹)</th>
                    <th style={{ textAlign: 'right' }}>Credit (₹)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {book.daybook.slice(0, 80).map(v => (
                    <tr key={v.id}>
                      <td>{v.date}</td>
                      <td><code>{v.voucherNo}</code></td>
                      <td><span className="tag">{v.voucherType}</span></td>
                      <td>
                        <div style={{ fontSize: '0.82rem' }}>
                          {v.lines.map((l, i) => (
                            <div key={i}>
                              <strong>{l.debit > 0 ? 'Dr' : 'Cr'}</strong> {l.accountName}: {formatCurrency(l.debit || l.credit)}
                            </div>
                          ))}
                        </div>
                        {v.narration && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{v.narration}</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(v.totalDebit)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(v.totalCredit)}</td>
                      <td>
                        {String(v.id).startsWith('vch_') && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              await deleteVoucher(v.id);
                              await loadData();
                              showToast('Voucher deleted', 'info');
                            }}
                          >
                            Del
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

      {/* TAB 2: GENERAL & PARTY LEDGERS */}
      {activeTab === 'ledgers' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
          <div className="glass-card" style={{ padding: 14, maxHeight: '75vh', overflowY: 'auto' }}>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Filter by Account Group</label>
              <select className="form-input" value={ledgerGroupFilter} onChange={e => setLedgerGroupFilter(e.target.value)}>
                <option value="All">All Account Groups ({book.accounts.length})</option>
                {ACCOUNT_GROUPS.map(g => <option key={g.id} value={g.id}>{g.id}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredAccounts.map(acc => (
                <div
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: selectedAccount?.id === acc.id ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                    border: selectedAccount?.id === acc.id ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{acc.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>{acc.group}</span>
                    <strong style={{ color: acc.closingType === 'Dr' ? 'var(--primary)' : 'var(--warning)' }}>
                      {formatCurrency(acc.closingBalance)} {acc.closingType}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedAccount && (
            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{selectedAccount.name}</h3>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Group: <strong>{selectedAccount.group}</strong>
                    {selectedAccount.gstin ? ` • GSTIN: ${selectedAccount.gstin}` : ''}
                    {selectedAccount.creditLimit > 0 ? ` • Credit Limit: ${formatCurrency(selectedAccount.creditLimit)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Closing Balance</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--primary)' }}>
                      {formatCurrency(selectedAccount.closingBalance)} {selectedAccount.closingType}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={handleExportLedgerExcel}>
                    Export Statement (.XLSX)
                  </button>
                </div>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Voucher No</th>
                      <th>Type</th>
                      <th>Particulars / Contra A/c</th>
                      <th style={{ textAlign: 'right' }}>Debit (Dr ₹)</th>
                      <th style={{ textAlign: 'right' }}>Credit (Cr ₹)</th>
                      <th style={{ textAlign: 'right' }}>Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'var(--bg-secondary)', fontWeight: 600 }}>
                      <td>Opening</td>
                      <td>—</td>
                      <td>OB</td>
                      <td>Opening Balance Brought Forward</td>
                      <td style={{ textAlign: 'right' }}>{selectedAccount.signedOpening > 0 ? formatCurrency(Math.abs(selectedAccount.signedOpening)) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{selectedAccount.signedOpening < 0 ? formatCurrency(Math.abs(selectedAccount.signedOpening)) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCurrency(Math.abs(selectedAccount.signedOpening))} {selectedAccount.signedOpening >= 0 ? 'Dr' : 'Cr'}
                      </td>
                    </tr>
                    {selectedAccount.postings.map(p => (
                      <tr key={p.id}>
                        <td>{p.date}</td>
                        <td><code>{p.voucherNo}</code></td>
                        <td>{p.voucherType}</td>
                        <td>
                          <div>{p.particulars}</div>
                          {p.narration && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{p.narration}</div>}
                        </td>
                        <td style={{ textAlign: 'right', color: p.debit > 0 ? 'var(--success)' : undefined }}>
                          {p.debit > 0 ? formatCurrency(p.debit) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', color: p.credit > 0 ? 'var(--danger)' : undefined }}>
                          {p.credit > 0 ? formatCurrency(p.credit) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {formatCurrency(p.runningBalance)} {p.runningType}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                      <td colSpan={4}>Period Totals & Closing Balance</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(selectedAccount.periodDebit)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(selectedAccount.periodCredit)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--primary)' }}>
                        {formatCurrency(selectedAccount.closingBalance)} {selectedAccount.closingType}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
                  <th>Opening Bal</th>
                  <th>Current Ledger Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => {
                  const ldg = book.accountMap.get(`sup_${s.id}`);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td><code>{s.accountCode || '—'}</code></td>
                      <td><code>{s.gstin || '—'}</code></td>
                      <td>{s.phone || '—'}</td>
                      <td>{s.state || '—'}</td>
                      <td>{s.creditDays || 30} days</td>
                      <td>{formatCurrency(s.openingBalance || 0)} {s.openingType || 'Cr'}</td>
                      <td style={{ fontWeight: 700 }}>
                        {ldg ? `${formatCurrency(ldg.closingBalance)} ${ldg.closingType}` : formatCurrency(s.openingBalance || 0)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
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
                            Del
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
              <div className="stat-card"><div>0–30 Days</div><strong>{formatCurrency(book.ageing.receivables.d0_30)}</strong></div>
              <div className="stat-card"><div>31–60 Days</div><strong>{formatCurrency(book.ageing.receivables.d31_60)}</strong></div>
              <div className="stat-card"><div>61–90 Days</div><strong style={{ color: 'var(--warning)' }}>{formatCurrency(book.ageing.receivables.d61_90)}</strong></div>
              <div className="stat-card"><div>90+ Days</div><strong style={{ color: 'var(--danger)' }}>{formatCurrency(book.ageing.receivables.d90_plus)}</strong></div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Customer</th><th>Invoice</th><th>Date</th><th>Age</th><th>Balance Due</th></tr>
                </thead>
                <tbody>
                  {book.ageing.receivables.rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.partyName}</td>
                      <td><code>{r.docNo}</code></td>
                      <td>{r.date}</td>
                      <td>{r.ageDays}d ({r.bucket})</td>
                      <td style={{ fontWeight: 700, color: 'var(--danger)' }}>{formatCurrency(r.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ marginBottom: 10 }}>Supplier Payable Ageing (Total: {formatCurrency(book.ageing.payables.total)})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <div className="stat-card"><div>0–30 Days</div><strong>{formatCurrency(book.ageing.payables.d0_30)}</strong></div>
              <div className="stat-card"><div>31–60 Days</div><strong>{formatCurrency(book.ageing.payables.d31_60)}</strong></div>
              <div className="stat-card"><div>61–90 Days</div><strong style={{ color: 'var(--warning)' }}>{formatCurrency(book.ageing.payables.d61_90)}</strong></div>
              <div className="stat-card"><div>90+ Days</div><strong style={{ color: 'var(--danger)' }}>{formatCurrency(book.ageing.payables.d90_plus)}</strong></div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Supplier</th><th>Bill No</th><th>Date</th><th>Age</th><th>Payable Due</th></tr>
                </thead>
                <tbody>
                  {book.ageing.payables.rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.partyName}</td>
                      <td><code>{r.docNo}</code></td>
                      <td>{r.date}</td>
                      <td>{r.ageDays}d ({r.bucket})</td>
                      <td style={{ fontWeight: 700, color: 'var(--warning)' }}>{formatCurrency(r.due)}</td>
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
          <h3 style={{ marginBottom: 12 }}>Trial Balance (Double-Entry Ledger Verification)</h3>
          <div className="table-scroll">
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
                  <tr key={acc.id}>
                    <td style={{ fontWeight: 600 }}>{acc.name}</td>
                    <td>{acc.group}</td>
                    <td style={{ textAlign: 'right' }}>{acc.openingBalance > 0 ? `${formatCurrency(acc.openingBalance)} ${acc.openingType}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{acc.periodDebit > 0 ? formatCurrency(acc.periodDebit) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{acc.periodCredit > 0 ? formatCurrency(acc.periodCredit) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {acc.signedClosing >= 0 ? formatCurrency(acc.closingBalance) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {acc.signedClosing < 0 ? formatCurrency(acc.closingBalance) : '—'}
                    </td>
                  </tr>
                ))}
                {Math.abs(book.trialBalance.openingDifference) >= 0.01 && (
                  <tr style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                    <td colSpan={5}>Opening Balance Difference Adjustment</td>
                    <td style={{ textAlign: 'right' }}>
                      {book.trialBalance.openingDifference < 0 ? formatCurrency(Math.abs(book.trialBalance.openingDifference)) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {book.trialBalance.openingDifference > 0 ? formatCurrency(book.trialBalance.openingDifference) : '—'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={5}>Grand Total (Reconciled Dr = Cr)</td>
                  <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                    {formatCurrency(Math.max(book.trialBalance.totalDebit, book.trialBalance.totalCredit))}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                    {formatCurrency(Math.max(book.trialBalance.totalDebit, book.trialBalance.totalCredit))}
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
          <h3 style={{ marginBottom: 14 }}>Trading & Profit and Loss Account</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 10 }}>
                Expenses / Debit Side (Dr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Opening Stock</span>
                  <strong>{formatCurrency(book.profitAndLoss.openingStockValue)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Purchases (Net of Returns)</span>
                  <strong>{formatCurrency(book.profitAndLoss.purchasesNet)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>To Direct Expenses (Freight / Inward)</span>
                  <strong>{formatCurrency(book.profitAndLoss.directExpenses)}</strong>
                </div>
                {book.profitAndLoss.grossProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <span>To Gross Profit c/o</span>
                    <span>{formatCurrency(book.profitAndLoss.grossProfit)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                  <span>To Indirect / Shop Expenses</span>
                  <strong>{formatCurrency(book.profitAndLoss.indirectExpenses)}</strong>
                </div>
                {book.profitAndLoss.netProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 800, fontSize: '1.05rem', paddingTop: 10, borderTop: '2px solid var(--border)' }}>
                    <span>To Net Profit (Transferred to Capital)</span>
                    <span>{formatCurrency(book.profitAndLoss.netProfit)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 10 }}>
                Revenue / Credit Side (Cr)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>By Sales (Net of Returns & GST)</span>
                  <strong>{formatCurrency(book.profitAndLoss.salesNet)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>By Closing Stock (At Cost)</span>
                  <strong>{formatCurrency(book.profitAndLoss.closingStockValue)}</strong>
                </div>
                {book.profitAndLoss.grossProfit >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <span>By Gross Profit b/f</span>
                    <span>{formatCurrency(book.profitAndLoss.grossProfit)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                  <span>By Indirect / Other Income</span>
                  <strong>{formatCurrency(book.profitAndLoss.indirectIncome)}</strong>
                </div>
                {book.profitAndLoss.netProfit < 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--danger)', fontWeight: 800, fontSize: '1.05rem', paddingTop: 10, borderTop: '2px solid var(--border)' }}>
                    <span>By Net Loss</span>
                    <span>{formatCurrency(Math.abs(book.profitAndLoss.netProfit))}</span>
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
          <h3 style={{ marginBottom: 14 }}>Balance Sheet</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 10 }}>
                Capital & Liabilities
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Capital Account</span>
                  <strong>{formatCurrency(book.balanceSheet.liabilities.capitalAccount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: book.balanceSheet.liabilities.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  <span>Add: Net Profit / (Loss)</span>
                  <strong>{formatCurrency(book.balanceSheet.liabilities.netProfit)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Loans (Liability)</span>
                  <strong>{formatCurrency(book.balanceSheet.liabilities.loansLiability)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sundry Creditors (Supplier Payables)</span>
                  <strong>{formatCurrency(book.balanceSheet.liabilities.sundryCreditors)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Duties & Taxes (Net GST Payable)</span>
                  <strong>{formatCurrency(book.balanceSheet.liabilities.gstPayable)}</strong>
                </div>
                {Math.abs(book.balanceSheet.liabilities.openingBalanceAdjustment) >= 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                    <span>Opening Balance Adjustment Reserve</span>
                    <span>{formatCurrency(book.balanceSheet.liabilities.openingBalanceAdjustment)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.05rem', paddingTop: 10, borderTop: '2px solid var(--border)' }}>
                  <span>Total Liabilities</span>
                  <span>{formatCurrency(book.balanceSheet.liabilities.total)}</span>
                </div>
              </div>
            </div>

            <div className="glass-card" style={{ padding: 16 }}>
              <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 10 }}>
                Assets & Properties
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Fixed Assets</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.fixedAssets)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Closing Stock-in-Hand (At Cost)</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.closingStock)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sundry Debtors (Customer Receivables)</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.sundryDebtors)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Cash-in-Hand</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.cashInHand)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Bank Accounts</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.bankAccounts)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Net GST Input Tax Credit (ITC) Receivable</span>
                  <strong>{formatCurrency(book.balanceSheet.assets.itcReceivable)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.05rem', paddingTop: 10, borderTop: '2px solid var(--border)' }}>
                  <span>Total Assets</span>
                  <span>{formatCurrency(book.balanceSheet.assets.total)}</span>
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
                  <input type="number" step="any" className="form-input" value={ledgerForm.openingBalance} onChange={e => setLedgerForm({ ...ledgerForm, openingBalance: e.target.value })} />
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
                <input className="form-input" value={supForm.accountCode} onChange={e => setSupForm({ ...supForm, accountCode: e.target.value })} placeholder="SUP-101" />
              </div>
              <div className="form-group">
                <label className="form-label">GSTIN (15 chars)</label>
                <input className="form-input" maxLength={15} value={supForm.gstin} onChange={e => setSupForm({ ...supForm, gstin: e.target.value.toUpperCase() })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={supForm.phone} onChange={e => setSupForm({ ...supForm, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">State</label>
                <input className="form-input" value={supForm.state} onChange={e => setSupForm({ ...supForm, state: e.target.value })} placeholder="Delhi" />
              </div>
              <div className="form-group">
                <label className="form-label">Opening Balance (₹)</label>
                <input type="number" step="any" className="form-input" value={supForm.openingBalance} onChange={e => setSupForm({ ...supForm, openingBalance: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Credit Period (Days)</label>
                <input type="number" className="form-input" value={supForm.creditDays} onChange={e => setSupForm({ ...supForm, creditDays: e.target.value })} />
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
