import React, { useState } from 'react';
import {
  DEFAULT_INVOICE_SERIES,
  formatSeriesNumber,
  getInvoiceSeriesList,
  saveInvoiceSeriesList,
} from '../utils/invoiceSeries';

export default function InvoiceSeriesModal({ isOpen, onClose, onSeriesUpdated, activeSeriesCode, onSelectSeries }) {
  const [seriesList, setSeriesList] = useState(() => getInvoiceSeriesList());
  const [form, setForm] = useState({
    code: 'JPR',
    name: 'Jaipur Branch Counter',
    docType: 'Tax Invoice (B2B / B2C)',
    prefix: 'JPR/',
    suffix: '/26-27',
    nextNo: 1,
    pad: 4,
    mode: 'Standard Form',
    tier: 'Workshop / Wholesale',
    godown: 'Main Godown',
    bank: 'PRAGYAN ENTERPRISES INDUSIND',
    gstTable: 'GSTR-1 Table 4A/7',
  });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const previewNo = formatSeriesNumber(form);

  const handleAddSeries = (e) => {
    e.preventDefault();
    setError('');
    const cleanCode = String(form.code || '').trim().toUpperCase();
    const cleanName = String(form.name || '').trim();
    if (!cleanCode || !cleanName) {
      setError('Series Code and Series Name are required.');
      return;
    }
    if (seriesList.some((s) => s.code.toUpperCase() === cleanCode)) {
      setError(`Series code [${cleanCode}] already exists.`);
      return;
    }
    const newSeries = {
      ...form,
      id: `series_${cleanCode.toLowerCase()}_${Date.now()}`,
      code: cleanCode,
      name: cleanName,
      nextNo: Math.max(1, Number(form.nextNo) || 1),
      pad: Math.max(0, Math.min(8, Number(form.pad) || 0)),
    };
    const nextList = [...seriesList, newSeries];
    setSeriesList(nextList);
    saveInvoiceSeriesList(nextList);
    if (onSeriesUpdated) onSeriesUpdated(nextList);
    if (onSelectSeries) onSelectSeries(newSeries.code);
    setForm({
      ...form,
      code: '',
      name: '',
      prefix: '',
      nextNo: 1,
    });
  };

  const handleUpdateNextNo = (code, nextVal) => {
    const nextList = seriesList.map((s) =>
      s.code === code ? { ...s, nextNo: Math.max(1, Number(nextVal) || 1) } : s
    );
    setSeriesList(nextList);
    saveInvoiceSeriesList(nextList);
    if (onSeriesUpdated) onSeriesUpdated(nextList);
  };

  const handleResetDefaults = () => {
    const defaults = DEFAULT_INVOICE_SERIES.map((s) => ({ ...s }));
    setSeriesList(defaults);
    saveInvoiceSeriesList(defaults);
    if (onSeriesUpdated) onSeriesUpdated(defaults);
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
          maxWidth: '1080px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>
                Multiple Invoice & Voucher Series Configuration
              </span>
              <span
                style={{
                  background: '#1E293B',
                  color: '#38BDF8',
                  border: '1px solid #334155',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}
              >
                CGST Rule 46 Compliant (Max 16 Chars)
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#94A3B8', marginTop: '2px' }}>
              Maintain independent auto-incrementing numbering sequences for B2B Wholesale, Counter POS, Inter-State IGST, and Workshop Estimates.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleResetDefaults}
              style={{
                background: '#1E293B',
                color: '#CBD5E1',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '5px 10px',
                fontSize: '11.5px',
                cursor: 'pointer',
              }}
            >
              Reset Default 5 Series
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                color: '#94A3B8',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✕ ESC
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Existing Series Table */}
          <div style={{ border: '1px solid #E2E8F0', borderRadius: '6px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #0F172A', color: '#0F172A', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Code</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Series Name</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Prefix / Suffix</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>Next No.</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>Pad</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Default Mode & Tier</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Godown / Bank</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>GSTR-1 Table</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Live Preview</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {seriesList.map((s) => {
                  const isCurrent = activeSeriesCode === s.code;
                  return (
                    <tr
                      key={s.code}
                      style={{
                        borderBottom: '1px solid #E2E8F0',
                        background: isCurrent ? '#EFF6FF' : '#FFFFFF',
                      }}
                    >
                      <td style={{ padding: '7px 10px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#1D4ED8' }}>
                        [{s.code}]
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 600, color: '#0F172A' }}>{s.name}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#475569' }}>
                        "{s.prefix || ''}" / "{s.suffix || ''}"
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        <input
                          type="number"
                          min="1"
                          value={s.nextNo}
                          onChange={(e) => handleUpdateNextNo(s.code, e.target.value)}
                          style={{
                            width: '68px',
                            padding: '3px 6px',
                            textAlign: 'right',
                            fontFamily: 'JetBrains Mono, monospace',
                            border: '1px solid #CBD5E1',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>
                        {s.pad > 0 ? `${s.pad} digits` : 'None'}
                      </td>
                      <td style={{ padding: '7px 10px', color: '#334155' }}>
                        <div>{s.mode}</div>
                        <div style={{ fontSize: '11px', color: '#64748B' }}>{s.tier}</div>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#334155' }}>
                        <div>{s.godown}</div>
                        <div style={{ fontSize: '11px', color: '#64748B' }}>{s.bank}</div>
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: '11.5px', color: '#0F172A', fontWeight: 500 }}>
                        {s.gstTable}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span
                          style={{
                            background: '#F1F5F9',
                            border: '1px solid #CBD5E1',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: 700,
                            color: '#0F172A',
                            fontSize: '11.5px',
                          }}
                        >
                          {formatSeriesNumber(s)}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        {onSelectSeries && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSeries(s.code);
                              onClose();
                            }}
                            style={{
                              background: isCurrent ? '#15803D' : '#1D4ED8',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '4px 10px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isCurrent ? '✓ Active' : 'Use Series'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Create New Series Form */}
          <form
            onSubmit={handleAddSeries}
            style={{
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0F172A' }}>
                + Create New Custom Voucher / Invoice Series
              </div>
              <div
                style={{
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  color: '#1D4ED8',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                Preview: {previewNo} ({previewNo.length}/16 chars)
              </div>
            </div>

            {error && (
              <div
                style={{
                  background: '#FEF2F2',
                  color: '#DC2626',
                  border: '1px solid #FECACA',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  marginBottom: '10px',
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
                alignItems: 'end',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Series Code *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="e.g. JPR"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Series Name *
                </label>
                <input
                  type="text"
                  placeholder="Jaipur Branch Sales"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Prefix
                </label>
                <input
                  type="text"
                  placeholder="JPR/"
                  value={form.prefix}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Suffix
                </label>
                <input
                  type="text"
                  placeholder="/26-27"
                  value={form.suffix}
                  onChange={(e) => setForm({ ...form, suffix: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Starting No.
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.nextNo}
                  onChange={(e) => setForm({ ...form, nextNo: Number(e.target.value) || 1 })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Zero Padding
                </label>
                <select
                  value={form.pad}
                  onChange={(e) => setForm({ ...form, pad: Number(e.target.value) })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', background: '#FFFFFF' }}
                >
                  <option value={0}>No Padding (1)</option>
                  <option value={3}>3 Digits (001)</option>
                  <option value={4}>4 Digits (0001)</option>
                  <option value={5}>5 Digits (00001)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Default Rate Tier
                </label>
                <select
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', background: '#FFFFFF' }}
                >
                  <option value="Workshop / Wholesale">Workshop / Wholesale</option>
                  <option value="Counter Retail">Counter Retail</option>
                  <option value="MRP">MRP</option>
                </select>
              </div>
              <div>
                <button
                  type="submit"
                  style={{
                    width: '100%',
                    background: '#0F172A',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '7px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Save Series
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
