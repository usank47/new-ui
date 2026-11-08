import {
  INVOICE_TYPES,
  SALES_INVOICE_TYPES,
  decodeGstin,
  appliedStock,
  businessKeyOf,
} from '../utils.js';
import { isExportOrSez } from './lut.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Determine whether a line item row has been populated by the user.
 */
export function isRowPopulated(item, index = 0, totalRows = 1) {
  if (!item) return false;
  if (totalRows === 1 && index === 0) return true;
  const hasName = Boolean(String(item.name || '').trim());
  const hasDesc = Boolean(String(item.description || '').trim());
  const hasHsn = Boolean(String(item.hsn || '').trim());
  const hasProduct = Boolean(item.productId);
  const hasRate = Number(item.rate) > 0;
  const hasDiscount = Number(item.discount) > 0;
  const qtyNum = Number(item.quantity);
  const hasNonDefaultQty =
    item.quantity === '' ||
    item.quantity === null ||
    !Number.isFinite(qtyNum) ||
    qtyNum <= 0 ||
    qtyNum !== 1;
  return hasName || hasDesc || hasHsn || hasProduct || hasRate || hasDiscount || hasNonDefaultQty;
}

/**
 * Aggregate stock demand across all rows of an invoice by productId.
 * Supports both aggregateInvoiceStockDemand(items) and aggregateInvoiceStockDemand({ items, products, ... }).
 */
export function aggregateInvoiceStockDemand(arg = {}) {
  const isArrayArg = Array.isArray(arg);
  const items = isArrayArg ? arg : (arg.items || []);
  const products = isArrayArg ? [] : (arg.products || arg.savedProducts || []);
  const invoiceType = isArrayArg ? 'tax-invoice' : (arg.invoiceType || 'tax-invoice');
  const status = isArrayArg ? 'unpaid' : (arg.status || 'unpaid');
  const editingBill = isArrayArg ? null : (arg.editingBill || null);

  const prodById = new Map((products || []).filter(Boolean).map(p => [String(p.id), p]));
  const deductsStock = status !== 'cancelled' && SALES_INVOICE_TYPES.includes(invoiceType);
  const priorApplied = (editingBill && (!editingBill._isDuplicate || editingBill._convertToType))
    ? appliedStock(editingBill)
    : {};

  const byProduct = {};
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i];
    if (!item || item.isCharge || !item.productId) continue;
    const pid = String(item.productId);
    const prod = prodById.get(pid);
    if (prod && prod.kind === 'service') continue;
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!byProduct[pid]) {
      // In appliedStock(bill), stock deducted from inventory is negative (e.g. -4), or if stockDelta was passed directly as positive (e.g. +4), handle both:
      const rawPrior = Number(priorApplied[pid]) || 0;
      const explicitDelta = Number(editingBill?.stockDelta?.[pid]) || 0;
      const alreadyDeducted = rawPrior < 0
        ? Math.abs(rawPrior)
        : (explicitDelta > 0 ? explicitDelta : Math.max(0, rawPrior));
      const currentStock = prod && prod.stock !== undefined && prod.stock !== null ? Number(prod.stock) : null;
      byProduct[pid] = {
        productId: pid,
        productName: prod?.name || item.name || pid,
        totalRequested: 0,
        totalQty: 0,
        alreadyDeducted,
        currentStock,
        effectiveAvailable: currentStock !== null ? currentStock + alreadyDeducted : null,
        reorderLevel: Number(prod?.reorderLevel ?? prod?.minStockLevel) || 0,
        rowIds: [],
        rowIndices: [],
      };
    }
    const nextTotal = Math.round((byProduct[pid].totalRequested + qty) * 10000) / 10000;
    byProduct[pid].totalRequested = nextTotal;
    byProduct[pid].totalQty = nextTotal;
    byProduct[pid].rowIds.push(item.id || String(i));
    byProduct[pid].rowIndices.push(i + 1);
  }

  return {
    deductsStock,
    byProduct,
    get(pid) {
      return byProduct[String(pid)] || undefined;
    },
    has(pid) {
      return Boolean(byProduct[String(pid)]);
    },
  };
}

/**
 * Centralized invoice validation shared by UI save/output paths and server persistence.
 */
