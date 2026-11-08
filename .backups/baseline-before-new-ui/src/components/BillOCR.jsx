import React, { useState, useEffect, useRef, useMemo } from 'react';
import { extractBillText, parseBillText } from '../utils/billOcr';
import {
  extractPurchaseBillAI,
  getAllProducts,
  saveProduct,
  getAllSuppliers,
  saveSupplier,
  getAllSupplierTemplates,
  saveSupplierTemplate,
} from '../store';
import { matchProductToMaster, normalizeAutomotiveProduct } from '../utils/products';
import { formatCurrency } from '../utils';
import { toast } from './Toast';

const SAMPLE_AI_PURCHASE_INVOICE = {
  supplierName: 'Minda & Bosch Auto Electricals Distributorship',
  supplierGstin: '07AABCM9912E1Z5',
  supplierAddress: '1421 Lothian Road, Kashmere Gate, Delhi - 110006',
  supplierPhone: '9811445566',
  supplierState: 'Delhi',
  invoiceNumber: 'MBA/26-27/0419',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  placeOfSupply: '07-Delhi',
  freight: 250,
  otherCharges: 0,
  roundOff: 0.4,
  printedGrandTotal: 19413.0,
  confidence: 96,
  warnings: [],
  items: [
    {
      name: 'Front Disc Brake Pad Set Swift/Dzire',
      partNumber: '55810M75J00',
      brand: 'Bosch',
      manufacturer: 'Bosch Automotive',
      hsn: '87083000',
      quantity: 10,
      unit: 'Set',
      mrp: 1250,
      rate: 680,
      discountPercent: 0,
      taxPercent: 18,
      confidence: 98,
    },
    {
      name: 'Halogen Headlight Bulb H4 12V 60/55W',
      partNumber: '1987302041',
      brand: 'Bosch',
      manufacturer: 'Bosch Automotive',
      hsn: '85392120',
      quantity: 25,
      unit: 'Nos',
      mrp: 165,
      rate: 95,
      discountPercent: 5,
      taxPercent: 18,
      confidence: 95,
    },
    {
      name: 'Spin-On Engine Oil Filter Creta/Seltos 1.5 CRDi',
      partNumber: '26300-35505',
      brand: 'Mann Filter',
      manufacturer: 'Mann+Hummel',
      hsn: '84212300',
      quantity: 35,
      unit: 'Nos',
      mrp: 395,
      rate: 210,
      discountPercent: 0,
      taxPercent: 18,
      confidence: 94,
    },
  ],
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function BillOCR({ onExtracted, onClose, showToast = toast }) {
  const [stage, setStage] = useState('pick'); // 'pick' | 'running' | 'review'
  const [statusMsg, setStatusMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [engineUsed, setEngineUsed] = useState('');
  const [fileInfo, setFileInfo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierTemplates, setSupplierTemplates] = useState([]);

  // Editable Review Form State
  const [header, setHeader] = useState({
    supplierName: '',
    supplierGstin: '',
    supplierAddress: '',
    supplierPhone: '',
    supplierState: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    placeOfSupply: '',
    freight: 0,
    otherCharges: 0,
    roundOff: 0,
    printedGrandTotal: 0,
    taxMode: 'intra', // 'intra' (CGST+SGST) | 'inter' (IGST)
    warnings: [],
  });
  const [lineItems, setLineItems] = useState([]);
  const [autoUpdateInventory, setAutoUpdateInventory] = useState(true);
  const [saveTemplateOnPost, setSaveTemplateOnPost] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => {
    Promise.all([getAllProducts(), getAllSuppliers(), getAllSupplierTemplates()]).then(([p, s, t]) => {
      setProducts(p || []);
      setSuppliers(s || []);
      setSupplierTemplates(t || []);
    });
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, []);

  const decorateItemsWithMasterMatch = (rawItems = [], masterProducts = products) => {
    return rawItems.map((it, idx) => {
      const matchInfo = matchProductToMaster(it, masterProducts);
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.rate) || 0;
      const discPct = Number(it.discountPercent) || 0;
      const taxPct = Number(it.taxPercent ?? 18);
      const gross = qty * rate;
      const discAmt = Math.round((gross * discPct) / 100 * 100) / 100;
      const taxable = Math.round((gross - discAmt) * 100) / 100;

      return {
        id: `ocr_item_${idx}_${Date.now()}`,
        name: it.name || it.description || '',
        partNumber: it.partNumber || it.oemPartNo || '',
        brand: it.brand || it.manufacturer || matchInfo.matchedProduct?.brand || '',
        hsn: it.hsn || matchInfo.matchedProduct?.hsn || '8708',
        quantity: qty,
        unit: it.unit || matchInfo.matchedProduct?.unit || 'Nos',
        mrp: Number(it.mrp) || Number(matchInfo.matchedProduct?.mrp) || 0,
        rate,
        discountPercent: discPct,
        taxPercent: taxPct,
        taxableValue: taxable,
        matchedProductId: matchInfo.matchedProduct?.id || '',
        action: matchInfo.matchedProduct ? 'map_existing' : 'create_new',
        confidence: it.confidence || matchInfo.confidence || 85,
        uncertain: matchInfo.uncertain,
        matchReason: matchInfo.matchReason || (matchInfo.matchedProduct ? 'Matched to Master' : 'New Product (Not in Master)'),
        warnings: matchInfo.warnings || [],
      };
    });
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileInfo({ name: file.name, type: file.type, size: file.size });
    if (file.type?.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl('');
    }
    setStage('running');
    setProgress(15);
    setStatusMsg('Extracting text & visual structure from invoice...');

    let rawText = '';
    try {
      const localRes = await extractBillText(file, (msg, p) => {
        setStatusMsg(msg);
        setProgress(Math.min(55, Math.round((p || 0.3) * 55)));
      });
      rawText = localRes?.text || '';
    } catch {
      // Continue to AI extraction with base64 image/PDF
    }

    setStatusMsg('Running AI Purchase Invoice Extractor & Product Matcher...');
    setProgress(75);

    try {
      const base64 = await fileToBase64(file);
      const aiRes = await extractPurchaseBillAI({
        fileBase64: base64,
        mimeType: file.type || 'application/pdf',
        fileName: file.name,
        textHint: rawText,
        supplierTemplates,
      });

      if (aiRes?.data && (aiRes.data.supplierName || aiRes.data.items?.length)) {
        const d = aiRes.data;
        setEngineUsed('Gemini AI Structured Extractor');
        setHeader({
          supplierName: d.supplierName || '',
          supplierGstin: (d.supplierGstin || '').toUpperCase(),
          supplierAddress: d.supplierAddress || '',
          supplierPhone: d.supplierPhone || '',
          supplierState: d.supplierState || '',
          invoiceNumber: d.invoiceNumber || '',
          invoiceDate: d.invoiceDate || new Date().toISOString().slice(0, 10),
          dueDate: d.dueDate || '',
          placeOfSupply: d.placeOfSupply || '',
          freight: Number(d.freight) || 0,
          otherCharges: Number(d.otherCharges) || 0,
          roundOff: Number(d.roundOff) || 0,
          printedGrandTotal: Number(d.printedGrandTotal) || 0,
          taxMode: Number(d.items?.[0]?.igst) > 0 ? 'inter' : 'intra',
          warnings: d.warnings || [],
        });
        setLineItems(decorateItemsWithMasterMatch(d.items || []));
        setStage('review');
        return;
      }
    } catch {
      // Fallback to local OCR parser below
    }

    // Local OCR / PDF Text Fallback
    const localParsed = parseBillText(rawText || '');
    setEngineUsed('Local PDF/Tesseract OCR Parser');
    setHeader({
      supplierName: localParsed.supplierName || file.name.replace(/\.[^.]+$/, ''),
      supplierGstin: (localParsed.supplierGstin || '').toUpperCase(),
      supplierAddress: '',
      supplierPhone: '',
      supplierState: '',
      invoiceNumber: localParsed.billNumber || `PUR-${Date.now().toString().slice(-4)}`,
      invoiceDate: localParsed.date || new Date().toISOString().slice(0, 10),
      dueDate: '',
      placeOfSupply: '',
      freight: 0,
      otherCharges: 0,
      roundOff: 0,
      printedGrandTotal: Number(localParsed.totalAmount) || 0,
      taxMode: Number(localParsed.igst) > 0 ? 'inter' : 'intra',
      warnings: localParsed.items?.length ? [] : ['Line items were not clearly separated in scan; please verify or add items below.'],
    });
    const fallbackItems = localParsed.items?.length
      ? localParsed.items
      : [
          {
            name: 'Automotive Spare Part (From Bill)',
            partNumber: '',
            brand: '',
            hsn: '8708',
            quantity: 1,
            unit: 'Nos',
            rate: Number(localParsed.taxableAmount || localParsed.totalAmount || 0),
            discountPercent: 0,
            taxPercent: 18,
          },
        ];
    setLineItems(decorateItemsWithMasterMatch(fallbackItems));
    setStage('review');
  };

  const handleLoadSampleInvoice = () => {
    setFileInfo({ name: 'Bosch_Minda_Supplier_Invoice_0419.pdf', type: 'application/pdf', size: 148200 });
    setEngineUsed('AI Automotive Purchase Bill Extractor');
    setHeader({
      ...SAMPLE_AI_PURCHASE_INVOICE,
      taxMode: 'intra',
    });
    setLineItems(decorateItemsWithMasterMatch(SAMPLE_AI_PURCHASE_INVOICE.items));
    setStage('review');
  };

  // Live calculation of line items, taxes, freight, round-off, and reconciliation against printed total
  const totals = useMemo(() => {
    let taxableSum = 0;
    let cgstSum = 0;
    let sgstSum = 0;
    let igstSum = 0;

    const computedRows = lineItems.map(it => {
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      const discPct = Number(it.discountPercent) || 0;
      const taxPct = Number(it.taxPercent) || 0;
      const gross = qty * rate;
      const discAmt = Math.round(((gross * discPct) / 100) * 100) / 100;
      const taxable = Math.round((gross - discAmt) * 100) / 100;
      const taxAmt = Math.round(((taxable * taxPct) / 100) * 100) / 100;
      const cgst = header.taxMode === 'intra' ? Math.round((taxAmt / 2) * 100) / 100 : 0;
      const sgst = header.taxMode === 'intra' ? Math.round((taxAmt / 2) * 100) / 100 : 0;
      const igst = header.taxMode === 'inter' ? taxAmt : 0;
      const rowTotal = Math.round((taxable + taxAmt) * 100) / 100;

      taxableSum += taxable;
      cgstSum += cgst;
      sgstSum += sgst;
      igstSum += igst;
      return { ...it, taxableValue: taxable, cgst, sgst, igst, rowTotal };
    });

    const freight = Number(header.freight) || 0;
    const other = Number(header.otherCharges) || 0;
    const roundOff = Number(header.roundOff) || 0;
    const calculatedGrandTotal = Math.round((taxableSum + cgstSum + sgstSum + igstSum + freight + other + roundOff) * 100) / 100;
    const printed = Number(header.printedGrandTotal) || calculatedGrandTotal;
    const diff = Math.round((calculatedGrandTotal - printed) * 100) / 100;

    return {
      computedRows,
      taxableSum: Math.round(taxableSum * 100) / 100,
      cgstSum: Math.round(cgstSum * 100) / 100,
      sgstSum: Math.round(sgstSum * 100) / 100,
      igstSum: Math.round(igstSum * 100) / 100,
      taxTotal: Math.round((cgstSum + sgstSum + igstSum) * 100) / 100,
      calculatedGrandTotal,
      printedGrandTotal: printed,
      diff,
    };
  }, [lineItems, header]);

  const updateLineItem = (idx, patch) => {
    setLineItems(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      const next = { ...row, ...patch };
      if ('matchedProductId' in patch && patch.matchedProductId) {
        const prod = products.find(p => p.id === patch.matchedProductId);
        if (prod) {
          next.action = 'map_existing';
          next.matchReason = `Manually mapped to "${prod.name}"`;
          next.uncertain = false;
        }
      }
      return next;
    }));
  };

  const addBlankLine = () => {
    setLineItems(prev => [
      ...prev,
      {
        id: `ocr_item_${Date.now()}`,
        name: '',
        partNumber: '',
        brand: '',
        hsn: '8708',
        quantity: 1,
        unit: 'Nos',
        mrp: 0,
        rate: 0,
        discountPercent: 0,
        taxPercent: 18,
        matchedProductId: '',
        action: 'create_new',
        confidence: 100,
        matchReason: 'Manual Line Item',
        warnings: [],
      },
    ]);
  };

  const removeLine = (idx) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleConfirmAndPost = async () => {
    if (!header.supplierName.trim()) {
      if (showToast) showToast('Supplier Name is required', 'error');
      return;
    }

    // 1. Upsert Supplier Master
    const existingSup = suppliers.find(
      s =>
        (header.supplierGstin && s.gstin?.toUpperCase() === header.supplierGstin.toUpperCase()) ||
        s.name?.toLowerCase() === header.supplierName.trim().toLowerCase()
    );
    await saveSupplier({
      ...(existingSup || {}),
      name: header.supplierName.trim(),
      gstin: header.supplierGstin.trim().toUpperCase(),
      address: header.supplierAddress,
      phone: header.supplierPhone,
      state: header.supplierState,
    });

    // 2. Save Supplier Extraction Template Rules if checked
    if (saveTemplateOnPost) {
      await saveSupplierTemplate({
        supplierName: header.supplierName.trim(),
        supplierGstin: header.supplierGstin.trim().toUpperCase(),
        defaultTaxMode: header.taxMode,
        sampleInvoicePattern: header.invoiceNumber,
      });
    }

    // 3. Upsert / Update Inventory Master if checked
    const finalBillItems = [];
    for (const row of totals.computedRows) {
      if (!row.name.trim()) continue;
      let productId = row.matchedProductId;

      if (autoUpdateInventory) {
        if (row.action === 'map_existing' && productId) {
          const existingProd = products.find(p => p.id === productId);
          if (existingProd) {
            await saveProduct({
              ...existingProd,
              oemPartNo: existingProd.oemPartNo || row.partNumber,
              brand: existingProd.brand || row.brand,
              lastPurchasePrice: Number(row.rate) || existingProd.purchasePrice,
              purchasePrice: Number(row.rate) || existingProd.purchasePrice,
              mrp: Number(row.mrp) || existingProd.mrp,
            });
          }
        } else if (row.action === 'create_new') {
          const created = await saveProduct(
            normalizeAutomotiveProduct({
              name: row.name,
              oemPartNo: row.partNumber,
              itemCode: row.partNumber,
              brand: row.brand,
              manufacturer: row.brand,
              hsn: row.hsn || '8708',
              unit: row.unit || 'Nos',
              taxPercent: Number(row.taxPercent) || 18,
              purchasePrice: Number(row.rate) || 0,
              lastPurchasePrice: Number(row.rate) || 0,
              mrp: Number(row.mrp) || Math.round((Number(row.rate) || 0) * 1.35),
              sellingPrice: Number(row.mrp) || Math.round((Number(row.rate) || 0) * 1.25),
              stock: 0,
              openingStock: 0,
            })
          );
          productId = created.id;
        }
      }

      finalBillItems.push({
        productId,
        name: row.name,
        partNumber: row.partNumber,
        brand: row.brand,
        hsn: row.hsn,
        quantity: Number(row.quantity) || 1,
        unit: row.unit || 'Nos',
        rate: Number(row.rate) || 0,
        discountPercent: Number(row.discountPercent) || 0,
        taxPercent: Number(row.taxPercent) || 18,
        taxableValue: row.taxableValue,
        amount: row.rowTotal,
      });
    }

    onExtracted({
      supplierName: header.supplierName.trim(),
      supplierGstin: header.supplierGstin.trim().toUpperCase(),
      billNumber: header.invoiceNumber.trim(),
      date: header.invoiceDate,
      dueDate: header.dueDate,
      taxableAmount: totals.taxableSum,
      cgst: totals.cgstSum,
      sgst: totals.sgstSum,
      igst: totals.igstSum,
      freight: Number(header.freight) || 0,
      roundOff: Number(header.roundOff) || 0,
      totalAmount: totals.calculatedGrandTotal,
      hsn: finalBillItems[0]?.hsn || '8708',
      notes: `Extracted via ${engineUsed} (${finalBillItems.length} spare part line items)`,
      items: finalBillItems,
      stockAlreadyAppliedByOcr: autoUpdateInventory,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: stage === 'review' ? 1120 : 620, width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">AI-Powered Supplier Purchase Bill Extraction & Part Matcher</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Upload PDF, Scanned PDF, JPG, or PNG supplier invoices — extracts GSTIN, OEM part numbers, HSN, discounts & reconciles totals
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          {stage === 'pick' && (
            <div style={{ padding: '12px 4px' }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files?.[0])}
              />
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                style={{
                  border: '2px dashed var(--primary)',
                  borderRadius: 12,
                  padding: '36px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--bg-secondary)',
                }}
              >
                <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 6 }}>
                  Drop Supplier Tax Invoice (PDF / Scanned PDF / JPG / PNG)
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                  Automatically extracts supplier GSTIN, line-by-line OEM part numbers, brand, HSN, GST splits & matches against your Product Master
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                    Select Invoice File
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleLoadSampleInvoice}>
                    Load Sample Automotive Supplier Bill (Demo)
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === 'running' && (
            <div style={{ padding: 36, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{statusMsg}</div>
              <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 999, overflow: 'hidden', maxWidth: 420, margin: '0 auto 10px' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.25s ease' }} />
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{fileInfo?.name}</div>
            </div>
          )}

          {stage === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Engine & Reconciliation Status Banner */}
              <div
                className="glass-card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  border: Math.abs(totals.diff) < 1 ? '1.5px solid var(--success)' : '1.5px solid var(--warning)',
                }}
              >
                <div>
                  <strong>Engine:</strong> {engineUsed} {fileInfo?.name ? `• File: ${fileInfo.name}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.86rem' }}>
                  <span>Calculated Total: <strong>{formatCurrency(totals.calculatedGrandTotal)}</strong></span>
                  <span>Printed Invoice Total: <strong>{formatCurrency(totals.printedGrandTotal)}</strong></span>
                  <span style={{ fontWeight: 700, color: Math.abs(totals.diff) < 1 ? 'var(--success)' : 'var(--warning)' }}>
                    {Math.abs(totals.diff) < 1 ? '✓ Totals Reconciled' : `⚠ Difference: ${formatCurrency(totals.diff)}`}
                  </span>
                </div>
              </div>

              {/* Supplier & Invoice Header Fields */}
              <div className="glass-card" style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Supplier Name *</label>
                    <input className="form-input" value={header.supplierName} onChange={e => setHeader({ ...header, supplierName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Supplier GSTIN</label>
                    <input className="form-input" value={header.supplierGstin} onChange={e => setHeader({ ...header, supplierGstin: e.target.value.toUpperCase() })} maxLength={15} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Invoice Number *</label>
                    <input className="form-input" value={header.invoiceNumber} onChange={e => setHeader({ ...header, invoiceNumber: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Invoice Date</label>
                    <input type="date" className="form-input" value={header.invoiceDate} onChange={e => setHeader({ ...header, invoiceDate: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Due Date</label>
                    <input type="date" className="form-input" value={header.dueDate} onChange={e => setHeader({ ...header, dueDate: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">GST Supply Type</label>
                    <select className="form-input" value={header.taxMode} onChange={e => setHeader({ ...header, taxMode: e.target.value })}>
                      <option value="intra">Intra-State (CGST + SGST)</option>
                      <option value="inter">Inter-State (IGST)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Line Items & Smart Product Master Matching Table */}
              <div className="glass-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h4 style={{ margin: 0 }}>Extracted Spare Parts & Master Matching ({lineItems.length} items)</h4>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addBlankLine}>
                    + Add Line Item
                  </button>
                </div>

                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Spare Part Name</th>
                        <th>OEM Part No</th>
                        <th>Brand</th>
                        <th>HSN</th>
                        <th>Qty</th>
                        <th>Rate (₹)</th>
                        <th>Disc %</th>
                        <th>GST %</th>
                        <th>Taxable</th>
                        <th>Product Master Mapping</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.computedRows.map((row, idx) => (
                        <tr key={row.id}>
                          <td style={{ minWidth: 190 }}>
                            <input
                              className="form-input"
                              value={row.name}
                              onChange={e => updateLineItem(idx, { name: e.target.value })}
                              placeholder="Part description"
                            />
                            {row.warnings?.length > 0 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--warning)', marginTop: 3 }}>
                                ⚠ {row.warnings[0]}
                              </div>
                            )}
                          </td>
                          <td style={{ width: 120 }}>
                            <input
                              className="form-input"
                              value={row.partNumber}
                              onChange={e => updateLineItem(idx, { partNumber: e.target.value })}
                              placeholder="OEM No"
                            />
                          </td>
                          <td style={{ width: 110 }}>
                            <input
                              className="form-input"
                              value={row.brand}
                              onChange={e => updateLineItem(idx, { brand: e.target.value })}
                              placeholder="Brand"
                            />
                          </td>
                          <td style={{ width: 90 }}>
                            <input
                              className="form-input"
                              value={row.hsn}
                              onChange={e => updateLineItem(idx, { hsn: e.target.value })}
                            />
                          </td>
                          <td style={{ width: 75 }}>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={row.quantity}
                              onChange={e => updateLineItem(idx, { quantity: e.target.value })}
                            />
                          </td>
                          <td style={{ width: 95 }}>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={row.rate}
                              onChange={e => updateLineItem(idx, { rate: e.target.value })}
                            />
                          </td>
                          <td style={{ width: 70 }}>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={row.discountPercent}
                              onChange={e => updateLineItem(idx, { discountPercent: e.target.value })}
                            />
                          </td>
                          <td style={{ width: 75 }}>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={row.taxPercent}
                              onChange={e => updateLineItem(idx, { taxPercent: e.target.value })}
                            />
                          </td>
                          <td style={{ fontWeight: 600 }}>{formatCurrency(row.taxableValue)}</td>
                          <td style={{ minWidth: 210 }}>
                            <select
                              className="form-input"
                              style={{ fontSize: '0.78rem', padding: '4px 6px' }}
                              value={row.action === 'create_new' ? '__CREATE_NEW__' : row.matchedProductId}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '__CREATE_NEW__') {
                                  updateLineItem(idx, { action: 'create_new', matchedProductId: '' });
                                } else {
                                  updateLineItem(idx, { action: 'map_existing', matchedProductId: val });
                                }
                              }}
                            >
                              <option value="__CREATE_NEW__">+ Create New Part in Master</option>
                              {products.map(p => (
                                <option key={p.id} value={p.id}>
                                  Map: {p.name} ({p.brand || 'Gen'} • {p.oemPartNo || 'No OEM'})
                                </option>
                              ))}
                            </select>
                            <div style={{ fontSize: '0.7rem', color: row.action === 'map_existing' ? 'var(--success)' : 'var(--primary)', marginTop: 2 }}>
                              {row.matchReason}
                            </div>
                          </td>
                          <td>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(idx)}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charges, Taxes & Options Footer Card */}
              <div className="glass-card" style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600 }}>
                    <input type="checkbox" checked={autoUpdateInventory} onChange={e => setAutoUpdateInventory(e.target.checked)} />
                    Automatically add inward stock & update Purchase Cost on Product Master
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600 }}>
                    <input type="checkbox" checked={saveTemplateOnPost} onChange={e => setSaveTemplateOnPost(e.target.checked)} />
                    Learn & save Supplier format rules for future bills from this vendor
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <div className="form-group">
                    <label className="form-label">Freight (₹)</label>
                    <input type="number" step="any" className="form-input" value={header.freight} onChange={e => setHeader({ ...header, freight: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Round-Off (₹)</label>
                    <input type="number" step="any" className="form-input" value={header.roundOff} onChange={e => setHeader({ ...header, roundOff: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Printed Total (₹)</label>
                    <input type="number" step="any" className="form-input" value={header.printedGrandTotal} onChange={e => setHeader({ ...header, printedGrandTotal: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Final Bill Total</label>
                    <div style={{ fontWeight: 800, fontSize: '1.08rem', color: 'var(--primary)', paddingTop: 6 }}>
                      {formatCurrency(totals.calculatedGrandTotal)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ marginTop: 14 }}>
          {stage === 'review' && (
            <button type="button" className="btn btn-secondary" onClick={() => setStage('pick')}>
              ← Upload Another Bill
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {stage === 'review' && (
            <button type="button" className="btn btn-primary" onClick={handleConfirmAndPost}>
              Apply & Populate Purchase Bill ({formatCurrency(totals.calculatedGrandTotal)})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
