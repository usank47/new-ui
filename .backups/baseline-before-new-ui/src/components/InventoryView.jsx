import React, { useState, useEffect, useMemo } from 'react';
import {
  getAllProducts,
  saveProduct,
  deleteProduct,
  getInventorySettings,
  saveInventorySettings,
  getAllBills,
  getAllPurchases,
  getAllVouchers,
  saveVoucher,
  getAllWarehouses,
  saveWarehouse,
} from '../store';
import { formatCurrency, isServiceProduct } from '../utils';
import {
  bulkRowToProduct,
  AUTOMOTIVE_CATEGORIES,
  PART_TYPES,
  FUEL_TYPES,
  normalizeAutomotiveProduct,
  isMisclassifiedAccountProduct,
  computeProductMargins,
  findDuplicateProducts,
  productMatchesSearch,
  classifyProductMovement,
} from '../utils/products';
import { writeXlsxFile, readXlsxRows } from '../utils/xlsx';
import ConfirmModal from './ConfirmModal';
import { ProductionList } from './Manufacturing';
import TableExport from './TableExport';
import { toast } from './Toast';

const COMMON_UNITS = ['Nos', 'Set', 'Kit', 'Pair', 'Ltr', 'Mtr', 'Kg', 'Box', 'Pcs', 'Bottle', 'Can', 'Roll'];
const GST_RATES = [0, 5, 12, 18, 28];

const emptyProductForm = () => ({
  name: '',
  kind: 'goods',
  itemCode: '',
  oemPartNo: '',
  mfgPartNo: '',
  altPartNo: '',
  sku: '',
  barcode: '',
  brand: '',
  manufacturer: '',
  partType: 'Aftermarket Standard',
  category: 'Engine Parts',
  productGroup: 'Engine Parts',
  subcategory: '',
  hsn: '8708',
  description: '',
  taxPercent: 18,
  unit: 'Nos',
  purchaseUnit: 'Nos',
  salesUnit: 'Nos',
  unitConversion: 1,
  purchasePrice: '',
  lastPurchasePrice: '',
  avgPurchaseCost: '',
  mrp: '',
  sellingPrice: '',
  mechanicPrice: '',
  wholesalePrice: '',
  specialPrice: '',
  minSellingPrice: '',
  discountPercent: 0,
  openingStock: 0,
  stock: 0,
  reservedStock: 0,
  minStock: 5,
  maxStock: 100,
  reorderLevel: 5,
  reorderQty: 10,
  rack: '',
  shelf: '',
  binLocation: '',
  materialCentre: 'Main Store',
  supersededPartNo: '',
  vehicleFitments: [],
  crossReferences: [],
});

