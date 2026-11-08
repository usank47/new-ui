import React, { useState, useEffect } from 'react';
import {
  getAllClients,
  getAllSuppliers,
  getAllProducts,
  getAllLedgers,
  getAllBills,
  getAllPurchases,
  commitBusyImport,
  getAllBusyImports,
} from '../store';
import {
  BUSY_WIZARD_STEPS,
  detectBusyFileMetadata,
  parseBusyFileRecords,
  reconcileBusyImport,
  SAMPLE_BUSY_MASTERS_DAT,
  SAMPLE_BUSY_TXNS_DAT,
} from '../utils/busyParser';
import { readXlsxRows } from '../utils/xlsx';
import { formatCurrency } from '../utils';
import { toast } from './Toast';

export default function BusyImportModal({ onClose, onImportCompleted, showToast = toast }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [detectedMeta, setDetectedMeta] = useState([]);
  const [parsedRecords, setParsedRecords] = useState([]);
  const [duplicatePolicy, setDuplicatePolicy] = useState('update'); // 'skip' | 'update' | 'keep_both'
  const [reconciliation, setReconciliation] = useState(null);
  const [existingData, setExistingData] = useState({
    clients: [],
    suppliers: [],
    products: [],
    ledgers: [],
    bills: [],
    purchases: [],
  });
  const [commitResult, setCommitResult] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [pastImports, setPastImports] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    const loadExisting = async () => {
      const [clients, suppliers, products, ledgers, bills, purchases, history] = await Promise.all([
        getAllClients(),
        getAllSuppliers(),
        getAllProducts(),
        getAllLedgers(),
        getAllBills(),
        getAllPurchases(),
        getAllBusyImports(),
      ]);
      setExistingData({ clients, suppliers, products, ledgers, bills, purchases });
      setPastImports(history || []);
    };
    loadExisting();
  }, []);

  // Re-run reconciliation whenever parsedRecords or duplicatePolicy changes
  useEffect(() => {
    if (parsedRecords.length > 0) {
      const result = reconcileBusyImport({
        records: parsedRecords,
        existingClients: existingData.clients,
        existingSuppliers: existingData.suppliers,
        existingProducts: existingData.products,
        existingLedgers: existingData.ledgers,
        existingBills: existingData.bills,
        existingPurchases: existingData.purchases,
        duplicatePolicy,
      });
      setReconciliation(result);
    }
  }, [parsedRecords, duplicatePolicy, existingData]);

  // Step 1 -> Step 4 automated progression when files are uploaded or sample loaded
  const handleFileInput = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    await processUploadedFiles(files);
  };

  const processUploadedFiles = async (files) => {
    setSelectedFiles(files.map(f => ({ name: f.name, size: f.size })));
    setCurrentStep(2); // Step 2: Upload files

    const metas = [];
    const allRecords = [];

    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'xlsx' || ext === 'xls') {
        const rows = await readXlsxRows(f);
        const meta = detectBusyFileMetadata(f.name, JSON.stringify(rows.slice(0, 5)), f.size);
        metas.push({ ...meta, rowCount: rows.length });
        const recs = parseBusyFileRecords(f.name, rows);
        allRecords.push(...recs);
      } else {
        const text = await f.text();
        const meta = detectBusyFileMetadata(f.name, text, f.size);
        const recs = parseBusyFileRecords(f.name, text);
        metas.push({ ...meta, rowCount: recs.length });
        allRecords.push(...recs);
      }
    }

    setDetectedMeta(metas);
    setCurrentStep(3); // Step 3: Detect file types
    setParsedRecords(allRecords);
    setCurrentStep(5); // Jump to Step 5 (Classification & Review) with Steps 1-4 completed
    showToast(`Parsed ${allRecords.length} BUSY records from ${files.length} file(s)`, 'success');
  };

  const handleLoadSampleBusyDat = () => {
    const f1Name = 'BUSY_MASTERS_FY26_27.DAT';
    const f2Name = 'BUSY_TXNS_FY26_27.DAT';
    setSelectedFiles([
      { name: f1Name, size: SAMPLE_BUSY_MASTERS_DAT.length },
      { name: f2Name, size: SAMPLE_BUSY_TXNS_DAT.length },
    ]);
    const m1 = detectBusyFileMetadata(f1Name, SAMPLE_BUSY_MASTERS_DAT, SAMPLE_BUSY_MASTERS_DAT.length);
    const m2 = detectBusyFileMetadata(f2Name, SAMPLE_BUSY_TXNS_DAT, SAMPLE_BUSY_TXNS_DAT.length);
    const r1 = parseBusyFileRecords(f1Name, SAMPLE_BUSY_MASTERS_DAT);
    const r2 = parseBusyFileRecords(f2Name, SAMPLE_BUSY_TXNS_DAT);
    setDetectedMeta([
      { ...m1, rowCount: r1.length },
      { ...m2, rowCount: r2.length },
    ]);
    setParsedRecords([...r1, ...r2]);
    setCurrentStep(5);
    showToast(`Loaded sample BUSY .DAT dataset (${r1.length} Masters + ${r2.length} Transactions)`, 'info');
  };

  // Execute Steps 13 -> 16: Atomic Commit, Verify DB Persistence, Refresh UI, Final Report
  const handleExecuteCommit = async () => {
    if (!reconciliation) return;
    setCommitting(true);
    setCurrentStep(13); // Step 13: Import data
    try {
      const payload = {
        files: detectedMeta,
        reconciliation: reconciliation.counts,
        financialImpact: reconciliation.financialImpact,
        ...reconciliation.staged,
      };
      const res = await commitBusyImport(payload);
      setCurrentStep(14); // Step 14: Verify DB persistence
      setCommitResult(res);

      setCurrentStep(15); // Step 15: Refresh UI data
      if (onImportCompleted) await onImportCompleted();

      setCurrentStep(16); // Step 16: Final Import Report
      showToast(`BUSY Import committed & verified (${res.totalVerified} records persisted on disk)`, 'success');
    } catch (err) {
      showToast(`BUSY Import failed: ${err.message}`, 'error');
    } finally {
      setCommitting(false);
    }
  };

  const handleDownloadAuditReport = () => {
    if (!commitResult?.auditRecord) return;
    const blob = new Blob([JSON.stringify(commitResult.auditRecord, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BUSY_Import_Audit_${commitResult.batchId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = reconciliation?.counts || {
    totalSource: 0, newCount: 0, updatedCount: 0, duplicateCount: 0,
    skippedCount: 0, invalidCount: 0, unsupportedCount: 0, unresolvedCount: 0,
    accountedFor: 0, reconciled: true,
  };

  const filteredRows = (reconciliation?.analyzedRows || []).filter(r =>
    statusFilter === 'All' ? true : r.status === statusFilter
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 1080, width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">BUSY Accounting Software Integration (16-Step Import Wizard)</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Supports BUSY Masters & Transactions (.DAT, .XLSX, .CSV, .JSON) with brand-aware part deduplication & 100% mathematical reconciliation
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* 16-Step Progress Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, minmax(112px, 1fr))',
            gap: 6,
            padding: '6px 0 10px 0',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: 10,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {BUSY_WIZARD_STEPS.map(s => {
            const done = currentStep > s.step;
            const active = currentStep === s.step;
            return (
              <div
                key={s.step}
                onClick={() => {
                  if (parsedRecords.length > 0 && s.step <= 12) setCurrentStep(s.step);
                }}
                title={`Step ${s.step}: ${s.title} — ${s.desc}`}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  fontSize: '0.73rem',
                  lineHeight: 1.3,
                  cursor: parsedRecords.length > 0 && s.step <= 12 ? 'pointer' : 'default',
                  border: active ? '2px solid var(--primary)' : done ? '1px solid rgba(5, 150, 105, 0.35)' : '1px solid var(--border-color)',
                  background: done ? 'var(--success-light)' : active ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ fontWeight: 700, color: done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {done ? '✓ ' : ''}Step {s.step}
                </div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: active ? 700 : 500, color: 'var(--text-primary)' }}>
                  {s.title}
                </div>
              </div>
            );
          })}
        </div>

        {/* Active Step Banner */}
        {(() => {
          const activeStepMeta = BUSY_WIZARD_STEPS.find(s => s.step === currentStep) || BUSY_WIZARD_STEPS[0];
          return (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                padding: '7px 12px',
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                marginBottom: 12,
                fontSize: '0.8rem',
                flexShrink: 0,
              }}
            >
              <div>
                <strong style={{ color: 'var(--primary)' }}>Step {activeStepMeta.step} of 16 — {activeStepMeta.title}:</strong>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>{activeStepMeta.desc}</span>
              </div>
              {parsedRecords.length > 0 && (
                <span className="tag" style={{ flexShrink: 0 }}>
                  {parsedRecords.length} total source records loaded
                </span>
              )}
            </div>
          );
        })()}

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {currentStep <= 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                className="glass-card"
                style={{
                  padding: 28,
                  textAlign: 'center',
                  border: '2px dashed var(--primary)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <h3 style={{ marginBottom: 8 }}>Step 1 & 2: Select & Upload BUSY Data Files</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
                  Select one or more BUSY Master or Transaction files (<code>.dat</code>, <code>.xlsx</code>, <code>.csv</code>, <code>.json</code>).
                  You can upload Masters and Transactions together.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <label className="btn btn-primary" style={{ cursor: 'pointer', margin: 0 }}>
                    Choose BUSY (.DAT / .XLSX / .CSV / .JSON) Files
                    <input
                      type="file"
                      multiple
                      accept=".dat,.DAT,.xlsx,.xls,.csv,.json"
                      style={{ display: 'none' }}
                      onChange={handleFileInput}
                    />
                  </label>
                  <button type="button" className="btn btn-secondary" onClick={handleLoadSampleBusyDat}>
                    Load Sample Automotive BUSY .DAT Dataset (Masters + Txns)
                  </button>
                </div>
                {selectedFiles.length > 0 && (
                  <div style={{ marginTop: 14, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Selected {selectedFiles.length} file(s): {selectedFiles.map(f => f.name).join(', ')}
                  </div>
                )}
              </div>

              {pastImports.length > 0 && (
                <div className="glass-card" style={{ padding: 16 }}>
                  <h4 style={{ marginBottom: 8 }}>Previous BUSY Import Audit Batches ({pastImports.length})</h4>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Batch ID</th>
                          <th>Imported At</th>
                          <th>Backup Snapshot</th>
                          <th>Source Records</th>
                          <th>Persisted & Verified</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastImports.slice(0, 6).map(b => (
                          <tr key={b.id}>
                            <td><code>{b.batchId}</code></td>
                            <td>{new Date(b.importedAt).toLocaleString('en-IN')}</td>
                            <td><code>{b.backupId}</code></td>
                            <td>{b.reconciliation?.totalSource || b.totalWritten}</td>
                            <td><strong>{b.totalVerified}</strong> records</td>
                            <td>
                              <span style={{ color: b.persistenceVerified ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
                                {b.persistenceVerified ? '✓ Verified on Disk' : 'Partial'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep >= 5 && currentStep <= 12 && reconciliation && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Step 3 & 4 File Detection Banner */}
              <div className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <strong>Step 3 & 4 — Detected BUSY Files ({detectedMeta.length}):</strong>{' '}
                    {detectedMeta.map((m, idx) => (
                      <span key={idx} className="tag" style={{ marginRight: 6 }}>
                        {m.fileName} • {m.busyCategory} ({m.subFormat}) • {m.rowCount} records
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Step 9 Duplicate Policy:</label>
                    <select
                      className="form-input"
                      style={{ width: 220, padding: '4px 8px' }}
                      value={duplicatePolicy}
                      onChange={e => setDuplicatePolicy(e.target.value)}
                    >
                      <option value="update">Update Existing Records (Recommended)</option>
                      <option value="skip">Skip Existing Duplicates (Safe)</option>
                      <option value="keep_both">Import Both as Separate</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Step 11 Mathematical Reconciliation Equation Card */}
              <div
                className="glass-card"
                style={{
                  padding: 14,
                  border: counts.reconciled ? '1.5px solid var(--success)' : '1.5px solid var(--danger)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700 }}>
                    Step 11 — Mathematical Reconciliation Check:{' '}
                    <span style={{ color: counts.reconciled ? 'var(--success)' : 'var(--danger)' }}>
                      {counts.reconciled ? '✓ 100% RECONCILED (Zero Silent Drops)' : '✕ MISMATCH'}
                    </span>
                  </div>
                  <code style={{ fontSize: '0.82rem' }}>
                    Total Source ({counts.totalSource}) = New ({counts.newCount}) + Updated ({counts.updatedCount}) + Duplicate ({counts.duplicateCount}) + Skipped ({counts.skippedCount}) + Invalid ({counts.invalidCount}) + Unsupported ({counts.unsupportedCount}) + Unresolved ({counts.unresolvedCount})
                  </code>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 8 }}>
                  {[
                    { label: 'All', val: counts.totalSource, title: 'Total Source' },
                    { label: 'New', val: counts.newCount, title: 'New Records', color: 'var(--success)' },
                    { label: 'Updated', val: counts.updatedCount, title: 'Updated', color: 'var(--primary)' },
                    { label: 'Duplicate', val: counts.duplicateCount, title: 'Duplicates', color: 'var(--warning)' },
                    { label: 'Invalid', val: counts.invalidCount, title: 'Invalid', color: 'var(--danger)' },
                    { label: 'Unsupported', val: counts.unsupportedCount, title: 'Unsupported', color: 'var(--warning)' },
                  ].map(box => (
                    <div
                      key={box.label}
                      onClick={() => setStatusFilter(box.label)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: statusFilter === box.label ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                        border: statusFilter === box.label ? '1px solid var(--primary)' : '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{box.title}</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: box.color || 'inherit' }}>{box.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 5 Classification & Step 10 Financial Impact Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="glass-card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: 6 }}>
                    Step 5 — Classified BUSY Masters & Transactions
                  </div>
                  <div style={{ fontSize: '0.82rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(reconciliation.byMasterType).map(([k, v]) => (
                      <span key={k} className="tag">Master: {k} ({v})</span>
                    ))}
                    {Object.entries(reconciliation.byTxnType).map(([k, v]) => (
                      <span key={k} className="tag">Txn: {k} ({v})</span>
                    ))}
                  </div>
                </div>

                <div className="glass-card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: 6 }}>
                    Step 10 — Projected Financial & Inventory Impact
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: '0.81rem' }}>
                    <div>Stock Added: <strong>{reconciliation.financialImpact.newProductsStockQty} units ({formatCurrency(reconciliation.financialImpact.newProductsStockValue)})</strong></div>
                    <div>Debtors Opening (Dr): <strong>{formatCurrency(reconciliation.financialImpact.debtorsOpeningDr)}</strong></div>
                    <div>Creditors Opening (Cr): <strong>{formatCurrency(reconciliation.financialImpact.creditorsOpeningCr)}</strong></div>
                    <div>Sales / Purchases: <strong>{formatCurrency(reconciliation.financialImpact.salesImportedTotal)} / {formatCurrency(reconciliation.financialImpact.purchasesImportedTotal)}</strong></div>
                  </div>
                </div>
              </div>

              {/* Step 6, 7, 8, 9 Detailed Record Table */}
              <div className="glass-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
                <div className="table-scroll" style={{ maxHeight: 320 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Domain / BUSY Type</th>
                        <th>Name / Party / Item</th>
                        <th>OEM Part No (Alias) / Voucher No</th>
                        <th>Brand / Group</th>
                        <th>Stock / Amount</th>
                        <th>Classification Status</th>
                        <th>Validation & Matching Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(row => (
                        <tr key={row.sourceId}>
                          <td><code>{row.rowIndex}</code></td>
                          <td>
                            <strong>{row.domain}</strong>: {row.subType}
                          </td>
                          <td style={{ fontWeight: 600 }}>{row.name || row.partyName || row.itemName || '—'}</td>
                          <td><code>{row.alias || row.oemPartNo || row.voucherNo || row.code || '—'}</code></td>
                          <td>{row.brand || row.accountGroup || row.category || '—'}</td>
                          <td>
                            {row.domain === 'Master' && row.subType === 'Item'
                              ? `${row.stock} ${row.unit} @ ${formatCurrency(row.sellingPrice)}`
                              : row.amount > 0
                                ? formatCurrency(row.amount)
                                : row.openingBalance > 0
                                  ? `${formatCurrency(row.openingBalance)} ${row.openingType}`
                                  : '—'}
                          </td>
                          <td>
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  row.status === 'New' ? 'var(--success)'
                                    : row.status === 'Updated' ? 'var(--primary)'
                                      : row.status === 'Invalid' ? 'var(--danger)'
                                        : 'var(--warning)',
                              }}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {currentStep >= 13 && commitResult && (
            <div className="glass-card" style={{ padding: 20 }}>
              <h3 style={{ color: 'var(--success)', marginBottom: 8 }}>
                ✓ Step 16 — Final BUSY Import & Database Verification Report
              </h3>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                Batch ID: <code>{commitResult.batchId}</code> • Pre-Import Restore Snapshot: <code>{commitResult.backupId}</code> •
                Disk Persistence Verified: <strong>{commitResult.persistenceVerified ? 'YES (100% Match)' : 'Partial'}</strong>
              </p>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th>Records Committed (Step 13)</th>
                      <th>Verified on Disk (Step 14)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(commitResult.written || {}).map(([col, count]) => {
                      const verified = commitResult.verifiedOnDisk?.[col] ?? 0;
                      return (
                        <tr key={col}>
                          <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{col}</td>
                          <td>{count}</td>
                          <td><strong>{verified}</strong></td>
                          <td style={{ color: count === verified ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                            {count === verified ? '✓ Verified' : 'Mismatch'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="modal-footer" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {currentStep >= 5 && currentStep <= 12 && (
              <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(1)}>
                ← Select Different Files
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {currentStep >= 5 && currentStep < 12 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrentStep(prev => Math.min(12, prev + 1))}
              >
                Next Wizard Step ({currentStep}/16) →
              </button>
            )}
            {currentStep >= 5 && currentStep <= 12 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={committing || (counts.newCount + counts.updatedCount === 0)}
                onClick={handleExecuteCommit}
              >
                {committing ? 'Committing & Verifying...' : `Step 12–16: Confirm & Import (${counts.newCount + counts.updatedCount} Records)`}
              </button>
            )}
            {currentStep === 16 && (
              <>
                <button type="button" className="btn btn-secondary" onClick={handleDownloadAuditReport}>
                  Download Audit Report (.JSON)
                </button>
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  Done & View Updated Data
                </button>
              </>
            )}
            {currentStep < 5 && (
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
