import React, { useState } from 'react';
import { saveClient, saveLedger, saveProduct, saveSupplier } from '../store';
import { ACCOUNT_GROUPS } from '../utils/accounting';

export default function QuickMasterModal({ isOpen, onClose, onCreated, initialType = 'party_debtor' }) {
  const [masterType, setMasterType] = useState(initialType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Party / Ledger state
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [stateName, setStateName] = useState('08 - Rajasthan');
  const [accountGroup, setAccountGroup] = useState('Bank Accounts');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingType, setOpeningType] = useState('Dr');
  const [creditLimit, setCreditLimit] = useState('50000');

  // Spare part state
  const [oemPartNo, setOemPartNo] = useState('');
  const [brand, setBrand] = useState('Maruti Genuine (MGP)');
  const [category] = useState('Brake System');
  const [hsn, setHsn] = useState('87083000');
  const [gstRate, setGstRate] = useState('18');
  const [mrp] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stock, setStock] = useState('10');
  const [rackBin, setRackBin] = useState('A-01');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      setError('Master Name is required.');
      return;
    }

    setSaving(true);
    try {
      let created = null;
      if (masterType === 'party_debtor') {
        created = await saveClient({
          name: cleanName,
          gstin: gstin.trim().toUpperCase(),
          phone: phone.trim(),
          state: stateName,
          openingBalance: Number(openingBalance) || 0,
          openingBalanceType: openingType || 'Dr',
          creditLimit: Number(creditLimit) || 0,
        });
      } else if (masterType === 'party_creditor') {
        created = await saveSupplier({
          name: cleanName,
          gstin: gstin.trim().toUpperCase(),
          phone: phone.trim(),
          state: stateName,
          openingBalance: Number(openingBalance) || 0,
          openingBalanceType: openingType || 'Cr',
        });
      } else if (masterType === 'general_ledger') {
        created = await saveLedger({
          name: cleanName,
          group: accountGroup,
          gstin: gstin.trim().toUpperCase(),
          openingBalance: Number(openingBalance) || 0,
          openingType: openingType,
        });
      } else if (masterType === 'spare_part') {
        created = await saveProduct({
          name: cleanName,
          oemPartNo: oemPartNo.trim().toUpperCase(),
          sku: oemPartNo.trim().toUpperCase(),
          brand: brand.trim(),
          category: category.trim(),
          hsn: hsn.trim(),
          gstRate: Number(gstRate) || 18,
          mrp: Number(mrp) || Number(salePrice) || 0,
          price: Number(salePrice) || 0,
          salePrice: Number(salePrice) || 0,
          wholesalePrice: Number(salePrice) ? Math.round(Number(salePrice) * 0.92) : 0,
          purchasePrice: Number(purchasePrice) || 0,
          stock: Number(stock) || 0,
          unit: 'Nos',
          rackBin: rackBin.trim(),
        });
      }

      if (onCreated) onCreated({ type: masterType, record: created });
      setName('');
      setGstin('');
      setOemPartNo('');
      setOpeningBalance('');
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to create master record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(2px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #CBD5E1',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '640px',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            background: '#0F172A',
            color: '#FFFFFF',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '14.5px' }}>Instant Master Creation</span>
              <span
                style={{
                  background: '#1E293B',
                  color: '#38BDF8',
                  border: '1px solid #334155',
                  padding: '1px 7px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                Alt+C
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#94A3B8', marginTop: '2px' }}>
              Create a Customer, Supplier, General Ledger, or Automotive Spare-Part without leaving your active voucher.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#94A3B8',
              border: '1px solid #334155',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✕ ESC
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px 18px' }}>
          {/* Master Type Selector Pills */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '14px' }}>
            {[
              { id: 'party_debtor', label: 'Customer (Debtor)', sub: 'Sundry Debtors (Dr)' },
              { id: 'party_creditor', label: 'Supplier (Creditor)', sub: 'Sundry Creditors (Cr)' },
              { id: 'general_ledger', label: 'General Ledger', sub: 'Bank / Tax / Expense' },
              { id: 'spare_part', label: 'Spare Part / Item', sub: 'OEM / HSN / Stock' },
            ].map((tab) => {
              const active = masterType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setMasterType(tab.id);
                    if (tab.id === 'party_debtor') setOpeningType('Dr');
                    if (tab.id === 'party_creditor') setOpeningType('Cr');
                  }}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: active ? '2px solid #1D4ED8' : '1px solid #CBD5E1',
                    background: active ? '#EFF6FF' : '#F8FAFC',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '12px', color: active ? '#1D4ED8' : '#0F172A' }}>
                    {tab.label}
                  </div>
                  <div style={{ fontSize: '10.5px', color: '#64748B', marginTop: '2px' }}>{tab.sub}</div>
                </button>
              );
            })}
          </div>

          {error && (
            <div
              style={{
                background: '#FEF2F2',
                color: '#DC2626',
                border: '1px solid #FECACA',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                marginBottom: '12px',
              }}
            >
              {error}
            </div>
          )}

          {masterType !== 'spare_part' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Account / Party Legal Name *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder={
                    masterType === 'general_ledger'
                      ? 'e.g. HDFC BANK CURRENT A/C or Workshop Rent'
                      : 'e.g. SHREE BALAJI AUTOMOBILES'
                  }
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '13px' }}
                />
              </div>

              {masterType === 'general_ledger' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Under Accounting Group (Schedule III / Tally Group)
                  </label>
                  <select
                    value={accountGroup}
                    onChange={(e) => {
                      const grp = e.target.value;
                      setAccountGroup(grp);
                      const found = ACCOUNT_GROUPS.find((g) => g.name === grp);
                      if (found) setOpeningType(found.defaultSign || 'Dr');
                    }}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', background: '#FFFFFF' }}
                  >
                    {ACCOUNT_GROUPS.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name} ({g.nature.toUpperCase()} — Normal {g.defaultSign})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  15-Digit GSTIN (Optional for Unregistered)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  placeholder="08AABCU9603R1ZM"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  State / Place of Supply
                </label>
                <input
                  type="text"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Opening Balance (₹)
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                  <select
                    value={openingType}
                    onChange={(e) => setOpeningType(e.target.value)}
                    style={{ width: '74px', padding: '7px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontWeight: 700, background: openingType === 'Dr' ? '#EFF6FF' : '#F0FDF4', color: openingType === 'Dr' ? '#1D4ED8' : '#15803D' }}
                  >
                    <option value="Dr">Dr</option>
                    <option value="Cr">Cr</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  {masterType === 'party_debtor' ? 'Credit Limit (₹)' : 'Mobile / Contact Phone'}
                </label>
                {masterType === 'party_debtor' ? (
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="+91 98290XXXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div style={{ gridColumn: '1 / 3' }}>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Spare Part Description / Name *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Front Brake Pad Set Swift / Baleno"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  OEM Part No / Alias *
                </label>
                <input
                  type="text"
                  placeholder="55810M75J20"
                  value={oemPartNo}
                  onChange={(e) => setOemPartNo(e.target.value.toUpperCase())}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Brand / Make
                </label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  8-Digit HSN Code
                </label>
                <input
                  type="text"
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  GST Slab (%)
                </label>
                <select
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', background: '#FFFFFF' }}
                >
                  <option value="28">28% (Auto Luxury / AC)</option>
                  <option value="18">18% (Standard Auto Spares)</option>
                  <option value="12">12% (Tractor / Agri Parts)</option>
                  <option value="5">5% (EV / Essential)</option>
                  <option value="0">0% (Exempt)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Purchase Cost (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="850.00"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Selling Price (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="1120.00"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Opening Stock (Nos) & Rack
                </label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    style={{ width: '55%', padding: '7px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12.5px', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                  <input
                    type="text"
                    placeholder="Rack A1"
                    value={rackBin}
                    onChange={(e) => setRackBin(e.target.value)}
                    style={{ width: '45%', padding: '7px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#64748B' }}>
              Immediately syncs to Double-Entry Ledgers, Trial Balance & Voucher Pickers
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: '#F1F5F9',
                  color: '#334155',
                  border: '1px solid #CBD5E1',
                  borderRadius: '4px',
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{
                  background: '#1D4ED8',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '7px 16px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving Master...' : '✓ Save Master (Ctrl+A)'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