export function validateInvoice({
  profile = {},
  client = {},
  details = {},
  items = [],
  totals = null,
  invoiceType = 'tax-invoice',
  invoiceOptions = {},
  taxInclusive = false,
  products = [],
  savedProducts = null,
  inventorySettings = null,
  allowNegativeStock = undefined,
  editingBill = null,
  baseCurrency = 'INR',
} = {}) {
  const effectiveProducts = Array.isArray(savedProducts) && savedProducts.length > 0 ? savedProducts : products;
  const effectiveAllowNeg = allowNegativeStock !== undefined
    ? Boolean(allowNegativeStock)
    : (inventorySettings ? inventorySettings.allowNegativeStock !== false : true);

  const errors = [];
  const warnings = [];
  const rowErrors = {};
  const fieldErrors = {
    client: {},
    details: {},
    items: rowErrors,
    totals: {},
  };

  const addError = ({ fieldId, section, field, flatKey = null, rowId = null, rowIndex = null, message }) => {
    errors.push({ fieldId, section, field, rowId, rowIndex, message });
    if (rowId !== null && section === 'items') {
      if (!rowErrors[rowId]) rowErrors[rowId] = {};
      if (!rowErrors[rowId][field]) rowErrors[rowId][field] = message;
    } else {
      if (section && fieldErrors[section] && !fieldErrors[section][field]) {
        fieldErrors[section][field] = message;
      }
      const key = flatKey || field;
      if (key && !fieldErrors[key]) {
        fieldErrors[key] = message;
      }
    }
  };

  // 1. Customer validation
  const clientName = String(client?.name || '').trim();
  if (!clientName) {
    addError({
      fieldId: 'invoice-client-name',
      section: 'client',
      field: 'name',
      flatKey: 'clientName',
      message: 'Customer name is required before saving.',
    });
  }

  const rawGstin = String(client?.gstin || '').trim().toUpperCase();
  if (rawGstin && (client?.country || profile?.country || 'India') === 'India') {
    const decoded = decodeGstin(rawGstin);
    if (!decoded) {
      addError({
        fieldId: 'invoice-client-gstin',
        section: 'client',
        field: 'gstin',
        flatKey: 'clientGstin',
        message: 'Customer GSTIN must be a valid 15-character GSTIN or leave it blank for unregistered customers.',
      });
    } else if (!decoded.checksumOk) {
      warnings.push(`Customer GSTIN (${rawGstin}) fails the standard GST checksum — verify for typos.`);
    }
  }

  // 2. Invoice Details validation
  const invDate = String(details?.invoiceDate || '').trim();
  if (!invDate || !ISO_DATE_RE.test(invDate) || Number.isNaN(Date.parse(invDate))) {
    addError({
      fieldId: 'invoice-date',
      section: 'details',
      field: 'invoiceDate',
      flatKey: 'invoiceDate',
      message: 'Enter a valid invoice date (YYYY-MM-DD).',
    });
  }

  const dueDate = String(details?.dueDate || '').trim();
  if (dueDate) {
    if (!ISO_DATE_RE.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
      addError({
        fieldId: 'invoice-due-date',
        section: 'details',
        field: 'dueDate',
        flatKey: 'dueDate',
        message: 'Enter a valid due date (YYYY-MM-DD).',
      });
    } else if (invDate && ISO_DATE_RE.test(invDate) && dueDate < invDate) {
      addError({
        fieldId: 'invoice-due-date',
        section: 'details',
        field: 'dueDate',
        flatKey: 'dueDate',
        message: 'Due date cannot be earlier than the invoice date.',
      });
    }
  }

  if (details?.periodFrom && details?.periodTo && details.periodTo < details.periodFrom) {
    addError({
      fieldId: 'invoice-detail-period-to',
      section: 'details',
      field: 'periodTo',
      flatKey: 'periodTo',
      message: 'Service period end date cannot be earlier than the start date.',
    });
  }

  // Foreign currency exchange rate validation
  const activeCurrency = invoiceOptions?.currency || baseCurrency || 'INR';
  if (activeCurrency !== (baseCurrency || 'INR')) {
    const fx = Number(invoiceOptions?.exchangeRate);
    if (invoiceOptions?.exchangeRate !== '' && invoiceOptions?.exchangeRate !== undefined && (!Number.isFinite(fx) || fx <= 0)) {
      addError({
        fieldId: 'invoice-detail-fx-rate',
        section: 'details',
        field: 'exchangeRate',
        flatKey: 'exchangeRate',
        message: `Enter a positive exchange rate for ${activeCurrency}.`,
      });
    }
  }

  // Business state requirement for India GST split
  if (totals?.needsProfileFix) {
    addError({
      fieldId: 'invoice-detail-pos',
      section: 'details',
      field: 'placeOfSupply',
      flatKey: 'placeOfSupply',
      message: 'Business State or GSTIN is required in Settings to determine CGST+SGST vs IGST.',
    });
  }

  // 3. Line Items validation — validate EVERY populated row
  const rowList = Array.isArray(items) ? items : [];
  let validPopulatedRowCount = 0;

  rowList.forEach((item, idx) => {
    const rowId = item?.id || String(idx);
    const rowNum = idx + 1;
    const populated = isRowPopulated(item, idx, rowList.length);
    if (!populated) return;

    const name = String(item?.name || '').trim();
    const rawQty = item?.quantity;
    const qty = Number(rawQty);
    const rawRate = item?.rate;
    const rate = Number(rawRate);
    const rawDiscount = item?.discount ?? 0;
    const discount = Number(rawDiscount);
    const taxPct = Number(item?.taxPercent ?? 0);
    const cessPct = Number(item?.cessPercent ?? 0);
    const isPctDiscount = item?.discountType === 'percent' || item?.discountMode === 'pct' || (!item?.discountType && !item?.discountMode && item?.discount !== undefined && item?.discountBase === undefined);

    let rowOk = true;

    if (!name) {
      rowOk = false;
      addError({
        fieldId: `item-name-${rowId}`,
        section: 'items',
        field: 'name',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum}: Enter an item name or description.`,
      });
    }

    if (rawQty === '' || rawQty === null || !Number.isFinite(qty) || qty <= 0) {
      rowOk = false;
      addError({
        fieldId: `item-qty-${rowId}`,
        section: 'items',
        field: 'quantity',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Quantity must be greater than 0.`,
      });
    }

    if (rawRate === '' || rawRate === null || !Number.isFinite(rate) || rate < 0) {
      rowOk = false;
      addError({
        fieldId: `item-rate-${rowId}`,
        section: 'items',
        field: 'rate',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Rate must be a valid non-negative amount.`,
      });
    } else if (rate === 0 && !item?.isCharge && invoiceType !== 'delivery-challan') {
      rowOk = false;
      addError({
        fieldId: `item-rate-${rowId}`,
        section: 'items',
        field: 'rate',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Enter a rate greater than 0.`,
      });
    }

    if (!Number.isFinite(discount) || discount < 0) {
      rowOk = false;
      addError({
        fieldId: `item-discount-${rowId}`,
        section: 'items',
        field: 'discount',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Discount cannot be negative.`,
      });
    } else if (isPctDiscount && discount > 100) {
      rowOk = false;
      addError({
        fieldId: `item-discount-${rowId}`,
        section: 'items',
        field: 'discount',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Percentage discount cannot exceed 100%.`,
      });
    } else if (!isPctDiscount && Number.isFinite(qty) && qty > 0 && Number.isFinite(rate) && rate > 0) {
      const gross = qty * rate;
      const base = item?.discountBase || (item?.discountMode && item.discountMode !== 'pct' ? item.discountMode : 'net');
      if (base === 'unit' && discount > rate + 0.005) {
        rowOk = false;
        addError({
          fieldId: `item-discount-${rowId}`,
          section: 'items',
          field: 'discount',
          rowId,
          rowIndex: rowNum,
          message: `Row #${rowNum} (${name || 'Item'}): Per-unit discount (${discount}) cannot exceed unit rate (${rate}).`,
        });
      } else if (base === 'net' && discount > gross + 0.005) {
        rowOk = false;
        addError({
          fieldId: `item-discount-${rowId}`,
          section: 'items',
          field: 'discount',
          rowId,
          rowIndex: rowNum,
          message: `Row #${rowNum} (${name || 'Item'}): Discount (${discount}) cannot exceed line amount (${gross.toFixed(2)}).`,
        });
      } else if (base === 'with-tax') {
        const rateFraction = (Math.max(0, taxPct) + Math.max(0, cessPct)) / 100;
        const maxGrossWithTax = taxInclusive ? gross : gross * (1 + rateFraction);
        if (discount > maxGrossWithTax + 0.01) {
          rowOk = false;
          addError({
            fieldId: `item-discount-${rowId}`,
            section: 'items',
            field: 'discount',
            rowId,
            rowIndex: rowNum,
            message: `Row #${rowNum} (${name || 'Item'}): With-tax discount cannot exceed tax-inclusive line total (${maxGrossWithTax.toFixed(2)}).`,
          });
        }
      }
    }

    if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) {
      rowOk = false;
      addError({
        fieldId: `item-tax-${rowId}`,
        section: 'items',
        field: 'taxPercent',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Tax % must be between 0 and 100.`,
      });
    }

    if (!Number.isFinite(cessPct) || cessPct < 0 || cessPct > 500) {
      rowOk = false;
      addError({
        fieldId: `item-cess-${rowId}`,
        section: 'items',
        field: 'cessPercent',
        rowId,
        rowIndex: rowNum,
        message: `Row #${rowNum} (${name || 'Item'}): Cess % must be between 0 and 500.`,
      });
    }

    if (rowOk) {
      validPopulatedRowCount += 1;
    }
  });

  if (validPopulatedRowCount === 0 && errors.filter(e => e.section === 'items').length === 0) {
    const firstId = rowList[0]?.id || '0';
    addError({
      fieldId: `item-name-${firstId}`,
      section: 'items',
      field: 'name',
      rowId: firstId,
      rowIndex: 1,
      message: 'Add at least one line item with a description, quantity, and rate.',
    });
  }

  // 4. Whole-bill discount validation
  const invDiscVal = Number(invoiceOptions?.invoiceDiscountValue || 0);
  if (!Number.isFinite(invDiscVal) || invDiscVal < 0) {
    addError({
      fieldId: 'invoice-bill-discount',
      section: 'totals',
      field: 'invoiceDiscountValue',
      flatKey: 'invoiceDiscountValue',
      message: 'Bill discount cannot be negative.',
    });
  } else if (invoiceOptions?.invoiceDiscountType === 'percent' && invDiscVal > 100) {
    addError({
      fieldId: 'invoice-bill-discount',
      section: 'totals',
      field: 'invoiceDiscountValue',
      flatKey: 'invoiceDiscountValue',
      message: 'Percentage bill discount cannot exceed 100%.',
    });
  }

  // 5. Aggregated Stock Demand Validation (across repeated rows of the same product)
  const { deductsStock, byProduct } = aggregateInvoiceStockDemand({
    items: rowList,
    products: effectiveProducts,
    invoiceType,
    status: editingBill?.status || 'unpaid',
    editingBill,
  });

  if (deductsStock) {
    for (const entry of Object.values(byProduct)) {
      if (entry.effectiveAvailable === null) continue;
      if (entry.totalRequested > entry.effectiveAvailable + 0.0001) {
        const rowLabel = entry.rowIndices.length > 1
          ? `Rows #${entry.rowIndices.join(', #')} (combined qty ${entry.totalRequested})`
          : `Row #${entry.rowIndices[0]} (qty ${entry.totalRequested})`;
        const msg = `Insufficient stock for "${entry.productName}" — ${rowLabel} exceeds available stock (${entry.effectiveAvailable}).`;
        if (!effectiveAllowNeg) {
          for (const rid of entry.rowIds) {
            addError({
              fieldId: `item-qty-${rid}`,
              section: 'items',
              field: 'quantity',
              rowId: rid,
              message: msg,
            });
          }
        } else {
          warnings.push(`${msg} Negative stock will be recorded.`);
        }
      } else if (entry.effectiveAvailable - entry.totalRequested <= entry.reorderLevel && entry.reorderLevel > 0) {
        warnings.push(`Low stock notice: "${entry.productName}" will have ${entry.effectiveAvailable - entry.totalRequested} left (reorder level: ${entry.reorderLevel}).`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldErrors,
    rowErrors,
    warnings,
    firstError: errors[0]?.message || null,
    firstFieldId: errors[0]?.fieldId || null,
    stockDemandByProduct: byProduct,
  };
}

/**
 * Concise, accurate explanation of tax treatment and GSTR-1 return classification.
 * Uses decoded GSTIN validity, export/SEZ rules, Place of Supply, and invoice type
 * rather than checking GSTIN string length alone.
 */
export function describeTaxTreatment({
  profile = {},
  client = {},
  details = {},
  totals = {},
  invoiceType = 'tax-invoice',
  invoiceOptions = {},
  showGST: showGstArg = undefined,
  taxInclusive = false,
} = {}) {
  const showGST = showGstArg !== undefined
    ? Boolean(showGstArg)
    : (invoiceOptions?.showGST !== false && INVOICE_TYPES[invoiceType]?.showGST !== false);
  if (invoiceType === 'bill-of-supply') {
    return {
      code: 'BOS',
      badge: 'Bill of Supply · Exempt / Nil',
      taxSplitLabel: 'No GST',
      taxModeLabel: 'No GST',
      gstinWarning: null,
      explanation: 'Bill of Supply — exempt or non-GST supply. No tax is charged on line items.',
    };
  }
  if (invoiceType === 'composition') {
    return {
      code: 'COMP',
      badge: 'Composition Scheme',
      taxSplitLabel: 'No Tax Collected',
      taxModeLabel: 'No Tax Collected',
      gstinWarning: null,
      explanation: 'Composition taxable person — dealer pays turnover tax directly and cannot collect GST from buyers.',
    };
  }
  if (!showGST) {
    return {
      code: 'NO_GST',
      badge: 'Tax Disabled',
      taxSplitLabel: 'No Tax',
      taxModeLabel: 'No Tax',
      gstinWarning: null,
      explanation: 'Tax column is turned off for this document.',
    };
  }

  const rawGstin = String(client?.gstin || '').trim().toUpperCase();
  const decodedClientGstin = rawGstin ? decodeGstin(rawGstin) : null;
  const hasValidClientGstin = Boolean(decodedClientGstin && decodedClientGstin.checksumOk);
  const gstinWarning = rawGstin && !hasValidClientGstin
    ? (decodedClientGstin
      ? `Customer GSTIN (${rawGstin}) fails the GST checksum — treated as unregistered until corrected.`
      : `Customer GSTIN (${rawGstin}) is not a valid 15-character GSTIN.`)
    : null;

  const exportOrSez = isExportOrSez({ profile, client, details });
  const isInterstate = Boolean(totals?.isInterstate);
  const isUT = Boolean(totals?.isUT);
  const isLUT = Boolean(totals?.isLUT || invoiceOptions?.isLUT);
  const isRcm = Boolean(invoiceOptions?.reverseCharge);
  const grandTotal = Number(totals?.total) || 0;

  const sellerState = profile?.state || (profile?.gstin ? decodeGstin(profile.gstin)?.state : '') || 'Seller State';
  const supplyState = details?.placeOfSupply || client?.state || decodedClientGstin?.state || sellerState;

  if (exportOrSez) {
    const kind = client?.isSEZ ? 'SEZ Supply' : 'Export Supply';
    return {
      code: 'EXP_6A',
      badge: `${kind} · GSTR-1 Table 6A`,
      taxSplitLabel: isLUT ? 'Zero-Rated (LUT)' : 'IGST',
      taxModeLabel: isLUT ? 'Zero-Rated (LUT)' : 'IGST (With Tax)',
      gstinWarning,
      explanation: isLUT
        ? `${kind} under LUT without payment of IGST (Zero-rated supply).`
        : `${kind} with payment of IGST (${supplyState || 'Outside India'}).`,
    };
  }

  const taxSplitLabel = isInterstate
    ? 'IGST'
    : isUT
      ? 'CGST + UTGST'
      : 'CGST + SGST';

  const taxModeLabel = isInterstate
    ? 'IGST (Inter-state)'
    : isUT
      ? 'CGST + UTGST (Union Territory)'
      : 'CGST + SGST (Intra-state)';

  let returnBucket = 'B2CS · Table 7';
  let code = 'B2CS';
  if (hasValidClientGstin) {
    returnBucket = isRcm ? 'B2B Reverse Charge · Table 4B' : 'B2B Regular · Table 4A';
    code = isRcm ? 'B2B_RCM' : 'B2B';
  } else if (isInterstate && grandTotal > 100000) {
    returnBucket = 'B2CL (> ₹1L Inter-state) · Table 5A';
    code = 'B2CL';
  }

  const routeDesc = isInterstate
    ? `Inter-state supply (${sellerState} → ${supplyState || 'Other State'}): charges ${taxModeLabel}`
    : `Intra-state supply (${supplyState || sellerState}): splits tax equally into ${taxModeLabel}`;

  const suffix = [
    taxInclusive ? 'Rates are tax-inclusive' : 'Rates are tax-exclusive',
    isRcm ? 'Reverse Charge (recipient pays GST)' : null,
  ].filter(Boolean).join(' · ');

  return {
    code,
    badge: returnBucket,
    taxSplitLabel,
    taxModeLabel,
    gstinWarning,
    explanation: `${routeDesc}. ${suffix}.`,
  };
}

/* ============================================================================
   SCOPED RECOVERABLE DRAFTS (By Company & Document Scope)
   ============================================================================ */

const SCOPED_DRAFTS_KEY = 'fgsb_scoped_invoice_drafts_v2';
const LEGACY_DRAFT_KEY = 'gst_invoiceDraft';

function getDefaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch { /* ignore */ }
  return null;
}

function resolveBizKey(profileOrKey) {
  if (typeof profileOrKey === 'string' && profileOrKey.trim()) return profileOrKey.trim();
  if (profileOrKey && typeof profileOrKey === 'object') {
    if (typeof profileOrKey.businessKey === 'string' && profileOrKey.businessKey.trim()) {
      return profileOrKey.businessKey.trim();
    }
    return businessKeyOf(profileOrKey) || 'default_company';
  }
  return 'default_company';
}

export function getDraftScopeKey(profileOrOpts, editingBill = null, draftId = 'current') {
  if (
    profileOrOpts &&
    typeof profileOrOpts === 'object' &&
    ('businessKey' in profileOrOpts || 'editingBillId' in profileOrOpts)
  ) {
    const biz = resolveBizKey(profileOrOpts.businessKey || profileOrOpts.profile);
    const editId = profileOrOpts.editingBillId || (profileOrOpts.editingBill && !profileOrOpts.editingBill._isDuplicate ? profileOrOpts.editingBill.id : null);
    if (editId) return `${biz}::edit::${editId}`;
    return `${biz}::new::${profileOrOpts.draftId || 'current'}`;
  }
  const biz = resolveBizKey(profileOrOpts);
  if (editingBill && !editingBill._isDuplicate && editingBill.id) {
    return `${biz}::edit::${editingBill.id}`;
  }
  if (typeof editingBill === 'string' && editingBill.trim()) {
    return `${biz}::edit::${editingBill.trim()}`;
  }
  return `${biz}::new::${draftId || 'current'}`;
}

export function readAllScopedDrafts(customStorage = null) {
  const store = customStorage || getDefaultStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(SCOPED_DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveScopedDraft(arg1, editingBill = null, draftData = null, draftId = 'current') {
  const isOptionsObj =
    arg1 &&
    typeof arg1 === 'object' &&
    ('payload' in arg1 || 'businessKey' in arg1 || 'editingBillId' in arg1 || 'storage' in arg1) &&
    draftData === null;

  const store = isOptionsObj ? (arg1.storage || getDefaultStorage()) : getDefaultStorage();
  const bizKey = isOptionsObj ? resolveBizKey(arg1.businessKey || arg1.profile) : resolveBizKey(arg1);
  const editBillObj = isOptionsObj
    ? (arg1.editingBillId ? { id: arg1.editingBillId } : (arg1.editingBill || null))
    : editingBill;
  const payload = isOptionsObj ? (arg1.payload || arg1.draftData || {}) : (draftData || {});
  const scopeKey = getDraftScopeKey(bizKey, editBillObj, isOptionsObj ? (arg1.draftId || 'current') : draftId);

  const entry = {
    scopeKey,
    businessKey: bizKey,
    isEdit: Boolean(editBillObj && !editBillObj._isDuplicate && editBillObj.id),
    editingBillId: editBillObj && !editBillObj._isDuplicate ? editBillObj.id : null,
    updatedAt: new Date().toISOString(),
    clientName: String(payload?.client?.name || '').trim(),
    invoiceNumber: String(payload?.details?.invoiceNumber || '').trim(),
    invoiceType: payload?.invoiceType || 'tax-invoice',
    totalAmount: Number(payload?.totalAmount ?? payload?.totals?.total) || 0,
    itemCount: Array.isArray(payload?.items)
      ? payload.items.filter(i => String(i?.name || '').trim() || Number(i?.rate) > 0).length
      : 0,
    data: payload,
  };

  try {
    if (!store) {
      return { ok: false, quotaError: true, error: 'Browser storage is unavailable.' };
    }
    const all = readAllScopedDrafts(store);
    all[scopeKey] = entry;
    const keys = Object.keys(all);
    if (keys.length > 25) {
      keys
        .sort((a, b) => String(all[a]?.updatedAt || '').localeCompare(String(all[b]?.updatedAt || '')))
        .slice(0, keys.length - 25)
        .forEach(k => { delete all[k]; });
    }
    store.setItem(SCOPED_DRAFTS_KEY, JSON.stringify(all));
    if (!isOptionsObj) {
      try {
        sessionStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify(payload));
      } catch { /* ignore */ }
    }
    return { ok: true, scopeKey, entry };
  } catch (err) {
    const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
    return {
      ok: false,
      quotaError: Boolean(isQuota),
      error: isQuota
        ? 'Local draft storage is full. Your current invoice remains in memory — please save it directly.'
        : (err?.message || 'Could not write local draft.'),
    };
  }
}

export function loadScopedDraft(arg1, editingBill = null, draftId = 'current') {
  const isOptionsObj =
    arg1 &&
    typeof arg1 === 'object' &&
    ('businessKey' in arg1 || 'editingBillId' in arg1 || 'storage' in arg1);

  const store = isOptionsObj ? (arg1.storage || getDefaultStorage()) : getDefaultStorage();
  const bizKey = isOptionsObj ? resolveBizKey(arg1.businessKey || arg1.profile) : resolveBizKey(arg1);
  const editBillObj = isOptionsObj
    ? (arg1.editingBillId ? { id: arg1.editingBillId } : (arg1.editingBill || null))
    : editingBill;
  const scopeKey = getDraftScopeKey(bizKey, editBillObj, isOptionsObj ? (arg1.draftId || 'current') : draftId);

  const all = readAllScopedDrafts(store);
  if (all[scopeKey]?.data) {
    return isOptionsObj ? all[scopeKey].data : all[scopeKey];
  }
  if (!editBillObj && !isOptionsObj) {
    try {
      const raw = sessionStorage.getItem(LEGACY_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed._businessKey || parsed._businessKey === bizKey) {
          return {
            scopeKey,
            businessKey: bizKey,
            isEdit: false,
            updatedAt: parsed._updatedAt || null,
            clientName: String(parsed?.client?.name || '').trim(),
            invoiceNumber: String(parsed?.details?.invoiceNumber || '').trim(),
            invoiceType: parsed?.invoiceType || 'tax-invoice',
            totalAmount: Number(parsed?.totalAmount) || 0,
            data: parsed,
          };
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

export function listCompanyDrafts(profileOrBizKey, customStorage = null) {
  const bizKey = resolveBizKey(profileOrBizKey);
  const all = readAllScopedDrafts(customStorage);
  return Object.values(all)
    .filter(d => d && d.businessKey === bizKey && (d.clientName || d.itemCount > 0 || d.totalAmount > 0 || d.data))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function deleteScopedDraft(arg1, editingBill = null, draftId = 'current') {
  const isOptionsObj =
    arg1 &&
    typeof arg1 === 'object' &&
    ('businessKey' in arg1 || 'editingBillId' in arg1 || 'storage' in arg1);

  const store = isOptionsObj ? (arg1.storage || getDefaultStorage()) : getDefaultStorage();
  const bizKey = isOptionsObj ? resolveBizKey(arg1.businessKey || arg1.profile) : resolveBizKey(arg1);
  const editBillObj = isOptionsObj
    ? (arg1.editingBillId ? { id: arg1.editingBillId } : (arg1.editingBill || null))
    : editingBill;
  const scopeKey = getDraftScopeKey(bizKey, editBillObj, isOptionsObj ? (arg1.draftId || 'current') : draftId);

  try {
    if (store) {
      const all = readAllScopedDrafts(store);
      if (scopeKey in all) {
        delete all[scopeKey];
        store.setItem(SCOPED_DRAFTS_KEY, JSON.stringify(all));
      }
    }
    if (!isOptionsObj) {
      sessionStorage.removeItem(LEGACY_DRAFT_KEY);
    }
  } catch { /* ignore */ }
}