export default function InventoryView({ showToast = toast, initialAction, clearInitialAction, onOpenBusyImport }) {
  const [products, setProducts] = useState([]);
  const [bills, setBills] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [brandFilter, setBrandFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'low' | 'negative' | 'dead' | 'fast'
  const [activeSubTab, setActiveSubTab] = useState('catalog'); // 'catalog' | 'adjustments' | 'reconcile' | 'production'
  const [expandedProductId, setExpandedProductId] = useState(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalTab, setModalTab] = useState('id'); // 'id' | 'pricing' | 'stock' | 'fitment'
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyProductForm);
  const [dupeWarning, setDupeWarning] = useState(null);

  // Fitment & cross-reference builder state inside modal
  const [fitDraft, setFitDraft] = useState({ make: '', model: '', generation: '', year: '', fuelType: 'Petrol', engine: '', variant: '' });
  const [crDraft, setCrDraft] = useState({ brand: '', partNo: '', notes: '' });

  // Settings state
  const [invSettings, setInvSettings] = useState({
    allowNegativeStock: true,
    multiLocationEnabled: false,
    defaultMaterialCentre: 'Main Store',
    deadStockDays: 180,
    fastMovingMinSales: 10,
  });

  // Bulk edit state
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkEdits, setBulkEdits] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);

  // Stock Adjustment / Journal form
  const [adjForm, setAdjForm] = useState({
    voucherType: 'Stock Journal',
    adjustmentMode: 'inward', // 'inward' | 'outward' | 'damage' | 'transfer'
    productId: '',
    quantity: 1,
    fromLocation: 'Main Store',
    toLocation: 'Branch Warehouse',
    reason: 'Opening / Counter Stock Adjustment',
    date: new Date().toISOString().slice(0, 10),
  });

  // Physical Stock Reconciliation state
  const [physicalCounts, setPhysicalCounts] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [newWarehouseName, setNewWarehouseName] = useState('');

  const loadAll = async () => {
    const [prods, bls, purs, vchs, whs, invCfg] = await Promise.all([
      getAllProducts(),
      getAllBills(),
      getAllPurchases(),
      getAllVouchers(),
      getAllWarehouses(),
      getInventorySettings(),
    ]);
    setProducts(
      (prods || [])
        .filter(p => !isMisclassifiedAccountProduct(p))
        .map(normalizeAutomotiveProduct)
    );
    setBills(bls || []);
    setPurchases(purs || []);
    setVouchers(vchs || []);
    setWarehouses(whs?.length ? whs : [{ id: 'wh_main', name: 'Main Store', code: 'MAIN' }, { id: 'wh_branch', name: 'Workshop Bay Store', code: 'BAY-1' }]);
    setInvSettings(invCfg);
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (initialAction === 'new-product') {
      openAdd();
      if (clearInitialAction) clearInitialAction();
    }
  }, [initialAction]);

  const enrichedProducts = useMemo(() => {
    return classifyProductMovement(products, bills, purchases, invSettings);
  }, [products, bills, purchases, invSettings]);

  const categories = useMemo(() => {
    const set = new Set(AUTOMOTIVE_CATEGORIES);
    products.forEach(p => { if (p.category) set.add(p.category); });
    return ['All', ...Array.from(set)];
  }, [products]);

  const brands = useMemo(() => {
    const set = new Set();
    products.forEach(p => { if (p.brand) set.add(p.brand); });
    return ['All', ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    return enrichedProducts.filter(p => {
      if (!productMatchesSearch(p, search)) return false;
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (brandFilter !== 'All' && p.brand !== brandFilter) return false;
      if (stockFilter === 'low' && !p.isLowStock) return false;
      if (stockFilter === 'negative' && !p.isNegativeStock) return false;
      if (stockFilter === 'dead' && !p.isDeadStock) return false;
      if (stockFilter === 'fast' && p.movementClass !== 'Fast-Moving') return false;
      return true;
    });
  }, [enrichedProducts, search, categoryFilter, brandFilter, stockFilter]);

  const stats = useMemo(() => {
    let totalValuationCost = 0;
    let totalValuationRetail = 0;
    let lowCount = 0;
    let negativeCount = 0;
    let deadCount = 0;
    for (const p of enrichedProducts) {
      if (isServiceProduct(p)) continue;
      const qty = Number(p.stock) || 0;
      const cost = Number(p.avgPurchaseCost || p.purchasePrice || p.sellingPrice || 0);
      const retail = Number(p.sellingPrice || p.rate || 0);
      if (qty > 0) {
        totalValuationCost += qty * cost;
        totalValuationRetail += qty * retail;
      }
      if (p.isLowStock) lowCount++;
      if (p.isNegativeStock) negativeCount++;
      if (p.isDeadStock) deadCount++;
    }
    return {
      totalItems: enrichedProducts.length,
      totalValuationCost: Math.round(totalValuationCost * 100) / 100,
      totalValuationRetail: Math.round(totalValuationRetail * 100) / 100,
      lowCount,
      negativeCount,
      deadCount,
    };
  }, [enrichedProducts]);

  const handleToggleNegativeStock = async () => {
    const next = await saveInventorySettings({
      ...invSettings,
      allowNegativeStock: !invSettings.allowNegativeStock,
    });
    setInvSettings(next);
    showToast(
      next.allowNegativeStock
        ? 'Allow Negative Stock is now ON — Sales allowed even when stock is 0 or negative.'
        : 'Allow Negative Stock is now OFF — Sales exceeding available stock will be restricted.',
      'info'
    );
  };

  const handleToggleMultiLocation = async () => {
    const next = await saveInventorySettings({
      ...invSettings,
      multiLocationEnabled: !invSettings.multiLocationEnabled,
    });
    setInvSettings(next);
    showToast(
      next.multiLocationEnabled
        ? 'Multi-Location Inventory is now ON — Material centres & stock transfers enabled.'
        : 'Multi-Location Inventory is now OFF — Single-location store mode active.',
      'info'
    );
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyProductForm(), materialCentre: invSettings.defaultMaterialCentre || 'Main Store' });
    setDupeWarning(null);
    setModalTab('id');
    setShowModal(true);
  };

  const openEdit = (p) => {
    const norm = normalizeAutomotiveProduct(p);
    setEditing(norm);
    setForm({
      ...emptyProductForm(),
      ...norm,
      kind: isServiceProduct(norm) ? 'service' : 'goods',
    });
    setDupeWarning(null);
    setModalTab('id');
    setShowModal(true);
  };

  const handleSave = async (e, forceSave = false) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) {
      showToast('Product name is required', 'error');
      return;
    }

    const candidate = normalizeAutomotiveProduct({
      ...(editing || {}),
      ...form,
      id: editing ? editing.id : undefined,
    });

    if (!forceSave) {
      const { exactDuplicates, crossBrandEquivalents } = findDuplicateProducts(candidate, products);
      if (exactDuplicates.length > 0) {
        setDupeWarning({
          type: 'exact',
          duplicates: exactDuplicates,
          crossBrand: crossBrandEquivalents,
        });
        return;
      }
    }

    const isService = form.kind === 'service';
    const payload = {
      ...candidate,
      kind: isService ? 'service' : 'goods',
      stock: isService ? undefined : Number(form.stock ?? 0),
    };

    await saveProduct(payload);
    setShowModal(false);
    setDupeWarning(null);
    await loadAll();
    showToast(editing ? 'Automotive part updated' : 'Automotive part added to master', 'success');
  };

  const handleDelete = (product) => {
    setConfirmState({
      title: `Delete "${product.name}"?`,
      message: 'This will remove the spare part from the Product Master. Existing invoices remain unaffected.',
      confirmLabel: 'Delete Part',
      onConfirm: async () => {
        setConfirmState(null);
        await deleteProduct(product.id);
        await loadAll();
        showToast('Product deleted', 'info');
      },
    });
  };

  const addFitmentToForm = () => {
    if (!fitDraft.make.trim() && !fitDraft.model.trim()) {
      showToast('Enter at least Vehicle Make or Model', 'warning');
      return;
    }
    setForm(prev => ({
      ...prev,
      vehicleFitments: [...(prev.vehicleFitments || []), { ...fitDraft }],
    }));
    setFitDraft({ make: '', model: '', generation: '', year: '', fuelType: 'Petrol', engine: '', variant: '' });
  };

  const removeFitmentFromForm = (idx) => {
    setForm(prev => ({
      ...prev,
      vehicleFitments: (prev.vehicleFitments || []).filter((_, i) => i !== idx),
    }));
  };

  const addCrossRefToForm = () => {
    if (!crDraft.partNo.trim()) {
      showToast('Enter a Cross-Reference Part Number', 'warning');
      return;
    }
    setForm(prev => ({
      ...prev,
      crossReferences: [...(prev.crossReferences || []), { ...crDraft }],
    }));
    setCrDraft({ brand: '', partNo: '', notes: '' });
  };

  const removeCrossRefFromForm = (idx) => {
    setForm(prev => ({
      ...prev,
      crossReferences: (prev.crossReferences || []).filter((_, i) => i !== idx),
    }));
  };

  // Stock Adjustment / Journal Submission
  const handlePostStockAdjustment = async (e) => {
    e.preventDefault();
    const prod = products.find(p => p.id === adjForm.productId);
    if (!prod) {
      showToast('Select a product to adjust', 'error');
      return;
    }
    const qty = Number(adjForm.quantity) || 0;
    if (qty <= 0) {
      showToast('Quantity must be greater than 0', 'error');
      return;
    }

    const currentStock = Number(prod.stock) || 0;
    let delta = 0;
    if (adjForm.adjustmentMode === 'inward') delta = qty;
    else if (adjForm.adjustmentMode === 'outward' || adjForm.adjustmentMode === 'damage') delta = -qty;
    else if (adjForm.adjustmentMode === 'transfer') delta = 0; // Total company stock stays same, materialCentre updates

    const nextStock = currentStock + delta;
    if (!invSettings.allowNegativeStock && nextStock < 0) {
      showToast(`Negative stock is disabled. Cannot reduce "${prod.name}" below 0 (Current: ${currentStock}).`, 'error');
      return;
    }

    const updatedProduct = {
      ...prod,
      stock: nextStock,
      materialCentre: adjForm.adjustmentMode === 'transfer' ? adjForm.toLocation : prod.materialCentre,
    };
    await saveProduct(updatedProduct);

    await saveVoucher({
      voucherType: 'Stock Journal',
      voucherNo: `SJN/${Date.now().toString().slice(-5)}`,
      date: adjForm.date,
      productId: prod.id,
      productName: prod.name,
      oemPartNo: prod.oemPartNo,
      adjustmentMode: adjForm.adjustmentMode,
      quantity: qty,
      delta,
      previousStock: currentStock,
      newStock: nextStock,
      fromLocation: adjForm.fromLocation,
      toLocation: adjForm.toLocation,
      narration: adjForm.reason || `Stock ${adjForm.adjustmentMode} (${qty} ${prod.unit || 'Nos'})`,
    });

    await loadAll();
    showToast(`Stock Journal posted: ${prod.name} (${currentStock} → ${nextStock})`, 'success');
  };

  // Physical Stock Reconciliation Commit
  const handleCommitReconciliation = async () => {
    const entries = Object.entries(physicalCounts).filter(([, val]) => val !== '' && val !== undefined && !Number.isNaN(Number(val)));
    if (!entries.length) {
      showToast('Enter physical count for at least one product', 'warning');
      return;
    }
    let adjusted = 0;
    for (const [id, physVal] of entries) {
      const prod = products.find(p => p.id === id);
      if (!prod) continue;
      const sysQty = Number(prod.stock) || 0;
      const physQty = Number(physVal);
      if (sysQty === physQty) continue;
      if (!invSettings.allowNegativeStock && physQty < 0) continue;

      await saveProduct({ ...prod, stock: physQty });
      await saveVoucher({
        voucherType: 'Stock Journal',
        voucherNo: `RECON/${Date.now().toString().slice(-5)}`,
        date: new Date().toISOString().slice(0, 10),
        productId: prod.id,
        productName: prod.name,
        adjustmentMode: 'reconciliation',
        quantity: Math.abs(physQty - sysQty),
        delta: physQty - sysQty,
        previousStock: sysQty,
        newStock: physQty,
        narration: `Physical stock reconciliation: System ${sysQty} → Physical ${physQty}`,
      });
      adjusted++;
    }
    setPhysicalCounts({});
    await loadAll();
    showToast(`Reconciled ${adjusted} product(s) and recorded Stock Journal entries`, 'success');
  };

  // Bulk Edit save
  const saveBulkChanges = async () => {
    const ids = Object.keys(bulkEdits);
    if (!ids.length) { setBulkMode(false); return; }
    setBulkSaving(true);
    try {
      for (const id of ids) {
        const current = products.find(p => p.id === id);
        if (!current) continue;
        const { product, error } = bulkRowToProduct(current, bulkEdits[id]);
        if (error) {
          showToast(`Cannot save: ${error}`, 'error');
          setBulkSaving(false);
          return;
        }
        await saveProduct(product);
      }
      setBulkEdits({});
      setBulkMode(false);
      await loadAll();
      showToast(`Saved ${ids.length} product(s)`, 'success');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleExportExcel = async () => {
    if (!products.length) {
      showToast('No products to export', 'warning');
      return;
    }
    const headers = [
      'Product Name', 'Item Code', 'OEM Part No', 'Mfg Part No', 'Alt Part No',
      'Brand', 'Manufacturer', 'Category', 'HSN', 'GST %', 'Unit',
      'Purchase Price', 'MRP', 'Retail Price', 'Mechanic Price', 'Wholesale Price',
      'Current Stock', 'Min Stock', 'Rack', 'Bin Location', 'Material Centre',
      'Vehicle Make', 'Vehicle Model', 'Vehicle Year', 'Fuel Type',
    ];
    const rows = products.map(p => {
      const vf = p.vehicleFitments?.[0] || {};
      return [
        p.name || '', p.itemCode || '', p.oemPartNo || '', p.mfgPartNo || '', p.altPartNo || '',
        p.brand || '', p.manufacturer || '', p.category || '', p.hsn || '', p.taxPercent ?? 18, p.unit || 'Nos',
        p.purchasePrice ?? 0, p.mrp ?? 0, p.sellingPrice ?? p.rate ?? 0, p.mechanicPrice ?? 0, p.wholesalePrice ?? 0,
        p.stock ?? 0, p.minStock ?? 5, p.rack || '', p.binLocation || '', p.materialCentre || 'Main Store',
        vf.make || '', vf.model || '', vf.year || '', vf.fuelType || '',
      ];
    });
    await writeXlsxFile(`Automotive_SpareParts_Master_${new Date().toISOString().slice(0, 10)}.xlsx`, headers, rows, 'SpareParts');
    showToast(`Exported ${products.length} spare parts to Excel`, 'success');
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readXlsxRows(file);
      let imported = 0;
      for (const r of rows) {
        const name = r['Product Name'] || r.name || r.Name || r['Item Name'];
        if (!name) continue;
        const prod = normalizeAutomotiveProduct({
          name,
          itemCode: r['Item Code'] || r.itemCode || '',
          oemPartNo: r['OEM Part No'] || r.oemPartNo || r['Part No'] || '',
          mfgPartNo: r['Mfg Part No'] || r.mfgPartNo || '',
          altPartNo: r['Alt Part No'] || r.altPartNo || '',
          brand: r.Brand || r.brand || '',
          manufacturer: r.Manufacturer || r.manufacturer || '',
          category: r.Category || r.category || 'Engine Parts',
          hsn: r.HSN || r.hsn || '8708',
          taxPercent: Number(r['GST %'] ?? r.taxPercent ?? 18),
          unit: r.Unit || r.unit || 'Nos',
          purchasePrice: Number(r['Purchase Price'] ?? r.purchasePrice ?? 0),
          mrp: Number(r.MRP ?? r.mrp ?? 0),
          sellingPrice: Number(r['Retail Price'] ?? r.sellingPrice ?? r.Rate ?? 0),
          mechanicPrice: Number(r['Mechanic Price'] ?? r.mechanicPrice ?? 0),
          wholesalePrice: Number(r['Wholesale Price'] ?? r.wholesalePrice ?? 0),
          stock: Number(r['Current Stock'] ?? r.stock ?? 0),
          minStock: Number(r['Min Stock'] ?? r.minStock ?? 5),
          rack: r.Rack || r.rack || '',
          binLocation: r['Bin Location'] || r.binLocation || '',
          materialCentre: r['Material Centre'] || r.materialCentre || 'Main Store',
          vehicleMake: r['Vehicle Make'] || '',
          vehicleModel: r['Vehicle Model'] || '',
          vehicleYear: r['Vehicle Year'] || '',
          fuelType: r['Fuel Type'] || '',
        });
        await saveProduct(prod);
        imported++;
      }
      await loadAll();
      showToast(`Imported ${imported} automotive spare parts`, 'success');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
    e.target.value = '';
  };

  const marginsPreview = computeProductMargins(form);

  return (
    <div className="inventory-view">
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Automotive Spare-Parts & Inventory Master</h1>
          <p className="page-subtitle">
            OEM / Aftermarket catalog, multi-tier pricing, vehicle fitments, cross-references & stock control
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {onOpenBusyImport && (
            <button className="btn btn-secondary" onClick={onOpenBusyImport} title="Import Masters & Items from BUSY (.DAT / .XLSX / .CSV)">
              BUSY .DAT Import
            </button>
          )}
          <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            Import XLSX/CSV
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleImportFile} />
          </label>
          <TableExport
            title="Products and Services"
            filename="Products"
            headers={['Name', 'Type', 'HSN/SAC', 'Purchase price', 'Selling price', 'GST %', 'Unit', 'Stock']}
            rows={products.map(p => [
              p.name || '',
              p.kind === 'service' ? 'Service' : 'Goods',
              p.hsn || '',
              p.purchasePrice ?? 0,
              p.sellingPrice ?? p.rate ?? 0,
              p.taxPercent ?? 18,
              p.unit || 'Nos',
              p.stock ?? 0,
            ])}
          />
          <button className="btn btn-secondary" onClick={handleExportExcel} title="Export Detailed Automotive Master to Excel">
            Export Master XLSX
          </button>
          <button
            className={`btn ${bulkMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setBulkMode(!bulkMode); setBulkEdits({}); }}
          >
            {bulkMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Spare Part (F6)
          </button>
        </div>
      </div>

      {/* Inventory Control Settings Bar (Allow Negative Stock & Multi-Location Toggles) */}
      <div
        className="glass-card"
        style={{
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="toggle-negative-stock"
              type="checkbox"
              checked={!!invSettings.allowNegativeStock}
              onChange={handleToggleNegativeStock}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <label htmlFor="toggle-negative-stock" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
              Allow Negative Stock:{' '}
              <span style={{ color: invSettings.allowNegativeStock ? 'var(--success)' : 'var(--danger)' }}>
                {invSettings.allowNegativeStock ? 'ON (Allowed)' : 'OFF (Restricted)'}
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="toggle-multi-location"
              type="checkbox"
              checked={!!invSettings.multiLocationEnabled}
              onChange={handleToggleMultiLocation}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <label htmlFor="toggle-multi-location" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
              Multi-Location Inventory:{' '}
              <span style={{ color: invSettings.multiLocationEnabled ? 'var(--primary)' : 'var(--text-muted)' }}>
                {invSettings.multiLocationEnabled ? 'ON (Multi-Warehouse)' : 'OFF (Single Store)'}
              </span>
            </label>
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${activeSubTab === 'catalog' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('catalog')}
          >
            Parts Catalog ({stats.totalItems})
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === 'adjustments' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('adjustments')}
          >
            Stock Journal / Transfer
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === 'reconcile' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('reconcile')}
          >
            Physical Reconciliation
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === 'production' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('production')}
          >
            Kit / Production (BOM)
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="dashboard-stats" style={{ marginBottom: 16 }}>
        <div className="stat-card" onClick={() => { setActiveSubTab('catalog'); setStockFilter('all'); }} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Total Spare Parts</div>
          <div className="stat-value">{stats.totalItems}</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Click row for pricing tiers & vehicle fitments</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Stock Value (At Cost)</div>
          <div className="stat-value">{formatCurrency(stats.totalValuationCost)}</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Retail Value: {formatCurrency(stats.totalValuationRetail)}</div>
        </div>
        <div className="stat-card" onClick={() => { setActiveSubTab('catalog'); setStockFilter('low'); }} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Low / Reorder Stock</div>
          <div className="stat-value" style={{ color: stats.lowCount > 0 ? 'var(--warning)' : 'inherit' }}>{stats.lowCount}</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>At or below reorder level</div>
        </div>
        <div className="stat-card" onClick={() => { setActiveSubTab('catalog'); setStockFilter('negative'); }} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Negative / Dead Stock</div>
          <div className="stat-value" style={{ color: stats.negativeCount > 0 ? 'var(--danger)' : 'inherit' }}>
            {stats.negativeCount} Neg / {stats.deadCount} Dead
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Click to filter negative balances</div>
        </div>
      </div>

      {activeSubTab === 'production' && (
        <ProductionList products={products} onChanged={loadAll} />
      )}

      {activeSubTab === 'adjustments' && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Stock Journal, Adjustment & Inter-Warehouse Transfer</h3>
          <form onSubmit={handlePostStockAdjustment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Adjustment Type</label>
              <select
                className="form-input"
                value={adjForm.adjustmentMode}
                onChange={e => setAdjForm({ ...adjForm, adjustmentMode: e.target.value })}
              >
                <option value="inward">Stock Inward (+ Add Stock)</option>
                <option value="outward">Stock Outward (- Reduce Stock)</option>
                <option value="damage">Damaged / Scrap Write-Off (-)</option>
                {invSettings.multiLocationEnabled && (
                  <option value="transfer">Inter-Warehouse Stock Transfer</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Select Spare Part *</label>
              <select
                className="form-input"
                value={adjForm.productId}
                onChange={e => setAdjForm({ ...adjForm, productId: e.target.value })}
                required
              >
                <option value="">-- Choose Product --</option>
                {products.filter(p => !isServiceProduct(p)).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.oemPartNo ? `[OEM: ${p.oemPartNo}]` : ''} ({p.brand || 'Gen'}) — Stock: {p.stock ?? 0}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Quantity *</label>
              <input
                type="number"
                step="any"
                min="0.01"
                className="form-input"
                value={adjForm.quantity}
                onChange={e => setAdjForm({ ...adjForm, quantity: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="form-input"
                value={adjForm.date}
                onChange={e => setAdjForm({ ...adjForm, date: e.target.value })}
              />
            </div>
            {invSettings.multiLocationEnabled && adjForm.adjustmentMode === 'transfer' && (
              <>
                <div className="form-group">
                  <label className="form-label">From Material Centre</label>
                  <select
                    className="form-input"
                    value={adjForm.fromLocation}
                    onChange={e => setAdjForm({ ...adjForm, fromLocation: e.target.value })}
                  >
                    {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">To Material Centre</label>
                  <select
                    className="form-input"
                    value={adjForm.toLocation}
                    onChange={e => setAdjForm({ ...adjForm, toLocation: e.target.value })}
                  >
                    {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Narration / Reason</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  className="form-input"
                  value={adjForm.reason}
                  onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })}
                  placeholder="Reason for stock movement..."
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  Post Stock Journal
                </button>
              </div>
            </div>
          </form>

          {invSettings.multiLocationEnabled && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Material Centres / Warehouses</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {warehouses.map(w => (
                  <span key={w.id} className="tag" style={{ padding: '4px 10px' }}>{w.name}</span>
                ))}
                <input
                  type="text"
                  className="form-input"
                  style={{ width: 200, padding: '4px 8px' }}
                  placeholder="New warehouse name..."
                  value={newWarehouseName}
                  onChange={e => setNewWarehouseName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    if (!newWarehouseName.trim()) return;
                    await saveWarehouse({ name: newWarehouseName.trim() });
                    setNewWarehouseName('');
                    await loadAll();
                    showToast('Material centre added', 'success');
                  }}
                >
                  + Add Location
                </button>
              </div>
            </div>
          )}

          {/* Recent Stock Journal History */}
          <div style={{ marginTop: 20 }}>
            <h4 style={{ marginBottom: 8 }}>Recent Stock Journal Entries</h4>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher No</th>
                    <th>Spare Part</th>
                    <th>Mode</th>
                    <th>Qty Change</th>
                    <th>Stock Before → After</th>
                    <th>Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.filter(v => v.voucherType === 'Stock Journal').slice(0, 15).map(v => (
                    <tr key={v.id}>
                      <td>{v.date}</td>
                      <td style={{ fontWeight: 600 }}>{v.voucherNo}</td>
                      <td>{v.productName} {v.oemPartNo ? `(${v.oemPartNo})` : ''}</td>
                      <td style={{ textTransform: 'capitalize' }}>{v.adjustmentMode}</td>
                      <td style={{ color: v.delta >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {v.delta >= 0 ? `+${v.quantity}` : `-${v.quantity}`}
                      </td>
                      <td>{v.previousStock} → <strong>{v.newStock}</strong></td>
                      <td>{v.narration}</td>
                    </tr>
                  ))}
                  {vouchers.filter(v => v.voucherType === 'Stock Journal').length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
                        No Stock Journal entries recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'reconcile' && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3>Physical Stock Verification & Reconciliation</h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Enter actual shelf count to automatically calculate variance and post Stock Journal adjustments.
              </p>
            </div>
            <button className="btn btn-primary" onClick={handleCommitReconciliation}>
              Apply Physical Counts
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part Name</th>
                  <th>OEM Part No</th>
                  <th>Brand</th>
                  <th>Rack / Bin</th>
                  <th>System Stock</th>
                  <th>Physical Count</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.filter(p => !isServiceProduct(p)).map(p => {
                  const sys = Number(p.stock) || 0;
                  const physRaw = physicalCounts[p.id];
                  const hasPhys = physRaw !== undefined && physRaw !== '';
                  const variance = hasPhys ? Number(physRaw) - sys : 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td><code>{p.oemPartNo || '—'}</code></td>
                      <td>{p.brand || '—'}</td>
                      <td>{[p.rack, p.binLocation].filter(Boolean).join(' / ') || '—'}</td>
                      <td><strong>{sys}</strong> {p.unit || 'Nos'}</td>
                      <td style={{ width: 140 }}>
                        <input
                          type="number"
                          step="any"
                          className="form-input"
                          placeholder={String(sys)}
                          value={physRaw ?? ''}
                          onChange={e => setPhysicalCounts({ ...physicalCounts, [p.id]: e.target.value })}
                        />
                      </td>
                      <td style={{ fontWeight: 700, color: !hasPhys || variance === 0 ? 'var(--text-muted)' : variance > 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {hasPhys ? (variance > 0 ? `+${variance}` : variance) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'catalog' && (
        <>
          {/* Search & Multi-Attribute Filters */}
          <div className="glass-card" style={{ padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by Part Name, OEM Part No, Mfg/Alt No, SKU, Barcode, Brand, Vehicle Make/Model..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select className="form-input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                {categories.map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>)}
              </select>
              <select className="form-input" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                {brands.map(b => <option key={b} value={b}>{b === 'All' ? 'All Brands' : b}</option>)}
              </select>
              <select className="form-input" value={stockFilter} onChange={e => setStockFilter(e.target.value)}>
                <option value="all">All Stock Status ({enrichedProducts.length})</option>
                <option value="low">Low / Reorder Stock ({stats.lowCount})</option>
                <option value="negative">Negative Stock ({stats.negativeCount})</option>
                <option value="fast">Fast-Moving Parts</option>
                <option value="dead">Dead Stock ({stats.deadCount})</option>
              </select>
            </div>
          </div>

          {bulkMode && (
            <div className="glass-card" style={{ padding: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Bulk Edit Mode Active — edit HSN, GST %, Purchase Price, Retail Price, or Stock inline.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(false); setBulkEdits({}); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveBulkChanges} disabled={bulkSaving}>
                  {bulkSaving ? 'Saving...' : `Save Bulk Changes (${Object.keys(bulkEdits).length})`}
                </button>
              </div>
            </div>
          )}

          {/* Main Products Listing Table — Sale Price (Rate) & Vehicle Fitment removed from main columns and moved to Expandable Detail View */}
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 38 }}></th>
                    <th>Part Name & Identification</th>
                    <th>OEM / Mfg Part No</th>
                    <th>Brand / Make</th>
                    <th>Category</th>
                    <th>HSN</th>
                    <th>GST %</th>
                    <th>Stock & Bin</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const isExpanded = expandedProductId === p.id;
                    const margins = computeProductMargins(p);
                    const rowEdits = bulkEdits[p.id] || {};
                    const stockVal = Number(p.stock) || 0;
                    return (
                      <React.Fragment key={p.id}>
                        <tr
                          onClick={() => !bulkMode && setExpandedProductId(isExpanded ? null : p.id)}
                          style={{
                            cursor: bulkMode ? 'default' : 'pointer',
                            background: isExpanded ? 'var(--bg-hover)' : undefined,
                          }}
                        >
                          <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--primary)' }}>
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td>
                            {bulkMode ? (
                              <input
                                className="form-input"
                                value={rowEdits.name ?? p.name}
                                onChange={e => setBulkEdits({ ...bulkEdits, [p.id]: { ...rowEdits, name: e.target.value } })}
                              />
                            ) : (
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {p.itemCode && <span>Code: {p.itemCode}</span>}
                                  {p.partType && <span>• {p.partType}</span>}
                                  {p.movementClass && p.movementClass !== 'Normal' && (
                                    <span style={{ color: p.movementClass === 'Fast-Moving' ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
                                      • {p.movementClass}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                              {p.oemPartNo || p.alias || p.itemCode || p.sku || '—'}
                            </div>
                            {(p.mfgPartNo || p.altPartNo) && (
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                {p.mfgPartNo ? `Mfg: ${p.mfgPartNo}` : ''} {p.altPartNo ? `Alt: ${p.altPartNo}` : ''}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 500 }}>{p.brand || '—'}</div>
                            {p.manufacturer && p.manufacturer !== p.brand && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{p.manufacturer}</div>
                            )}
                          </td>
                          <td>
                            <div>{p.category || 'General'}</div>
                            {p.subcategory && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{p.subcategory}</div>}
                          </td>
                          <td>
                            {bulkMode ? (
                              <input
                                className="form-input"
                                style={{ width: 90 }}
                                value={rowEdits.hsn ?? p.hsn}
                                onChange={e => setBulkEdits({ ...bulkEdits, [p.id]: { ...rowEdits, hsn: e.target.value } })}
                              />
                            ) : (
                              <code>{p.hsn || '—'}</code>
                            )}
                          </td>
                          <td>
                            {bulkMode ? (
                              <input
                                type="number"
                                className="form-input"
                                style={{ width: 70 }}
                                value={rowEdits.taxPercent ?? p.taxPercent}
                                onChange={e => setBulkEdits({ ...bulkEdits, [p.id]: { ...rowEdits, taxPercent: e.target.value } })}
                              />
                            ) : (
                              <span>{p.taxPercent ?? 18}%</span>
                            )}
                          </td>
                          <td>
                            {bulkMode ? (
                              <input
                                type="number"
                                className="form-input"
                                style={{ width: 90 }}
                                value={rowEdits.stock ?? (p.stock ?? '')}
                                onChange={e => setBulkEdits({ ...bulkEdits, [p.id]: { ...rowEdits, stock: e.target.value } })}
                              />
                            ) : isServiceProduct(p) ? (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Service</span>
                            ) : (
                              <div>
                                <span
                                  style={{
                                    fontWeight: 700,
                                    color: stockVal < 0
                                      ? 'var(--danger)'
                                      : p.isLowStock
                                        ? 'var(--warning)'
                                        : 'var(--success)',
                                  }}
                                >
                                  {stockVal} {p.unit || 'Nos'}
                                </span>
                                {(p.rack || p.binLocation || (invSettings.multiLocationEnabled && p.materialCentre)) && (
                                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                    {[invSettings.multiLocationEnabled ? p.materialCentre : '', p.rack ? `Rack ${p.rack}` : '', p.binLocation ? `Bin ${p.binLocation}` : ''].filter(Boolean).join(' • ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                                title="View Pricing Tiers & Vehicle Fitments"
                              >
                                {isExpanded ? 'Hide Details' : 'Details'}
                              </button>
                              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>
                                Edit
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Product Detail Panel: Pricing Tiers, Vehicle Fitments, Cross-References & Stock Locations */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} style={{ background: 'var(--bg-elevated)', padding: '16px 20px', borderBottom: '2px solid var(--primary)' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                                {/* 1. Multi-Tier Pricing Card */}
                                <div className="glass-card" style={{ padding: 14 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.84rem', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 8 }}>
                                    Pricing Tiers & Margins
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.84rem' }}>
                                    <div>MRP: <strong>{formatCurrency(p.mrp || p.sellingPrice || 0)}</strong></div>
                                    <div>Retail Price: <strong style={{ color: 'var(--success)' }}>{formatCurrency(p.sellingPrice || p.rate || 0)}</strong></div>
                                    <div>Mechanic Price: <strong>{formatCurrency(p.mechanicPrice || p.sellingPrice || 0)}</strong></div>
                                    <div>Wholesale Price: <strong>{formatCurrency(p.wholesalePrice || p.sellingPrice || 0)}</strong></div>
                                    <div>Special Price: <strong>{formatCurrency(p.specialPrice || p.sellingPrice || 0)}</strong></div>
                                    <div>Min Selling: <strong>{formatCurrency(p.minSellingPrice || p.purchasePrice || 0)}</strong></div>
                                    <div>Purchase Cost: <strong>{formatCurrency(p.purchasePrice || 0)}</strong></div>
                                    <div>Margin / Markup: <strong>{margins.marginPercent}% / {margins.markupPercent}%</strong></div>
                                  </div>
                                </div>

                                {/* 2. Vehicle Fitment Hierarchy Card */}
                                <div className="glass-card" style={{ padding: 14 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.84rem', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 8 }}>
                                    Compatible Vehicle Fitments ({p.vehicleFitments?.length || 0})
                                  </div>
                                  {p.vehicleFitments?.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {p.vehicleFitments.map((vf, idx) => (
                                        <div key={idx} style={{ fontSize: '0.83rem', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          <strong>{[vf.make, vf.model, vf.generation].filter(Boolean).join(' → ')}</strong>
                                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                            {[vf.year ? `Year: ${vf.year}` : '', vf.fuelType ? `Fuel: ${vf.fuelType}` : '', vf.engine ? `Engine: ${vf.engine}` : '', vf.variant ? `Variant: ${vf.variant}` : ''].filter(Boolean).join(' • ')}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                                      Universal / No specific vehicle restriction recorded. Click Edit to add Make → Model → Year fitments.
                                    </div>
                                  )}
                                </div>

                                {/* 3. Cross-References & Storage Card */}
                                <div className="glass-card" style={{ padding: 14 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.84rem', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 8 }}>
                                    Cross-References & Bin Location
                                  </div>
                                  <div style={{ fontSize: '0.83rem', display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <div>OEM Part No: <code>{p.oemPartNo || '—'}</code> | Mfg No: <code>{p.mfgPartNo || '—'}</code></div>
                                    <div>Alt Part No: <code>{p.altPartNo || '—'}</code> | Superseded: <code>{p.supersededPartNo || '—'}</code></div>
                                    <div>SKU / Barcode: <code>{p.sku || '—'}</code> / <code>{p.barcode || '—'}</code></div>
                                    <div>Location: <strong>{p.materialCentre || 'Main Store'}</strong> • Rack: <strong>{p.rack || '—'}</strong> • Shelf: <strong>{p.shelf || '—'}</strong> • Bin: <strong>{p.binLocation || '—'}</strong></div>
                                    <div>Available Stock: <strong>{p.availableStock ?? p.stock ?? 0}</strong> (Reserved: {p.reservedStock || 0}, Reorder Level: {p.reorderLevel || 5})</div>
                                    {p.crossReferences?.length > 0 && (
                                      <div style={{ marginTop: 4 }}>
                                        <strong>Cross-Ref Equivalents:</strong>{' '}
                                        {p.crossReferences.map((cr, i) => (
                                          <span key={i} className="tag" style={{ marginRight: 4 }}>
                                            {cr.brand ? `${cr.brand}: ` : ''}{cr.partNo}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        No spare parts match the current filter. Click <strong>+ Add Spare Part (F6)</strong> or <strong>BUSY .DAT Import</strong> to add items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Automotive Product Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 860, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editing ? `Edit Part: ${editing.name}` : 'Add Automotive Spare Part'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {/* Modal Section Tabs */}
            <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <button type="button" className={`btn btn-sm ${modalTab === 'id' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setModalTab('id')}>
                1. Identification & Brand
              </button>
              <button type="button" className={`btn btn-sm ${modalTab === 'pricing' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setModalTab('pricing')}>
                2. Multi-Tier Pricing & GST
              </button>
              <button type="button" className={`btn btn-sm ${modalTab === 'stock' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setModalTab('stock')}>
                3. Stock, Rack & Bin
              </button>
              <button type="button" className={`btn btn-sm ${modalTab === 'fitment' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setModalTab('fitment')}>
                4. Vehicle Fitment & Cross-Ref ({(form.vehicleFitments?.length || 0) + (form.crossReferences?.length || 0)})
              </button>
            </div>

            {dupeWarning && (
              <div className="glass-card" style={{ padding: 12, marginBottom: 14, border: '1px solid var(--warning)', background: 'rgba(245, 158, 11, 0.08)' }}>
                <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>
                  Duplicate Part Detected in Same Brand
                </div>
                <div style={{ fontSize: '0.84rem', marginBottom: 8 }}>
                  {dupeWarning.duplicates.map((d, i) => (
                    <div key={i}>• Matches <strong>{d.product.name}</strong> ({d.product.brand || 'Unbranded'}) — {d.reason}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={(e) => handleSave(e, true)}>
                    Save Anyway as Separate Item
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDupeWarning(null)}>
                    Review Fields
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={e => handleSave(e, false)}>
              {modalTab === 'id' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Product / Spare Part Name *</label>
                    <input
                      className="form-input"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Front Disc Brake Pad Set Swift/Dzire"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Item Type</label>
                    <select className="form-input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                      <option value="goods">Spare Part / Goods</option>
                      <option value="service">Labour / Workshop Service</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">OEM Part Number</label>
                    <input
                      className="form-input"
                      value={form.oemPartNo}
                      onChange={e => setForm({ ...form, oemPartNo: e.target.value })}
                      placeholder="e.g., 55810M75J00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Manufacturer Part No</label>
                    <input
                      className="form-input"
                      value={form.mfgPartNo}
                      onChange={e => setForm({ ...form, mfgPartNo: e.target.value })}
                      placeholder="e.g., KBX-5581"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Alternate / Superseded No</label>
                    <input
                      className="form-input"
                      value={form.altPartNo}
                      onChange={e => setForm({ ...form, altPartNo: e.target.value })}
                      placeholder="e.g., TVS-BP75"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Brand *</label>
                    <input
                      className="form-input"
                      value={form.brand}
                      onChange={e => setForm({ ...form, brand: e.target.value })}
                      placeholder="e.g., Bosch, MGP, Valeo, Mann"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Manufacturer</label>
                    <input
                      className="form-input"
                      value={form.manufacturer}
                      onChange={e => setForm({ ...form, manufacturer: e.target.value })}
                      placeholder="e.g., Bosch Automotive India"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Part Classification</label>
                    <select className="form-input" value={form.partType} onChange={e => setForm({ ...form, partType: e.target.value })}>
                      {PART_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Category / Group</label>
                    <select className="form-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value, productGroup: e.target.value })}>
                      {AUTOMOTIVE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Subcategory</label>
                    <input
                      className="form-input"
                      value={form.subcategory}
                      onChange={e => setForm({ ...form, subcategory: e.target.value })}
                      placeholder="e.g., Front Disc Pads"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Internal Code / SKU</label>
                    <input
                      className="form-input"
                      value={form.itemCode}
                      onChange={e => setForm({ ...form, itemCode: e.target.value, sku: e.target.value })}
                      placeholder="e.g., BP-MS-01"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Barcode / EAN</label>
                    <input
                      className="form-input"
                      value={form.barcode}
                      onChange={e => setForm({ ...form, barcode: e.target.value })}
                      placeholder="Scan or type barcode"
                    />
                  </div>
                </div>
              )}

              {modalTab === 'pricing' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">HSN / SAC Code</label>
                    <input className="form-input" value={form.hsn} onChange={e => setForm({ ...form, hsn: e.target.value })} placeholder="87083000" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">GST Rate (%)</label>
                    <select className="form-input" value={form.taxPercent} onChange={e => setForm({ ...form, taxPercent: Number(e.target.value) })}>
                      {GST_RATES.map(r => <option key={r} value={r}>{r}% GST</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Primary UOM (Unit)</label>
                    <select className="form-input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                      {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Purchase Price (Cost ₹)</label>
                    <input type="number" step="any" className="form-input" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">MRP (₹)</label>
                    <input type="number" step="any" className="form-input" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Retail Selling Price (₹) *</label>
                    <input type="number" step="any" className="form-input" value={form.sellingPrice} onChange={e => setForm({ ...form, sellingPrice: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mechanic / Garage Price (₹)</label>
                    <input type="number" step="any" className="form-input" value={form.mechanicPrice} onChange={e => setForm({ ...form, mechanicPrice: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Wholesale / Dealer Price (₹)</label>
                    <input type="number" step="any" className="form-input" value={form.wholesalePrice} onChange={e => setForm({ ...form, wholesalePrice: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Special Customer Price (₹)</label>
                    <input type="number" step="any" className="form-input" value={form.specialPrice} onChange={e => setForm({ ...form, specialPrice: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Minimum Selling Price (₹)</label>
                    <input type="number" step="any" className="form-input" value={form.minSellingPrice} onChange={e => setForm({ ...form, minSellingPrice: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Default Discount (%)</label>
                    <input type="number" step="any" className="form-input" value={form.discountPercent} onChange={e => setForm({ ...form, discountPercent: e.target.value })} />
                  </div>
                  <div className="glass-card" style={{ padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Live Profit Margin</div>
                    <div style={{ fontWeight: 700, color: 'var(--success)' }}>
                      {formatCurrency(marginsPreview.marginAmount)} ({marginsPreview.marginPercent}% Margin / {marginsPreview.markupPercent}% Markup)
                    </div>
                  </div>
                </div>
              )}

              {modalTab === 'stock' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Opening Stock</label>
                    <input type="number" step="any" className="form-input" value={form.openingStock} onChange={e => setForm({ ...form, openingStock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Current Stock in Hand</label>
                    <input type="number" step="any" className="form-input" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reserved Stock</label>
                    <input type="number" step="any" className="form-input" value={form.reservedStock} onChange={e => setForm({ ...form, reservedStock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Minimum / Reorder Level</label>
                    <input type="number" step="any" className="form-input" value={form.minStock} onChange={e => setForm({ ...form, minStock: e.target.value, reorderLevel: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Maximum Stock Level</label>
                    <input type="number" step="any" className="form-input" value={form.maxStock} onChange={e => setForm({ ...form, maxStock: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reorder Quantity</label>
                    <input type="number" step="any" className="form-input" value={form.reorderQty} onChange={e => setForm({ ...form, reorderQty: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rack Number</label>
                    <input className="form-input" value={form.rack} onChange={e => setForm({ ...form, rack: e.target.value })} placeholder="e.g., R-A1" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Shelf</label>
                    <input className="form-input" value={form.shelf} onChange={e => setForm({ ...form, shelf: e.target.value })} placeholder="e.g., S-02" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Bin Location</label>
                    <input className="form-input" value={form.binLocation} onChange={e => setForm({ ...form, binLocation: e.target.value })} placeholder="e.g., BIN-101" />
                  </div>
                  {invSettings.multiLocationEnabled && (
                    <div className="form-group">
                      <label className="form-label">Material Centre / Warehouse</label>
                      <select className="form-input" value={form.materialCentre} onChange={e => setForm({ ...form, materialCentre: e.target.value })}>
                        {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {modalTab === 'fitment' && (
                <div>
                  <h4 style={{ marginBottom: 8 }}>Vehicle Compatibility Hierarchy (Make → Model → Generation → Year → Fuel → Engine → Variant)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
                    <input className="form-input" placeholder="Make (e.g. Maruti)" value={fitDraft.make} onChange={e => setFitDraft({ ...fitDraft, make: e.target.value })} />
                    <input className="form-input" placeholder="Model (e.g. Swift)" value={fitDraft.model} onChange={e => setFitDraft({ ...fitDraft, model: e.target.value })} />
                    <input className="form-input" placeholder="Gen (e.g. 3rd Gen)" value={fitDraft.generation} onChange={e => setFitDraft({ ...fitDraft, generation: e.target.value })} />
                    <input className="form-input" placeholder="Year (2018-2024)" value={fitDraft.year} onChange={e => setFitDraft({ ...fitDraft, year: e.target.value })} />
                    <select className="form-input" value={fitDraft.fuelType} onChange={e => setFitDraft({ ...fitDraft, fuelType: e.target.value })}>
                      {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input className="form-input" placeholder="Engine (1.2L K12M)" value={fitDraft.engine} onChange={e => setFitDraft({ ...fitDraft, engine: e.target.value })} />
                    <button type="button" className="btn btn-secondary" onClick={addFitmentToForm}>+ Add Fitment</button>
                  </div>

                  {form.vehicleFitments?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                      {form.vehicleFitments.map((vf, i) => (
                        <span key={i} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px' }}>
                          {[vf.make, vf.model, vf.generation, vf.year, vf.fuelType, vf.engine].filter(Boolean).join(' • ')}
                          <button type="button" onClick={() => removeFitmentFromForm(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}

                  <h4 style={{ marginBottom: 8, marginTop: 14 }}>OEM / Aftermarket Cross-Reference Part Numbers</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 10 }}>
                    <input className="form-input" placeholder="Brand (e.g. TVS Girling)" value={crDraft.brand} onChange={e => setCrDraft({ ...crDraft, brand: e.target.value })} />
                    <input className="form-input" placeholder="Equivalent Part No" value={crDraft.partNo} onChange={e => setCrDraft({ ...crDraft, partNo: e.target.value })} />
                    <input className="form-input" placeholder="Notes (e.g. Direct replacement)" value={crDraft.notes} onChange={e => setCrDraft({ ...crDraft, notes: e.target.value })} />
                    <button type="button" className="btn btn-secondary" onClick={addCrossRefToForm}>+ Add Cross-Ref</button>
                  </div>

                  {form.crossReferences?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {form.crossReferences.map((cr, i) => (
                        <span key={i} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px' }}>
                          {cr.brand ? `${cr.brand}: ` : ''}{cr.partNo} {cr.notes ? `(${cr.notes})` : ''}
                          <button type="button" onClick={() => removeCrossRefFromForm(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="modal-footer" style={{ marginTop: 18 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">
                  {editing ? 'Update Spare Part' : 'Save Spare Part'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
