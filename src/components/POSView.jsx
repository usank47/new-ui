import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  getAllProducts,
  getAllClients,
  saveClient,
  getAllBills,
  saveBill,
  applyStockChanges,
  getNextInvoiceNumber,
  getInventorySettings,
  getProfile,
} from '../store';
import {
  CUSTOMER_TYPES,
  normalizeAutomotiveProduct,
  getPriceForCustomerType,
  productMatchesSearch,
} from '../utils/products';
import { formatCurrency, stockEffect, businessKeyOf, isCancelledBill } from '../utils';
import { toast } from './Toast';

export default function POSView({ showToast = toast, onOpenFullInvoice }) {
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [bills, setBills] = useState([]);
  const [profile, setProfile] = useState({});
  const [invSettings, setInvSettings] = useState({ allowNegativeStock: true, multiLocationEnabled: false });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [customerName, setCustomerName] = useState('Walk-in Counter Customer');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [customerVehicle, setCustomerVehicle] = useState('');
  const [customerType, setCustomerType] = useState('Retail');

  const [cart, setCart] = useState([]);
  const [selectedCartIdx, setSelectedCartIdx] = useState(0);
  const [billDiscount, setBillDiscount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('Cash'); // 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Credit' | 'Split'
  const [cashTendered, setCashTendered] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitUpi, setSplitUpi] = useState('');
  const [saving, setSaving] = useState(false);

  // Quick Modals
  const [priceCheckItem, setPriceCheckItem] = useState(null);
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustForm, setNewCustForm] = useState({ name: '', phone: '', customerType: 'Mechanic', gstin: '', vehicleNo: '', creditLimit: 50000 });
  const [heldBills, setHeldBills] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fgsb_pos_held_bills') || '[]'); } catch { return []; }
  });

  const searchInputRef = useRef(null);
  const customerSelectRef = useRef(null);

  const loadData = async () => {
    const [prods, clis, bls, prof, invCfg] = await Promise.all([
      getAllProducts(),
      getAllClients(),
      getAllBills(),
      getProfile(),
      getInventorySettings(),
    ]);
    setProducts((prods || []).map(normalizeAutomotiveProduct));
    setClients(clis || []);
    setBills(bls || []);
    setProfile(prof || {});
    setInvSettings(invCfg);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Re-price cart items when customerType changes
  const handleCustomerTypeChange = (nextType) => {
    setCustomerType(nextType);
    setCart(prev =>
      prev.map(item => {
        const prod = products.find(p => p.id === item.productId);
        if (!prod) return item;
        const { price, tierLabel } = getPriceForCustomerType(prod, nextType);
        return { ...item, rate: price, tierLabel };
      })
    );
  };

  const handleSelectClient = (clientId) => {
    setSelectedClientId(clientId);
    if (!clientId) {
      setCustomerName('Walk-in Counter Customer');
      setCustomerPhone('');
      setCustomerGstin('');
      handleCustomerTypeChange('Retail');
      return;
    }
    const cli = clients.find(c => c.id === clientId);
    if (cli) {
      setCustomerName(cli.name || '');
      setCustomerPhone(cli.phone || '');
      setCustomerGstin(cli.gstin || '');
      setCustomerVehicle(cli.vehicleNo || '');
      handleCustomerTypeChange(cli.customerType || 'Retail');
    }
  };

  // Customer outstanding calculation
  const selectedClientOutstanding = useMemo(() => {
    if (!selectedClientId) return 0;
    const cli = clients.find(c => c.id === selectedClientId);
    if (!cli) return 0;
    let due = Number(cli.openingBalance) || 0;
    for (const b of bills) {
      if (!b || isCancelledBill(b)) continue;
      const bName = (b.clientName || b.data?.client?.name || '').toLowerCase();
      if (bName !== (cli.name || '').toLowerCase()) continue;
      const total = Number(b.totalAmount ?? b.data?.totalAmount ?? 0);
      const paid = (b.payments || b.data?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      if (b.status !== 'Paid') due += Math.max(0, total - paid);
    }
    return Math.round(due * 100) / 100;
  }, [selectedClientId, clients, bills]);

  const addToCart = (prod) => {
    const existingIdx = cart.findIndex(c => c.productId === prod.id);
    const currentQtyInCart = existingIdx >= 0 ? Number(cart[existingIdx].quantity) : 0;
    const nextQty = currentQtyInCart + 1;
    const avail = Number(prod.stock) || 0;

    if (prod.kind !== 'service' && !invSettings.allowNegativeStock && nextQty > avail) {
      showToast(`Insufficient Stock for "${prod.name}". Available: ${avail} ${prod.unit || 'Nos'} (Allow Negative Stock is OFF).`, 'error');
      return;
    }

    const { price, tierLabel } = getPriceForCustomerType(prod, customerType);

    if (existingIdx >= 0) {
      setCart(prev => prev.map((it, idx) => (idx === existingIdx ? { ...it, quantity: nextQty } : it)));
      setSelectedCartIdx(existingIdx);
    } else {
      const newItem = {
        productId: prod.id,
        name: prod.name,
        oemPartNo: prod.oemPartNo || '',
        brand: prod.brand || '',
        hsn: prod.hsn || '8708',
        unit: prod.unit || 'Nos',
        quantity: 1,
        mrp: Number(prod.mrp) || price,
        rate: price,
        minSellingPrice: Number(prod.minSellingPrice) || 0,
        discountPercent: Number(prod.discountPercent) || 0,
        taxPercent: Number(prod.taxPercent ?? 18),
        availableStock: avail,
        rack: prod.rack || '',
        binLocation: prod.binLocation || '',
        tierLabel,
      };
      setCart(prev => {
        const next = [...prev, newItem];
        setSelectedCartIdx(next.length - 1);
        return next;
      });
    }
  };

  const updateCartItem = (idx, patch) => {
    setCart(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = { ...item, ...patch };
        if ('quantity' in patch) {
          const q = Number(patch.quantity) || 0;
          if (!invSettings.allowNegativeStock && q > item.availableStock) {
            showToast(`Cannot exceed available stock (${item.availableStock}) when Negative Stock is OFF`, 'error');
            return item;
          }
        }
        return next;
      })
    );
  };

  const removeFromCart = (idx) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
    setSelectedCartIdx(prev => Math.max(0, prev - 1));
  };

  // Totals computation
  const posTotals = useMemo(() => {
    let subTotal = 0;
    let taxTotal = 0;
    let itemDiscountTotal = 0;

    const lines = cart.map(it => {
      const qty = Math.max(0, Number(it.quantity) || 0);
      const rate = Math.max(0, Number(it.rate) || 0);
      const discPct = Math.max(0, Number(it.discountPercent) || 0);
      const taxPct = Math.max(0, Number(it.taxPercent) || 0);

      const gross = qty * rate;
      const discAmt = Math.round(((gross * discPct) / 100) * 100) / 100;
      const taxable = Math.round((gross - discAmt) * 100) / 100;
      const taxAmt = Math.round(((taxable * taxPct) / 100) * 100) / 100;
      const lineTotal = Math.round((taxable + taxAmt) * 100) / 100;

      subTotal += taxable;
      taxTotal += taxAmt;
      itemDiscountTotal += discAmt;
      return { ...it, taxable, taxAmt, lineTotal };
    });

    const extraDisc = Number(billDiscount) || 0;
    const rawGrand = Math.max(0, subTotal + taxTotal - extraDisc);
    const grandTotal = Math.round(rawGrand);
    const roundOff = Math.round((grandTotal - rawGrand) * 100) / 100;
    const halfTax = Math.round((taxTotal / 2) * 100) / 100;

    const tendered = Number(cashTendered) || 0;
    const changeReturn = paymentMode === 'Cash' && tendered > grandTotal ? Math.round((tendered - grandTotal) * 100) / 100 : 0;

    return {
      lines,
      subTotal: Math.round(subTotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      cgst: halfTax,
      sgst: halfTax,
      itemDiscountTotal: Math.round(itemDiscountTotal * 100) / 100,
      roundOff,
      grandTotal,
      changeReturn,
    };
  }, [cart, billDiscount, cashTendered, paymentMode]);

  // Hold / Recall Bill
  const handleHoldBill = () => {
    if (!cart.length) return;
    const held = {
      id: `hold_${Date.now()}`,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      customerName,
      customerType,
      selectedClientId,
      cart,
      grandTotal: posTotals.grandTotal,
    };
    const next = [held, ...heldBills];
    setHeldBills(next);
    try { localStorage.setItem('fgsb_pos_held_bills', JSON.stringify(next)); } catch { /* ignore */ }
    setCart([]);
    showToast(`Bill held for ${customerName}`, 'info');
  };

  const handleRecallBill = (held) => {
    setCustomerName(held.customerName);
    setCustomerType(held.customerType || 'Retail');
    setSelectedClientId(held.selectedClientId || '');
    setCart(held.cart || []);
    const next = heldBills.filter(h => h.id !== held.id);
    setHeldBills(next);
    try { localStorage.setItem('fgsb_pos_held_bills', JSON.stringify(next)); } catch { /* ignore */ }
    showToast('Held bill recalled to counter', 'info');
  };

  // Checkout / Save POS Invoice
  const handleCheckout = async () => {
    if (!cart.length) {
      showToast('Add at least one spare part to the POS cart', 'warning');
      return;
    }

    // Verify negative stock rule
    if (!invSettings.allowNegativeStock) {
      for (const item of cart) {
        const prod = products.find(p => p.id === item.productId);
        if (prod && prod.kind !== 'service' && Number(item.quantity) > (Number(prod.stock) || 0)) {
          showToast(`Insufficient stock for "${item.name}" (Available: ${prod.stock ?? 0}). Sale blocked because Allow Negative Stock is OFF.`, 'error');
          return;
        }
      }
    }

    // Check Credit Limit warning if Credit sale
    if (paymentMode === 'Credit' && selectedClientId) {
      const cli = clients.find(c => c.id === selectedClientId);
      if (cli && Number(cli.creditLimit) > 0 && selectedClientOutstanding + posTotals.grandTotal > Number(cli.creditLimit)) {
        showToast(`Warning: Customer exceeds credit limit of ${formatCurrency(cli.creditLimit)}`, 'warning');
      }
    }

    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const invNo = await getNextInvoiceNumber('POS', {
        invoiceType: 'tax-invoice',
        businessKey: businessKeyOf(profile),
        invoiceDate: today,
      });

      const billItems = posTotals.lines.map(l => ({
        productId: l.productId,
        description: `${l.name}${l.oemPartNo ? ` [OEM: ${l.oemPartNo}]` : ''}`,
        hsn: l.hsn || '8708',
        quantity: Number(l.quantity) || 1,
        unit: l.unit || 'Nos',
        rate: Number(l.rate) || 0,
        discountPercent: Number(l.discountPercent) || 0,
        taxPercent: Number(l.taxPercent) || 18,
        amount: l.taxable,
      }));

      let payments = [];
      let status = 'Paid';
      if (paymentMode === 'Credit') {
        status = 'Pending';
      } else if (paymentMode === 'Split') {
        const cAmt = Number(splitCash) || 0;
        const uAmt = Number(splitUpi) || Math.max(0, posTotals.grandTotal - cAmt);
        if (cAmt > 0) payments.push({ id: `pmt_c_${Date.now()}`, amount: cAmt, date: today, mode: 'Cash' });
        if (uAmt > 0) payments.push({ id: `pmt_u_${Date.now()}`, amount: uAmt, date: today, mode: 'UPI' });
      } else {
        payments = [{ id: `pmt_${Date.now()}`, amount: posTotals.grandTotal, date: today, mode: paymentMode }];
      }

      const stockApplied = stockEffect('tax-invoice', billItems, products);

      const newBill = {
        id: invNo,
        invoiceNumber: invNo,
        invoiceDate: today,
        dueDate: today,
        invoiceType: 'tax-invoice',
        posCounterBill: true,
        clientName: customerName || 'Walk-in Counter Customer',
        clientGstin: customerGstin || '',
        customerType,
        vehicleNo: customerVehicle || '',
        ownerGstin: profile?.gstin || '',
        ownerName: profile?.businessName || '',
        subTotal: posTotals.subTotal,
        cgst: posTotals.cgst,
        sgst: posTotals.sgst,
        igst: 0,
        totalAmount: posTotals.grandTotal,
        status,
        payments,
        stockApplied,
        items: billItems,
        data: {
          invoiceNumber: invNo,
          invoiceDate: today,
          invoiceType: 'tax-invoice',
          profile,
          client: {
            name: customerName || 'Walk-in Counter Customer',
            phone: customerPhone,
            gstin: customerGstin,
            vehicleNo: customerVehicle,
          },
          items: billItems,
          subTotal: posTotals.subTotal,
          cgst: posTotals.cgst,
          sgst: posTotals.sgst,
          igst: 0,
          totalAmount: posTotals.grandTotal,
          status,
          payments,
        },
      };

      await saveBill(newBill, { overwrite: true });
      await applyStockChanges(stockApplied);

      setCart([]);
      setCashTendered('');
      setBillDiscount(0);
      await loadData();
      showToast(`POS Invoice ${invNo} saved (${formatCurrency(posTotals.grandTotal)}) & stock updated!`, 'success');
    } catch (err) {
      showToast(`POS Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // POS Keyboard Shortcuts (Alt+A Product Search, Alt+C Customer, Delete remove item, Ctrl+Enter Save)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        customerSelectRef.current?.focus();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleCheckout();
      } else if (e.key === 'Delete' && document.activeElement?.tagName !== 'INPUT' && cart.length > 0) {
        e.preventDefault();
        removeFromCart(selectedCartIdx);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (!productMatchesSearch(p, search)) return false;
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      return true;
    });
  }, [products, search, categoryFilter]);

  const categories = useMemo(() => {
    const s = new Set(['All']);
    products.forEach(p => { if (p.category) s.add(p.category); });
    return Array.from(s);
  }, [products]);

  const handleCreateQuickCustomer = async (e) => {
    e.preventDefault();
    if (!newCustForm.name.trim()) return;
    const saved = await saveClient(newCustForm);
    await loadData();
    handleSelectClient(saved.id);
    setShowNewCustomerModal(false);
    showToast(`Customer "${saved.name}" added & selected`, 'success');
  };

  return (
    <div className="pos-view">
      {/* POS Top Bar */}
      <div className="page-header" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title">Counter POS Billing (Touch + Keyboard Fast Mode)</h1>
          <p className="page-subtitle">
            Shortcuts: <code>Alt+A</code> Search Part • <code>Alt+C</code> Select Customer • <code>Delete</code> Remove Row • <code>Ctrl+Enter</code> Save & Bill
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            className="tag"
            style={{
              padding: '5px 10px',
              fontWeight: 700,
              color: invSettings.allowNegativeStock ? 'var(--success)' : 'var(--danger)',
            }}
          >
            Negative Stock: {invSettings.allowNegativeStock ? 'ALLOWED' : 'RESTRICTED'}
          </span>
          {heldBills.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              {heldBills.map(h => (
                <button key={h.id} className="btn btn-secondary btn-sm" onClick={() => handleRecallBill(h)}>
                  Recall: {h.customerName} ({formatCurrency(h.grandTotal)})
                </button>
              ))}
            </div>
          )}
          {onOpenFullInvoice && (
            <button className="btn btn-secondary btn-sm" onClick={onOpenFullInvoice}>
              Switch to Full GST Invoice Form
            </button>
          )}
        </div>
      </div>

      {/* Main Split POS Layout: Left Catalog (55%) | Right Counter Cart & Tender (45%) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* LEFT PANEL: Fast Product Search & Touch Tile Grid */}
        <div className="glass-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              ref={searchInputRef}
              type="text"
              className="form-input"
              placeholder="[Alt+A] Scan Barcode or type Part Name, OEM Part No, Brand, Vehicle Model..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filteredProducts.length === 1) {
                  e.preventDefault();
                  addToCart(filteredProducts[0]);
                  setSearch('');
                }
              }}
            />
            <select className="form-input" style={{ width: 170 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Touch-Friendly Spare Part Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))',
              gap: 10,
              maxHeight: '68vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {filteredProducts.map(prod => {
              const { price, tierLabel } = getPriceForCustomerType(prod, customerType);
              const stockVal = Number(prod.stock) || 0;
              return (
                <div
                  key={prod.id}
                  onClick={() => addToCart(prod)}
                  className="glass-card"
                  style={{
                    padding: 12,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 6,
                    transition: 'transform 0.1s ease, border-color 0.15s ease',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      <span><strong>{prod.brand || 'OEM'}</strong></span>
                      <code>{prod.oemPartNo || prod.itemCode || ''}</code>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 2, lineHeight: 1.25 }}>
                      {prod.name}
                    </div>
                    {prod.vehicleFitments?.[0] && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        Fits: {prod.vehicleFitments[0].make} {prod.vehicleFitments[0].model}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{tierLabel.split(' ')[0]} Rate</div>
                      <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--primary)' }}>
                        {formatCurrency(price)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: stockVal <= 0 ? 'var(--danger)' : stockVal <= (prod.minStock || 5) ? 'var(--warning)' : 'var(--success)',
                        }}
                      >
                        Stock: {stockVal}
                      </span>
                      <div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '1px 6px', fontSize: '0.68rem', marginTop: 2 }}
                          onClick={e => {
                            e.stopPropagation();
                            setPriceCheckItem(prod);
                          }}
                        >
                          Tiers / Fitment
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: Customer Bar, Cart Items & Tender Checkout */}
        <div className="glass-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Customer & Price Tier Bar */}
          <div style={{ background: 'var(--bg-secondary)', padding: 10, borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 8, marginBottom: 8 }}>
              <select
                ref={customerSelectRef}
                className="form-input"
                value={selectedClientId}
                onChange={e => handleSelectClient(e.target.value)}
              >
                <option value="">[Alt+C] Walk-in Counter Customer</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.customerType || 'Retail'}) {c.phone ? `• ${c.phone}` : ''}
                  </option>
                ))}
              </select>

              <select
                className="form-input"
                value={customerType}
                onChange={e => handleCustomerTypeChange(e.target.value)}
                title="Automatic Price Tier Selection"
              >
                {CUSTOMER_TYPES.map(ct => (
                  <option key={ct} value={ct}>{ct} Tier</option>
                ))}
              </select>

              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewCustomerModal(true)}>
                + New
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Customer / Mechanic Name"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
              <input
                className="form-input"
                placeholder="Vehicle Reg No (e.g. DL-01-AB-1234)"
                value={customerVehicle}
                onChange={e => setCustomerVehicle(e.target.value.toUpperCase())}
              />
              <input
                className="form-input"
                placeholder="Customer GSTIN (Optional)"
                value={customerGstin}
                onChange={e => setCustomerGstin(e.target.value.toUpperCase())}
                maxLength={15}
              />
            </div>

            {selectedClientId && (
              <div style={{ fontSize: '0.76rem', marginTop: 6, display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Current Ledger Outstanding: <strong style={{ color: selectedClientOutstanding > 0 ? 'var(--warning)' : 'var(--success)' }}>{formatCurrency(selectedClientOutstanding)}</strong></span>
                <span>Pricing Active: <strong>{customerType} Price Tier</strong></span>
              </div>
            )}
          </div>

          {/* Cart Items Table */}
          <div className="table-scroll" style={{ maxHeight: 280, minHeight: 160 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th style={{ textAlign: 'center' }}>Qty</th>
                  <th>Rate (₹)</th>
                  <th>Disc%</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {posTotals.lines.map((item, idx) => (
                  <tr
                    key={item.productId}
                    onClick={() => setSelectedCartIdx(idx)}
                    style={{ background: selectedCartIdx === idx ? 'var(--bg-hover)' : undefined }}
                  >
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.84rem' }}>{item.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {item.oemPartNo ? `OEM: ${item.oemPartNo} • ` : ''}GST {item.taxPercent}%
                        {item.availableStock - item.quantity < 0 && (
                          <span style={{ color: 'var(--danger)', fontWeight: 700, marginLeft: 6 }}>
                            (Neg Stock: {item.availableStock - item.quantity})
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 8px' }}
                          onClick={() => updateCartItem(idx, { quantity: Math.max(1, Number(item.quantity) - 1) })}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 52, textAlign: 'center', padding: '2px 4px' }}
                          value={item.quantity}
                          onChange={e => updateCartItem(idx, { quantity: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 8px' }}
                          onClick={() => updateCartItem(idx, { quantity: Number(item.quantity) + 1 })}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td style={{ width: 88 }}>
                      <input
                        type="number"
                        className="form-input"
                        style={{ padding: '3px 6px' }}
                        value={item.rate}
                        onChange={e => updateCartItem(idx, { rate: e.target.value })}
                      />
                    </td>
                    <td style={{ width: 64 }}>
                      <input
                        type="number"
                        className="form-input"
                        style={{ padding: '3px 6px' }}
                        value={item.discountPercent}
                        onChange={e => updateCartItem(idx, { discountPercent: e.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatCurrency(item.lineTotal)}
                    </td>
                    <td>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeFromCart(idx)}>✕</button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      Click any spare part on the left or scan barcode to start billing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Payment Mode & Tender Calculator */}
          <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit', 'Split'].map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`btn btn-sm ${paymentMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setPaymentMode(mode)}
                >
                  {mode === 'Credit' ? 'Credit (Udhaar)' : mode}
                </button>
              ))}
            </div>

            {paymentMode === 'Cash' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Cash Received (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder={String(posTotals.grandTotal)}
                    value={cashTendered}
                    onChange={e => setCashTendered(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Extra Bill Discount (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={billDiscount}
                    onChange={e => setBillDiscount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Change to Return</label>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--success)', paddingTop: 6 }}>
                    {formatCurrency(posTotals.changeReturn)}
                  </div>
                </div>
              </div>
            )}

            {paymentMode === 'Split' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Cash Portion (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={splitCash}
                    onChange={e => {
                      const c = Number(e.target.value) || 0;
                      setSplitCash(e.target.value);
                      setSplitUpi(String(Math.max(0, posTotals.grandTotal - c)));
                    }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>UPI / Bank Portion (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={splitUpi}
                    onChange={e => setSplitUpi(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Summary Totals */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Taxable: <strong>{formatCurrency(posTotals.subTotal)}</strong> •
                CGST: <strong>{formatCurrency(posTotals.cgst)}</strong> •
                SGST: <strong>{formatCurrency(posTotals.sgst)}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Net Payable Total</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--primary)' }}>
                  {formatCurrency(posTotals.grandTotal)}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={handleHoldBill} disabled={!cart.length}>
                Hold Bill
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setCart([])} disabled={!cart.length}>
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontWeight: 700, fontSize: '1rem' }}
                disabled={saving || !cart.length}
                onClick={handleCheckout}
              >
                {saving ? 'Saving POS Invoice...' : `Complete POS Sale & Print (Ctrl+Enter) — ${formatCurrency(posTotals.grandTotal)}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Price & Fitment Check Modal */}
      {priceCheckItem && (
        <div className="modal-overlay" onClick={() => setPriceCheckItem(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{priceCheckItem.name}</h2>
              <button className="modal-close" onClick={() => setPriceCheckItem(null)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.88rem' }}>
              <div>OEM Part No: <strong>{priceCheckItem.oemPartNo || '—'}</strong></div>
              <div>Brand: <strong>{priceCheckItem.brand || '—'}</strong></div>
              <div>MRP: <strong>{formatCurrency(priceCheckItem.mrp || 0)}</strong></div>
              <div>Retail Price: <strong style={{ color: 'var(--success)' }}>{formatCurrency(priceCheckItem.sellingPrice || 0)}</strong></div>
              <div>Mechanic Price: <strong>{formatCurrency(priceCheckItem.mechanicPrice || priceCheckItem.sellingPrice || 0)}</strong></div>
              <div>Wholesale Price: <strong>{formatCurrency(priceCheckItem.wholesalePrice || priceCheckItem.sellingPrice || 0)}</strong></div>
              <div>Rack / Bin: <strong>{[priceCheckItem.rack, priceCheckItem.binLocation].filter(Boolean).join(' / ') || 'Main Store'}</strong></div>
              <div>Available Stock: <strong>{priceCheckItem.stock ?? 0} {priceCheckItem.unit}</strong></div>
            </div>
            <div className="modal-footer" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => { addToCart(priceCheckItem); setPriceCheckItem(null); }}>
                + Add to POS Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Customer Modal */}
      {showNewCustomerModal && (
        <div className="modal-overlay" onClick={() => setShowNewCustomerModal(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Quick Add Counter / Garage Customer</h2>
              <button className="modal-close" onClick={() => setShowNewCustomerModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateQuickCustomer}>
              <div className="form-group">
                <label className="form-label">Customer / Garage Name *</label>
                <input className="form-input" value={newCustForm.name} onChange={e => setNewCustForm({ ...newCustForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Customer Type (Sets Price Tier)</label>
                <select className="form-input" value={newCustForm.customerType} onChange={e => setNewCustForm({ ...newCustForm, customerType: e.target.value })}>
                  {CUSTOMER_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input className="form-input" value={newCustForm.phone} onChange={e => setNewCustForm({ ...newCustForm, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Vehicle Registration Number</label>
                <input className="form-input" value={newCustForm.vehicleNo} onChange={e => setNewCustForm({ ...newCustForm, vehicleNo: e.target.value.toUpperCase() })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewCustomerModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save & Select</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
