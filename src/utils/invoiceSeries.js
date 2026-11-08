// Multiple Invoice & Voucher Series Engine (CGST Rule 46 Compliant)

const STORAGE_KEY = 'gst_erp_invoice_series_v1';

export const DEFAULT_INVOICE_SERIES = [
  {
    id: 'series_ma',
    code: 'MA',
    name: 'Main GST Series',
    docType: 'Tax Invoice (B2B / B2C)',
    prefix: 'MA/',
    suffix: '/26-27',
    nextNo: 2,
    pad: 0,
    mode: 'Standard Form',
    tier: 'Workshop / Wholesale',
    godown: 'Main Godown',
    bank: 'PRAGYAN ENTERPRISES INDUSIND',
    gstTable: 'GSTR-1 Table 4A/7',
  },
  {
    id: 'series_b2b',
    code: 'B2B',
    name: 'Wholesale Workshop B2B',
    docType: 'Tax Invoice (B2B)',
    prefix: 'PE/B2B/26-27/',
    suffix: '',
    nextNo: 105,
    pad: 4,
    mode: 'Standard Form',
    tier: 'Workshop / Wholesale',
    godown: 'Main Godown',
    bank: 'PRAGYAN ENTERPRISES INDUSIND',
    gstTable: 'GSTR-1 Table 4A (B2B)',
  },
  {
    id: 'series_pos',
    code: 'POS',
    name: 'Counter Fast POS Series',
    docType: 'POS Retail Invoice',
    prefix: 'POS/26-27/',
    suffix: '',
    nextNo: 513,
    pad: 4,
    mode: 'POS Fast Mode',
    tier: 'Counter Retail',
    godown: 'Counter Rack A',
    bank: 'Cash-in-Hand',
    gstTable: 'GSTR-1 Table 7 (B2CS)',
  },
  {
    id: 'series_igst',
    code: 'IGST',
    name: 'Inter-State Outstation',
    docType: 'Inter-State Tax Invoice',
    prefix: 'IGST/',
    suffix: '/26-27',
    nextNo: 42,
    pad: 3,
    mode: 'Standard Form',
    tier: 'Workshop / Wholesale',
    godown: 'Main Godown',
    bank: 'AXIS BANK SAVING ACCOUNT',
    gstTable: 'GSTR-1 Table 4A / 5A (IGST)',
  },
  {
    id: 'series_est',
    code: 'EST',
    name: 'Workshop Proforma / Estimate',
    docType: 'Proforma / Estimate',
    prefix: 'EST/26-27/',
    suffix: '',
    nextNo: 89,
    pad: 3,
    mode: 'Proforma / Quote',
    tier: 'Counter Retail',
    godown: 'Main Godown',
    bank: 'Cash-in-Hand',
    gstTable: 'Non-GST (No GSTR-1 Impact)',
  },
];

export function formatSeriesNumber(series, customNo) {
  if (!series) return 'MA/2/26-27';
  const rawNo = Math.max(1, Number(customNo !== undefined ? customNo : (series.nextNo ?? series.nextNumber)) || 1);
  const padLen = Math.max(0, Number(series.pad ?? series.padding) || 0);
  const numStr = padLen > 0 ? String(rawNo).padStart(padLen, '0') : String(rawNo);
  const prefix = series.prefix || '';
  const suffix = series.suffix || '';
  return `${prefix}${numStr}${suffix}`;
}

export function getInvoiceSeriesList() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_INVOICE_SERIES.map((s) => ({ ...s }));
}

export function saveInvoiceSeriesList(list) {
  const safeList = Array.isArray(list) && list.length > 0 ? list : DEFAULT_INVOICE_SERIES;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeList));
    }
  } catch {
    // ignore storage errors
  }
  return safeList;
}

export function peekSeriesNumber(codeOrId = 'MA') {
  const list = getInvoiceSeriesList();
  const series = list.find((s) => s.code === codeOrId || s.id === codeOrId) || list[0] || DEFAULT_INVOICE_SERIES[0];
  return formatSeriesNumber(series);
}

export function consumeSeriesNumber(codeOrId = 'MA') {
  const list = getInvoiceSeriesList();
  const idx = list.findIndex((s) => s.code === codeOrId || s.id === codeOrId);
  const targetIdx = idx >= 0 ? idx : 0;
  const target = list[targetIdx];
  const formatted = formatSeriesNumber(target);
  const updated = list.map((s, i) => (i === targetIdx ? { ...s, nextNo: (Number(s.nextNo) || 1) + 1 } : s));
  saveInvoiceSeriesList(updated);
  return {
    invoiceNumber: formatted,
    series: updated[targetIdx],
    seriesList: updated,
  };
}
