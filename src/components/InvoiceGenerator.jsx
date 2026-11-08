import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Maximize2, ArrowLeft, Plus, Trash2, Download, UserPlus, Pencil, Settings, ChevronUp, ChevronDown, MessageCircle, Check, Loader, Truck, Printer, Eye, EyeOff, QrCode, Copy, AlertCircle, FileCheck, MoreHorizontal, RotateCcw, Table, LayoutList } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { saveBill, commitBillTransaction, getNextInvoiceNumber, getTermsTemplates, getAllClients, saveClient, getProfile, getAllProducts, getInvoiceDisplayOptions, saveInvoiceDisplayOptions, getAllProfiles, getRegionMode, saveRecurring, getAllRecurring, getAllBills, getEnabledModules, getBusinessType, getInventorySettingsSync } from '../store';
import { PRICE_TIERS, normalizePriceTier, getPriceForCustomerType, inspectTierPriceImpact, applyTierPricingToItems, productMatchesSearch, decodeHtmlEntities } from '../utils/products';
import { validateInvoice, describeTaxTreatment, saveScopedDraft, loadScopedDraft, listCompanyDrafts, deleteScopedDraft } from '../utils/invoiceValidation';
import { getInvoiceSeriesList, peekSeriesNumber } from '../utils/invoiceSeries';
import { INVOICE_TYPES, isModuleEnabled, businessKeyOf, GST_DOC_NUMBER, COUNTRIES, printedSubtotal, deliveryChargeLine, stockEffect, appliedStock, stockDelta, generateEWayBillJSON, formatCurrency, getCountryConfig, getStatesForCountry, getAllUnits, addCustomUnit, removeCustomUnit, getCountriesForRegion, TDS_SECTIONS, TCS_SECTIONS, REMOVED_TCS_SECTIONS, TERMS_PRESETS, getActiveAccounts, getDefaultAccount, getAccountById, getDefaultUnitForMode, filterUnitsByMode, PAPER_SIZES, getPaperSize, computeInvoiceTotals, calculateLineItemTax, clientYearToDate, htmlHasText, ORDER_DETAIL_FIELDS, invoiceOptionOn, DEFAULT_DECLARATION, decodeGstin, safePageBoundaries, localToday, toLocalIsoDate, parseLocalDate, paymentStatusFor, getStateCode } from '../utils';
import { getPrintSettings, savePrintSettings } from '../utils/printSettings';
import { openWhatsAppShare } from '../utils/share';
import { confirmAction, promptAction } from './ConfirmModal';
import { useCostCentres } from './useCostCentres';
import { CostCentreSelect } from './CostCentrePicker';
import { centreFields } from '../utils/costCentres';
import { isExportOrSez, lutCoversDate, normaliseLutArn, fyOf } from '../utils/lut';
import { PURPOSE_CODES } from '../utils/purposeCodes';
import { baseCurrencyOf, currencyForClient, isForeignClient } from '../utils/fx';
import InvoiceCurrency from './InvoiceCurrency';
import PrintPreviewModal from './PrintPreviewModal';
import { ensureToken, findOrCreateFolder, uploadPDF } from '../services/googleDrive';
import { isOfflineMode } from '../utils/offlineMode';
import DOMPurify from 'dompurify';
import InvoicePreview from './InvoicePreview';
import { suggestGstRate, autoFillRate, rateText } from '../utils/hsnRates';
import HelpButton from './HelpButton';
import { getClientCredit, planCreditApplication } from '../utils/clientCredit';
import ClientModal from './ClientModal';
import { EInvoiceEditorModal } from './EInvoiceModal';
import { toast } from './Toast';

// Rich text editor component that works with contentEditable properly
function RichEditor({ value, onChange, placeholder, toolbar = false }) {
  const ref = useRef(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (ref.current && !isInitialized.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
      isInitialized.current = true;
    }
  }, []);

  // Update if value changes externally (e.g. draft restore, editing bill)
  useEffect(() => {
    if (ref.current && isInitialized.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (ref.current) {
      onChange(ref.current.innerHTML);
    }
  }, [onChange]);

  // Toolbar formatting via document.execCommand. The existing innerHTML setters above
  // already wrap user content with DOMPurify.sanitize(), and the toolbar only emits
  // standard formatting tags that the same sanitizer keeps.
  const applyFormat = (cmd, val) => {
    if (ref.current) ref.current.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const btnStyle = { padding: '0.2rem 0.5rem', fontSize: '0.78rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', minWidth: '28px' };

  return (
    <>
      {toolbar && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          <button type="button" onClick={() => applyFormat('bold')}        title="Bold (Ctrl+B)"      style={{ ...btnStyle, fontWeight: 700 }}>B</button>
          <button type="button" onClick={() => applyFormat('italic')}      title="Italic (Ctrl+I)"    style={{ ...btnStyle, fontStyle: 'italic' }}>I</button>
          <button type="button" onClick={() => applyFormat('underline')}   title="Underline (Ctrl+U)" style={{ ...btnStyle, textDecoration: 'underline' }}>U</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('insertUnorderedList')} title="Bullet list"  style={btnStyle}>•&nbsp;List</button>
          <button type="button" onClick={() => applyFormat('insertOrderedList')}   title="Numbered list" style={btnStyle}>1.&nbsp;List</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('formatBlock', '<h4>')}  title="Heading"   style={{ ...btnStyle, fontWeight: 700, fontSize: '0.85rem' }}>H</button>
          <button type="button" onClick={() => applyFormat('formatBlock', '<p>')}   title="Paragraph" style={btnStyle}>¶</button>
          <button type="button" onClick={async () => {
            const url = await promptAction({
              title: 'Insert link',
              message: 'Paste the URL to link to. Selected text will become the link.',
              placeholder: 'https://example.com',
              confirmLabel: 'Insert',
            });
            if (url) applyFormat('createLink', url);
          }} title="Insert link" style={btnStyle}>🔗</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('removeFormat')} title="Clear formatting" style={btnStyle}>✕</button>
        </div>
      )}
      <div ref={ref} contentEditable suppressContentEditableWarning
        className="form-input rich-editor"
        onInput={handleInput}
        style={{ minHeight: '100px', whiteSpace: 'pre-wrap' }}
        data-placeholder={placeholder} />
    </>
  );
}

const DEFAULT_OPTIONS = {
  showGST: true,
  showState: true,
  showGSTIN: true,
  showPlaceOfSupply: true,
  showHSN: true,
  showDiscount: true,
  showBankDetails: true,
  showUPI: true,
  showLogo: true,
  showSignature: true,
  showTerms: true,
  showNotes: true,
  showAmountWords: true,
  showDueDate: true,
  showItemQty: true,
  showRoundOff: true, // v1.10.75 - on for new installs; a saved choice still wins
  invoiceMode: 'goods',    // 'goods' | 'services' | 'mixed' — drives default unit + dropdown filter
  paperSize: 'a4',
  thermalFontSize: 'medium',
  thermalCompact: false,
  thermalCutMark: true,
  recurring: null,         // null OR { enabled, frequency, interval, nextDate, endMode, endDate, maxOccurrences }
  showCess: false,         // when true, exposes per-line Cess % input (India-only)
  reverseCharge: false,    // when true, GST is paid by the recipient (Section 9(3)/9(4))
  showTDS: false,
  tdsSection: '194Q',
  tdsRate: 0.1,
  tdsCumulativeThisYear: 0,
  showTCS: false,
  tcsSection: '52',
  tcsRate: 0.5, // CGST section 52: 0.5% since 10 July 2024
  tcsCumulativeThisYear: 0,
  customTitle: '',
  currency: 'INR',
  exchangeRate: '',
  selectedAccountId: null,   // null ⇒ resolve via last-used / default / first-active at render time
  showAccountLabel: false,   // when true, prints "Pay via: <account label>" above the bank block
  accentColor: '',
  pdfStyle: 'classic',
  invoiceDiscountValue: 0,
  invoiceDiscountType: 'fixed', // 'fixed' | 'percent'
  autoApplyClientCredit: false,
};

const LUT_OPTION_KEYS = ['isLUT', 'lutArn', 'lutFy', 'lutManual', 'tdsRecorded'];
const GOODS_ONLY_DETAILS = ['vehicleNo', 'deliveryNote', 'deliveryNoteDate', 'dispatchDocNo', 'dispatchedThrough', 'destination', 'deliveryTerms'];
const stripLutOptions = (o) => { LUT_OPTION_KEYS.forEach((k) => { delete o[k]; }); return o; };
const lutOptionsOf = (o) => Object.fromEntries(LUT_OPTION_KEYS.filter((k) => k in (o || {})).map((k) => [k, o[k]]));

const ACCENT_PRESETS = [
  { color: '#1e40af', label: 'Blue' },
  { color: '#7c3aed', label: 'Purple' },
  { color: '#0f766e', label: 'Teal' },
  { color: '#be123c', label: 'Red' },
  { color: '#c2410c', label: 'Orange' },
  { color: '#15803d', label: 'Green' },
  { color: '#0369a1', label: 'Sky' },
  { color: '#1e293b', label: 'Dark' },
];

const OPTION_GROUP_HELP = {
  'Header & branding': 'invoice-options#show-header',
  'Client / Bill-to': 'invoice-options#show-client',
  'Invoice meta': 'invoice-options#show-meta',
  'Items table': 'invoice-options#show-items',
  'Totals': 'invoice-options#show-totals',
  'Compliance flags (India)': 'invoices#reverse-charge',
  'Footer': 'invoice-options#show-footer',
};

const PDF_STYLES = [
  { id: 'classic', label: 'Classic', desc: 'Clean with top accent bar' },
  { id: 'modern', label: 'Modern', desc: 'Bold header with color block' },
  { id: 'minimal', label: 'Minimal', desc: 'Simple, borderless layout' },
  { id: 'boxed', label: 'Boxed grid', desc: 'Every section in ruled boxes, item table filled to a fixed height' },
  { id: 'tally', label: 'Tally style', desc: 'The Tally layout: order and dispatch boxes, HSN tax summary, declaration' },
];

const currencySymbolFor = (code) =>
  COUNTRIES.find(c => c.currency === (code || 'INR'))?.currencySymbol || code || '₹';

function SuggestingInput({ item, suggestions, onFieldChange, onSelectProduct, onSetProductSearch, currency, activeRateTier = 'retail', errorMsg }) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const boxRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [item.name]);

  useEffect(() => { setActiveIdx(-1); }, [item.name, suggestions.length]);

  // Deterministic outside-click dismissal (replaces fragile setTimeout blur race)
  useEffect(() => {
    if (!suggestions.length) return undefined;
    const handleDocPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        onSetProductSearch({ itemId: null, query: '' });
      }
    };
    document.addEventListener('mousedown', handleDocPointerDown);
    return () => document.removeEventListener('mousedown', handleDocPointerDown);
  }, [suggestions.length, onSetProductSearch]);

  const commit = (idx) => {
    const pick = suggestions[idx] ?? suggestions[0];
    if (pick) onSelectProduct(item.id, pick);
  };
  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && activeIdx < 0) e.preventDefault();
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        commit(activeIdx);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onSetProductSearch({ itemId: null, query: '' });
    }
  };
  const inputId = `item-name-${item.id}`;
  const errId = `item-name-err-${item.id}`;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <textarea
        id={inputId}
        ref={boxRef}
        rows={1}
        className={`form-input line-item-name${errorMsg ? ' input-invalid' : ''}`}
        value={item.name}
        placeholder="Search part / item name or OEM number…"
        aria-invalid={Boolean(errorMsg)}
        aria-describedby={errorMsg ? errId : undefined}
        onChange={(e) => onFieldChange(item.id, 'name', e.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={handleKey}
        autoComplete="off"
      />
      {errorMsg && (
        <div id={errId} className="field-error-text" role="alert">{errorMsg}</div>
      )}
      {suggestions.length > 0 && (
        <div className="product-suggestions" role="listbox" aria-label="Matching catalog items">
          {suggestions.map((p, i) => {
            const tierInfo = getPriceForCustomerType(p, activeRateTier);
            const displayPrice = tierInfo.price || Number(p.rate) || 0;
            const hasStock = p.stock !== null && p.stock !== undefined && p.stock !== '';
            const stockVal = hasStock ? Number(p.stock) : null;
            return (
              <div
                key={p.id}
                className="product-suggestion-item"
                role="option"
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectProduct(item.id, p);
                }}
                style={i === activeIdx ? { background: 'var(--primary-light, rgba(30,64,175,0.12))' } : undefined}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span className="product-suggestion-name">{decodeHtmlEntities(p.name)}</span>
                  {(p.partNumber || p.sku || p.brand) && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {[p.partNumber || p.sku, p.brand].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <span className="product-suggestion-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {hasStock && (
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: stockVal <= 0 ? '#fef2f2' : '#f0fdf4',
                      color: stockVal <= 0 ? '#dc2626' : '#15803d',
                      border: `1px solid ${stockVal <= 0 ? '#fecaca' : '#bbf7d0'}`,
                    }}>
                      Stock: {stockVal}
                    </span>
                  )}
                  {p.hsn && <span>HSN {p.hsn}</span>}
                  {displayPrice > 0 && (
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                      {formatCurrency(displayPrice, currency || 'INR')}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LineItem = memo(function LineItem({
  item, rowIndex = 0, totalRows = 1, invoiceOptions, showGST, taxLabel, taxInclusive = false, isInterstate = false,
  units, countryTaxRates, filterUnitsByMode, invoiceMode,
  currency, profileCountry, suggestions, activeRateTier = 'retail',
  onFieldChange, onSelectProduct, onSetProductSearch,
  onAddCustomUnit, onRemoveCustomUnit, onRemove, onDuplicate, onMoveRow, onResetTierPrice, clampNonNeg,
  isLastRow, onAddRow, isOnlyRow, rowErrors = {}, viewMode = 'cards',
}) {
  const handleRowKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || !isLastRow) return;
    const hasContent = (item.name && item.name.trim()) || Number(item.rate) > 0 || Number(item.quantity) > 0;
    if (!hasContent) return;
    e.preventDefault();
    onAddRow?.();
  };

  // Compute live line item breakdown so the user always sees Taxable, Tax Amt, and Line Total right inside the row
  const lineCalc = useMemo(() => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const rate = Math.max(0, Number(item.rate) || 0);
    const disc = Math.max(0, Number(item.discount) || 0);
    const taxPct = showGST ? Math.max(0, Number(item.taxPercent) || 0) : 0;
    const cessPct = (showGST && invoiceOptions.showCess) ? Math.max(0, Number(item.cessPercent) || 0) : 0;
    return calculateLineItemTax(
      qty,
      rate,
      disc,
      taxPct,
      isInterstate,
      taxInclusive,
      item.discountType || 'fixed',
      cessPct,
      item.discountBase || 'net',
      item.withTaxRule || 2
    );
  }, [item.quantity, item.rate, item.discount, item.discountType, item.discountBase, item.withTaxRule, item.taxPercent, item.cessPercent, showGST, invoiceOptions.showCess, isInterstate, taxInclusive]);

  const taxSum = (lineCalc.cgst || 0) + (lineCalc.sgst || 0) + (lineCalc.igst || 0) + (lineCalc.cess || 0);
  const priceSourceLabel = item.priceSource === 'manual'
    ? 'Manual'
    : (item.priceTierLabel || (item.productId ? (PRICE_TIERS.find(t => t.id === normalizePriceTier(activeRateTier))?.shortLabel || 'Retail') : null));

  return (
    <div
      className={`line-item-row${viewMode === 'table' ? ' line-item-row-compact' : ''}${Object.keys(rowErrors).length > 0 ? ' line-item-row-invalid' : ''}`}
      data-item-id={item.id}
      onKeyDown={handleRowKeyDown}
    >
      <div className="line-item-field" style={{ flex: 2.4, minWidth: 210, position: 'relative' }}>
        <label className="form-label" htmlFor={`item-name-${item.id}`}>
          #{rowIndex + 1} Item {item.productId ? <span style={{ fontSize: '0.66rem', color: '#059669', fontWeight: 600 }}>• Catalog</span> : null}
        </label>
        <SuggestingInput
          item={item}
          suggestions={suggestions}
          onFieldChange={onFieldChange}
          onSelectProduct={onSelectProduct}
          onSetProductSearch={onSetProductSearch}
          currency={currency}
          activeRateTier={activeRateTier}
          errorMsg={rowErrors.name}
        />
      </div>
      {invoiceOptions.showHSN && (
        <div className="line-item-field" style={{ flex: 0.9, minWidth: 92, position: 'relative' }}>
          <label className="form-label" htmlFor={`item-hsn-${item.id}`}>{invoiceMode === 'services' ? 'SAC' : 'HSN/SAC'}</label>
          <input id={`item-hsn-${item.id}`} type="text" className="form-input" value={item.hsn}
            onChange={(e) => {
              const val = e.target.value;
              onFieldChange(item.id, 'hsn', val);
              const suggested = autoFillRate(val);
              if (suggested !== null && (item.taxPercent === undefined || item.taxPercent === 18 || item.taxPercent === 0)) {
                onFieldChange(item.id, 'taxPercent', suggested);
              }
            }} />
          {(() => {
            const s = suggestGstRate(item.hsn);
            if (!s || !item.hsn || String(item.hsn).length < 4) return null;
            return (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, padding: '2px 5px', fontSize: '0.66rem', color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 1 }}
                title={`${s.label} — ${rateText(s)} is the usual rate since 22 Sep 2025 - check yours`}>
                → {rateText(s)} · {s.label}
              </div>
            );
          })()}
        </div>
      )}
      <div className="line-item-field" style={{ flex: 0.7, minWidth: 74 }}>
        <label className="form-label" htmlFor={`item-qty-${item.id}`}>Qty</label>
        <input
          id={`item-qty-${item.id}`}
          type="number"
          min="0"
          step="any"
          className={`form-input${rowErrors.quantity ? ' input-invalid' : ''}`}
          value={item.quantity}
          aria-invalid={Boolean(rowErrors.quantity)}
          aria-describedby={rowErrors.quantity ? `item-qty-err-${item.id}` : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onFieldChange(item.id, 'quantity', clampNonNeg(e.target.value))}
        />
        {rowErrors.quantity && (
          <div id={`item-qty-err-${item.id}`} className="field-error-text" role="alert">{rowErrors.quantity}</div>
        )}
      </div>
      {(invoiceMode !== 'services' || invoiceOptionOn(invoiceOptions, 'showItemUnit')) && (
        <div className="line-item-field" style={{ flex: 0.85, minWidth: 82 }}>
          <label className="form-label" htmlFor={`item-unit-${item.id}`}>Unit</label>
          <select id={`item-unit-${item.id}`} className="form-input" value={item.unit || getDefaultUnitForMode(invoiceMode)}
            onChange={(e) => {
              if (e.target.value === '__custom__') { onAddCustomUnit(item.id); return; }
              if (e.target.value.startsWith('__remove__::')) {
                const label = e.target.value.replace('__remove__::', '');
                onRemoveCustomUnit(label);
                return;
              }
              onFieldChange(item.id, 'unit', e.target.value);
            }}>
            {(() => {
              const visible = filterUnitsByMode(units, invoiceMode);
              const showCurrentExtra = item.unit && !visible.some(u => u.label === item.unit);
              return (
                <>
                  {showCurrentExtra && <option value={item.unit}>{item.unit}</option>}
                  {visible.map(u => (
                    <option key={u.label} value={u.label}>{u.label}{u.custom ? ' ★' : ''}</option>
                  ))}
                </>
              );
            })()}
            <option value="__custom__">＋ Add custom…</option>
            {units.some(u => u.custom) && units.filter(u => u.custom).map(u => (
              <option key={`rm-${u.label}`} value={`__remove__::${u.label}`}>− Remove "{u.label}"</option>
            ))}
          </select>
        </div>
      )}
      <div className="line-item-field" style={{ flex: 1.25, minWidth: 112 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <label className="form-label" htmlFor={`item-rate-${item.id}`} style={{ marginBottom: 0 }}>
            Rate{currency && currency !== 'INR' ? ` (${currencySymbolFor(currency)})` : ''}
          </label>
          {priceSourceLabel && (
            <span
              className={`price-source-badge ${item.priceSource === 'manual' ? 'price-source-manual' : 'price-source-tier'}`}
              title={item.priceSource === 'manual' ? 'Manual price override (preserved when switching tiers). Click ↺ to reset to active tier rate.' : `Automatic ${priceSourceLabel} tier price`}
            >
              {priceSourceLabel}
              {item.priceSource === 'manual' && item.productId && onResetTierPrice && (
                <button
                  type="button"
                  onClick={() => onResetTierPrice(item.id)}
                  title="Reset to active tier price"
                  style={{ border: 'none', background: 'transparent', color: 'inherit', padding: '0 0 0 3px', cursor: 'pointer', fontSize: '0.68rem', lineHeight: 1 }}
                >
                  ↺
                </button>
              )}
            </span>
          )}
        </div>
        <input
          id={`item-rate-${item.id}`}
          type="number"
          min="0"
          step="any"
          className={`form-input${rowErrors.rate ? ' input-invalid' : ''}`}
          value={item.rate}
          aria-invalid={Boolean(rowErrors.rate)}
          aria-describedby={rowErrors.rate ? `item-rate-err-${item.id}` : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onFieldChange(item.id, 'rate', clampNonNeg(e.target.value))}
        />
        {rowErrors.rate && (
          <div id={`item-rate-err-${item.id}`} className="field-error-text" role="alert">{rowErrors.rate}</div>
        )}
      </div>
      {invoiceOptions.showDiscount && (
        <div className="line-item-field" style={invoiceMode === 'services' ? { flex: 1.15, minWidth: 125 } : { flex: 1.6, minWidth: 185 }}>
          <label className="form-label" htmlFor={`item-discount-${item.id}`}>Discount</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <input
              id={`item-discount-${item.id}`}
              type="number"
              min="0"
              step="any"
              className={`form-input${rowErrors.discount ? ' input-invalid' : ''}`}
              value={item.discount}
              aria-invalid={Boolean(rowErrors.discount)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onFieldChange(item.id, 'discount', clampNonNeg(e.target.value))}
              style={{ flex: 1, minWidth: 55 }}
            />
            <select className="form-input"
              value={item.discountType === 'percent' ? 'percent' : 'fixed'}
              onChange={(e) => onFieldChange(item.id, 'discountType', e.target.value)}
              style={{ width: 52, padding: '0.4rem 0.3rem', fontSize: '0.82rem' }}
              title="Discount mode: fixed amount or percent of line">
              <option value="fixed">{currencySymbolFor(currency)}</option>
              <option value="percent">%</option>
            </select>
            {item.discountType !== 'percent' && invoiceMode !== 'services' && (
              <select className="form-input"
                value={item.discountBase || 'net'}
                onChange={(e) => { onFieldChange(item.id, 'discountBase', e.target.value); onFieldChange(item.id, 'withTaxRule', 2); }}
                style={{ width: 78, padding: '0.4rem 0.3rem', fontSize: '0.75rem' }}
                title="What the ₹ discount applies to. Net = qty×rate (default). Unit = ₹X off each unit. WithTax = ₹X off tax-inclusive total.">
                <option value="net">Net</option>
                <option value="unit">Unit</option>
                <option value="with-tax">W/Tax</option>
              </select>
            )}
          </div>
          {rowErrors.discount && (
            <div className="field-error-text" role="alert">{rowErrors.discount}</div>
          )}
        </div>
      )}
      {showGST && (
        <div className="line-item-field" style={{ flex: 0.9, minWidth: 86 }}>
          <label className="form-label" htmlFor={`item-tax-${item.id}`}>{taxLabel} %</label>
          <select id={`item-tax-${item.id}`} className={`form-input${rowErrors.taxPercent ? ' input-invalid' : ''}`}
            value={countryTaxRates.includes(Number(item.taxPercent)) ? String(item.taxPercent) : '__custom__'}
            onChange={async (e) => {
              if (e.target.value === '__custom__') {
                const raw = await promptAction({
                  title: `Custom ${taxLabel} rate`,
                  message: `Enter a ${taxLabel} rate between 0% and 100% (up to 2 decimals).`,
                  defaultValue: String(item.taxPercent || 0),
                  placeholder: 'e.g. 7.5',
                  inputType: 'number',
                  confirmLabel: 'Apply rate',
                });
                if (raw === null) return;
                const n = parseFloat(raw);
                if (!isFinite(n) || n < 0 || n > 100) { toast('Tax rate must be between 0 and 100', 'warning'); return; }
                onFieldChange(item.id, 'taxPercent', n);
              } else {
                onFieldChange(item.id, 'taxPercent', parseFloat(e.target.value) || 0);
              }
            }}>
            {countryTaxRates.map(r => (
              <option key={r} value={String(r)}>{r}%</option>
            ))}
            <option value="__custom__">{countryTaxRates.includes(Number(item.taxPercent)) ? 'Custom…' : `${item.taxPercent}% (custom)`}</option>
          </select>
        </div>
      )}
      {showGST && invoiceOptions.showCess && (profileCountry || 'India') === 'India' && (
        <div className="line-item-field" style={{ flex: 0.75, minWidth: 74 }}>
          <label className="form-label" htmlFor={`item-cess-${item.id}`} title="GST Compensation Cess (tobacco / auto / coal etc.)">Cess %</label>
          <input id={`item-cess-${item.id}`} type="number" min="0" max="500" step="any" className="form-input"
            value={item.cessPercent || 0}
            onChange={(e) => onFieldChange(item.id, 'cessPercent', clampNonNeg(e.target.value))} />
        </div>
      )}
      {/* Live Per-Row Taxable, Tax Amt, and Line Total readout */}
      <div className="line-item-field line-item-computed-summary" style={{ flex: 1.25, minWidth: 130 }}>
        <label className="form-label">Line Total</label>
        <div className="line-item-total-box" title={`Taxable: ${formatCurrency(lineCalc.taxableValue || 0, currency || 'INR')} | Tax: ${formatCurrency(taxSum, currency || 'INR')}`}>
          <span className="line-item-total-amount">{formatCurrency(lineCalc.total || 0, currency || 'INR')}</span>
          <span className="line-item-total-sub">
            Taxable {formatCurrency(lineCalc.taxableValue || 0, currency || 'INR')}
            {showGST ? ` · ${taxLabel} ${formatCurrency(taxSum, currency || 'INR')}` : ''}
          </span>
        </div>
      </div>
      <div className="line-item-field line-item-delete" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end', paddingBottom: 2 }}>
        {onDuplicate && (
          <button type="button" className="icon-btn" onClick={() => onDuplicate(item.id)} title="Duplicate row">
            <Copy size={14} />
          </button>
        )}
        {onMoveRow && totalRows > 1 && (
          <>
            <button type="button" className="icon-btn" onClick={() => onMoveRow(item.id, -1)} disabled={rowIndex === 0} title="Move row up">
              <ChevronUp size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onMoveRow(item.id, 1)} disabled={rowIndex === totalRows - 1} title="Move row down">
              <ChevronDown size={14} />
            </button>
          </>
        )}
        <button type="button" className="icon-btn icon-btn-red" onClick={() => onRemove(item.id)}
          disabled={isOnlyRow} title={isOnlyRow ? 'An invoice needs at least one line' : 'Remove row'}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="line-item-description-row" style={{ flexBasis: '100%', marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {item.description || item._descOpen ? (
          <textarea
            className="form-input"
            rows={2}
            placeholder="Description / batch / fitment note (shown under this line in the PDF)"
            value={item.description || ''}
            onChange={(e) => onFieldChange(item.id, 'description', e.target.value)}
            style={{ fontSize: '0.8rem', resize: 'vertical', minHeight: 36, flex: 1 }} />
        ) : (
          <button type="button" className="btn btn-secondary"
            onClick={() => onFieldChange(item.id, '_descOpen', true)}
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', color: 'var(--text-muted)' }}
            title="Add a description that will show under this line in the PDF">
            + Add description
          </button>
        )}
      </div>
    </div>
  );
});

// v1.10.77 (#88) - the Tally and Boxed designs pad the item table so a short
// bill still looks like a full page. When that padding alone pushes the
// invoice past one PDF page, trim it (from the bottom) just enough, so the
// terms, bank details and signature stay on page 1. Returns a function that
// puts everything back. Elements: [data-pdf-spacer="stretch"] rows have their
// cells shortened; [data-pdf-spacer="row"] rows are hidden whole.
function fitSpacersToOnePage(container, pageWmm, pageHmm, ps) {
  const m = (k) => Math.max(0, Number(ps?.[k]) || 0);
  const availW = Math.max(20, pageWmm - m('marginLeft') - m('marginRight'));
  const availH = Math.max(20, pageHmm - m('marginTop') - m('marginBottom'));
  const onePagePx = availH * container.getBoundingClientRect().width / availW;
  let over = container.scrollHeight - onePagePx + 3;
  const spacers = [...container.querySelectorAll('[data-pdf-spacer]')];
  const room = spacers.reduce((s, el) => s + el.getBoundingClientRect().height, 0);
  if (over <= 3 || over > room) return () => {};
  const undo = [];
  for (const el of spacers.reverse()) {
    if (over <= 0) break;
    const h = el.getBoundingClientRect().height;
    if (el.dataset.pdfSpacer === 'row') {
      const prev = el.style.display;
      el.style.display = 'none';
      undo.push(() => { el.style.display = prev; });
      over -= h;
    } else {
      const cells = [...el.children];
      const prev = cells.map((c) => c.style.height);
      const next = Math.max(0, h - over);
      cells.forEach((c) => { c.style.height = `${next}px`; });
      undo.push(() => cells.forEach((c, i) => { c.style.height = prev[i]; }));
      over -= h - next;
    }
  }
  return () => undo.reverse().forEach((f) => f());
}

export default function InvoiceGenerator({ onBack, onCreateNextInvoice, onRegisterNavGuard, profile: profileProp, editingBill }) {
  const draft = useMemo(() => loadScopedDraft(profileProp, editingBill), [profileProp, editingBill]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(profileProp);
  const profile = activeProfile || profileProp;
  const [invoiceType, setInvoiceType] = useState(draft?.invoiceType || editingBill?.data?.invoiceType || editingBill?.invoiceType || 'tax-invoice');
  const [selectedSeriesId, setSelectedSeriesId] = useState('MA');
  const [activeRateTier, setActiveRateTier] = useState(() => normalizePriceTier(draft?.activeRateTier || editingBill?.data?.activeRateTier || editingBill?.data?.client?.customerType || 'retail'));
  const invoiceSeriesList = useMemo(() => getInvoiceSeriesList(), [selectedSeriesId]);
  const [client, setClient] = useState(draft?.client || { name: '', address: '', city: '', pin: '', state: '', gstin: '', country: '', email: '', phone: '', isSEZ: false });
  const previewPaneRef = useRef(null);
  const [previewZoom, setPreviewZoom] = useState(() => {
    try { return Number(getPrintSettings().previewZoom) || 100; } catch { return 100; }
  });
  useEffect(() => {
    try {
      const s = getPrintSettings();
      if (Number(s.previewZoom) !== previewZoom) {
        savePrintSettings({ ...s, previewZoom });
      }
    } catch { /* sandboxed localStorage — session-only degradation ok */ }
  }, [previewZoom]);

  const handleFitToWidth = useCallback(() => {
    if (!previewPaneRef.current) { setPreviewZoom(100); return; }
    const pane = previewPaneRef.current;
    const scaler = pane.querySelector('.preview-scaler');
    const preview = scaler?.querySelector('.invoice-preview-container');
    const paneWidth = pane.clientWidth - 16;
    const naturalWidth = preview?.offsetWidth || 794;
    if (!(paneWidth > 0 && naturalWidth > 0)) { setPreviewZoom(100); return; }
    const ratio = paneWidth / naturalWidth;
    const nextZoom = Math.max(50, Math.min(200, Math.round(ratio * 100)));
    setPreviewZoom(nextZoom);
  }, []);

  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('fgsb_previewCollapsed');
      return saved !== null ? saved === '1' : true;
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('fgsb_previewCollapsed', previewCollapsed ? '1' : '0'); } catch { /* sandboxed */ }
  }, [previewCollapsed]);

  const [details, setDetails] = useState(draft?.details || {
    invoiceNumber: '',
    invoiceDate: localToday(),
    dueDate: getBusinessType() === 'freelancer' ? toLocalIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 15)) : '',
    placeOfSupply: '',
    originalInvoiceRef: '',
    shipToSameAsBilling: true,
    shippingAddress: '',
    shippingCity: '',
    shippingPin: '',
    shippingState: '',
  });
  const { on: ccOn, centres } = useCostCentres(profile);

  const [items, setItems] = useState(draft?.items || [
    { id: Date.now().toString(), name: '', hsn: '', quantity: 1, unit: 'Nos', rate: 0, discount: 0, taxPercent: 18, cessPercent: 0 }
  ]);
  const [allBillsForCredit, setAllBillsForCredit] = useState([]);
  const [creditToApply, setCreditToApply] = useState(0);
  const [units, setUnits] = useState(getAllUnits());
  const [taxInclusive, setTaxInclusive] = useState(draft?.taxInclusive || false);

  const [saving, setSaving] = useState(false);
  const [validationResult, setValidationResult] = useState({ valid: true, errors: [], fieldErrors: {}, rowErrors: {}, warnings: [] });
  const [lineItemViewMode, setLineItemViewMode] = useState(() => {
    try { return localStorage.getItem('fgsb_lineItemViewMode') || 'cards'; } catch { return 'cards'; }
  });
  useEffect(() => {
    try { localStorage.setItem('fgsb_lineItemViewMode', lineItemViewMode); } catch { /* ignore */ }
  }, [lineItemViewMode]);
  const [tierChangePrompt, setTierChangePrompt] = useState(null); // { targetTier, targetClient, impact }
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [draftStorageWarning, setDraftStorageWarning] = useState(false);
  const [_companyDrafts, setCompanyDrafts] = useState([]);
  const billUpdatedAt = useRef(editingBill && !editingBill._isDuplicate ? (editingBill.updatedAt || null) : null);
  const saveMutexRef = useRef(false);

  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTermsId, setSelectedTermsId] = useState(draft?.selectedTermsId || '');
  const [customTerms, setCustomTerms] = useState(draft?.customTerms || '');
  const [customNotes, setCustomNotes] = useState(draft?.customNotes || '');
  const [internalNote, setInternalNote] = useState(draft?.internalNote || '');
  const [extraSections, setExtraSections] = useState(draft?.extraSections || []);
  const [savedClients, setSavedClients] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientPickerIdx, setClientPickerIdx] = useState(-1);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const clientNameRef = useRef(null);
  const clientSuggestionsRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState({ itemId: null, query: '' });
  const [invoiceOptions, setInvoiceOptions] = useState(() => {
    try {
      const saved = localStorage.getItem('freegstbill_invoiceOptions');
      const persisted = saved ? JSON.parse(saved) : {};
      delete persisted.paymentAccountSnapshot; stripLutOptions(persisted);
      return { ...DEFAULT_OPTIONS, ...persisted, ...(draft?.invoiceOptions || {}) };
    } catch { return draft?.invoiceOptions || { ...DEFAULT_OPTIONS }; }
  });
  const [showOptions, setShowOptions] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const printRef = useRef(null);
  const [previewNatural, setPreviewNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = printRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setPreviewNatural((prev) => (
      prev.w === el.offsetWidth && prev.h === el.offsetHeight
        ? prev
        : { w: el.offsetWidth, h: el.offsetHeight }
    ));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewCollapsed]);
  const draftInitialized = useRef(!!draft);
  const blankNewInvoice = useRef(!editingBill && !draft);
  const draftOptions = useRef(draft?.invoiceOptions || {});
  const [readOnlyDoc] = useState(() => !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType
    && (editingBill.status === 'cancelled' || !!editingBill.convertedTo));
  const [einvoice, setEinvoice] = useState(() => (editingBill && !editingBill._isDuplicate ? editingBill.einvoice || null : null));
  const [showEinvoice, setShowEinvoice] = useState(null); // { saved } while open
  const [autoSaveStatus, setAutoSaveStatus] = useState(() => (editingBill && !editingBill._isDuplicate ? 'saved' : 'idle')); // 'idle' | 'dirty' | 'saving' | 'saved'
  const isDirty = useRef(false);
  const stockStart = useRef(editingBill && (!editingBill._isDuplicate || editingBill._convertToType) ? appliedStock(editingBill) : {});
  const conversionMarked = useRef(false);
  const hasOutput = useRef(!!editingBill && !editingBill._isDuplicate && !editingBill._convertToType && (Number(editingBill.printedCount) || 0) > 0);
  const hasInitialized = useRef(false);
  const numberReserved = useRef(!!editingBill && !editingBill._isDuplicate);
  const hasBeenSaved = useRef(!!editingBill && !editingBill._isDuplicate);
  const savedId = useRef(editingBill && !editingBill._isDuplicate ? editingBill.id : null);
  const peekedNumber = useRef(null);
  const peekSeq = useRef(0);
  const warnedLongNumber = useRef(false);

  const typeConfig = INVOICE_TYPES[invoiceType];
  const showGST = invoiceOptions.showGST;
  const sellerCountryConfig = getCountryConfig(profile?.country);
  const _psPrintForRates = getPrintSettings();
  const customRates = Array.isArray(_psPrintForRates.customTaxRates)
    ? _psPrintForRates.customTaxRates.map(Number).filter(n => isFinite(n) && n >= 0 && n <= 100)
    : [];
  const baseCountryRates = sellerCountryConfig.taxRates && sellerCountryConfig.taxRates.length
    ? sellerCountryConfig.taxRates
    : [0, 5, 12, 18, 28, 40];
  const countryTaxRates = useMemo(
    () => [...new Set([...baseCountryRates, ...customRates])].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseCountryRates.join(','), customRates.join(',')]
  );
  const defaultTaxRate = countryTaxRates.includes(18) ? 18 : (countryTaxRates[countryTaxRates.length - 2] ?? 0);
  const taxLabel = sellerCountryConfig.taxLabel || 'GST';

  const clampNonNeg = useCallback((raw) => {
    const n = parseFloat(raw);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }, []);

  const optionsPersistTimer = useRef(null);
  const editingSaved = !!editingBill?.data && !editingBill?._isDuplicate;
  useEffect(() => {
    if (editingSaved) return undefined;
    const { paymentAccountSnapshot: _snap, ...persistable } = invoiceOptions;
    stripLutOptions(persistable);
    localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(persistable));
    if (hasInitialized.current) {
      clearTimeout(optionsPersistTimer.current);
      optionsPersistTimer.current = setTimeout(() => {
        saveInvoiceDisplayOptions(persistable).catch(() => {});
      }, 800);
    }
    return () => clearTimeout(optionsPersistTimer.current);
  }, [invoiceOptions, editingSaved]);

  // Load saved display options from server on mount
  useEffect(() => {
    if (editingSaved) return;
    getInvoiceDisplayOptions().then(serverOpts => {
      if (serverOpts) {
        delete serverOpts.paymentAccountSnapshot;
        stripLutOptions(serverOpts);
        const merged = { ...DEFAULT_OPTIONS, ...serverOpts, ...draftOptions.current };
        setInvoiceOptions(prev => {
          const changed = Object.keys(merged).some(k => merged[k] !== prev[k]);
          if (changed) {
            const nextOpts = { ...merged, paymentAccountSnapshot: prev.paymentAccountSnapshot, ...lutOptionsOf(prev) };
            const { paymentAccountSnapshot: _skip, ...toPersist } = nextOpts;
            stripLutOptions(toPersist);
            localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(toPersist));
            return nextOpts;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, [editingSaved]);

  // Refresh list of recoverable company-scoped drafts
  useEffect(() => {
    setCompanyDrafts(listCompanyDrafts(profile));
  }, [profile]);

  // Mark initialized after initial mount/effect cycle so user edits flip isDirty
  useEffect(() => {
    const t = setTimeout(() => { hasInitialized.current = true; }, 450);
    return () => clearTimeout(t);
  }, []);

  // Local-only scoped draft persistence (NEVER mutates server bills, stock, or client credit on keystrokes!)
  useEffect(() => {
    if (!hasInitialized.current || readOnlyDoc) return undefined;
    isDirty.current = true;
    setAutoSaveStatus(prev => (prev === 'saving' ? prev : 'dirty'));
    const t = setTimeout(() => {
      const draftData = {
        invoiceType,
        activeRateTier,
        client,
        details,
        items,
        customTerms,
        customNotes,
        internalNote,
        extraSections,
        selectedTermsId,
        invoiceOptions,
        taxInclusive,
      };
      const res = saveScopedDraft(profile, editingBill, draftData);
      if (res.quotaError) {
        setDraftStorageWarning(true);
      } else {
        setDraftStorageWarning(false);
        setCompanyDrafts(listCompanyDrafts(profile));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [invoiceType, activeRateTier, client, details, items, customTerms, customNotes, internalNote, extraSections, selectedTermsId, invoiceOptions, taxInclusive, profile, editingBill, readOnlyDoc]);

  const isMeaningfulInvoice = useCallback(() => {
    if (editingBill) return true;
    if (client?.name?.trim()) return true;
    return items.some(item => (item.name || '').trim() || Number(item.rate) > 0);
  }, [client?.name, items, editingBill]);

  const clearDraft = useCallback(() => {
    deleteScopedDraft(profile, editingBill);
    setCompanyDrafts(listCompanyDrafts(profile));
  }, [profile, editingBill]);

  // Save-before-leave guard across Back button, sidebar, shortcuts, New Invoice, and Company Switcher
  const [leaveModal, setLeaveModal] = useState(false);
  const pendingLeaveActionRef = useRef(null);

  const requestLeaveWithGuard = useCallback((proceedFn) => {
    if (isMeaningfulInvoice() && isDirty.current && !readOnlyDoc) {
      pendingLeaveActionRef.current = proceedFn || onBack;
      setLeaveModal(true);
      return;
    }
    clearDraft();
    if (typeof proceedFn === 'function') proceedFn();
    else onBack?.();
  }, [isMeaningfulInvoice, readOnlyDoc, clearDraft, onBack]);

  useEffect(() => {
    if (typeof onRegisterNavGuard !== 'function') return undefined;
    onRegisterNavGuard(requestLeaveWithGuard);
    return () => onRegisterNavGuard(null);
  }, [onRegisterNavGuard, requestLeaveWithGuard]);

  const handleBack = () => {
    requestLeaveWithGuard(onBack);
  };

  useEffect(() => {
    const handler = (e) => {
      if (isMeaningfulInvoice() && isDirty.current && !readOnlyDoc) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isMeaningfulInvoice, readOnlyDoc]);

  // v1.10.16 — reported: user adds a 2nd business profile in Settings, comes
  // back to the invoice generator, but the "Billing From (Business Profile)"
  // chip row (which only renders when allProfiles.length > 1) doesn't
  // appear until they switch profiles once. Root cause: getAllProfiles()
  // fired once on mount; if the SPA kept InvoiceGenerator mounted while the
  // user was in Settings, the new profile never showed. Fix: also refetch
  // when the window regains visibility. Belt-and-braces since the
  // conditional-render path in App.jsx already unmounts+remounts, but this
  // covers the case where a stale server response is cached mid-navigation.
  useEffect(() => {
    const refetchProfiles = () => getAllProfiles().then(setAllProfiles).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') refetchProfiles(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refetchProfiles);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refetchProfiles);
    };
  }, []);

  // Load terms templates and saved clients
  useEffect(() => {
    getAllProfiles().then(p => { setAllProfiles(p); if (!activeProfile && p.length > 0) setActiveProfile(profileProp); }).catch(() => {});
    getTermsTemplates().then(templates => {
      setTermsTemplates(templates);
      if (templates.length > 0 && blankNewInvoice.current && !selectedTermsId) {
        setSelectedTermsId(templates[0].id);
        setCustomTerms(templates[0].content);
      }
    });
    getAllClients().then(clients => {
      setSavedClients(clients);
      // Auto-link if editing a bill with a known client
      if (client.name.trim()) {
        const match = clients.find(c => c.name.toLowerCase() === client.name.trim().toLowerCase());
        if (match) setSelectedClientId(match.id);
      }
    });
    getAllProducts().then(setProducts);
    // v1.10.24 — Load bills once for client-credit lookup. Refreshed after
    // save (inside saveInvoiceToDB's success path) so the balance stays
    // current when the same session creates multiple invoices for one client.
    getAllBills().then(setAllBillsForCredit).catch(() => {});
  }, []);

  // Initialize from editing bill or generate new number (skip if restoring from draft)
  useEffect(() => {
    if (draftInitialized.current) {
      draftInitialized.current = false;
      return;
    }
    if (editingBill?.data) {
      const d = editingBill.data;
      setClient(d.client);
      setItems(d.items);
      setInvoiceType(d.invoiceType || 'tax-invoice');
      if (d.customTerms !== undefined) setCustomTerms(d.customTerms);
      if (d.customNotes !== undefined) setCustomNotes(d.customNotes);
      if (d.internalNote !== undefined) setInternalNote(d.internalNote);
      if (d.extraSections) setExtraSections(d.extraSections);
      if (d.taxInclusive !== undefined) setTaxInclusive(d.taxInclusive);
      if (d.invoiceOptions) {
        // User's persisted defaults as base, bill options overlay
        // v1.10.19 — Backfill paymentAccountSnapshot for pre-v1.10.18 bills.
        // Reported after v1.10.18: "swaping bank account issue solve work on
        // old bills or not... i cant see it is working". Right — v1.10.18
        // only froze the snapshot at save time, so bills saved before that
        // release still resolved the bank via the live profile. But those
        // bills DID persist a full profile snapshot in d.profile since
        // v1.4.x, so we can recover the original account by looking it up
        // in d.profile.paymentAccounts (or the flat legacy fields).
        // v1.10.20 — Strip paymentAccountSnapshot from `persisted` before
        // merging. Otherwise Invoice A's snapshot (auto-saved to
        // localStorage) contaminates Invoice B's merge, and the
        // `!mergedOpts.paymentAccountSnapshot` check below sees a snapshot
        // that isn't actually the current bill's. That single bug defeated
        // the entire v1.10.19 backfill in practice.
        let mergedOpts = null;
        try {
          const saved = localStorage.getItem('freegstbill_invoiceOptions');
          const persisted = saved ? JSON.parse(saved) : {};
          delete persisted.paymentAccountSnapshot; stripLutOptions(persisted);
          // showRoundOff: a saved bill that never stored it was not rounded
          // (OPTIONS_OFF_BY_DEFAULT); the new ON default must not change its total.
          mergedOpts = { ...DEFAULT_OPTIONS, ...persisted, showRoundOff: false, ...d.invoiceOptions };
        } catch { mergedOpts = { ...DEFAULT_OPTIONS, showRoundOff: false, ...d.invoiceOptions }; }
        // Backfilling only happens if the bill genuinely has no snapshot.
        // Check d.invoiceOptions directly (not mergedOpts) to sidestep any
        // remaining cross-store bleed-through.
        // v1.10.21 — Also heal contaminated snapshots from the v1.10.18–19
        // window. Reported: "after i full reloaded again all vanished and
        // asigned to same account which is default." Cause: bills saved
        // between v1.10.18 and v1.10.19 had snapshots polluted by
        // cross-invoice localStorage bleed — the snapshot's own `id` didn't
        // match the bill's selectedAccountId. v1.10.20 stopped the leak but
        // didn't touch the already-saved bad snapshots. Now: if the stored
        // snapshot's id doesn't match the stored selection, treat it as
        // stale and re-derive from d.profile (the frozen-at-save profile
        // snapshot, which still has the original account).
        const billSnap = d.invoiceOptions.paymentAccountSnapshot;
        const billSelId = d.invoiceOptions.selectedAccountId;
        const snapshotIsStale = billSnap && billSelId && billSnap.id && billSnap.id !== billSelId;
        if ((!billSnap || snapshotIsStale) && d.profile) {
          const snap = getAccountById(d.profile, billSelId);
          if (snap) mergedOpts.paymentAccountSnapshot = snap;
        }
        setInvoiceOptions(mergedOpts);
      } else {
        // A bill saved with no options at all was never rounded.
        setInvoiceOptions(prev => ({ ...prev, showRoundOff: false }));
      }

      if (editingBill._isDuplicate) {
        const convertType = editingBill._convertToType;
        const type = convertType || d.invoiceType || 'tax-invoice';
        if (convertType) {
          setInvoiceType(convertType);
          const config = INVOICE_TYPES[convertType];
          if (config) setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
        }
        // v1.10.10 — read per-type prefix override from print settings.
        const _psForPrefix = getPrintSettings();
        const rawOverride = _psForPrefix.customPrefixes?.[type];
        const overridePrefix = rawOverride && rawOverride.trim();
        const prefix = overridePrefix || INVOICE_TYPES[type]?.prefix || 'INV';
        const seq = ++peekSeq.current;
        getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) }).then(num => {
          if (seq !== peekSeq.current) return;
          peekedNumber.current = num;
          setDetails({ ...d.details, invoiceNumber: num, invoiceDate: localToday() });
          numberReserved.current = false;
        });
      } else {
        setDetails(d.details);
      }
    } else if (!details.invoiceNumber) {
      // v1.10.10 — honour the per-type prefix override for fresh invoices.
      const _psForPrefix = getPrintSettings();
      const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
      const overridePrefix = rawOverride && rawOverride.trim();
      const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
      const seq = ++peekSeq.current;
      getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile) }).then(num => {
        if (seq !== peekSeq.current) return;
        peekedNumber.current = num;
        setDetails(prev => ({ ...prev, invoiceNumber: num }));
        numberReserved.current = false;
      });
    }
  }, [editingBill]);

  // v1.10.79 (#95) - the number shown on an unsaved invoice follows the
  // business it is for: each business can number on its own, and the business
  // is often known only after the first render. Without this the screen showed
  // the shared series' next number while Save took the business's own.
  const bizKey = businessKeyOf(profile);
  const peekedFor = useRef(bizKey);
  useEffect(() => {
    if (!bizKey || peekedFor.current === bizKey) return;
    peekedFor.current = bizKey;
    if ((editingBill && !editingBill._isDuplicate) || numberReserved.current || hasBeenSaved.current) return;
    // Only a number the editor filled in itself (or none): a draft's own
    // number, or one typed by hand, stays as it is.
    if (details.invoiceNumber && details.invoiceNumber !== peekedNumber.current) return;
    const rawOverride = getPrintSettings().customPrefixes?.[invoiceType];
    const overridePrefix = rawOverride && rawOverride.trim();
    const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
    const seq = ++peekSeq.current;
    getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType, businessKey: bizKey })
      .then((num) => {
        if (seq !== peekSeq.current || numberReserved.current) return;
        setDetails((prev) => (prev.invoiceNumber && prev.invoiceNumber !== peekedNumber.current ? prev : { ...prev, invoiceNumber: num }));
        peekedNumber.current = num;
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizKey]);

  // Seed the payment-account selection on first render. For a freshly-created
  // invoice (no editingBill, no value yet) we prefer the profile's ⭐ default,
  // then the last-used account from localStorage, then the first active
  // account. Resolving here once means the dropdown shows the right value
  // immediately rather than flickering through nulls.
  // v1.10.22 — reported: "if user added two account and star the one account
  // while creating new invoice it shows old star account not new". Root
  // cause: prior priority was last-used → default → first-active. Changing
  // the ⭐ in Settings didn't invalidate the last-used pointer, so new
  // invoices kept picking the old account. Fix: ⭐ default always wins
  // when set. Last-used stays as a fallback when no account is starred
  // (e.g. an in-progress migration).
  useEffect(() => {
    if (editingBill) return; // editing — keep whatever the bill stored
    if (invoiceOptions.selectedAccountId) return; // already set
    if (!profile) return;
    const lastUsedKey = `gst_lastUsedAccountId_${profile.id || profile.businessName || 'default'}`;
    let candidate = null;
    try { candidate = localStorage.getItem(lastUsedKey); } catch { /* sandboxed */ }
    const active = getActiveAccounts(profile);
    const defaultId = getDefaultAccount(profile)?.id || null;
    const candidateResolves = candidate && active.some(a => a.id === candidate);
    const next = defaultId
      || (candidateResolves ? candidate : null)
      || active[0]?.id
      || null;
    if (next) setInvoiceOptions(prev => ({ ...prev, selectedAccountId: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.businessName, editingBill]);

  // Persist the just-used account to localStorage so the NEXT new invoice on
  // this profile defaults to the same one. Saved on every change rather than
  // only on Save so power users typing through 5 invoices in a row get sticky
  // behaviour even if they navigate without saving each one.
  useEffect(() => {
    if (!profile || !invoiceOptions.selectedAccountId) return;
    const lastUsedKey = `gst_lastUsedAccountId_${profile.id || profile.businessName || 'default'}`;
    try { localStorage.setItem(lastUsedKey, invoiceOptions.selectedAccountId); } catch { /* ignore */ }
  }, [profile?.id, profile?.businessName, invoiceOptions.selectedAccountId]);

  // When loading a saved bill, prefer the LIVE business profile that matches the bill's
  // snapshot (by id, falling back to businessName). Means a Settings rename / address
  // edit / new logo flows through to all historical invoices on next PDF render. Falls
  // back to the snapshot if that profile was deleted.
  useEffect(() => {
    if (!editingBill?.data?.profile || allProfiles.length === 0) return;
    const snap = editingBill.data.profile;
    const liveMatch = allProfiles.find(p =>
      (p.id && snap.id && p.id === snap.id) ||
      (p.businessName && p.businessName === snap.businessName)
    );
    if (liveMatch && liveMatch !== activeProfile) setActiveProfile(liveMatch);
  }, [editingBill, allProfiles, activeProfile]);

  const isIssuedInvoice = !!editingBill && !editingBill._isDuplicate && !editingBill._convertToType;

  // v1.10.68 (#68, idea from @deppen12) — the GSTIN already names the state and
  // carries a checksum, so fill the state and catch a typo without any API key
  // or internet. The state decides place of supply: get it wrong and the
  // invoice charges CGST + SGST where it owes IGST, or the other way round.
  const [gstinHint, setGstinHint] = useState(null);
  const handleClientGstinBlur = () => {
    const decoded = decodeGstin(client.gstin);
    if (!decoded) { setGstinHint(null); return; }
    if (!decoded.checksumOk) {
      setGstinHint({ tone: 'warn', message: 'This GSTIN fails its own checksum — check for a typo.' });
      return;
    }
    if (!decoded.state) { setGstinHint(null); return; }
    if (!client.state?.trim()) {
      setClient(prev => ({ ...prev, state: decoded.state }));
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state} — state filled in.` });
    } else if (client.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setGstinHint({ tone: 'warn', message: `This GSTIN is registered in ${decoded.state}, but the state says ${client.state}.` });
    } else {
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state}.` });
    }
  };

  const handleTypeChange = async (type) => {
    if (isIssuedInvoice) return;
    setInvoiceType(type);
    const config = INVOICE_TYPES[type];
    // v1.10.14 — honour the per-type prefix override when switching invoice type.
    const _psForPrefix = getPrintSettings();
    const rawOverride = _psForPrefix.customPrefixes?.[type];
    const overridePrefix = rawOverride && rawOverride.trim();
    const prefix = overridePrefix || config?.prefix || 'INV';
    // Peek — actual reservation happens on save.
    const seq = ++peekSeq.current;
    const num = await getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix, invoiceType: type, businessKey: businessKeyOf(profile) });
    if (seq !== peekSeq.current) return;
    peekedNumber.current = num;
    numberReserved.current = false;
    setDetails(prev => ({ ...prev, invoiceNumber: num }));

    // Auto-set options based on type
    if (type === 'bill-of-supply') {
      setInvoiceOptions(prev => ({ ...prev, showGST: false, showPlaceOfSupply: false }));
    } else {
      setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
    }
  };

  const toggleOption = (key) => {
    // v1.10.83 - once the unit is switched by hand, Goods / Services no longer flip it.
    setInvoiceOptions(prev => ({ ...prev, [key]: !invoiceOptionOn(prev, key), ...(key === 'showItemUnit' ? { showItemUnitManual: true } : {}) }));
  };

  // v1.10.83 - invoice currency. The rate belongs to one currency, so a new
  // currency starts with no rate (the last one used is offered as a hint).
  const baseCurrency = baseCurrencyOf(profile);
  const currencyPatch = (prev, cur) => (cur === (prev.currency || baseCurrency) ? {} : {
    currency: cur, exchangeRate: '',
    ...(cur !== baseCurrency ? { lastForeignCurrency: cur } : {}),
  });
  const setCurrency = (cur) => setInvoiceOptions(prev => ({ ...prev, ...currencyPatch(prev, cur) }));
  const setExchangeRate = (v) => setInvoiceOptions(prev => ({
    ...prev, exchangeRate: v,
    ...(Number(v) > 0 ? { fxRates: { ...(prev.fxRates || {}), [prev.currency]: v } } : {}),
  }));

  // v1.10.4 — useMemo replaces the prior useEffect+setTotals pair. Same
  // math (extracted to pure `computeInvoiceTotals` in v1.10.1), but
  // computed inline during render so React doesn't double-render on
  // every keystroke.
  // v1.10.66 (#61) — client.country now decides exports, and client.gstin /
  // profile.gstin stand in for a missing state. All three must be listed:
  // switching only the country left the old CGST + SGST split on screen, and
  // that stale split is what Save stored.
  // This client's sales so far this financial year, for the ₹50L threshold of
  // 194Q / 206C(1H). Not stored in invoiceOptions (it changes with every
  // invoice); fed to the calculation only.
  const clientYtd = useMemo(
    () => clientYearToDate(allBillsForCredit, client?.name, details?.invoiceDate, editingBill?.id),
    [allBillsForCredit, client?.name, details?.invoiceDate, editingBill?.id],
  );
  const totals = useMemo(() => computeInvoiceTotals({
    items, profile, client, details, showGST, taxInclusive,
    // v1.10.83 - TDS recorded with a payment belongs to that issued invoice only.
    invoiceOptions: { ...invoiceOptions, tcsCumulativeThisYear: clientYtd, tdsCumulativeThisYear: clientYtd, tdsRecorded: isIssuedInvoice ? invoiceOptions.tdsRecorded : undefined },
  }), [isIssuedInvoice, invoiceOptions.tdsRecorded, clientYtd, invoiceOptions.tcsSection, invoiceOptions.tdsSection, items, client.state, client?.country, client?.gstin, client?.isSEZ, profile?.state, profile?.country, profile?.gstin, showGST, taxInclusive, invoiceOptions.showRoundOff, invoiceOptions.showTDS, invoiceOptions.tdsRate, invoiceOptions.tdsCumulativeThisYear, invoiceOptions.showTCS, invoiceOptions.tcsRate, invoiceOptions.tcsCumulativeThisYear, invoiceOptions.reverseCharge, invoiceOptions.invoiceDiscountValue, invoiceOptions.invoiceDiscountType, invoiceOptions.isLUT, details?.placeOfSupply]);

  // v1.10.83 - exports and SEZ supplies under a LUT (Settings › Company).
  // A new invoice ticks "under LUT" by itself when the business's saved LUT
  // covers the invoice date's financial year, until the user changes the tick
  // (lutManual). A saved invoice opened for editing keeps its own choice. The
  // LUT's ARN and year are copied onto the invoice so a later LUT never
  // changes what an old invoice prints.
  const lutEligible = !!showGST && isExportOrSez({ profile, client, details });
  const lutDefault = lutCoversDate(profile, details?.invoiceDate);
  const lutLocked = !!editingBill && !editingBill._isDuplicate;
  useEffect(() => {
    if (!lutEligible || lutLocked) return;
    setInvoiceOptions(prev => {
      const isLUT = prev.lutManual ? !!prev.isLUT : lutDefault;
      const lutArn = isLUT ? normaliseLutArn(profile?.lutArn) : '';
      const lutFy = lutArn ? (profile?.lutFy || '') : '';
      if (!!prev.isLUT === isLUT && (prev.lutArn || '') === lutArn && (prev.lutFy || '') === lutFy) return prev;
      return { ...prev, isLUT, lutArn, lutFy };
    });
    // The invoice's own LUT fields are deps too: a draft restored after the
    // first run (or made before the LUT was saved) is brought in line. The
    // update returns prev once it agrees, so this settles in one pass.
  }, [lutEligible, lutDefault, lutLocked, profile?.lutArn, profile?.lutFy, invoiceOptions.isLUT, invoiceOptions.lutArn, invoiceOptions.lutFy, invoiceOptions.lutManual]);
  const toggleLut = (on) => setInvoiceOptions(prev => {
    const lutArn = on ? normaliseLutArn(profile?.lutArn) : '';
    return { ...prev, lutManual: true, isLUT: on, lutArn, lutFy: lutArn ? (profile?.lutFy || '') : '' };
  });

  const clientCredit = useMemo(() => {
    if (!client?.name?.trim() && !selectedClientId) return { available: 0, sources: [] };
    const otherBills = editingBill
      ? allBillsForCredit.filter(b => b.id !== editingBill.id)
      : allBillsForCredit;
    return getClientCredit(client.name, otherBills, selectedClientId || client?.id || null);
  }, [client?.name, client?.id, selectedClientId, allBillsForCredit, editingBill]);

  const taxTreatment = useMemo(() => describeTaxTreatment({
    profile,
    client,
    details,
    totals,
    invoiceType,
    invoiceOptions,
    taxInclusive,
  }), [profile, client, details, totals, invoiceType, invoiceOptions, taxInclusive]);

  const lastAutoAppliedClient = useRef(null);
  useEffect(() => {
    if (editingBill) return;
    if (!invoiceOptions.autoApplyClientCredit) {
      lastAutoAppliedClient.current = null;
      return;
    }
    const name = client?.name?.trim() || '';
    if (!name || lastAutoAppliedClient.current === name) return;
    lastAutoAppliedClient.current = name;
    const cap = Math.min(clientCredit.available, Number(totals.total) || 0);
    setCreditToApply(cap > 0.005 ? cap : 0);
  }, [client?.name, clientCredit.available, invoiceOptions.autoApplyClientCredit, editingBill, totals.total]);

  useEffect(() => {
    const isIndia = (profile?.country || 'India') === 'India';
    if (!isIndia || !showGST) return;
    if (!profile?.state && client?.state) {
      const key = `gst_stateWarning_${profile?.businessName || 'profile'}`;
      if (!sessionStorage.getItem(key)) {
        toast('Set your business State in Settings — required for correct CGST/SGST vs IGST split.', 'warning');
        sessionStorage.setItem(key, '1');
      }
    }
  }, [profile?.state, profile?.country, profile?.businessName, client?.state, showGST]);

  const handleItemChange = useCallback((id, field, value) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const patch = { [field]: value };
      if (field === 'rate') {
        patch.priceSource = 'manual';
        patch.manualRateOverride = true;
      } else if (field === 'name' && item.productId) {
        // If user edits the item name away from the selected catalog product, unlink productId
        const prod = products.find(p => p.id === item.productId);
        if (prod && decodeHtmlEntities(prod.name).trim().toLowerCase() !== String(value || '').trim().toLowerCase()) {
          patch.productId = null;
          patch.priceSource = 'manual';
          patch.priceTierLabel = null;
        }
      }
      return { ...item, ...patch };
    }));
    if (field === 'name') {
      setProductSearch({ itemId: id, query: value });
    }
  }, [products]);

  const selectProduct = useCallback((itemId, product) => {
    const tierInfo = getPriceForCustomerType(product, activeRateTier);
    const salePrice = tierInfo.price || Number(product.sellingPrice) || Number(product.rate) || 0;
    setItems(prev => prev.map(item => item.id === itemId ? {
      ...item,
      name: decodeHtmlEntities(product.name),
      hsn: product.hsn || '',
      rate: salePrice,
      unit: product.unit || item.unit || 'Nos',
      taxPercent: product.taxPercent ?? defaultTaxRate,
      productId: product.id,
      priceSource: 'tier',
      manualRateOverride: false,
      priceTierId: tierInfo.tierId,
      priceTierLabel: tierInfo.shortLabel,
      isCharge: false,
    } : item));
    setProductSearch({ itemId: null, query: '' });
  }, [activeRateTier, defaultTaxRate]);

  const duplicateItem = useCallback((itemId) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.id === itemId);
      if (idx === -1) return prev;
      const clone = { ...prev[idx], id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  }, []);

  const moveItemRow = useCallback((itemId, direction) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.id === itemId);
      const targetIdx = idx + direction;
      if (idx === -1 || targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, []);

  const resetItemTierPrice = useCallback((itemId) => {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId || !it.productId) return it;
      const prod = products.find(p => p.id === it.productId);
      if (!prod) return it;
      const tierInfo = getPriceForCustomerType(prod, activeRateTier);
      return {
        ...it,
        rate: tierInfo.price,
        priceSource: 'tier',
        manualRateOverride: false,
        priceTierId: tierInfo.tierId,
        priceTierLabel: tierInfo.shortLabel,
      };
    }));
  }, [products, activeRateTier]);

  const requestTierChange = useCallback((rawNextTier, reasonLabel = null) => {
    const nextTier = normalizePriceTier(rawNextTier);
    if (nextTier === activeRateTier) return;
    const impact = inspectTierPriceImpact(items, products, nextTier);
    if (impact.catalogCount > 0 && (impact.automaticCount > 0 || impact.manualCount > 0)) {
      setTierChangePrompt({
        targetTier: nextTier,
        reasonLabel,
        impact,
      });
    } else {
      setActiveRateTier(nextTier);
    }
  }, [activeRateTier, items, products]);

  const applyTierChangeDecision = useCallback((mode) => {
    if (!tierChangePrompt) return;
    const { targetTier } = tierChangePrompt;
    setActiveRateTier(targetTier);
    if (mode === 'auto') {
      setItems(prev => applyTierPricingToItems(prev, products, targetTier, { replaceManual: false }));
      toast(`Updated automatic catalog prices to ${PRICE_TIERS.find(t => t.id === targetTier)?.label || targetTier}`, 'info');
    } else if (mode === 'all') {
      setItems(prev => applyTierPricingToItems(prev, products, targetTier, { replaceManual: true }));
      toast(`Replaced all catalog prices with ${PRICE_TIERS.find(t => t.id === targetTier)?.label || targetTier}`, 'info');
    } else {
      toast(`Switched active tier to ${PRICE_TIERS.find(t => t.id === targetTier)?.label || targetTier} (kept existing item rates)`, 'info');
    }
    setTierChangePrompt(null);
  }, [tierChangePrompt, products]);

  const getProductSuggestions = useCallback((itemId) => {
    if (productSearch.itemId !== itemId || !productSearch.query.trim()) return [];
    return products.filter(p => productMatchesSearch(p, productSearch.query)).slice(0, 8);
  }, [productSearch.itemId, productSearch.query, products]);

  const hasDeliveryCharge = items.some((i) => i.isCharge);
  const servicesMode = (invoiceOptions.invoiceMode || 'goods') === 'services';
  const [wholeDiscountOpen, setWholeDiscountOpen] = useState(false);
  const addDeliveryCharge = () => {
    if (hasDeliveryCharge) return;
    setItems((prev) => [...prev, deliveryChargeLine(prev)]);
  };

  const addItem = () => {
    const defaultUnit = items.length > 0 && items[items.length - 1].unit
      ? items[items.length - 1].unit
      : getDefaultUnitForMode(invoiceOptions.invoiceMode);
    const newId = Date.now().toString();
    setItems(prev => [...prev, {
      id: newId, name: '', hsn: '', quantity: 1, unit: defaultUnit, rate: 0, discount: 0,
      taxPercent: showGST ? defaultTaxRate : 0,
      cessPercent: 0,
    }]);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-item-id="${newId}"] textarea.form-input, [data-item-id="${newId}"] input.form-input`);
      if (el) el.focus();
    });
  };

  const handleAddCustomUnit = useCallback(async (itemId) => {
    const label = await promptAction({
      title: 'Add custom unit',
      message: 'Enter a short unit label. Saved for reuse across future invoices.',
      placeholder: 'e.g. Carat, Bundle, Bushel',
      confirmLabel: 'Add unit',
    });
    if (!label) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    if (trimmed.length > 20) { toast('Unit name must be 20 characters or fewer', 'warning'); return; }
    const ok = addCustomUnit(trimmed);
    setUnits(getAllUnits());
    if (!ok) {
      toast(`Unit "${trimmed}" already exists or is reserved`, 'info');
    } else {
      toast(`Unit "${trimmed}" added`, 'success');
    }
    handleItemChange(itemId, 'unit', trimmed);
  }, [handleItemChange]);

  const handleRemoveCustomUnit = useCallback(async (label) => {
    if (!await confirmAction({
      title: `Remove custom unit "${label}"?`,
      message: 'Existing invoices keep this label unchanged. It just no longer appears in the unit dropdowns.',
      confirmLabel: 'Remove unit',
      tone: 'danger',
    })) return;
    removeCustomUnit(label);
    setUnits(getAllUnits());
    toast(`Removed custom unit "${label}"`, 'success');
  }, []);

  const removeItem = useCallback((id) => {
    setItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  }, []);

  const handleTermsSelect = (templateId) => {
    setSelectedTermsId(templateId);
    const tpl = termsTemplates.find(t => t.id === templateId);
    if (tpl) setCustomTerms(tpl.content);
  };

  const selectSavedClient = (cli) => {
    setClient({
      id: cli.id || null,
      name: cli.name || '',
      address: cli.address || '',
      city: cli.city || '',
      pin: cli.pin || '',
      state: cli.state || '',
      gstin: cli.gstin || '',
      country: cli.country || '',
      email: cli.email || '',
      phone: cli.phone || '',
      customerType: cli.customerType || 'Retail',
      isSEZ: !!cli.isSEZ,
    });
    setSelectedClientId(cli.id);
    setShowClientSuggestions(false);
    const clientTier = normalizePriceTier(cli.customerType || 'retail');
    if (clientTier !== activeRateTier) {
      requestTierChange(clientTier, `Customer "${cli.name}" uses ${PRICE_TIERS.find(t => t.id === clientTier)?.label || clientTier}`);
    }
    if (!editingBill) {
      setInvoiceOptions(prev => ({
        ...prev,
        paperSize: cli.preferredPaperSize || prev.paperSize || 'a4',
        customPaperWidth: cli.preferredCustomPaperWidth || prev.customPaperWidth || 80,
        customPaperHeight: cli.preferredCustomPaperHeight || prev.customPaperHeight || 297,
        ...currencyPatch(prev, currencyForClient(cli, profile, { preferred: cli.preferredCurrency, lastForeign: prev.lastForeignCurrency })),
        clientAutoPrint: !!cli.autoPrint,
      }));
    }
    toast(`Loaded client: ${cli.name}`, 'info');
  };

  const openAddClientModal = () => {
    setModalClient({ name: client.name || '', address: client.address || '', city: client.city || '', pin: client.pin || '', state: client.state || '', gstin: client.gstin || '', country: client.country || '' });
    setIsEditingClient(false);
    setShowClientModal(true);
    setShowClientSuggestions(false);
  };

  const openEditClientModal = (cli) => {
    setModalClient(cli);
    setIsEditingClient(true);
    setShowClientModal(true);
  };

  const handleClientModalSave = async (formData) => {
    const data = { ...formData };
    if (isEditingClient && modalClient?.id) data.id = modalClient.id;
    await saveClient(data);
    const updated = await getAllClients();
    setSavedClients(updated);
    const savedRec = isEditingClient && modalClient?.id
      ? updated.find(c => c.id === modalClient.id)
      : updated.find(c => c.name === data.name.trim() && !savedClients.some(old => old.id === c.id));
    setClient({
      id: savedRec?.id || data.id || null,
      name: data.name || '',
      address: data.address || '',
      city: data.city || '',
      pin: data.pin || '',
      state: data.state || '',
      gstin: data.gstin || '',
      country: data.country || '',
      email: data.email || '',
      phone: data.phone || '',
      customerType: data.customerType || 'Retail',
      isSEZ: !!data.isSEZ,
    });
    if (!editingSaved) setCurrency(currencyForClient(data, profile, { preferred: data.preferredCurrency, lastForeign: invoiceOptions.lastForeignCurrency }));
    if (isEditingClient && modalClient?.id) {
      setSelectedClientId(modalClient.id);
      toast(`Client "${data.name}" updated!`, 'success');
    } else {
      if (savedRec) setSelectedClientId(savedRec.id);
      toast(`Client "${data.name}" saved!`, 'success');
    }
    setShowClientModal(false);
  };

  const filteredClients = useMemo(() => {
    const q = client.name.trim().toLowerCase();
    if (!q) return savedClients;
    return savedClients.filter(cli => cli.name.toLowerCase().includes(q));
  }, [client.name, savedClients]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clientSuggestionsRef.current && !clientSuggestionsRef.current.contains(e.target) &&
          clientNameRef.current && !clientNameRef.current.contains(e.target)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Unified client + server validation gate. NEVER skips validation on editingBill, duplicates, or conversions.
  const runInvoiceValidation = useCallback(() => {
    const invCfg = getInventorySettingsSync();
    const effectiveEditingBill = hasBeenSaved.current
      ? {
          id: savedId.current || details.invoiceNumber,
          status: editingBill?.status || 'unpaid',
          data: { stockApplied: stockStart.current || {} },
        }
      : (editingBill && (!editingBill._isDuplicate || editingBill._convertToType) ? editingBill : null);

    const v = validateInvoice({
      profile,
      client,
      details,
      items,
      totals,
      invoiceType,
      invoiceOptions,
      taxInclusive,
      products,
      inventorySettings: invCfg,
      editingBill: effectiveEditingBill,
      baseCurrency,
    });
    setValidationResult(v);
    if (!v.valid && v.firstFieldId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(v.firstFieldId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
      });
    }
    return v;
  }, [profile, client, details, items, totals, invoiceType, invoiceOptions, taxInclusive, products, editingBill, baseCurrency]);

  const validateForSave = useCallback(() => {
    const v = runInvoiceValidation();
    return v.valid ? null : (v.firstError || 'Please fix the highlighted validation errors before saving.');
  }, [runInvoiceValidation]);

  const saveInvoiceToDBNow = async (skipStockDeduction = false, extraPatch = {}) => {
    if (readOnlyDoc) {
      toast(editingBill.convertedTo
        ? `Already converted to ${editingBill.convertedTo}, so it is not changed. Use Duplicate to make a new one.`
        : 'A cancelled invoice is not changed. Undo the cancel on the Dashboard, or use Duplicate.', 'warning');
      return null;
    }

    const v = runInvoiceValidation();
    if (!v.valid) {
      toast(v.firstError || 'Please fix the highlighted errors before saving.', 'warning');
      return null;
    }

    let finalInvoiceNumber = details.invoiceNumber;
    const isNewDoc = !editingBill || !!editingBill._isDuplicate;
    if (isNewDoc && !numberReserved.current) {
      try {
        const _psForPrefix = getPrintSettings();
        const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
        const overridePrefix = rawOverride && rawOverride.trim();
        const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
        const numOpts = { explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate };
        const typed = String(details.invoiceNumber || '').trim();
        const ownNumber = !!typed && typed !== peekedNumber.current
          && typed !== await getNextInvoiceNumber(prefix, { ...numOpts, peek: true });
        if (!ownNumber) {
          finalInvoiceNumber = await getNextInvoiceNumber(prefix, numOpts);
          setDetails(prev => ({ ...prev, invoiceNumber: finalInvoiceNumber }));
        }
        numberReserved.current = true;
      } catch { /* fall back to the peeked value; server will 409 if it collides */ }
    }

    const priorSnapshot = invoiceOptions.paymentAccountSnapshot;
    const priorMatchesSelection = priorSnapshot && priorSnapshot.id === invoiceOptions.selectedAccountId;
    const snapAccount = priorMatchesSelection
      ? priorSnapshot
      : getAccountById(profile, invoiceOptions.selectedAccountId);
    const { tdsRecorded, ...optionsOwn } = invoiceOptions;
    const invoiceOptionsWithSnapshot = { ...optionsOwn, ...(isIssuedInvoice && tdsRecorded ? { tdsRecorded } : {}), paymentAccountSnapshot: snapAccount || null };

    const effectiveClientId = selectedClientId || client?.id || null;
    const creditPlan = (!editingBill && creditToApply > 0.005)
      ? planCreditApplication(client.name, allBillsForCredit, creditToApply, finalInvoiceNumber, effectiveClientId)
      : null;

    const ownBill = !!editingBill && !editingBill._isDuplicate;
    const priorId = savedId.current;
    const renameFrom = priorId && priorId !== finalInvoiceNumber ? priorId : null;
    if (renameFrom) {
      let usedBy = null;
      try {
        usedBy = (await getAllBills()).find((b) => b.id !== renameFrom && (b.payments || b.data?.payments || [])
          .some((p) => p?.mode === 'credit-applied' && (p.creditSourceBillIds || []).includes(renameFrom)));
      } catch { /* server check still stands */ }
      if (usedBy) {
        toast(`${renameFrom} can't be renumbered: its credit paid ${usedBy.invoiceNumber || usedBy.id}. Keep the number ${renameFrom}.`, 'error', 8000);
        return null;
      }
    }

    const seedPayments = ownBill && editingBill.payments ? [...editingBill.payments] : [];
    if (priorId) {
      try {
        const serverBills = await getAllBills();
        const fresh = serverBills.find(b => b.id === priorId);
        const freshPayments = Array.isArray(fresh?.payments) ? fresh.payments : [];
        for (const fp of freshPayments) {
          const dup = seedPayments.some(p =>
            (fp.receiptNo && p.receiptNo === fp.receiptNo)
            || (fp.id && p.id === fp.id)
            || (Math.abs((Number(p.amount) || 0) - (Number(fp.amount) || 0)) < 0.005
                && p.date === fp.date
                && (p.mode || '') === (fp.mode || ''))
          );
          if (!dup) seedPayments.push(fp);
        }
      } catch { /* non-fatal */ }
    }
    if (creditPlan?.targetEntry) seedPayments.push(creditPlan.targetEntry);
    const seedPaidAmount = seedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const isIssued = !!editingBill && !editingBill._isDuplicate;
    let serverCopy = null;
    if (isIssued || hasBeenSaved.current) {
      try { serverCopy = (await getAllBills()).find((b) => b.id === (renameFrom || finalInvoiceNumber)) || null; } catch { /* treated as not saved yet */ }
    }
    const stockFrom = serverCopy ? appliedStock(serverCopy) : stockStart.current;
    const keepCancelled = isIssued && (serverCopy?.status || editingBill.status) === 'cancelled';
    const computedStatus = paymentStatusFor({ totalAmount: totals.total, data: { totals } }, seedPaidAmount);
    const seedStatus = keepCancelled ? 'cancelled' : (computedStatus === 'unpaid' && ownBill && editingBill.status === 'overdue')
      ? 'overdue'
      : computedStatus;

    const nextStockApplied = isIssued && (serverCopy?.convertedTo || editingBill.convertedTo) ? {} : stockEffect(items, invoiceType, seedStatus);

    const bill = {
      id: finalInvoiceNumber,
      clientId: effectiveClientId,
      clientName: client.name,
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: details.invoiceDate,
      invoiceType,
      currency: invoiceOptions.currency || 'INR',
      totalAmount: totals.total,
      totalTaxAmount: totals.totalTaxAmount ?? (totals.cgst + totals.sgst + (totals.utgst || 0) + totals.igst + (totals.cess || 0)),
      status: seedStatus,
      paidAmount: seedPaidAmount,
      payments: seedPayments,
      printedCount: extraPatch.printedCount ?? (ownBill ? editingBill.printedCount : 0) ?? 0,
      lastPrintedAt: extraPatch.lastPrintedAt ?? (ownBill ? editingBill.lastPrintedAt : null) ?? null,
      ...(keepCancelled ? { cancelledAt: serverCopy?.cancelledAt || editingBill.cancelledAt || null } : {}),
      ...(isIssued && (serverCopy?.convertedTo || editingBill.convertedTo) ? { convertedTo: serverCopy?.convertedTo || editingBill.convertedTo } : {}),
      ...((serverCopy?.einvoice || einvoice) ? { einvoice: serverCopy?.einvoice || einvoice } : {}),
      ...(ownBill && (serverCopy?.tdsCertificate || editingBill.tdsCertificate) ? { tdsCertificate: true } : {}),
      data: {
        profile,
        client: { ...client, id: effectiveClientId },
        details: { ...details, invoiceNumber: finalInvoiceNumber },
        items,
        totals,
        invoiceType,
        activeRateTier,
        customTerms,
        customNotes,
        internalNote,
        extraSections,
        invoiceOptions: invoiceOptionsWithSnapshot,
        taxInclusive,
        stockApplied: nextStockApplied,
      },
    };

    const shouldOverwrite = !renameFrom && (!isNewDoc || hasBeenSaved.current);
    let savedNumber = bill.id;
    const invCfg = getInventorySettingsSync();
    const conversionSourceId = (editingBill?._convertToType && !conversionMarked.current) ? editingBill.id : null;

    const commitOnce = async (targetBill, overwriteFlag) => {
      return commitBillTransaction({
        bill: targetBill,
        overwrite: overwriteFlag,
        expectedUpdatedAt: billUpdatedAt.current || undefined,
        stockStartOverride: stockFrom,
        creditSourcePatches: creditPlan?.sourcePatches || [],
        renameFrom,
        conversionSourceId,
        allowNegativeStock: invCfg.allowNegativeStock !== false,
      });
    };

    try {
      const commitRes = await commitOnce(bill, shouldOverwrite);
      savedNumber = commitRes?.bill?.id || bill.id;
      billUpdatedAt.current = commitRes?.updatedAt || commitRes?.bill?.updatedAt || new Date().toISOString();
      stockStart.current = commitRes?.bill?.data?.stockApplied || nextStockApplied;
      if (conversionSourceId) conversionMarked.current = true;

      if (creditPlan?.sourcePatches?.length) {
        const applied = creditPlan.amountApplied;
        const from = creditPlan.consumedFrom.map(c => c.invoiceNumber).join(', ');
        toast(`${formatCurrency(applied, invoiceOptions.currency || 'INR')} credit applied from ${from}`, 'success');
        getAllBills().then(setAllBillsForCredit).catch(() => {});
        setCreditToApply(0);
      }

      if (Array.isArray(commitRes?.movedProducts) && commitRes.movedProducts.length > 0) {
        setProducts(await getAllProducts());
        if (!skipStockDeduction) {
          const changes = stockDelta(stockFrom, nextStockApplied);
          for (const product of commitRes.movedProducts) {
            if (!(changes[product.id] < 0)) continue;
            if (product.stock <= 0) toast(`${product.name} is now out of stock!`, 'warning');
            else if (product.stock <= 5) toast(`${product.name} has only ${product.stock} left in stock`, 'warning');
          }
        }
      }

      if (selectedClientId) {
        const cli = savedClients.find(c => c.id === selectedClientId);
        if (cli) {
          const nextPaperSize = invoiceOptions.paperSize || 'a4';
          const nextCurrency = invoiceOptions.currency || 'INR';
          const nextCustomW = invoiceOptions.customPaperWidth || 80;
          const nextCustomH = invoiceOptions.customPaperHeight || 297;
          const changed = cli.preferredPaperSize !== nextPaperSize
            || cli.preferredCurrency !== nextCurrency
            || cli.preferredCustomPaperWidth !== nextCustomW
            || cli.preferredCustomPaperHeight !== nextCustomH;
          if (changed) {
            const updatedClient = {
              ...cli,
              preferredPaperSize: nextPaperSize,
              preferredCurrency: nextCurrency,
              preferredCustomPaperWidth: nextCustomW,
              preferredCustomPaperHeight: nextCustomH,
            };
            saveClient(updatedClient).then(() => {
              setSavedClients(prev => prev.map(c => c.id === cli.id ? updatedClient : c));
            }).catch(() => {});
          }
        }
      }
      hasBeenSaved.current = true;
      isDirty.current = false;
      setAutoSaveStatus('saved');
      clearDraft();
    } catch (err) {
      if (err?.reason === 'version-conflict') {
        toast('This invoice was modified in another tab or window. Reload the invoice from Dashboard before saving to avoid overwriting newer changes.', 'error', 9000);
        return null;
      }
      if (err?.status === 422) {
        toast(err.message || 'Server validation rejected this invoice.', 'error');
        return null;
      }
      if (err?.status === 409 && renameFrom) {
        toast(`Invoice number ${bill.id} is already used by another invoice. This invoice is still saved as ${renameFrom}.`, 'error');
        return null;
      }
      if (err?.status === 409) {
        if (isNewDoc && !shouldOverwrite) {
          const _psForPrefix = getPrintSettings();
          const rawOverride = _psForPrefix.customPrefixes?.[invoiceType];
          const overridePrefix = rawOverride && rawOverride.trim();
          const prefix = overridePrefix || INVOICE_TYPES[invoiceType]?.prefix || 'INV';
          let nextNum = bill.id;
          let success = false;
          for (let i = 0; i < 1000; i++) {
            try {
              nextNum = await getNextInvoiceNumber(prefix, { explicitPrefix: !!overridePrefix, invoiceType, businessKey: businessKeyOf(profile), invoiceDate: details.invoiceDate });
              const retryBill = { ...bill, id: nextNum, invoiceNumber: nextNum };
              retryBill.data = { ...retryBill.data, details: { ...retryBill.data.details, invoiceNumber: nextNum } };
              const retryRes = await commitOnce(retryBill, false);
              success = true;
              savedNumber = nextNum;
              billUpdatedAt.current = retryRes?.updatedAt || new Date().toISOString();
              stockStart.current = retryRes?.bill?.data?.stockApplied || nextStockApplied;
              setDetails(prev => ({ ...prev, invoiceNumber: nextNum }));
              hasBeenSaved.current = true;
              isDirty.current = false;
              setAutoSaveStatus('saved');
              clearDraft();
              if (nextNum !== bill.id) {
                toast(`Invoice number ${bill.id} was already used — saved as ${nextNum} instead.`, 'info');
              }
              break;
            } catch (retryErr) {
              if (retryErr?.status !== 409 || retryErr?.reason === 'version-conflict') throw retryErr;
            }
          }
          if (!success) {
            toast('Could not find a free invoice number after 1000 attempts. Please change the number manually.', 'error');
            return null;
          }
        } else {
          toast(`Invoice number ${bill.id} already exists. Change it before saving.`, 'error');
          return null;
        }
      } else {
        throw err;
      }
    }

    savedId.current = savedNumber;

    if (invoiceOptions.recurring?.enabled) {
      try {
        const rec = invoiceOptions.recurring;
        const allTemplates = await getAllRecurring().catch(() => []);
        const existing = allTemplates.find((t) => t.id === `tpl_${savedNumber}`)
          || (renameFrom ? allTemplates.find((t) => t.id === `tpl_${renameFrom}`) : null);
        const templateId = existing?.id || `tpl_${savedNumber}`;
        const keepSchedule = !!existing && existing.requestedNextDate === rec.nextDate;
        const dueDays = details.dueDate && details.invoiceDate
          ? Math.round((parseLocalDate(details.dueDate) - parseLocalDate(details.invoiceDate)) / 86400000) : null;
        await saveRecurring({
          ...(existing || {}),
          id: templateId,
          sourceInvoiceId: savedNumber,
          active: existing ? existing.active !== false : true,
          frequency: rec.frequency || 'monthly',
          interval: rec.interval || 1,
          nextDate: keepSchedule ? existing.nextDate : rec.nextDate,
          anchorDay: keepSchedule ? existing.anchorDay ?? null : null,
          requestedNextDate: rec.nextDate,
          endMode: rec.endMode || 'never',
          endDate: rec.endDate || '',
          maxOccurrences: rec.maxOccurrences || null,
          occurrencesCreated: existing?.occurrencesCreated || 0,
          createdAt: existing?.createdAt || new Date().toISOString(),
          lastGenerated: existing?.lastGenerated || null,
          ownerGstin: profile?.gstin || '',
          ownerName: profile?.businessName || '',
          placeOfSupply: details.placeOfSupply || '',
          dueDays: Number.isFinite(dueDays) && dueDays >= 0 ? dueDays : null,
          clientName: client.name,
          clientState: client.state,
          clientGstin: client.gstin,
          clientAddress: client.address,
          clientCountry: client.country,
          clientCity: client.city,
          clientPin: client.pin,
          clientEmail: client.email,
          clientPhone: client.phone,
          isSEZ: client.isSEZ,
          invoiceType,
          profileId: profile?.id || null,
          profileBusinessName: profile?.businessName || null,
          items: items.map(i => ({ ...i })),
          customTerms,
          customNotes,
          extraSections,
          taxInclusive,
          invoiceOptions: { ...invoiceOptions, recurring: null },
        });
      } catch (err) {
        console.error('Failed to save recurring template:', err);
        toast('Invoice saved, but recurring template failed to save', 'warning');
      }
    }

    if (['tax-invoice', 'credit-note'].includes(invoiceType) && savedNumber && !GST_DOC_NUMBER.test(savedNumber) && !warnedLongNumber.current) {
      warnedLongNumber.current = true;
      toast(`${savedNumber} has ${savedNumber.length} characters; GST allows 16, so GSTR-1 will refuse it. Shorten the format in Settings → Invoice Number Format.`, 'warning', 10000);
    }
    return savedNumber;
  };

  // Serialize all save/output operations through a single promise queue + mutex guard
  const saveQueue = useRef(Promise.resolve());
  const saveInvoiceToDB = (...args) => {
    if (saveMutexRef.current) return saveQueue.current;
    saveMutexRef.current = true;
    const run = saveQueue.current
      .then(() => saveInvoiceToDBNow(...args))
      .finally(() => { saveMutexRef.current = false; });
    saveQueue.current = run.catch(() => {});
    return run;
  };

  const leaveActions = {
    saveAndExit: async () => {
      try {
        setAutoSaveStatus('saving');
        const no = await saveInvoiceToDB();
        if (!no) { setAutoSaveStatus('dirty'); return; }
        toast('Invoice saved', 'success');
        clearDraft();
        setLeaveModal(false);
        const proceed = pendingLeaveActionRef.current || onBack;
        pendingLeaveActionRef.current = null;
        proceed?.();
      } catch {
        setAutoSaveStatus('dirty');
        toast('Save failed — staying on the page so you can retry', 'error');
      }
    },
    discardAndExit: () => {
      isDirty.current = false;
      clearDraft();
      setLeaveModal(false);
      const proceed = pendingLeaveActionRef.current || onBack;
      pendingLeaveActionRef.current = null;
      proceed?.();
    },
    cancel: () => {
      pendingLeaveActionRef.current = null;
      setLeaveModal(false);
    },
  };

  // Upload PDF to Google Drive if configured
  const uploadToGoogleDrive = async (pdfBlob, fileName) => {
    try {
      const latestProfile = await getProfile();
      const clientId = latestProfile.googleClientId;
      const folderName = latestProfile.googleDriveFolder || 'GST Billing Invoices';
      // v1.10.83 - Settings → Features → Google Drive off means no upload.
      if (!clientId || !isModuleEnabled('googleDrive', getEnabledModules())) return;
      if (isOfflineMode()) { toast('Offline mode is on, so the PDF was not sent to Google Drive. It is saved on this computer.', 'info', 6000); return; }

      const hasToken = await ensureToken(clientId);
      if (!hasToken) {
        toast('Google Drive: Please reconnect in Settings', 'warning');
        return;
      }

      const folderId = await findOrCreateFolder(folderName);
      await uploadPDF(fileName, pdfBlob, folderId);
      toast(`Saved to Google Drive → ${folderName}`, 'success');
    } catch (err) {
      console.error('Google Drive upload error:', err);
      toast('Google Drive upload failed: ' + err.message, 'warning');
    }
  };

  // Shared PDF generation helper. v1.10.3 — wraps the whole body in
  // try/finally so `scalerEl.style.transform` is always restored, even
  // if html2canvas or jsPDF throws mid-render. Prior code only restored
  // on the success path — an exception left the on-screen preview
  // stuck at scale 1.0 until the user navigated away.
  const buildPDF = async ({ archive = false, forPrint = false } = {}) => {
    const printSettings = getPrintSettings();
    const scalerEl = printRef.current.closest('.preview-scaler');
    const spacerFit = {};
    if (scalerEl) scalerEl.style.transform = 'none';
    try {
      return await __buildPDFInner(printSettings, archive, spacerFit, forPrint);
    } finally {
      spacerFit.restore?.();
      if (scalerEl) scalerEl.style.transform = '';
    }
  };

  // archive: the copy kept in Saved Invoices, which carries no REPRINT stamp.
  const __buildPDFInner = async (printSettings, archive = false, spacerFit = {}, forPrint = false) => {

    // v1.10.46 — Hoisted from line ~2133 to fix the v1.10.45 regression
    // where `isHeaderOn` / `isFooterOn` (introduced in v1.10.45 for the
    // page-2+ header/footer reserves) referenced this constant BEFORE
    // its declaration → Temporal Dead Zone ReferenceError → every
    // buildPDF() call threw → both `Print` and `Save & Download PDF`
    // buttons silently failed with the generic "Print failed" /
    // "Failed to generate PDF" toasts (reported in issue #20). Every
    // subsequent guard in this function that already referenced
    // isThermalPdf keeps working — this is a pure hoist.
    const isThermalPdf = getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

    // PDF quality / size trade-off:
    //   - `compress: true` deflate-compresses PDF streams (incl. embedded images).
    //     Adds ~50-150ms but typically shrinks output by 15-30%.
    //   - Render scale = max(3, devicePixelRatio * 2). Bumping from 2 to 3 makes text
    //     visibly sharper without much file-size increase, because JPEG compresses
    //     clean line-art / glyphs efficiently. On Retina/4K screens we go higher.
    //   - JPEG quality 0.95 vs old 0.92: gain in legibility for small text outweighs
    //     the modest size bump.
    // Paper size (v1.8.1) — read from invoiceOptions. A4 default; A5 uses
    // jsPDF's built-in format; thermal 80mm/58mm use custom [width, height].
    // Thermal formats use a tall single-column layout — the InvoicePreview
    // component branches on options.paperSize CSS class to render compact.
    const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
    // jsPDF orientation defaults to 'portrait' if the paper config doesn't
    // specify it, so pre-v1.8.3 saved bills keep rendering portrait.
    // Note: `let pdf` (not const) so the thermal path can replace it with
    // a content-height-sized instance after html2canvas returns — thermal
    // receipts were previously always 297mm tall regardless of actual
    // content, wasting 15-20cm of blank paper per receipt when the PDF
    // was reprinted.
    let pdf = new jsPDF({
      orientation: paperCfg.jsPdfOrientation || 'portrait',
      unit: 'mm',
      format: paperCfg.jsPdfFormat,
      compress: true,
    });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const extraPages = printRef.current.querySelectorAll('[data-pdf-page]');
    // v1.9.1 — quality-driven render scale + JPEG quality:
    //   draft   → scale 2, JPEG 0.85 → ~50% smaller PDF, email-friendly
    //   standard→ scale 3, JPEG 0.95 → default (existing behaviour)
    //   hd      → scale max(4, dpr*3), JPEG 0.98 → archival quality, larger
    // v1.10.3 — Scale is now capped at 6× on any device. Prior code
    // `Math.max(4, dpr * 3)` on a 4× DPR Android phone hit 12× → an
    // A4 canvas at 100 megapixels → OOM crash before jsPDF ever ran.
    // Also: PNG for HD (crisp text edges — invoices are line-art),
    // JPEG for draft/standard (file size wins). Prior always-JPEG
    // smudged glyph edges on high-DPI screens.
    const capScale = (n) => Math.min(6, Math.max(2, Math.round(n)));
    const qualityCfg = {
      draft:    { scale: 2, imgFormat: 'JPEG', quality: 0.85 },
      standard: { scale: capScale(Math.max(3, (window.devicePixelRatio || 1) * 2)), imgFormat: 'JPEG', quality: 0.95 },
      hd:       { scale: capScale(Math.max(4, (window.devicePixelRatio || 1) * 2.5)), imgFormat: 'PNG', quality: 1.0 },
    };
    // v1.10.77 (#86) - printing always uses HD: a print is not emailed, so file
    // size does not matter, and the JPEG of "standard" (what most business
    // presets set) printed visibly softer than the downloaded PDF looked.
    const q = forPrint ? qualityCfg.hd : (qualityCfg[printSettings.pdfQuality] || qualityCfg.standard);
    const renderScale = q.scale;
    const jpegQuality = q.quality;
    const imgFormat = q.imgFormat;   // 'JPEG' or 'PNG'
    // v1.10.3 — Await webfonts before rasterising. On a cold load,
    // html2canvas fired before Inter finished downloading → the capture
    // used fallback fonts with wrong glyph metrics → table columns
    // overflowed. `document.fonts.ready` resolves once every declared
    // font has loaded (or failed).
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* non-fatal */ }
    }

    // v1.10.60 — reported (#51, @sguptagzb): "when I try to print the
    // Invoice, the format is not coming as it comes in Preview", with a
    // sample PDF attached.
    //
    // Decoding that PDF showed the page rendered with NO layout CSS —
    // no table borders, no cards, no flex rows, so labels ran straight into
    // values ("Subtotal(rupee)1,78,000.00"). Inline styles survived, class
    // rules did not. Generating the same invoice here produced a correctly
    // styled PDF on the identical version, so the code was fine and their
    // environment was not.
    //
    // Root cause of the whole class: html2canvas clones the invoice into a
    // detached document, and that clone has to RE-FETCH the stylesheet by
    // URL. Any reason that fetch fails — a CSP source expression that does
    // not match the origin in use, a service worker (this is a PWA) serving
    // a stale or failed response, a clone document with a null origin —
    // produces a silently unstyled PDF. v1.10.48 widened the CSP, which
    // fixed one cause; this removes the dependency altogether.
    //
    // Now the document's own CSS rules are read out and injected into the
    // clone as a plain <style> element, so the clone never fetches anything.
    // The thermal print path has done exactly this since v1.10.42 — the PDF
    // path simply never adopted it.
    const collectDocumentStyles = () => {
      const parts = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) parts.push(rule.cssText);
        } catch { /* cross-origin (Google Fonts) — skip; system fonts suffice */ }
      }
      return parts.join(String.fromCharCode(10));
    };

    const captureOptions = (el) => ({
      scale: renderScale,
      // v1.10.3 — useCORS was `true` but every image source is a base64
      // data URL (profile.logo, generated QR). `useCORS: true` triggers
      // a CORS preflight on any relative URL that slips in and silently
      // fails; today it's a dead flag but was flagged as fragile.
      useCORS: false,
      logging: false,
      letterRendering: true,
      backgroundColor: '#ffffff',
      // v1.10.3 — was `0` (disable). A broken image (bad logo, stale
      // QR) hung the capture indefinitely, giving the user a stuck
      // "Generating…" spinner. 15s is enough for real images + a
      // fallback for corrupt ones.
      imageTimeout: 15_000,
      width: el.scrollWidth,
      height: el.scrollHeight,
    });

    // Hide extra pages, capture main invoice.
    // v1.10.8 — audit M21 real fix. Prior code stamped the same tall
    // canvas at successive negative-Y offsets. Any row straddling a
    // pdfPageHeight boundary was cut mid-content on the PDF seam.
    // Now: pre-measure the DOM row boundaries so we can crop each
    // virtual page at a safe row-boundary instead of blindly slicing
    // every pdfPageHeight mm.
    //
    // Elements collected as "no-split-inside" anchors:
    //  • Every <tr> in the items table  → keep rows whole.
    //  • .inv-header / .inv-parties     → keep title + billing block whole.
    //  • .inv-footer-block              → keep bank / T&C / notes whole.
    //  • [data-pdf-page-boundary]       → escape hatch for future needs.
    //
    // The set collected here is DOM pixels relative to printRef.current.
    // We convert to canvas pixels below (× domToCanvasScale) once html2canvas
    // has returned and we know the true canvas.width.
    //
    // v1.10.70 - an edge is only offered if no row, footer block, signature
    // block or image straddles it (see safePageBoundaries). The footer is two
    // columns, and the gap between bank details and terms on the left ran
    // straight through the stamp on the right: the stamp printed half on
    // page 1 and half on page 2 (ERR-024).
    const collectRowBoundaries = (container) => {
      const top = container.getBoundingClientRect().top;
      const span = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.max(0, r.top - top), Math.max(0, r.bottom - top)];
      };
      const edges = [0];
      container.querySelectorAll(
        '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
        '.inv-footer, .inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary]'
      ).forEach(el => edges.push(...span(el)));
      const keepWhole = [...container.querySelectorAll(
        '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
        // v1.10.73 - [data-pdf-page-boundary] too: the Boxed grid and Tally
        // designs mark every block with it (signature included), and a page
        // must end at those blocks' edges, never through one.
        '.inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary], img'
      )].map(span);
      return safePageBoundaries(edges, keepWhole);
    };
    // v1.10.70 - hide the extra pages BEFORE measuring, not after. The
    // separate-terms page sits inside the footer row, so measuring with it
    // still visible laid the footer out differently from the capture.
    extraPages.forEach(el => el.style.display = 'none');
    // v1.10.77 (#88) - trim the Tally / Boxed padding if it alone pushes the
    // invoice onto a second page; put back right after the capture.
    if (paperCfg.kind !== 'thermal') spacerFit.restore = fitSpacersToOnePage(printRef.current, pdfWidth, pdfPageHeight, printSettings);
    const domBoundariesPx = collectRowBoundaries(printRef.current);
    const domContainerWidth = printRef.current.getBoundingClientRect().width;

    const mainCanvas = await html2canvas(printRef.current, {
      ...captureOptions(printRef.current),
      onclone: (clonedDoc) => {
        // v1.10.60 (#51) — embed the stylesheet rather than letting the
        // clone re-fetch it. Without this, any fetch failure yields a
        // completely unstyled PDF with no error shown to the user.
        try {
          const css = collectDocumentStyles();
          if (css) {
            const styleEl = clonedDoc.createElement('style');
            styleEl.setAttribute('data-fgsb-inlined', '1');
            styleEl.textContent = css;
            (clonedDoc.head || clonedDoc.documentElement).appendChild(styleEl);
          }
        } catch { /* never block the capture over styling */ }
        clonedDoc.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; });
        const inv = clonedDoc.getElementById('invoice-preview');
        if (inv) {
          // Match the target paper width so html2canvas captures at the right
          // aspect ratio. jsPDF will scale to fit the page width; we set the
          // HTML width to widthMm so glyphs land where CSS put them.
          inv.style.width = `${paperCfg.widthMm}mm`;
          inv.style.overflow = 'visible'; inv.style.minHeight = 'unset';
          inv.style.border = 'none'; inv.style.boxShadow = 'none'; inv.style.borderRadius = '0';
          // v1.9.2 — add printing-mode class so CSS rules force darker colours
          // in the PDF capture. Fixes user complaint that A4/A5 output had
          // very-light gray text that faded on paper printers. Users can
          // turn this off in Print Settings if their printer is fine with
          // lighter greys.
          if (printSettings.pdfDarkenOnPrint !== false) {
            inv.classList.add('printing-mode');
          }
        }
        clonedDoc.querySelectorAll('[data-pdf-page]').forEach(el => el.style.display = 'none');
      }
    });
    extraPages.forEach(el => el.style.display = '');
    spacerFit.restore?.();
    spacerFit.restore = null;

    // v1.10.3 — Record each original page as a "recipe" so multi-copy
    // (GST Rule 48) can duplicate multi-page invoices correctly.
    // v1.10.8 — Each recipe is now its own cropped image (was: one
    // shared tall image with negative-Y offsets). See M21 note above.
    const pageRecipes = [];

    // v1.10.9 — Wire print margins. Prior code ignored `marginTop/Bottom/
    // Left/Right` from printSettings entirely — the UI existed, defaults
    // were in printSettings.js, but no consumer read them. Now: margins
    // shift the invoice image inside each PDF page. Useful for
    // pre-printed letterheads where content must clear the top logo,
    // or for printers with built-in edge margins.
    const mTop = Math.max(0, Number(printSettings.marginTop) || 0);
    const mBottom = Math.max(0, Number(printSettings.marginBottom) || 0);
    const mLeft = Math.max(0, Number(printSettings.marginLeft) || 0);
    const mRight = Math.max(0, Number(printSettings.marginRight) || 0);

    // v1.10.10 — PDF Font Scale now applies at the PDF-placement layer,
    // not just via CSS on the preview. Prior fix (v1.10.9) set an inline
    // `font-size: 80%` on the container, which correctly changed the
    // preview because parent-relative sizing cascaded to a few text
    // nodes — but html2canvas captures the DOM at its natural size, and
    // most children use `rem`/`px` (not `em`), so the raster came out
    // at 100% and the "80% compact" setting silently did nothing in the
    // real PDF. Now: multiply BOTH placement width AND height by the
    // scale. The invoice image lands smaller on the page → text is
    // proportionally smaller → more content fits per PDF page. This
    // matches how MS Word / LibreOffice "shrink to fit" works.
    const rawScale = Number(printSettings.pdfFontScale);
    const pdfScale = isFinite(rawScale) && rawScale > 0
      ? Math.max(0.5, Math.min(1.4, rawScale))
      : 1.0;
    // v1.10.45 — Reserve vertical space for page-2+ header band and the
    // page-number footer band, so content never overlaps them.
    // Reported: business name "Hem E..." collided with the "TERMS &
    // CONDITIONS" heading on page 2 of a multi-page invoice because
    // contentYOffset was `mTop` (usually 0) on every page while the
    // header was drawn at Y=6mm. Now: shrink the multi-page content
    // area by the header + footer bands and shift the image down on
    // page 2+ to sit BELOW the header. Single-page invoices are
    // unaffected — page-header + footer aren't drawn on page 1.
    //
    // 14mm ≈ 9pt bold text (2mm cap) + 2mm gap + 2mm underline offset
    //         + 8mm safety pad (glyph descenders + page-scale slop).
    //  9mm ≈ 8pt footer text at Y = pageHeight - 4mm + safety pad above.
    const isHeaderOn = !isThermalPdf && !!printSettings.pageHeaderEnabled;
    const isFooterOn = !isThermalPdf && !!printSettings.pageNumbersEnabled;
    const pageHeaderReserve = isHeaderOn ? 14 : 0;
    const pageFooterReserve = isFooterOn ? 9  : 0;

    const availWidth  = Math.max(20, pdfWidth      - mLeft - mRight);
    // "Full" = single-page availability (no reserve — page 1 has no header/footer bands).
    // "Multi" = per-page availability during pagination (reserves both bands).
    const availHeightFull  = Math.max(20, pdfPageHeight - mTop - mBottom);
    const availHeightMulti = Math.max(20, availHeightFull - pageHeaderReserve - pageFooterReserve);
    const contentWidth        = availWidth        * pdfScale;
    const contentHeightFull   = availHeightFull   * pdfScale;
    const contentHeightMulti  = availHeightMulti  * pdfScale;
    // Centre the scaled invoice inside the available margin box so
    // shrunk PDFs don't hug the left edge.
    const contentXOffset = mLeft + (availWidth - contentWidth) / 2;
    const contentYOffset = mTop; // top-aligned; bottom margin absorbs slack
    // Recompute the image's rendered height using the reduced content width
    // so aspect ratio stays correct after margins are applied.
    const scaledImgHeight = (mainCanvas.height * contentWidth) / mainCanvas.width;

    // Test hook for tests/smoke.mjs (ERR-024): where each PDF page ends, and
    // where the things a page must never cut through sit - all in the same
    // DOM pixels. Read-only, and costs nothing to anyone else.
    try {
      const t = printRef.current.getBoundingClientRect().top;
      const rel = (el) => { const r = el.getBoundingClientRect(); return [r.top - t, r.bottom - t]; };
      const firstRow = printRef.current.querySelector('.inv-table tbody tr');
      const sig = printRef.current.querySelector('.inv-signature, [data-pdf-signature]');
      window.__lastPdfLayout = {
        pageHeight: contentHeightMulti * domContainerWidth / contentWidth,
        fullHeight: contentHeightFull * domContainerWidth / contentWidth,
        total: mainCanvas.height * domContainerWidth / mainCanvas.width,
        ends: [],
        rowHeight: firstRow ? rel(firstRow)[1] - rel(firstRow)[0] : 0,
        signature: sig ? rel(sig) : null,
        blocks: [...printRef.current.querySelectorAll('.inv-footer-block')].map(rel).filter(([a, b]) => b - a > 2),
        atoms: [...printRef.current.querySelectorAll('.inv-signature, img, [data-pdf-page-boundary]')].map(rel).filter(([a, b]) => b - a > 2),
      };
    } catch { /* test hook only */ }

    // v1.10.77 (#88) - a page that is only slightly too tall (up to 6%) is
    // shrunk to fit, instead of sending the footer to a page of its own: a
    // 4px overflow used to move the terms, bank details and signature to page 2.
    const fitsOnePage = scaledImgHeight <= contentHeightFull + 2
      || (paperCfg.kind !== 'thermal' && scaledImgHeight <= contentHeightFull * 1.06);
    if (window.__lastPdfLayout) window.__lastPdfLayout.onePage = fitsOnePage;
    if (fitsOnePage) {
      // Single-page fits — no cropping needed. Page 1 has no header/footer
      // bands so we can use the full page height (no v1.10.45 reserve).
      const mainImg = mainCanvas.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
      const fit = paperCfg.kind === 'thermal' ? 1 : Math.min(1, contentHeightFull / scaledImgHeight);
      const finalH = paperCfg.kind === 'thermal' ? Math.min(scaledImgHeight, contentHeightFull) : scaledImgHeight * fit;
      const finalW = contentWidth * fit;
      const finalX = contentXOffset + (contentWidth - finalW) / 2;
      // v1.10.33 — Thermal receipts: replace the padded 72×297mm page
      // with one exactly tall enough for the actual receipt content.
      // Prior behaviour: a 40-line receipt on thermal80 produced a PDF
      // with the receipt in the top ~130mm and 165mm of blank paper
      // below — visible in Chrome's Save-as-PDF preview as the huge
      // dark area below the "cut here" line the user reported. Now
      // the PDF page height matches the receipt height (+ margins),
      // so the PDF looks like the on-screen preview.
      //
      // Only fires for the single-page path — multi-page thermal
      // (extremely long receipts) still uses paperCfg.heightMm as a
      // reasonable page-break unit.
      if (paperCfg.kind === 'thermal') {
        const thermalHeightMm = Math.max(30, Math.ceil(finalH + mTop + mBottom + 2));
        pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [paperCfg.widthMm, thermalHeightMm],
          compress: true,
        });
      }
      pdf.addImage(mainImg, imgFormat, finalX, contentYOffset, finalW, finalH, undefined, 'MEDIUM');
      pageRecipes.push({ img: mainImg, y: contentYOffset, h: finalH, x: finalX, w: finalW });
    } else {
      // v1.10.8 multi-page path — snap page breaks to safe DOM row boundaries.
      //
      // 1. Convert DOM-pixel boundaries → canvas-pixel boundaries.
      const domToCanvasScale = mainCanvas.width / domContainerWidth;
      const canvasBoundariesPx = domBoundariesPx.map(y => y * domToCanvasScale);
      const totalCanvasHeightPx = mainCanvas.height;
      if (!canvasBoundariesPx.includes(totalCanvasHeightPx)) {
        canvasBoundariesPx.push(totalCanvasHeightPx);
      }
      canvasBoundariesPx.sort((a, b) => a - b);

      // 2. How many canvas pixels correspond to one CONTENT height?
      // v1.10.9 — was pdfPageHeight * (mainCanvas.width / pdfWidth). Now
      // uses contentHeight (page - top - bottom margins) so page breaks
      // respect the margin band.
      // v1.10.45 — uses contentHeightMulti so page splits also
      // reserve room for the header/footer bands drawn on page 2+.
      const pdfPageHeightCanvasPx = contentHeightMulti * (mainCanvas.width / contentWidth);

      // 3. Walk the canvas top-to-bottom, allocating pages. For each
      //    page: find the largest boundary ≤ naive end, but > current
      //    page start (progress guarantee).
      const pageSplits = [];
      let pageStart = 0;
      let safety = 0;
      while (pageStart < totalCanvasHeightPx && safety++ < 100) {
        const naiveEnd = pageStart + pdfPageHeightCanvasPx;
        if (naiveEnd >= totalCanvasHeightPx) {
          pageSplits.push({ start: pageStart, end: totalCanvasHeightPx });
          break;
        }
        // Prefer the LAST boundary at or before naiveEnd; must exceed pageStart.
        let safeEnd = null;
        for (let i = canvasBoundariesPx.length - 1; i >= 0; i--) {
          const b = canvasBoundariesPx[i];
          if (b <= naiveEnd + 1 && b > pageStart + 20) {   // +20px min progress
            safeEnd = b;
            break;
          }
        }
        // No safe boundary found in range (a single "row" bigger than a page,
        // e.g. a huge terms block). Fall back to a hard slice — but still
        // print SOMETHING rather than looping forever.
        if (safeEnd === null) safeEnd = naiveEnd;
        pageSplits.push({ start: pageStart, end: safeEnd });
        pageStart = safeEnd;
      }

      if (window.__lastPdfLayout) {
        window.__lastPdfLayout.ends = pageSplits.slice(0, -1).map(s => s.end / domToCanvasScale);
      }

      // 4. For each page, crop mainCanvas → temp canvas → data URL → PDF.
      // v1.10.9 — margins; v1.10.10 — pdfFontScale via centred placement.
      // v1.10.45 — page 2+ shifts down by pageHeaderReserve so the
      // business-name header drawn later never overlaps the invoice.
      for (let i = 0; i < pageSplits.length; i++) {
        const { start, end } = pageSplits[i];
        const cropHeight = end - start;
        if (cropHeight < 1) continue;
        const tmp = document.createElement('canvas');
        tmp.width = mainCanvas.width;
        tmp.height = cropHeight;
        const ctx = tmp.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tmp.width, cropHeight);
        ctx.drawImage(mainCanvas, 0, -start);
        const pageImg = tmp.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
        const pageMmHeight = (cropHeight * contentWidth) / mainCanvas.width;
        if (i > 0) pdf.addPage();
        const yForThisPage = contentYOffset + (i > 0 ? pageHeaderReserve : 0);
        pdf.addImage(pageImg, imgFormat, contentXOffset, yForThisPage, contentWidth, pageMmHeight, undefined, 'MEDIUM');
        pageRecipes.push({ img: pageImg, y: yForThisPage, h: pageMmHeight, x: contentXOffset, w: contentWidth });
      }
    }

    // Capture each extra section as a separate PDF page (also recipe-tracked).
    // v1.10.45 — Extra pages are always page 2+ so they must reserve room
    // for the header/footer bands too. Otherwise attached rich-text pages
    // hit the same "business name overlaps content" bug as multi-page
    // splits. yOffset shifts the image below the header band; the max
    // height clamps to the reduced available area.
    const extraYOffset = pageHeaderReserve;
    const extraMaxH = Math.max(20, pdfPageHeight - extraYOffset - pageFooterReserve);
    for (const pageEl of extraPages) {
      const c = await html2canvas(pageEl, {
        ...captureOptions(pageEl),
        onclone: (cd) => { cd.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; }); }
      });
      const extraImg = c.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
      const extraH = Math.min((c.height * pdfWidth) / c.width, extraMaxH);
      pdf.addPage();
      pdf.addImage(extraImg, imgFormat, 0, extraYOffset, pdfWidth, extraH, undefined, 'MEDIUM');
      pageRecipes.push({ img: extraImg, y: extraYOffset, h: extraH });
    }

    // v1.10.3 — scalerEl restoration moved to outer buildPDF's `finally`
    // block so it runs even if a later step throws.

    // ============================================================
    // v1.9.0 post-processing — every step below is toggleable via
    // printSettings. Priority order is:
    //   1. Add margins (visual white border, if user set them)
    //   2. Multi-copy expansion (Original / Duplicate / Triplicate)
    //   3. Watermark overlay
    //   4. Reprint indicator
    //   5. Barcode / QR of invoice number
    //   6. Feedback QR
    //   7. Page numbers + business header on subsequent pages
    // ============================================================
    const ps = printSettings; // captured from closure below

    // ----- Multi-copy (Original / Duplicate / Triplicate) -----
    // GST Rule 48 for goods: 3 copies. For services: 2 copies.
    // v1.10.3 — Rebuilt to correctly duplicate multi-page invoices. See
    // pageRecipes comment above for background.
    if (ps.multiCopyEnabled && ps.multiCopyCount > 1) {
      const labels = ps.multiCopyLabels || ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE'];
      const originalPageCount = pageRecipes.length;   // correct: 1 recipe per original page
      // Replay every original page for each additional copy.
      for (let copyIdx = 1; copyIdx < ps.multiCopyCount; copyIdx++) {
        for (const recipe of pageRecipes) {
          pdf.addPage();
          // v1.10.9 — margins carry through to duplicated copies via
          // recipe.x/w (fallback to 0/pdfWidth for legacy shapes).
          pdf.addImage(recipe.img, imgFormat,
            recipe.x ?? 0, recipe.y,
            recipe.w ?? pdfWidth, recipe.h,
            undefined, 'MEDIUM');
        }
      }
      // Now stamp corner labels using a math that actually corresponds
      // to which copy each page belongs to (was wrong before too).
      const totalCopies = ps.multiCopyCount;
      for (let copyIdx = 0; copyIdx < totalCopies; copyIdx++) {
        const label = labels[Math.min(copyIdx, labels.length - 1)] || `COPY ${copyIdx + 1}`;
        for (let p = 1; p <= originalPageCount; p++) {
          const absolutePage = copyIdx * originalPageCount + p;
          pdf.setPage(absolutePage);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(80, 80, 80);
          const labelWidth = pdf.getTextWidth(label) + 6;
          pdf.setDrawColor(80, 80, 80);
          pdf.setLineWidth(0.3);
          pdf.rect(pdfWidth - labelWidth - 4, 4, labelWidth, 6, 'S');
          pdf.text(label, pdfWidth - labelWidth - 1, 8);
          pdf.setTextColor(0);
        }
      }
    }

    // v1.10.3 — free the multi-megabyte base64 image strings once
    // multi-copy replay is done. Post-processing steps below only
    // mutate the PDF pages, they don't need the source images. Prior
    // code held mainImg + pageRecipes in closure through the whole
    // watermark/QR/page-number loop, doubling peak memory.
    pageRecipes.length = 0;

    // v1.10.12 — Gate the A4/A5-only post-processing on thermal paper.
    // Reports: (a) "watermark coming for thermal also — it should not
    // come", (b) page numbers "Page 2 of 3" don't make sense on a
    // continuous receipt roll, (c) invoice QR / feedback QR crowd out
    // the actual print on 58mm rolls. All post-processing steps below
    // are skipped when the paper is thermal.
    // v1.10.33 note: isThermalPdf is now hoisted to the top of
    // __buildPDFInner (see v1.10.46 comment). Original rationale
    // for the check: `.startsWith('thermal')` missed the `custom`
    // preset at sub-100mm widths, so a Custom 76mm PDF got the
    // sheet-only watermark / page numbers / QR overlays that
    // don't belong on a thermal roll.

    // ----- Watermark overlay -----
    // v1.10.12 — Cleaned up the preset ↔ custom decision:
    //   • Custom mode ON  + custom text FILLED   → use custom text.
    //   • Custom mode ON  + custom text EMPTY    → skip (no silent
    //     fallback to preset — that was the confusing behavior
    //     reported as "after selecting predefined then customer
    //     watermark or else it is not working").
    //   • Custom mode OFF → use preset.
    //   • Master toggle OFF or thermal paper       → skip entirely.
    let rawText = null;
    if (!isThermalPdf && ps.watermarkEnabled) {
      if (ps.watermarkUseCustomText) {
        rawText = ps.watermarkCustomText ? ps.watermarkCustomText : null;
      } else {
        rawText = ps.watermarkText || null;
      }
    }
    if (rawText) {
      const text = String(rawText).toUpperCase();
      const opacity = Math.max(0, Math.min(1, (Number(ps.watermarkOpacity) || 15) / 100));
      const angle = Number(ps.watermarkAngle) || -35;
      const size = Number(ps.watermarkFontSize) || 90;
      const finalPages = pdf.getNumberOfPages();
      for (let p = 1; p <= finalPages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(size);
        // jsPDF opacity via GState (setGState)
        try {
          const gState = new pdf.GState({ opacity });
          pdf.setGState(gState);
        } catch { /* older jsPDF versions — fallback to grey text */ }
        pdf.setTextColor(200, 200, 200);
        // Center the watermark on the page
        const cx = pdfWidth / 2;
        const cy = pdfPageHeight / 2;
        pdf.text(text, cx, cy, { align: 'center', angle });
        try {
          const gState = new pdf.GState({ opacity: 1 });
          pdf.setGState(gState);
        } catch { /* no-op */ }
        pdf.setTextColor(0);
      }
    }

    // ----- Reprint indicator (automatic when this bill has been printed before) -----
    // v1.10.41 — Reported: "REPRINT · Copy #2" badge was overlapping the
    // business logo in the top-left of the PDF. Root cause: badge was
    // pinned at x=4, y=4 which is exactly where every template's logo
    // sits. Two fixes:
    //   1. Move the badge to the TOP-RIGHT corner (pageWidth - w - 4)
    //      so it never fights the logo for space.
    //   2. Default reprintLabelEnabled = false (see printSettings.js) so
    //      users don't get the surprise stamp on every second download.
    //      Only retail/restaurant users who genuinely need POS reprint
    //      tracking will turn it on — the Print Settings toggle is
    //      already gated to those business types.
    if (!archive && !isThermalPdf && ps.reprintLabelEnabled && Number(editingBill?.printedCount) > 0) {
      const label = `REPRINT · Copy #${(Number(editingBill.printedCount) || 0) + 1}`;
      const finalPages = pdf.getNumberOfPages();
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      for (let p = 1; p <= finalPages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(220, 38, 38);
        const w = pdf.getTextWidth(label) + 4;
        const x = pageWidthMm - w - 4;  // top-right corner
        pdf.setDrawColor(220, 38, 38);
        pdf.rect(x, 4, w, 6, 'S');
        pdf.text(label, x + 2, 8);
        pdf.setTextColor(0);
      }
    }

    // ----- Barcode / QR of invoice number -----
    if (!isThermalPdf && (ps.invoiceQrEnabled || ps.invoiceBarcodeEnabled)) {
      // Use the qrcode library that's already a dep for UPI QR
      const QRCode = (await import('qrcode')).default;
      const qrPayload = ps.invoiceQrUrl
        ? ps.invoiceQrUrl.replace(/\{invoice_number\}/g, encodeURIComponent(details.invoiceNumber))
        : details.invoiceNumber;
      if (ps.invoiceQrEnabled) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
          pdf.setPage(pdf.getNumberOfPages());
          const size = 18; // mm
          pdf.addImage(qrDataUrl, 'PNG', pdfWidth - size - 6, pdfPageHeight - size - 12, size, size);
          pdf.setFontSize(6); pdf.setTextColor(80);
          pdf.text('Verify invoice', pdfWidth - size - 6, pdfPageHeight - 6);
          pdf.setTextColor(0);
        } catch { /* skip on error */ }
      }
      // "Barcode" — jsPDF can't render true Code128 without a lib, so we render
      // a big monospace text version of the invoice number that scans as OCR-able
      // and is legible for humans + warehouse workflows.
      if (ps.invoiceBarcodeEnabled) {
        pdf.setPage(pdf.getNumberOfPages());
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.text(String(details.invoiceNumber), 8, pdfPageHeight - 6);
      }
    }

    // ----- Feedback / Review QR -----
    if (!isThermalPdf && ps.feedbackQrEnabled && ps.feedbackQrUrl) {
      const QRCode = (await import('qrcode')).default;
      try {
        const dataUrl = await QRCode.toDataURL(ps.feedbackQrUrl, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
        pdf.setPage(pdf.getNumberOfPages());
        const size = 16;
        pdf.addImage(dataUrl, 'PNG', 6, pdfPageHeight - size - 12, size, size);
        pdf.setFontSize(6); pdf.setTextColor(80);
        pdf.text(ps.feedbackQrLabel || 'Rate us', 6, pdfPageHeight - 6);
        pdf.setTextColor(0);
      } catch { /* skip */ }
    }

    // ----- Page numbers + business header on subsequent pages -----
    if (!isThermalPdf && (ps.pageNumbersEnabled || ps.pageHeaderEnabled) && pdf.getNumberOfPages() > 1) {
      const finalPages = pdf.getNumberOfPages();
      for (let p = 2; p <= finalPages; p++) {
        pdf.setPage(p);
        if (ps.pageHeaderEnabled && profile?.businessName) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(80);
          pdf.text(profile.businessName, 8, 6);
          pdf.setDrawColor(200); pdf.setLineWidth(0.2);
          pdf.line(8, 8, pdfWidth - 8, 8);
          pdf.setTextColor(0);
        }
        if (ps.pageNumbersEnabled) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(120);
          pdf.text(`Page ${p} of ${finalPages}`, pdfWidth - 8, pdfPageHeight - 4, { align: 'right' });
          pdf.setTextColor(0);
        }
      }
    }

    return pdf;
  };

  // Per-view keyboard shortcuts.
  //   Ctrl/Cmd+S       — save invoice (no PDF) if meaningful
  //   Ctrl/Cmd+P       — download PDF
  //   Ctrl/Cmd+Enter   — add a new line item (v1.10.22)
  //   Ctrl/Cmd+Shift+D — duplicate the LAST line item (v1.10.22)
  //   Esc              — close the leave-guard modal (v1.10.22)
  useEffect(() => {
    const onKey = (e) => {
      // Esc closes the leave modal without needing Ctrl.
      if (e.key === 'Escape' && leaveModal) {
        e.preventDefault();
        setLeaveModal(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 's' || e.key === 'S') {
        if (!isMeaningfulInvoice()) return; // nothing to save
        e.preventDefault();
        saveInvoiceToDB().then(async (no) => { if (no) { toast('Invoice saved', 'success'); await refreshSavedPdf(no); } }).catch(() => toast('Save failed', 'error'));
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // Defer to the next tick so the keydown doesn't race the PDF render.
        setTimeout(() => generatePDF(), 0);
      } else if (e.key === 'Enter') {
        // Add a new line item. Doesn't fire when the user is inside a form
        // element that should get Enter (rich-text editor autofocus etc.) —
        // browsers dispatch Ctrl+Enter to the row-level input which won't
        // preventDefault by itself.
        e.preventDefault();
        addItem();
      } else if (e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Duplicate the last item — quick win for "same item, next line".
        e.preventDefault();
        setItems(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          return [...prev, { ...last, id: Date.now().toString() }];
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeaningfulInvoice, leaveModal]);

  // v1.10.3 — Shared print-via-iframe helper. Prior code duplicated the
  // "createObjectURL + iframe + revoke on load" pattern in 3 places and
  // ALL 3 leaked the blob URL if `onload` never fired (broken PDF,
  // iframe blocked). Now: revoked in error handler AND unconditionally
  // on load. Iframe stays (reused by id) but does not accumulate.
  const printViaIframe = (blob) => {
    const url = URL.createObjectURL(blob);
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } };
    // Belt: 90s hard timeout in case onload never fires.
    const timer = setTimeout(cleanup, 90_000);
    try {
      let frame = document.getElementById('fgsb-print-frame');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'fgsb-print-frame';
        frame.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;';
        document.body.appendChild(frame);
      }
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch { window.open(url, '_blank'); }
        // Give the print job ~60s to grab the buffer, then revoke.
        setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
      };
      frame.onerror = () => { clearTimeout(timer); cleanup(); };
    } catch (err) {
      clearTimeout(timer); cleanup(); throw err;
    }
  };

  // v1.10.42 — Vector-HTML thermal print (revived from v1.10.35). Clones
  // the on-screen invoice-preview element + the document's stylesheets
  // into a hidden iframe, sets @page: size WIDTHmm auto, and calls
  // iframe.contentWindow.print(). Text stays VECTOR all the way to the
  // printer driver — 203-dpi thermal rasterises at native resolution
  // → sharp glyphs regardless of font size, smaller print jobs, faster
  // buffer fill on cheap thermal printers with tiny buffers.
  //
  // This is what the v1.10.35 ThermalPreviewModal was doing before the
  // v1.10.36 revert. We lost it there because custom paper widths + a
  // separate modal-hosted <InvoicePreview> instance introduced CSS drift
  // vs the on-screen render. This revival uses the parent's existing
  // on-screen `printRef` (same DOM the user is seeing), avoiding that
  // drift class entirely.
  //
  // Returns true on success, false if the browser blocked programmatic
  // iframe print (rare — chrome/edge/safari all allow it from a user-
  // gesture click, which is our only caller). The false case lets the
  // caller fall back to the PDF path without a toast on the user.
  const printThermalViaHtml = async () => {
    if (!printRef.current) return false;
    const receipt = printRef.current.querySelector('#invoice-preview') || printRef.current;
    if (!receipt) return false;

    const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
    const widthMm = paperCfg.widthMm || 80;

    // Collect the document's CSS text so the iframe renders identically.
    // Cross-origin stylesheets (Google Fonts, etc.) throw on cssRules
    // access — skip those; thermal renders fine with system fonts.
    const collectStyles = () => {
      const parts = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) parts.push(rule.cssText);
        } catch { /* cross-origin, skip */ }
      }
      return parts.join('\n');
    };

    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Receipt</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    #invoice-preview {
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      min-height: 0 !important;
    }
    ${collectStyles()}
  </style>
</head>
<body>${receipt.outerHTML}</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;border:0;';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    try {
      await new Promise((resolve) => {
        iframe.onload = resolve;
        iframe.srcdoc = doc;
      });
      // Wait for images (logo, QR) inside the iframe. 3s safety per image.
      const imgs = iframe.contentDocument?.querySelectorAll('img') || [];
      await Promise.all(Array.from(imgs).map(img => (
        img.complete
          ? Promise.resolve()
          : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 3000); })
      )));
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Give the driver ~8s to grab the buffer before we tear down.
      setTimeout(() => { try { iframe.remove(); } catch { /* ignore */ } }, 8000);
      return true;
    } catch (err) {
      console.warn('Direct thermal print failed, will fall back to PDF:', err);
      try { iframe.remove(); } catch { /* ignore */ }
      return false;
    }
  };

  // v1.10.3 — Thermal receipts (58mm / 80mm rolls) no longer go through
  // html2canvas → JPEG → jsPDF. That path was 100× the CPU/memory of
  // what's needed for a text-only receipt. Now: for thermal paper sizes
  // we hand the browser the invoice HTML directly via a print-focused
  // window.print() flow. Modern printer drivers handle 58/80mm rolls
  // natively when the CSS `@page size` matches.
  //
  // v1.10.33 — Bug fix: was `.startsWith('thermal')` which does NOT
  // match the `custom` preset even when its width is under 100mm
  // (getPaperSize returns kind='thermal' for those). So a user picking
  // Custom 76mm was routed through the sheet-print path — thick roll
  // wasted paper, watermark stamped on receipt, HSN/rate lines shown.
  // Now: single source of truth — getPaperSize().kind.
  const isThermalPaper = () => getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

  // v1.10.26 — Focus mode moves the preview pane off-screen (position:
  // absolute), which is fine for html2canvas (layout still computed) but
  // breaks window.print() for thermal (prints visible viewport only).
  // Un-collapse the preview for the duration of any print / download
  // operation and restore after.
  //
  // v1.10.27 — Reported: "after print, preview panel comes back up and
  // hiding again have to click." Prior code registered an `afterprint`
  // listener + 30s safety timeout, which never fired in two of the three
  // paths and left the preview expanded:
  //   - Download PDF has NO print dialog → afterprint never fires
  //   - A4 iframe print → afterprint fires on iframe.contentWindow, not
  //     the parent window we were listening on
  //   - Only thermal window.print() correctly fired afterprint on parent
  //
  // Fix: restore in the finally block, unconditionally. window.print()
  // blocks the JS thread until the native dialog closes on all desktop
  // browsers, so the restore happens after the user is done with print.
  // On mobile Safari where print() may not block, the DOM was already
  // captured at the moment print() was invoked, so restoring right after
  // is safe.
  const withPreviewOnScreen = async (fn) => {
    const wasCollapsed = previewCollapsed;
    if (!wasCollapsed) return fn();
    setPreviewCollapsed(false);
    // v1.10.28 — bumped settle from 50ms → 200ms. Reported: PDF sometimes
    // came out with content shoved to top-left on slower devices. Root
    // cause: after removing position: absolute, browser needs a real layout
    // pass; 50ms wasn't enough for React commit + reflow on low-end Android.
    // Two rAFs + a settle timeout so React commits the DOM change AND
    // the browser lays out the newly-visible preview before we snapshot.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))));
    try {
      return await fn();
    } finally {
      setPreviewCollapsed(true);
    }
  };

  // v1.10.36 — Print pipeline split into two functions:
  //   1. `executePrint` — the actual work (buildPDF → printViaIframe).
  //      This is the SAME code path that was working in v1.10.34 and
  //      after the v1.10.35 → v1.10.36 revert. Guaranteed reliable.
  //   2. `directPrint` — user-facing Print button click handler. For
  //      thermal invoices, opens the PrintPreviewModal first so the
  //      user sees exactly what will print before it goes. For A4/sheet,
  //      calls executePrint directly because the OS print dialog
  //      already shows a full page preview.
  //
  // The modal DOES NOT re-render or re-serialize anything for printing
  // — its Print button just calls executePrint, which uses the parent's
  // existing on-screen `printRef`. Both the modal's <InvoicePreview>
  // and the printed output come from the SAME component with the SAME
  // props → bit-for-bit identical. Zero CSS drift risk (this was the
  // v1.10.35 bug — a re-serialized iframe DOM diverged from the on-
  // screen render because of dropped cross-origin fonts + max-width
  // caps beating inline widths). See PrintPreviewModal.jsx for details.
  // Save before any PDF or print is made, counting it as printed once more.
  // A new invoice gets its real number here (the form only shows a peek until
  // the first save), so the PDF must be built AFTER this, once the preview has
  // re-rendered with that number. Returns the saved number, or null.
  const saveForOutput = async () => {
    if (readOnlyDoc) return details.invoiceNumber; // printed or downloaded as it is
    const prevPrinted = editingBill && !editingBill._isDuplicate ? Number(editingBill.printedCount) || 0 : 0;
    const no = await saveInvoiceToDB(false, {
      printedCount: prevPrinted + 1,
      lastPrintedAt: new Date().toISOString(),
    });
    if (!no) return null;
    hasOutput.current = true;
    clearDraft();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return no;
  };

  // Prints what the preview shows. Returns true when it was sent to print.
  const printPreview = () => withPreviewOnScreen(async () => {
    try {
      // v1.10.42 — Thermal + user hasn't opted out of direct print?
      // Try the vector-HTML path first. If the browser blocks it
      // (returned false), silently fall through to the PDF path so
      // the user still gets a print — no surfaced error required.
      if (isThermalPaper() && (getPrintSettings().thermalPrintMode || 'direct') === 'direct') {
        const ok = await printThermalViaHtml();
        if (ok) return true;
      }
      const pdf = await buildPDF({ forPrint: true });
      printViaIframe(pdf.output('blob'));
      return true;
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
      return false;
    }
  });

  const executePrint = async () => {
    if (!printRef.current) return;
    setSaving(true);
    try {
      // Printing hands the client a numbered invoice, so it is saved first,
      // like Save & Download (it used to print without saving at all).
      const saved = await saveForOutput();
      if (!saved) return;
      await printPreview();
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
    } finally {
      setSaving(false);
    }
  };

  // v1.10.77 (#86) - opened by the Dashboard's Print button: print once the
  // preview has drawn, then go back to the Dashboard.
  // The timer only raises a flag: the print itself runs on the next render,
  // with the invoice loaded. (Calling the print from the timer used the first
  // render's empty form: 'Bill must have an id'.)
  const [printOnOpen, setPrintOnOpen] = useState(false);
  const printOnOpenDone = useRef(false);
  useEffect(() => {
    if (!editingBill?._printOnOpen) return undefined;
    const t = setTimeout(() => setPrintOnOpen(true), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!printOnOpen || printOnOpenDone.current) return;
    printOnOpenDone.current = true;
    // A saved invoice printed as it is: nothing in it is saved again (a full
    // save would refresh its business details and options from today's
    // settings); only the print count goes up on the stored copy.
    (async () => {
      setSaving(true);
      try {
        if (printRef.current && await printPreview()) {
          const stored = (await getAllBills()).find((b) => b.id === editingBill.id);
          if (stored) {
            await saveBill({ ...stored, printedCount: (Number(stored.printedCount) || 0) + 1, lastPrintedAt: new Date().toISOString() }, { overwrite: true });
          }
        }
      } catch (err) {
        console.error('Print failed', err);
      } finally {
        setSaving(false);
      }
      clearDraft();
      onBack();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOnOpen]);

  const directPrint = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    if (isThermalPaper()) {
      // Thermal → show the preview modal. Actual print fires from the
      // modal's Print button via executePrint. User can Cancel there
      // if the preview looks wrong.
      setShowPrintPreview(true);
      return;
    }
    // A4 / A5 / Letter / Legal — go straight to print. Chrome's own
    // dialog already shows a page-accurate preview, no in-app modal
    // needed for these.
    await executePrint();
  };

  // v1.10.83 - the preview window can now be opened any time (Full view), so
  // its Print button gets the same blank-invoice check as the Print button.
  const printFromPreview = async () => {
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    await executePrint();
  };

  // The copy kept in the app's "Saved Invoices" folder (Client / Month / file.pdf).
  const saveToInvoicesFolder = (pdfBlob, fileName) => {
    const invoiceDate = details.invoiceDate ? new Date(details.invoiceDate) : new Date();
    const monthName = invoiceDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const params = new URLSearchParams({ name: fileName, client: client?.name || 'General', month: monthName });
    return fetch(`/api/save-pdf?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdfBlob })
      .then((r) => { if (!r.ok) throw new Error(`save-pdf ${r.status}`); });
  };

  // v1.10.76 (#83) - reported: editing an invoice and pressing Save updated
  // the invoice but left the old PDF in Saved Invoices. If this invoice was
  // ever downloaded or printed, Save now rebuilds that PDF too (no download).
  const refreshSavedPdf = async (savedNumber) => {
    if (!hasOutput.current || !printRef.current) return;
    try {
      const pdf = await withPreviewOnScreen(() => buildPDF({ archive: true }));
      await saveToInvoicesFolder(pdf.output('blob'), `${typeConfig.prefix}_${savedNumber.replace(/\//g, '-')}.pdf`);
      toast('The PDF in Saved Invoices is updated too', 'info');
    } catch (err) {
      console.error('Saved Invoices PDF refresh failed:', err);
      toast('Invoice saved, but its PDF in Saved Invoices could not be updated. Use Save & Download.', 'warning');
    }
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    try {
      setSaving(true);
      // Save first so the PDF shows the number the invoice was saved under.
      const savedNumber = await saveForOutput();
      if (!savedNumber) return;
      // v1.10.26 — force preview on-screen so html2canvas can snapshot it.
      const pdf = await withPreviewOnScreen(() => buildPDF());
      const fileName = `${typeConfig.prefix}_${savedNumber.replace(/\//g, '-')}.pdf`;
      pdf.save(fileName);

      const pdfBlob = pdf.output('blob');

      // Save to local "Saved Invoices" folder (Client Name / Month / file.pdf)
      const clientName = client?.name || 'General';
      // A cancelled invoice keeps its CANCELLED-stamped copy in Saved Invoices
      // (and the original kept for Undo); downloading it again leaves those alone.
      if (!(readOnlyDoc && editingBill?.status === 'cancelled')) saveToInvoicesFolder(pdfBlob, fileName).catch(() => {});

      toast(`Invoice downloaded & saved to Saved Invoices/${clientName}/`, 'success');
      uploadToGoogleDrive(pdfBlob, fileName);

      // v1.10.3 — auto-print via the shared printViaIframe helper.
      // v1.10.5 — also fire when the loaded client has autoPrint=true,
      // even if the app-wide autoPrintOnSave is off (per-client override).
      const ps = getPrintSettings();
      if (ps.autoPrintOnSave || invoiceOptions.clientAutoPrint) {
        try { printViaIframe(pdfBlob); }
        catch { /* non-fatal — user already has the PDF downloaded */ }
      }
    } catch (err) {
      console.error(err);
      toast('Failed to generate PDF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const shareWhatsApp = () => {
    // v1.10.29 — reported: "when i use whatsapp button it is sending
    // subtotal amount". Cause: this used `items.reduce((s, i) => s +
    // (i.quantity * i.rate), 0)` — that's the pre-tax subtotal, not the
    // invoice total. Now uses totals.total (post-tax, post-discount, with
    // round-off + TCS + invoice-level discount all applied) — the same
    // number that appears on the PDF and gets saved as bill.totalAmount.
    const cur = invoiceOptions.currency || 'INR';
    const total = formatCurrency(Number(totals.total) || 0, cur);
    const subtotal = formatCurrency(printedSubtotal(totals), cur);
    const dateStr = details.invoiceDate ? new Date(details.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const businessName = profile?.businessName || '';
    const lines = [
      `*Invoice: ${details.invoiceNumber}*`,
      `Date: ${dateStr}`,
      `Client: ${client?.name || ''}`,
      `Subtotal: ${subtotal}`,
      `*Total: ${total}*`,
    ];
    if (businessName) lines.push('', `— ${businessName}`);
    openWhatsAppShare(client?.phone, lines.join('\n'));
  };

  const exportEWayBill = () => {
    if (!profile?.gstin) { toast('Set your GSTIN in Settings first', 'warning'); return; }
    // v1.10.74 - a blank invoice made an E-Way Bill JSON the portal rejects.
    if (!items.some(i => (i.name || '').trim() && (i.quantity || 0) * (i.rate || 0) > 0)) {
      toast('Add at least one item with a quantity and rate first.', 'warning');
      return;
    }
    // v1.10.1 — Pass taxInclusive so back-calc taxable value on line items.
    // Otherwise E-Way Bill portal rejects with `amount_mismatch` on MRP-inclusive invoices.
    // A missing PIN code (or a non-Indian business) throws with what to fill
    // and where; uncaught, the click used to do nothing at all.
    let ewb;
    try {
      ewb = generateEWayBillJSON(profile, client, details, items, totals, invoiceType, { taxInclusive });
    } catch (err) {
      toast(err.message || 'Could not make the E-Way Bill file', 'warning', 8000);
      return;
    }
    const blob = new Blob([JSON.stringify(ewb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EWB-${details.invoiceNumber?.replace(/\//g, '-') || 'draft'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('E-Way Bill JSON downloaded', 'success');
  };

  const einvoiceOn = isModuleEnabled('einvoice', getEnabledModules());
  const tdsTcsOn = isModuleEnabled('tdsTcs', getEnabledModules());
  const ewayOn = isModuleEnabled('ewayBill', getEnabledModules());
  const saveEinvoice = async (value) => {
    try {
      const stored = (await getAllBills()).find((b) => b.id === savedId.current);
      if (!stored) { toast('Save the invoice first.', 'warning'); return false; }
      const { einvoice: _old, ...rest } = stored;
      await saveBill(value ? { ...rest, einvoice: value } : rest, { overwrite: true });
      setEinvoice(value);
      toast(value ? 'IRN saved. It now prints on the invoice.' : 'IRN removed', 'success');
      return true;
    } catch (err) {
      console.error('Saving the IRN failed', err);
      toast('Could not save the IRN. Try again.', 'error');
      return false;
    }
  };

  const handleExplicitSave = async () => {
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return null; }
    try {
      setSaving(true);
      setAutoSaveStatus('saving');
      const no = await saveInvoiceToDB();
      if (!no) {
        setAutoSaveStatus('dirty');
        return null;
      }
      clearDraft();
      setValidationResult({ valid: true, errors: [], fieldErrors: {}, rowErrors: {}, warnings: [] });
      toast(`Invoice ${no} saved`, 'success');
      await refreshSavedPdf(no);
      return no;
    } catch (err) {
      setAutoSaveStatus('dirty');
      if (err?.status !== 409) {
        console.error('Save failed', err);
        toast('Save failed — try again', 'error');
      }
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndNew = async () => {
    const savedNo = await handleExplicitSave();
    if (!savedNo) return;
    isDirty.current = false;
    if (typeof onCreateNextInvoice === 'function') {
      onCreateNextInvoice();
      requestAnimationFrame(() => {
        const el = document.getElementById('invoice-client-name');
        if (el) el.focus();
      });
    }
  };

  return (
    <div className="generator-container">
      {readOnlyDoc && (
        <div className="notice notice-info" role="status" style={{ marginBottom: '0.6rem' }}>
          {editingBill.convertedTo
            ? `Converted to ${editingBill.convertedTo}. This copy is read-only; you can still download or print it.`
            : 'This invoice is cancelled and read-only; you can still download or print it. Undo the cancel on the Dashboard to change it.'}
          <HelpButton title="When an invoice cannot be changed" doc="invoices#read-only" size={16} />
        </div>
      )}
      {einvoice?.irn && !readOnlyDoc && (
        <div className="notice notice-warn" role="status" style={{ marginBottom: '0.6rem' }}>
          This invoice has an IRN. Changes made here are not sent to the e-invoice portal. To correct an e-invoice, cancel it on the portal (within 24 hours) and issue a new one, or issue a credit note.
          <HelpButton title="E-invoicing" doc="gst-returns#e-invoice" size={16} />
        </div>
      )}
      {draftStorageWarning && (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '0.6rem', fontSize: '0.8rem' }}>
          ⚠ Local browser storage is full — your in-progress edits are safe in memory, but cannot be cached as an offline draft. Click <strong>Save</strong> to persist this invoice to the server.
        </div>
      )}
      {!validationResult.valid && validationResult.errors?.length > 0 && (
        <div className="validation-summary-banner" role="alert" aria-live="assertive">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#b91c1c', fontSize: '0.8rem' }}>
              <AlertCircle size={15} /> Please fix {validationResult.errors.length} issue{validationResult.errors.length > 1 ? 's' : ''} before saving:
            </strong>
            <button
              type="button"
              onClick={() => setValidationResult({ valid: true, errors: [], fieldErrors: {}, rowErrors: {}, warnings: [] })}
              style={{ border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            >
              Dismiss ✕
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {validationResult.errors.map((err, i) => (
              <li key={i} style={{ fontSize: '0.76rem', color: '#991b1b' }}>
                {err.fieldId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(err.fieldId);
                      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
                    }}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#991b1b', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', textAlign: 'left' }}
                  >
                    {err.message}
                  </button>
                ) : err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showEinvoice && (
        <EInvoiceEditorModal
          bill={{
            invoiceNumber: details.invoiceNumber, invoiceDate: details.invoiceDate, invoiceType,
            status: editingBill && !editingBill._isDuplicate ? editingBill.status : 'unpaid',
            currency: invoiceOptions.currency || 'INR', einvoice,
            data: { profile, client, details, items, totals, invoiceType, customTerms, invoiceOptions, taxInclusive },
          }}
          profile={profile} bills={allBillsForCredit} saved={showEinvoice.saved}
          onSaveIrn={saveEinvoice} onClose={() => setShowEinvoice(false)} />
      )}
      <div className="generator-toolbar erp-single-row-toolbar">
        <div className="erp-toolbar-left">
          <button className="btn btn-secondary erp-toolbar-btn" onClick={handleBack} title="Back to Dashboard">
            <ArrowLeft size={14} /> Back
          </button>
          {(() => {
            const isSavingNow = saving || autoSaveStatus === 'saving';
            const isSavedClean = !isDirty.current && (hasBeenSaved.current || autoSaveStatus === 'saved');
            const isDirtyUnsaved = isDirty.current;
            const color = isSavingNow ? '#2563eb' : isSavedClean ? '#059669' : isDirtyUnsaved ? '#d97706' : '#64748b';
            const bg = isSavingNow ? 'rgba(37, 99, 235, 0.12)'
              : isSavedClean ? 'rgba(5, 150, 105, 0.12)'
              : isDirtyUnsaved ? 'rgba(217, 119, 6, 0.14)'
              : 'var(--bg-secondary)';
            const label = isSavingNow ? 'Saving…'
              : isSavedClean ? `Saved${savedId.current ? ` · ${savedId.current}` : ''}`
              : isDirtyUnsaved ? 'Unsaved changes'
              : 'Draft';
            return (
              <span
                role="status"
                aria-live="polite"
                className="save-status-pill"
                title={isSavedClean ? 'All changes saved to server' : isDirtyUnsaved ? 'Local draft saved — click Save (Ctrl+S) to commit to server' : 'New invoice draft'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: '0.72rem', fontWeight: 600,
                  height: 26, padding: '0 9px',
                  borderRadius: 999,
                  background: bg,
                  border: `1px solid ${color}55`,
                  color: color,
                  whiteSpace: 'nowrap',
                }}
              >
                {isSavingNow && <Loader size={11} className="spin" />}
                {isSavedClean && <Check size={11} />}
                {!isSavingNow && !isSavedClean && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                )}
                {label}
              </span>
            );
          })()}

          <div className="erp-toolbar-divider" />

          {/* Series Selector (Rule 46) */}
          <select
            aria-label="Voucher Series"
            className="form-input num-mono erp-toolbar-select"
            style={{ width: 126 }}
            title="Voucher Series (CGST Rule 46)"
            value={selectedSeriesId}
            disabled={isIssuedInvoice}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedSeriesId(nextId);
              const nextDocNo = peekSeriesNumber(nextId);
              if (nextDocNo && !isIssuedInvoice) {
                setDetails(prev => ({ ...prev, invoiceNumber: nextDocNo }));
              }
            }}
          >
            {invoiceSeriesList.map(s => {
              const shortCode = s.code || String(s.id || '').replace(/^series_/i, '').toUpperCase();
              return (
                <option key={s.id} value={s.id}>
                  [{shortCode}] {s.name} ({peekSeriesNumber(s.id)})
                </option>
              );
            })}
          </select>

          {/* Canonical Price Tier Selector */}
          <select
            aria-label="Customer Price Tier"
            className="form-input erp-toolbar-select"
            style={{ width: 122 }}
            title="Customer Price Tier — governs catalog item rates"
            value={activeRateTier}
            onChange={(e) => requestTierChange(e.target.value)}
          >
            {PRICE_TIERS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>

          <span
            className={taxTreatment.warning ? 'cr-badge' : 'dr-badge'}
            style={{ padding: '2px 6px', fontSize: '0.65rem', whiteSpace: 'nowrap', cursor: 'help' }}
            title={`${taxTreatment.explanation}${taxTreatment.warning ? ` ⚠ ${taxTreatment.warning}` : ''}`}
          >
            {taxTreatment.badge}
          </span>
          <span
            className="cr-badge"
            style={{ padding: '2px 6px', fontSize: '0.65rem', whiteSpace: 'nowrap', cursor: 'help' }}
            title={`${taxTreatment.taxModeLabel}: ${taxTreatment.taxModeHint}`}
          >
            {taxTreatment.splitBadge}
          </span>
        </div>

        <div className="erp-toolbar-right generator-actions">
          <button
            type="button"
            className="btn btn-primary erp-toolbar-btn"
            onClick={handleExplicitSave}
            disabled={saving}
            title="Save invoice to server (Ctrl+S)"
          >
            <Check size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
          {typeof onCreateNextInvoice === 'function' && (
            <button
              type="button"
              className="btn btn-secondary erp-toolbar-btn"
              onClick={handleSaveAndNew}
              disabled={saving}
              title="Save this invoice and immediately start a fresh counter invoice"
            >
              <FileCheck size={13} /> Save &amp; New
            </button>
          )}
          <button type="button" className="btn btn-secondary erp-toolbar-btn" onClick={directPrint} disabled={saving}
            title={isThermalPaper() ? 'Send directly to your thermal printer' : 'Save and open print dialog'}>
            <Printer size={13} /> Print
          </button>
          <button type="button" className="btn btn-secondary erp-toolbar-btn" onClick={generatePDF} disabled={saving}
            title="Save + download the PDF (Ctrl+P)">
            <Download size={13} /> PDF
          </button>
          <button className="btn btn-secondary erp-toolbar-btn" type="button"
            onClick={() => {
              const open = !showOptions;
              setShowOptions(open);
              if (open) setTimeout(() => document.getElementById('invoice-options-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }}
            title={showOptions ? 'Hide layout and column options' : 'Choose columns, sections, paper size and PDF style'}>
            <Settings size={13} /> {showOptions ? 'Hide Opts' : 'Customize'}
          </button>
          <button className="btn btn-secondary erp-toolbar-btn" type="button"
            onClick={() => setPreviewCollapsed(v => !v)}
            title={previewCollapsed ? 'Show the live preview pane' : 'Hide the preview pane and use full width for entry'}>
            {previewCollapsed ? <><Eye size={13} /> Preview</> : <><EyeOff size={13} /> Hide Preview</>}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-secondary erp-toolbar-btn"
              onClick={() => setShowMoreActions(v => !v)}
              aria-expanded={showMoreActions}
              aria-haspopup="menu"
              title="More output & compliance actions (WhatsApp, E-Way Bill, E-Invoice)"
            >
              <MoreHorizontal size={14} /> More
            </button>
            {showMoreActions && (
              <div
                role="menu"
                className="erp-more-actions-menu"
                onMouseLeave={() => setShowMoreActions(false)}
                style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 90,
                  minWidth: 185, background: '#fff', border: '1px solid #cbd5e1',
                  borderRadius: 8, boxShadow: '0 10px 25px rgba(15,23,42,0.14)',
                  padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <button type="button" role="menuitem" className="erp-menu-item" onClick={() => { setShowMoreActions(false); shareWhatsApp(); }} disabled={saving}>
                  <MessageCircle size={13} style={{ color: '#16a34a' }} /> Share via WhatsApp
                </button>
                <button type="button" role="menuitem" className="erp-menu-item" onClick={() => { setShowMoreActions(false); setShowPrintPreview(true); }}>
                  <Maximize2 size={13} /> Full-Page Print Preview
                </button>
                {ewayOn && (invoiceType === 'tax-invoice' || invoiceType === 'delivery-challan') && (
                  <button type="button" role="menuitem" className="erp-menu-item" onClick={() => { setShowMoreActions(false); exportEWayBill(); }} disabled={saving}>
                    <Truck size={13} /> Download E-Way Bill JSON
                  </button>
                )}
                {einvoiceOn && (invoiceType === 'tax-invoice' || invoiceType === 'credit-note') && (
                  <button type="button" role="menuitem" className="erp-menu-item" onClick={() => { setShowMoreActions(false); setShowEinvoice({ saved: !!savedId.current }); }} disabled={saving}>
                    <QrCode size={13} /> E-Invoice / IRN{einvoice?.irn ? ' ✓' : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`split-view ${previewCollapsed ? 'split-view-focus' : ''}`}>
        <div className="editor-pane">
          {/* Compact Single-Row Invoice Type & Supply Mode Bar */}
          <div className="glass-panel erp-compact-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', flexShrink: 0 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', marginRight: 2, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  Type <HelpButton title="Invoice Type" doc="invoices#invoice-types" size={13} />
                </span>
                {Object.entries(INVOICE_TYPES).map(([key, val]) => {
                  const compactLabel = key === 'bill-of-supply'
                    ? 'Bill of Supply'
                    : key === 'composition'
                      ? 'Composition'
                      : key === 'proforma'
                        ? 'Proforma / Est.'
                        : val.label;
                  return (
                    <button key={key} type="button"
                      className={`type-chip erp-type-chip ${invoiceType === key ? 'type-chip-active' : ''}`}
                      disabled={isIssuedInvoice && invoiceType !== key}
                      title={isIssuedInvoice ? 'The type cannot change once an invoice is saved. Duplicate it to make a different document.' : `${val.label} — ${val.description}`}
                      onClick={() => handleTypeChange(key)}>{compactLabel}</button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', flexShrink: 0, paddingLeft: '6px', borderLeft: '1px solid #CBD5E1' }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>For:</span>
                {[
                  { id: 'goods',    label: '📦 Goods',    desc: 'Physical products — defaults to Nos / Kg / Pcs units' },
                  { id: 'services', label: '⏱ Services', desc: 'Time / work-based — defaults to Hrs and surfaces Session / Visit / Month units' },
                  { id: 'mixed',    label: '🔀 Mixed',   desc: 'Both — full unit list available, no filtering' },
                ].map(opt => (
                  <button key={opt.id} type="button"
                    className={`type-chip erp-type-chip ${(invoiceOptions.invoiceMode || 'goods') === opt.id ? 'type-chip-active' : ''}`}
                    onClick={() => setInvoiceOptions(prev => ({ ...prev, invoiceMode: opt.id, ...(prev.showItemUnitManual ? {} : { showItemUnit: opt.id !== 'services' }) }))}
                    title={opt.desc}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {isIssuedInvoice && (
              <p className="type-desc" style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: '0.72rem' }}>
                Saved as a {typeConfig?.label || invoiceType}. Use Duplicate to raise a different document.
              </p>
            )}

            {/* Customization Options */}
            {showOptions && (
              <div className="invoice-options" id="invoice-options-panel" style={{ scrollMarginTop: 110 }}>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Invoice Title <HelpButton title="Title, currency and exchange rate" doc="invoice-options#title-currency" size={16} /></label>
                  <input type="text" className="form-input" value={invoiceOptions.customTitle}
                    onChange={(e) => setInvoiceOptions(prev => ({ ...prev, customTitle: e.target.value }))}
                    placeholder={typeConfig?.title || 'TAX INVOICE'} />
                </div>
                <InvoiceCurrency options={invoiceOptions} baseCurrency={baseCurrency} regionMode={getRegionMode()} compact
                  invoiceDate={details.invoiceDate} total={totals.total} onCurrency={setCurrency} onRate={setExchangeRate} disabled={readOnlyDoc} />

                {/* Inline recurring — turn any invoice into a recurring template
                    without leaving the form. On save, this writes both the
                    invoice AND a recurring template the server auto-fires on
                    schedule. Edit/cancel the template later via the Recurring
                    Invoices view in the sidebar. */}
                {(() => {
                  const rec = invoiceOptions.recurring;
                  const isOn = !!rec?.enabled;
                  const toggle = () => {
                    if (isOn) {
                      setInvoiceOptions(prev => ({ ...prev, recurring: { ...prev.recurring, enabled: false } }));
                    } else {
                      // One month after the invoice date, kept inside the
                      // month (31 Jan -> 28 Feb, not 3 Mar) and as a local date.
                      const from = parseLocalDate(details.invoiceDate || localToday());
                      const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
                      next.setDate(Math.min(from.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
                      setInvoiceOptions(prev => ({
                        ...prev,
                        recurring: {
                          enabled: true,
                          frequency: 'monthly',
                          interval: 1,
                          nextDate: toLocalIsoDate(next),
                          endMode: 'never',
                          endDate: '',
                          maxOccurrences: '',
                        },
                      }));
                    }
                  };
                  const set = (key, val) => setInvoiceOptions(prev => ({
                    ...prev, recurring: { ...prev.recurring, [key]: val },
                  }));
                  return (
                    <div className={`form-group${isOn ? ' notice notice-info' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={isOn} onChange={toggle}
                          style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                        <strong>🔁 Make this a recurring invoice</strong>
                        <HelpButton title="Recurring invoice" doc="invoice-options#recurring" size={16} />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          (auto-generate a new invoice on schedule, same items, new number)
                        </span>
                      </label>
                      {isOn && (
                        <div style={{ marginTop: '0.6rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Frequency</label>
                            <select className="form-input" value={rec.frequency}
                              onChange={e => set('frequency', e.target.value)}>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Every N (interval)</label>
                            <input type="number" min="1" max="12" className="form-input"
                              value={rec.interval || 1}
                              onChange={e => set('interval', parseInt(e.target.value) || 1)} />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Next invoice date</label>
                            <input type="date" className="form-input" value={rec.nextDate || ''}
                              onChange={e => set('nextDate', e.target.value)} />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">End condition</label>
                            <select className="form-input" value={rec.endMode || 'never'}
                              onChange={e => set('endMode', e.target.value)}>
                              <option value="never">Never (until I stop it)</option>
                              <option value="onDate">On a specific date</option>
                              <option value="afterN">After N invoices</option>
                            </select>
                          </div>
                          {rec.endMode === 'onDate' && (
                            <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                              <label className="form-label">Stop generating after this date</label>
                              <input type="date" className="form-input" value={rec.endDate || ''}
                                onChange={e => set('endDate', e.target.value)} />
                            </div>
                          )}
                          {rec.endMode === 'afterN' && (
                            <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                              <label className="form-label">Stop after this many invoices have been generated</label>
                              <input type="number" min="1" className="form-input"
                                value={rec.maxOccurrences || ''}
                                onChange={e => set('maxOccurrences', parseInt(e.target.value) || '')}
                                placeholder="e.g. 12 for a 1-year monthly contract" />
                            </div>
                          )}
                          <div style={{ gridColumn: 'span 2', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            Auto-generation fires every time you open the app (or daily if it stays running).
                            Future invoices get fresh sequential numbers, today's date as their invoice date,
                            and the same client + items + amounts as this one. Edit or pause the template any
                            time via <strong>Recurring</strong> in the sidebar.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* TCS — collected by seller, ADDS to total (Section 206C, Income Tax Act) */}
                {(profile?.country || 'India') === 'India' && (tdsTcsOn || invoiceOptions.showTCS) && (
                  <div className={`form-group${invoiceOptions.showTCS ? ' notice notice-warn' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!invoiceOptions.showTCS}
                        onChange={() => setInvoiceOptions(prev => {
                          // Turning TCS on for an invoice whose remembered section can no
                          // longer be chosen (206C(1H)) starts from the first current one.
                          const turningOn = !prev.showTCS;
                          const valid = TCS_SECTIONS.some(s => s.code === prev.tcsSection);
                          return turningOn && !valid
                            ? { ...prev, showTCS: true, tcsSection: TCS_SECTIONS[0].code, tcsRate: TCS_SECTIONS[0].rate }
                            : { ...prev, showTCS: turningOn };
                        })}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      <strong>TCS — Tax Collected at Source</strong>
                      <HelpButton title="TCS" doc="invoices#tcs" size={16} />
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(Adds to invoice total)</span>
                    </label>
                    {invoiceOptions.showTCS && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <select className="form-input" value={invoiceOptions.tcsSection || TCS_SECTIONS[0].code}
                          onChange={(e) => {
                            const code = e.target.value;
                            const section = TCS_SECTIONS.find(s => s.code === code);
                            setInvoiceOptions(prev => ({ ...prev, tcsSection: code, tcsRate: code === 'custom' ? prev.tcsRate : section?.rate ?? prev.tcsRate }));
                          }}>
                          {REMOVED_TCS_SECTIONS[invoiceOptions.tcsSection] && (
                            <option value={invoiceOptions.tcsSection} disabled>{REMOVED_TCS_SECTIONS[invoiceOptions.tcsSection]}</option>
                          )}
                          {TCS_SECTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                        <input type="number" step="any" min="0" max="100" className="form-input"
                          value={invoiceOptions.tcsRate}
                          onChange={(e) => setInvoiceOptions(prev => ({ ...prev, tcsRate: e.target.value }))}
                          placeholder="Rate %" />
                      </div>
                    )}
                  </div>
                )}

                {/* TDS — deducted by buyer from payment, INFORMATIONAL on invoice */}
                {(profile?.country || 'India') === 'India' && (tdsTcsOn || invoiceOptions.showTDS) && (
                  <div className={`form-group${invoiceOptions.showTDS ? ' notice notice-info' : ''}`} style={{ marginBottom: '0.75rem', padding: '0.6rem', borderRadius: '6px', display: 'block' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!invoiceOptions.showTDS}
                        onChange={() => setInvoiceOptions(prev => ({ ...prev, showTDS: !prev.showTDS }))}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      <strong>TDS — Tax Deducted at Source</strong>
                      <HelpButton title="TDS" doc="invoices#tds" size={16} />
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(Buyer deducts; informational)</span>
                    </label>
                    {invoiceOptions.showTDS && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <select className="form-input" value={invoiceOptions.tdsSection || '194Q'}
                          onChange={(e) => {
                            const code = e.target.value;
                            const section = TDS_SECTIONS.find(s => s.code === code);
                            setInvoiceOptions(prev => ({ ...prev, tdsSection: code, tdsRate: code === 'custom' ? prev.tdsRate : section?.rate ?? prev.tdsRate }));
                          }}>
                          {TDS_SECTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                        <input type="number" step="any" min="0" max="100" className="form-input"
                          value={invoiceOptions.tdsRate}
                          onChange={(e) => setInvoiceOptions(prev => ({ ...prev, tdsRate: e.target.value }))}
                          placeholder="Rate %" />
                      </div>
                    )}
                  </div>
                )}
                {/* Payment account picker — lists the active business profile's active
                    accounts. Hidden when the profile has 0 accounts (preserves v1.4.3
                    "no bank block" behaviour). Stored as invoiceOptions.selectedAccountId
                    so re-opening the invoice produces the same PDF. */}
                {(() => {
                  const accounts = getActiveAccounts(profile);
                  if (accounts.length === 0) return null;
                  const resolved = getAccountById(profile, invoiceOptions.selectedAccountId);
                  return (
                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <label className="form-label">Payment account on this invoice <HelpButton title="Payment account on this invoice" doc="invoice-options#payment-account" size={16} /></label>
                      <select className="form-input" value={resolved?.id || ''}
                        onChange={(e) => {
                          // v1.10.21 — reported: "working but on select it is not
                          // changing have to save and reopen it". Cause: the
                          // preview reads options.paymentAccountSnapshot first
                          // (bank frozen at the last save). Picking a new
                          // account from the dropdown only updated
                          // selectedAccountId, so the preview kept showing the
                          // old snapshot until save+reopen re-snapshotted. Fix:
                          // resnap immediately from the LIVE profile when the
                          // user picks a different account so the preview
                          // reflects the new bank without a round trip.
                          const newId = e.target.value || null;
                          const newSnap = newId ? getAccountById(profile, newId) : null;
                          setInvoiceOptions(prev => ({ ...prev, selectedAccountId: newId, paymentAccountSnapshot: newSnap }));
                        }}>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.isDefault ? '⭐ ' : ''}{a.label || a.bankName || 'Untitled account'}
                            {a.bankName && a.label !== a.bankName ? ` — ${a.bankName}` : ''}
                          </option>
                        ))}
                      </select>
                      <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                        Bank details and UPI QR on the PDF come from the selected account.
                        Manage accounts in Settings → Payment Accounts.
                      </small>
                    </div>
                  );
                })()}
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">PDF Style <HelpButton title="PDF Style" doc="invoice-options#style" size={16} /></label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {PDF_STYLES.map(s => (
                      <button key={s.id} type="button"
                        className={`type-chip ${(invoiceOptions.pdfStyle || 'classic') === s.id ? 'type-chip-active' : ''}`}
                        onClick={() => setInvoiceOptions(prev => ({ ...prev, pdfStyle: s.id }))}
                        title={s.desc}>{s.label}</button>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Accent Color <HelpButton title="Accent Color" doc="invoice-options#accent-colour" size={16} /></label>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" title="Auto (match invoice type)"
                      style={{ width: '28px', height: '28px', borderRadius: '50%', border: !invoiceOptions.accentColor ? '2.5px solid #334155' : '2px solid #cbd5e1', background: 'conic-gradient(#1e40af, #7c3aed, #0f766e, #be123c, #1e40af)', cursor: 'pointer', position: 'relative' }}
                      onClick={() => setInvoiceOptions(prev => ({ ...prev, accentColor: '' }))}>
                      {!invoiceOptions.accentColor && <span style={{ position: 'absolute', inset: '3px', borderRadius: '50%', border: '2px solid white' }} />}
                    </button>
                    {ACCENT_PRESETS.map(p => (
                      <button key={p.color} type="button" title={p.label}
                        style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: p.color, border: invoiceOptions.accentColor === p.color ? '2.5px solid #334155' : '2px solid #cbd5e1', cursor: 'pointer', position: 'relative' }}
                        onClick={() => setInvoiceOptions(prev => ({ ...prev, accentColor: p.color }))}>
                        {invoiceOptions.accentColor === p.color && <span style={{ position: 'absolute', inset: '3px', borderRadius: '50%', border: '2px solid white' }} />}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Field-level toggles, grouped. Lets the user hide any default field on the
                    PDF without losing the data on the invoice itself. */}
                {[
                  { group: 'Header & branding', items: [
                    ['showLogo', 'Logo'],
                    ['showBusinessName', 'Business name'],
                    ['showBusinessAddress', 'Business address'],
                    ['showBusinessPhone', 'Business phone'],
                    ['showBusinessEmail', 'Business email'],
                    ['showState', 'Business state'],
                    ['showGSTIN', 'Tax ID (GSTIN/VAT/etc.)'],
                  ]},
                  { group: 'Client / Bill-to', items: [
                    ['showClientAddress', 'Client address'],
                    ['showClientPhone', 'Client phone'],
                    ['showClientEmail', 'Client email'],
                    ['showPlaceOfSupply', 'Place of Supply'],
                  ]},
                  { group: 'Invoice meta', items: [
                    ['showInvoiceNumber', 'Invoice number'],
                    ['showInvoiceDate', 'Invoice date'],
                    ['showDueDate', 'Due date'],
                  ]},
                  { group: 'Items table', items: [
                    ['showHSN', 'HSN/SAC column'],
                    ['showItemQty', 'Qty column'],
                    // v1.10.33 — Renamed from "Unit column" to match
                    // reality: InvoicePreview renders the unit INSIDE the
                    // Qty cell ("5 Nos", not a separate column). Prior
                    // label misled users into unticking Qty and expecting
                    // Unit to survive as its own column — it just vanished
                    // instead. Label now describes what actually happens.
                    // v1.10.83 - off by itself in Services mode (see the mode chips).
                    ['showItemUnit', 'Unit (Hrs, Nos...) next to Qty'],
                    ['showRateColumn', 'Rate column'],
                    ['showDiscount', 'Discount column'],
                    ['showGST', 'Tax % column (GST/VAT/etc.)'],
                    ['showCess', 'GST Cess % column (India — tobacco/auto/coal)'],
                  ]},
                  { group: 'Totals', items: [
                    ['showSubtotal', 'Subtotal row'],
                    ['showAmountWords', 'Amount in words'],
                    ['showRoundOff', 'Round-off line'],
                    ['showHsnSummary', 'HSN/SAC tax summary table'],
                    ['showTaxInWords', 'Tax amount in words'],
                  ]},
                  { group: 'Compliance flags (India)', items: [
                    ['reverseCharge', 'Reverse Charge applies (Section 9(3)/9(4)) — recipient pays GST'],
                  ]},
                  // Paper-size selector rendered outside the checkbox-grid pattern
                  // — see the block below the .map(). Adding a group marker here
                  // keeps the visual flow but the actual UI is a dropdown.
                  { group: '__PAPER_SIZE__', items: [] },
                  { group: 'Footer', items: [
                    ['showBankDetails', 'Bank details'],
                    ['showAccountLabel', 'Show "Pay via: <account>" label above bank block'],
                    // v1.10.74 - the QR needs a rupee invoice with a UPI ID, not an Indian business.
                    ['showUPI', 'UPI QR (rupee invoices)'],
                    ['showSignature', 'Signature block'],
                    ['showSignatoryText', 'Show "Authorized Signatory" caption'],
                    ['showTerms', 'Terms & Conditions'],
                    ['showNotes', 'Notes / Remarks'],
                    ['showSystemGeneratedNote', 'Note: system-generated invoice, no signature or stamp required'],
                    ['showDeclaration', 'Declaration'],
                    ['showCustomerSeal', "\"Customer's Seal and Signature\" box (Boxed grid / Tally style)"],
                  ]},
                ].map(section => {
                  if (section.group === '__PAPER_SIZE__') {
                    return (
                      <div key="paper-size" style={{ marginBottom: '0.6rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Paper / print size <HelpButton title="Paper size" doc="invoice-options#paper-size" size={16} /></div>
                        <select className="form-input" style={{ fontSize: '0.85rem' }}
                          value={invoiceOptions.paperSize || 'a4'}
                          onChange={e => setInvoiceOptions(prev => ({ ...prev, paperSize: e.target.value }))}>
                          {Object.entries(PAPER_SIZES).map(([key, ps]) => (
                            <option key={key} value={key}>{ps.label}</option>
                          ))}
                        </select>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                          {getPaperSize(invoiceOptions.paperSize, invoiceOptions).hint}
                        </p>

                        {/* Custom size inputs — shown only when Custom preset picked */}
                        {invoiceOptions.paperSize === 'custom' && (
                          <div style={{ marginTop: '0.5rem', padding: '0.55rem 0.65rem', background: 'var(--bg-secondary)', borderRadius: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 3 }}>Width (mm)</label>
                              <input type="number" min="30" max="500" step="1"
                                value={invoiceOptions.customPaperWidth || 80}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, customPaperWidth: parseInt(e.target.value, 10) || 80 }))}
                                className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 3 }}>Height (mm)</label>
                              <input type="number" min="50" max="1200" step="1"
                                value={invoiceOptions.customPaperHeight || 297}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, customPaperHeight: parseInt(e.target.value, 10) || 297 }))}
                                className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }} />
                            </div>
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', gridColumn: 'span 2', margin: 0 }}>
                              Tip: enter your printer's <strong>printable</strong> width, not the roll width. Most 58mm thermals print at 48mm; 80mm print at 72mm. <strong>Below 100mm width auto-switches to thermal receipt layout</strong> — same rendering as the 58/80mm presets, just at your exact size.
                            </p>
                            {/* v1.10.30 — quick-pick chips for uncommon thermal rolls. */}
                            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: 4 }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Quick-pick:</span>
                              {[
                                { label: '40mm', w: 32 },
                                { label: '76mm', w: 68 },
                                { label: '90mm', w: 80 },
                                { label: '110mm', w: 102 },
                              ].map(p => (
                                <button type="button" key={p.label}
                                  onClick={() => setInvoiceOptions(prev => ({ ...prev, customPaperWidth: p.w, customPaperHeight: 297 }))}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                                  title={`Set to ${p.label} roll (${p.w}mm printable × auto height)`}>
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Thermal-only extra settings — only shown when a
                            thermal paper size is picked. Each control maps
                            to an invoiceOptions field consumed by the
                            thermal render path in InvoicePreview. */}
                        {getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal' && (
                          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                              Thermal printer settings <HelpButton title="Thermal printer settings" doc="invoice-options#thermal-options" size={16} />
                            </div>

                            <label style={{ display: 'block', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                              <span style={{ fontWeight: 600 }}>Font size</span>
                              <select className="form-input"
                                style={{ fontSize: '0.78rem', marginTop: 2 }}
                                value={invoiceOptions.thermalFontSize || 'medium'}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalFontSize: e.target.value }))}>
                                <option value="small">Small (fits more per page)</option>
                                <option value="medium">Medium (recommended)</option>
                                <option value="large">Large (easier to read)</option>
                              </select>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', marginTop: '0.5rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!invoiceOptions.thermalCompact}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalCompact: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
                              <span>
                                <strong>Compact mode</strong>
                                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Tighter item rows, to save paper on long orders. Whether HSN and the quantity × rate line print is set in Print Settings.
                                </span>
                              </span>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', marginTop: '0.4rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={invoiceOptions.thermalCutMark !== false}
                                onChange={e => setInvoiceOptions(prev => ({ ...prev, thermalCutMark: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
                              <span>
                                <strong>Cut mark at bottom</strong>
                                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Prints a CUT HERE line to tear against. Turn it off if your printer cuts the paper itself.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={section.group} style={{ marginBottom: '0.6rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{section.group} <HelpButton title={section.group} doc={OPTION_GROUP_HELP[section.group]} size={16} /></div>
                      <div className="options-grid">
                        {section.items.map(([key, label]) => {
                          // These default to OFF; everything else defaults to ON.
                          // v1.10.70 - showSystemGeneratedNote added: without it the box
                          // showed ticked while the invoice printed no note.
                          const checked = invoiceOptionOn(invoiceOptions, key);
                          return (
                            <label key={key} className="option-toggle">
                              <input type="checkbox" checked={checked} onChange={() => toggleOption(key)} />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {invoiceOptionOn(invoiceOptions, 'showDeclaration') && (
                  <div className="form-group" style={{ marginTop: '0.4rem' }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Declaration text</label>
                    <textarea className="form-input" rows={2}
                      value={invoiceOptions.declarationText ?? DEFAULT_DECLARATION}
                      onChange={e => setInvoiceOptions(prev => ({ ...prev, declarationText: e.target.value }))} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                  <button type="button" className="btn btn-secondary"
                    onClick={() => {
                      const allKeys = ['showLogo','showBusinessName','showBusinessAddress','showBusinessPhone','showBusinessEmail','showState','showGSTIN','showClientAddress','showClientPhone','showClientEmail','showPlaceOfSupply','showInvoiceNumber','showInvoiceDate','showDueDate','showHSN','showItemQty','showItemUnit','showRateColumn','showDiscount','showGST','showSubtotal','showAmountWords','showRoundOff','showBankDetails','showAccountLabel','showUPI','showSignature','showSignatoryText','showTerms','showNotes'];
                      setInvoiceOptions(prev => { const out = { ...prev }; allKeys.forEach(k => { out[k] = false; }); return out; });
                    }}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}>
                    Hide all
                  </button>
                  <button type="button" className="btn btn-secondary"
                    onClick={() => setInvoiceOptions(prev => ({
                      ...DEFAULT_OPTIONS,
                      // v1.10.33 — Preserve per-bill data that lives inside
                      // invoiceOptions but is NOT a "display option" the
                      // reset button should touch. Prior code was a raw
                      // setInvoiceOptions(DEFAULT_OPTIONS) which nulled
                      // paymentAccountSnapshot (bank details frozen at save
                      // time, v1.10.20 invariant) and selectedAccountId
                      // (the account picked for THIS bill) — so an edit-
                      // then-reset silently repointed the bank block to the
                      // legacy profile bank.
                      paymentAccountSnapshot: prev.paymentAccountSnapshot,
                      selectedAccountId: prev.selectedAccountId,
                    }))}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}>
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Client Modal */}
          <ClientModal show={showClientModal} onClose={() => setShowClientModal(false)} onSave={handleClientModalSave} client={modalClient} isEditing={isEditingClient} defaultCountry={profile?.country} />

          {/* Client Details — Compact 2-Row ERP Grid */}
          <div className="glass-panel erp-compact-panel">
            <div className="flex justify-between items-center" style={{ marginBottom: '0.45rem' }}>
              <h3 className="section-title" style={{ margin: 0, fontSize: '0.82rem' }}>Billed To <HelpButton title="Billed To" doc="invoices#billed-to" size={14} /></h3>
            </div>

            {!editingBill && clientCredit.available > 0.005 && (
              <div style={{
                marginBottom: '0.6rem', padding: '0.5rem 0.75rem',
                background: 'rgba(3, 105, 161, 0.08)',
                border: '1px solid rgba(3, 105, 161, 0.3)',
                borderRadius: 6, fontSize: '0.8rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong style={{ color: '#0369a1' }}>💳 Client has {formatCurrency(clientCredit.available, invoiceOptions.currency || 'INR')} credit</strong>
                    <HelpButton title="Using a client's credit" doc="invoices#client-credit" size={14} />
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                      from {clientCredit.sources.length} prior overpayment{clientCredit.sources.length > 1 ? 's' : ''}
                      {' '}({clientCredit.sources.map(s => s.invoiceNumber).slice(0, 3).join(', ')}
                      {clientCredit.sources.length > 3 ? '…' : ''})
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input type="number" min="0" step="any" className="form-input"
                      value={creditToApply || ''} placeholder="0"
                      onChange={e => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        const cap = Math.min(clientCredit.available, Number(totals.total) || Infinity);
                        setCreditToApply(Math.min(v, cap));
                      }}
                      style={{ width: 100, fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} />
                    <button type="button" className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => setCreditToApply(Math.min(clientCredit.available, Number(totals.total) || 0))}>
                      Apply full
                    </button>
                    {creditToApply > 0 && (
                      <button type="button" className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: '#dc2626', borderColor: '#fca5a5' }}
                        onClick={() => setCreditToApply(0)}>
                        Skip
                      </button>
                    )}
                  </div>
                </div>
                {creditToApply > 0.005 && (
                  <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#0369a1' }}>
                    → Will apply {formatCurrency(creditToApply, invoiceOptions.currency || 'INR')} as advance from prior overpayment
                    {creditToApply < clientCredit.available ? ` (${formatCurrency(clientCredit.available - creditToApply, invoiceOptions.currency || 'INR')} credit will remain)` : ''}.
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={!!invoiceOptions.autoApplyClientCredit}
                    onChange={e => setInvoiceOptions(prev => ({ ...prev, autoApplyClientCredit: e.target.checked }))} />
                  Auto-apply available client credit on future invoices
                </label>
              </div>
            )}

            <div className="erp-billed-to-grid">
              {/* Row 1: Client Name + GSTIN + Billing Address */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label" htmlFor="invoice-client-name">Client Name</label>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input id="invoice-client-name" type="text"
                    className={`form-input ${validationResult.fieldErrors?.clientName ? 'input-invalid' : ''}`}
                    aria-invalid={!!validationResult.fieldErrors?.clientName || undefined}
                    style={{ flex: 1 }} value={client.name} ref={clientNameRef}
                    onChange={(e) => {
                      setClient({ ...client, name: e.target.value });
                      setSelectedClientId(null);
                      setShowClientSuggestions(true);
                      setClientPickerIdx(-1);
                    }}
                    onFocus={() => { if (savedClients.length > 0) setShowClientSuggestions(true); }}
                    onKeyDown={(e) => {
                      if (!showClientSuggestions || !filteredClients.length) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setClientPickerIdx(i => (i + 1) % filteredClients.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setClientPickerIdx(i => (i <= 0 ? filteredClients.length - 1 : i - 1));
                      } else if (e.key === 'Enter') {
                        if (clientPickerIdx >= 0 && filteredClients[clientPickerIdx]) {
                          e.preventDefault();
                          selectSavedClient(filteredClients[clientPickerIdx]);
                        }
                      } else if (e.key === 'Escape') {
                        setShowClientSuggestions(false);
                      }
                    }}
                    placeholder="Type client name to search or add new" autoComplete="off" />
                  {selectedClientId && (
                    <button type="button" className="btn-client-edit" onClick={() => openEditClientModal(savedClients.find(c => c.id === selectedClientId))} title="Edit saved client">
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
                {validationResult.fieldErrors?.clientName && (
                  <small className="field-error-text">{validationResult.fieldErrors.clientName}</small>
                )}
                {showClientSuggestions && savedClients.length > 0 && (
                  <div className="client-suggestions" ref={clientSuggestionsRef}>
                    {filteredClients.length > 0 && filteredClients.map((cli, i) => (
                      <div key={cli.id} className="client-suggestion-row"
                        style={i === clientPickerIdx ? { background: 'var(--primary-light, rgba(30,64,175,0.12))' } : undefined}>
                        <button type="button" className="client-suggestion-item"
                          onMouseEnter={() => setClientPickerIdx(i)}
                          onClick={() => selectSavedClient(cli)}>
                          <div className="client-suggestion-main">
                            <strong>{cli.name}</strong>
                            {(cli.city || cli.address) && <small className="client-suggestion-addr">{cli.city || cli.address.substring(0, 30)}{!cli.city && cli.address.length > 30 ? '...' : ''}</small>}
                          </div>
                          <span>{cli.state}{cli.gstin ? ` · ${cli.gstin}` : ''}</span>
                        </button>
                        <button type="button" className="client-suggestion-edit" onClick={() => { openEditClientModal(cli); setShowClientSuggestions(false); }} title="Edit client">
                          <Pencil size={12} />
                        </button>
                      </div>
                    ))}
                    {client.name.trim() && (
                      <button type="button" className="client-suggestion-save" onClick={openAddClientModal}>
                        <UserPlus size={14} /> Save "{client.name.trim()}" as new client
                      </button>
                    )}
                    {filteredClients.length === 0 && !client.name.trim() && (
                      <div className="client-picker-empty">Type to search clients</div>
                    )}
                  </div>
                )}
              </div>

              {invoiceOptions.showGSTIN && (() => {
                const cc = getCountryConfig(client.country || profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label" htmlFor="invoice-client-gstin">{cc.taxIdLabel}</label>
                    <input id="invoice-client-gstin" type="text" className="form-input num-mono" value={client.gstin}
                      onChange={(e) => { setClient({ ...client, gstin: e.target.value.toUpperCase() }); setGstinHint(null); }}
                      onBlur={handleClientGstinBlur} placeholder="Optional (15-digit)" maxLength={20} />
                    {gstinHint && (
                      <small style={{ color: gstinHint.tone === 'warn' ? '#d97706' : '#16a34a', fontSize: '0.68rem', display: 'block', marginTop: '0.15rem' }}>
                        {gstinHint.tone === 'warn' ? '⚠' : '✓'} {gstinHint.message}
                        <HelpButton title="What the GSTIN check tells you" doc="invoices#gstin-check" size={14} />
                      </small>
                    )}
                  </div>
                );
              })()}

              <div className="form-group">
                <label className="form-label" htmlFor="invoice-client-address">Billing Address</label>
                <input id="invoice-client-address" type="text" className="form-input" value={client.address}
                  onChange={(e) => setClient({ ...client, address: e.target.value })} placeholder="Street address, locality" />
              </div>
            </div>

            {/* Row 2: Country + City + PIN + State */}
            <div className="erp-location-grid" style={{ marginTop: '0.5rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="client-country">Country</label>
                <select id="client-country" className="form-input" value={client.country || profile?.country || 'India'}
                  onChange={(e) => {
                    setClient({ ...client, country: e.target.value, state: '' });
                    if (!editingSaved) setCurrency(currencyForClient({ country: e.target.value }, profile, { lastForeign: invoiceOptions.lastForeignCurrency }));
                  }}>
                  {(() => {
                    const visible = getCountriesForRegion(getRegionMode());
                    const cur = client.country || profile?.country;
                    const out = [];
                    if (cur && !visible.some(c => c.name === cur)) {
                      out.push(<option key={cur} value={cur}>{cur}</option>);
                    }
                    return out.concat(visible.map(c => <option key={c.code} value={c.name}>{c.name}</option>));
                  })()}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="invoice-client-city">City</label>
                <input id="invoice-client-city" type="text" className="form-input" value={client.city}
                  onChange={(e) => setClient({ ...client, city: e.target.value })} placeholder="e.g. Jaipur" />
              </div>
              <div className="form-group">
                {(() => { const cc = getCountryConfig(client.country || profile?.country); return <label className="form-label" htmlFor="invoice-client-pin">{cc.postalLabel}</label>; })()}
                <input id="invoice-client-pin" type="text" className="form-input num-mono" value={client.pin}
                  onChange={(e) => setClient({ ...client, pin: e.target.value })} placeholder="PIN code" />
              </div>
              {invoiceOptions.showState && (() => {
                const cc = getCountryConfig(client.country || profile?.country);
                const stateOpts = getStatesForCountry(client.country || profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label" htmlFor="invoice-client-state">{cc.stateLabel}</label>
                    {stateOpts.length > 0 ? (
                      <select id="invoice-client-state" className="form-input" value={client.state} onChange={(e) => setClient({ ...client, state: e.target.value })}>
                        <option value="">Select {cc.stateLabel}</option>
                        {stateOpts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input id="invoice-client-state" type="text" className="form-input" value={client.state}
                        onChange={(e) => setClient({ ...client, state: e.target.value })} placeholder={cc.stateLabel} />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Invoice Details — Compact Multi-Column Row */}
          <div className="glass-panel erp-compact-panel">
            <h3 className="section-title" style={{ margin: '0 0 0.45rem 0', fontSize: '0.82rem' }}>Invoice Details <HelpButton title="Invoice Details" doc="invoices#details" size={14} /></h3>
            <div className="erp-invoice-details-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="invoice-number">Invoice Number</label>
                <input id="invoice-number" type="text"
                  className={`form-input num-mono ${validationResult.fieldErrors?.invoiceNumber ? 'input-invalid' : ''}`}
                  aria-invalid={!!validationResult.fieldErrors?.invoiceNumber || undefined}
                  value={details.invoiceNumber}
                  onChange={(e) => setDetails({ ...details, invoiceNumber: e.target.value })} />
                {validationResult.fieldErrors?.invoiceNumber && (
                  <small className="field-error-text">{validationResult.fieldErrors.invoiceNumber}</small>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="invoice-date">Invoice Date</label>
                <input id="invoice-date" type="date"
                  className={`form-input num-mono ${validationResult.fieldErrors?.invoiceDate ? 'input-invalid' : ''}`}
                  aria-invalid={!!validationResult.fieldErrors?.invoiceDate || undefined}
                  value={details.invoiceDate}
                  onChange={(e) => setDetails({ ...details, invoiceDate: e.target.value })} />
                {validationResult.fieldErrors?.invoiceDate && (
                  <small className="field-error-text">{validationResult.fieldErrors.invoiceDate}</small>
                )}
              </div>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <label className="form-label" htmlFor="invoice-due-date" style={{ marginBottom: 0 }}>Due Date</label>
                  <div style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                    {[7, 15, 30].map(n => (
                      <button key={n} type="button" className="btn btn-secondary"
                        style={{ fontSize: '0.64rem', padding: '0px 4px', height: 17, minHeight: 17, borderRadius: 3 }}
                        title={`Set Due Date to +${n} days`}
                        onClick={() => {
                          const d = parseLocalDate(details.invoiceDate || localToday());
                          setDetails({ ...details, dueDate: toLocalIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) });
                        }}>+{n}d</button>
                    ))}
                  </div>
                </div>
                <input id="invoice-due-date" type="date"
                  className={`form-input num-mono ${validationResult.fieldErrors?.dueDate ? 'input-invalid' : ''}`}
                  aria-invalid={!!validationResult.fieldErrors?.dueDate || undefined}
                  value={details.dueDate}
                  onChange={(e) => setDetails({ ...details, dueDate: e.target.value })} />
                {validationResult.fieldErrors?.dueDate && (
                  <small className="field-error-text">{validationResult.fieldErrors.dueDate}</small>
                )}
              </div>
              {(getRegionMode() !== 'india' || isForeignClient(client, profile) || (invoiceOptions.currency || baseCurrency) !== baseCurrency) && (
                <InvoiceCurrency options={invoiceOptions} baseCurrency={baseCurrency} regionMode={getRegionMode()}
                  invoiceDate={details.invoiceDate} total={totals.total} onCurrency={setCurrency} onRate={setExchangeRate} disabled={readOnlyDoc} />
              )}
              {ccOn && (
                <div className="form-group">
                  <label className="form-label" htmlFor="cost-centre">Cost centre</label>
                  <CostCentreSelect centres={centres} value={details.costCentre || ''} name={details.costCentreName || ''}
                    onChange={(id, name) => setDetails((prev) => {
                      const { costCentre: _id, costCentreName: _name, ...rest } = prev;
                      return { ...rest, ...centreFields(id, name) };
                    })} />
                </div>
              )}
              {lutEligible && (() => {
                const savedArn = normaliseLutArn(profile?.lutArn);
                const invFy = fyOf(details.invoiceDate);
                return (
                  <div className={`form-group full-width notice ${invoiceOptions.isLUT ? 'notice-info' : 'notice-warn'}`} style={{ padding: '0.6rem 0.85rem', borderRadius: 6, display: 'block' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input type="checkbox" checked={!!invoiceOptions.isLUT} disabled={readOnlyDoc}
                        onChange={e => toggleLut(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                      <strong>{client?.isSEZ ? 'SEZ supply' : 'Export'} under LUT (no IGST)</strong>
                      <HelpButton title="Exports and SEZ supplies under a LUT" doc="invoices#lut" size={16} />
                    </label>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', lineHeight: 1.5 }}>
                      {invoiceOptions.isLUT
                        ? <>No IGST is charged (zero-rated). The invoice prints the Rule 46 declaration{invoiceOptions.lutArn ? <> with LUT ARN <strong>{invoiceOptions.lutArn}</strong>{invoiceOptions.lutFy ? ` (FY ${invoiceOptions.lutFy})` : ''}</> : ''}.</>
                        : <>IGST is charged on this {client?.isSEZ ? 'SEZ supply' : 'export'} (with payment of IGST, claimed back later as a refund).</>}
                    </p>
                    {!savedArn && (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', lineHeight: 1.5 }}>
                        <strong>Have a LUT?</strong> Exports and SEZ supplies under a LUT are billed without IGST, so you don't pay tax and wait for a refund. File it free on the GST portal each financial year (Form GST RFD-11), then add its ARN in Settings → Company.
                        <HelpButton title="LUT for exports" doc="gst-basics#lut" size={14} />
                      </p>
                    )}
                    {savedArn && invFy && profile?.lutFy !== invFy && (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--warn-text)' }}>
                        ⚠ Your saved LUT is for FY {profile?.lutFy || '(year not set)'}, but this invoice is dated in FY {invFy}. A LUT covers one financial year: file one for FY {invFy} on the GST portal and update it in Settings → Company.
                      </p>
                    )}
                  </div>
                );
              })()}
              {/* v1.10.83 - a foreign currency but the client is saved in India
                  (the client form starts on India): the invoice is then billed as
                  domestic, with no LUT. Say so, and take them to the Country box. */}
              {(invoiceOptions.currency || baseCurrency) !== baseCurrency && baseCurrency === 'INR'
                && !isForeignClient(client, profile) && !client?.isSEZ && !readOnlyDoc && (
                <div className="form-group full-width notice notice-warn" style={{ padding: '0.6rem 0.85rem', borderRadius: 6, display: 'block', fontSize: '0.82rem', lineHeight: 1.5 }}>
                  <strong>Export under LUT? First set the client&apos;s country.</strong> You are billing in {invoiceOptions.currency}, but {client?.name || 'this client'} is saved in India, so this is billed as a sale in India: no LUT, and IGST is charged. If they are abroad, set their country. The invoice then becomes an export: the place of supply prints &quot;Outside India&quot;, the LUT box appears here (no IGST, and the LUT line prints on the PDF), and your SWIFT and purpose code print.{' '}
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', marginTop: 4 }}
                    onClick={() => { const el = document.getElementById('client-country'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus(); }}>
                    Set the client's country
                  </button>
                </div>
              )}
              {/* v1.10.83 - a client abroad, but Place of supply is an Indian state
                  (picked by hand, or kept from a copied invoice): not an export, so
                  no LUT. Say so, with one click back to "Outside India". */}
              {showGST && isForeignClient(client, profile) && !client?.isSEZ && !readOnlyDoc
                && (profile?.country || 'India') === 'India' && getStateCode(String(details.placeOfSupply || '').trim()) && (
                <div className="form-group full-width notice notice-warn" style={{ padding: '0.6rem 0.85rem', borderRadius: 6, display: 'block', fontSize: '0.82rem', lineHeight: 1.5 }}>
                  <strong>Export under LUT? Place of supply is {details.placeOfSupply}.</strong> {client?.name || 'This client'} is in {client.country}, but the place of supply is an Indian state, so this is billed as a sale in India: no LUT, and IGST is charged. For an export, the place of supply is outside India.{' '}
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', marginTop: 4 }}
                    onClick={() => setDetails({ ...details, placeOfSupply: '' })}>
                    Make it an export
                  </button>
                </div>
              )}
              {/* v1.10.83 - GST switched off (Customize → Tax % column) on a tax
                  invoice to a client abroad or in an SEZ: no place of supply, no
                  LUT box and no LUT line, with nothing saying why. */}
              {!showGST && INVOICE_TYPES[invoiceType]?.showGST && profile?.gstin && (profile?.country || 'India') === 'India'
                && (isForeignClient(client, profile) || client?.isSEZ) && !readOnlyDoc && (
                <div className="form-group full-width notice notice-warn" style={{ padding: '0.6rem 0.85rem', borderRadius: 6, display: 'block', fontSize: '0.82rem', lineHeight: 1.5 }}>
                  <strong>Export under LUT? GST is turned off on this invoice.</strong> Without it (Customize → Tax % column), there is no LUT box and the LUT line is not printed. A GST-registered business needs it on an export or SEZ invoice; under the LUT the tax is still 0.{' '}
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', marginTop: 4 }}
                    onClick={() => setInvoiceOptions(prev => ({ ...prev, showGST: true, showPlaceOfSupply: true }))}>
                    Turn GST on
                  </button>
                </div>
              )}
              {/* v1.10.83 - the RBI purpose code the client quotes on the wire;
                  blank uses the payment account's (Settings → Payment accounts). */}
              {(isForeignClient(client, profile) || (invoiceOptions.currency || baseCurrency) !== baseCurrency) && baseCurrency === 'INR' && (() => {
                const accountCode = getAccountById(profile, invoiceOptions.selectedAccountId)?.purposeCode || '';
                return (
                  <div className="form-group">
                    <label className="form-label" htmlFor="purpose-code">Purpose code (RBI) <HelpButton title="Purpose codes" doc="settings#paid-from-abroad" size={14} /></label>
                    <input id="purpose-code" type="text" className="form-input" list="purpose-codes-inv" disabled={readOnlyDoc}
                      value={invoiceOptions.purposeCode || ''}
                      onChange={(e) => setInvoiceOptions(prev => ({ ...prev, purposeCode: e.target.value.toUpperCase().trim() }))}
                      placeholder={accountCode ? `${accountCode} (from your bank account)` : 'e.g. P0802 software, P1006 consulting'} />
                    <datalist id="purpose-codes-inv">
                      {PURPOSE_CODES.map(p => <option key={p.code} value={p.code}>{`${p.code} - ${p.label}`}</option>)}
                    </datalist>
                  </div>
                );
              })()}
              {invoiceOptions.showPlaceOfSupply && (() => {
                const posOpts = getStatesForCountry(profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label">Place of Supply</label>
                    {posOpts.length > 0 ? (
                      <select className="form-input" value={details.placeOfSupply}
                        onChange={(e) => setDetails({ ...details, placeOfSupply: e.target.value })}>
                        {/* v1.10.83 - an export's place of supply is outside India. */}
                        <option value="">{isForeignClient(client, profile) ? 'Outside India (export)' : 'Defaults to Client State'}</option>
                        {posOpts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input type="text" className="form-input" value={details.placeOfSupply}
                        onChange={(e) => setDetails({ ...details, placeOfSupply: e.target.value })} placeholder="State / Region" />
                    )}
                  </div>
                );
              })()}
              {invoiceType === 'credit-note' && (
                <div className="form-group full-width">
                  <label className="form-label">Original Invoice Reference</label>
                  <input type="text" className="form-input" value={details.originalInvoiceRef}
                    onChange={(e) => setDetails({ ...details, originalInvoiceRef: e.target.value })} placeholder="e.g. INV/2025-26/0001" />
                </div>
              )}

              {/* Ship-to & Order/Dispatch Details side-by-side in a compact row */}
              {(!servicesMode || details.shipToSameAsBilling === false) && <div className="form-group" style={{ gridColumn: details.shipToSameAsBilling === false ? '1 / -1' : 'span 2', padding: '0.4rem 0.65rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', userSelect: 'none', fontSize: '0.78rem' }}>
                  <input type="checkbox" checked={details.shipToSameAsBilling !== false}
                    onChange={e => setDetails({ ...details, shipToSameAsBilling: e.target.checked })}
                    style={{ width: 15, height: 15, accentColor: 'var(--primary)' }} />
                  <span><strong>Ship to</strong> same as bill-to address <HelpButton title="Ship to" doc="invoices#ship-to" size={14} /></span>
                </label>
                {details.shipToSameAsBilling === false && (
                  <div className="erp-location-grid" style={{ marginTop: '0.45rem' }}>
                    <div className="form-group">
                      <label className="form-label">Shipping Address</label>
                      <input type="text" className="form-input" value={details.shippingAddress || ''}
                        onChange={e => setDetails({ ...details, shippingAddress: e.target.value })}
                        placeholder="Delivery address / warehouse" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shipping City</label>
                      <input type="text" className="form-input" value={details.shippingCity || ''}
                        onChange={e => setDetails({ ...details, shippingCity: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shipping PIN</label>
                      <input type="text" className="form-input num-mono" value={details.shippingPin || ''}
                        onChange={e => setDetails({ ...details, shippingPin: e.target.value })}
                        placeholder="6-digit PIN" maxLength={6} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Shipping State</label>
                      {(() => {
                        const posOpts = getStatesForCountry(profile?.country);
                        return posOpts.length > 0 ? (
                          <select className="form-input" value={details.shippingState || ''}
                            onChange={e => setDetails({ ...details, shippingState: e.target.value })}>
                            <option value="">Same as billing state</option>
                            {posOpts.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <input type="text" className="form-input" value={details.shippingState || ''}
                            onChange={e => setDetails({ ...details, shippingState: e.target.value })}
                            placeholder="Delivery state / region" />
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>}

              {(() => {
                const filled = ORDER_DETAIL_FIELDS.filter(f => String(details[f.key] || '').trim()).length;
                const fields = ORDER_DETAIL_FIELDS.filter(f => !servicesMode || !GOODS_ONLY_DETAILS.includes(f.key) || String(details[f.key] || '').trim());
                const periodBackwards = details.periodFrom && details.periodTo && details.periodTo < details.periodFrom;
                return (
                  <details className="form-group" open={filled > 0 || undefined}
                    style={{ gridColumn: filled > 0 ? '1 / -1' : 'span 2', padding: '0.4rem 0.65rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: '0.78rem', userSelect: 'none' }}>
                      <strong>Order, dispatch &amp; reference details</strong>
                      <HelpButton title="Order, dispatch and reference details" doc="invoices#order-details" size={14} />
                      <span style={{ color: 'var(--text-muted)' }}> (optional{filled ? `, ${filled} filled` : ''} — PO no, vehicle no, transport)</span>
                    </summary>
                    <div className="erp-location-grid" style={{ marginTop: '0.45rem' }}>
                      {fields.map(f => (
                        <div key={f.key} className={`form-group${f.wide ? ' full-width' : ''}`}>
                          <label className="form-label">{f.label}</label>
                          <input type={f.type || 'text'} className="form-input" value={details[f.key] || ''}
                            placeholder={f.placeholder || ''}
                            onChange={e => setDetails({ ...details, [f.key]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                    {periodBackwards && (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--warn-text, #b45309)' }}>
                        ⚠ The service period ends before it starts. Check the two dates.
                      </p>
                    )}
                  </details>
                );
              })()}
            </div>
          </div>

          {/* Line Items */}
          <div className="glass-panel erp-compact-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <h3 className="section-title" style={{ margin: 0, fontSize: '0.82rem' }}>Line Items <HelpButton title="Line Items" doc="invoices#items" size={14} /></h3>
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                  <button
                    type="button"
                    onClick={() => setLineItemViewMode('cards')}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer',
                      background: lineItemViewMode === 'cards' ? 'var(--primary)' : 'transparent',
                      color: lineItemViewMode === 'cards' ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    onClick={() => setLineItemViewMode('compact')}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer',
                      background: lineItemViewMode === 'compact' ? 'var(--primary)' : 'transparent',
                      color: lineItemViewMode === 'compact' ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    Compact Table
                  </button>
                </div>
              </div>
              {showGST && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={taxInclusive} onChange={e => setTaxInclusive(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ fontWeight: 500 }}>Prices include tax</span>
                  <HelpButton title="Prices that already include GST" doc="invoices#tax-inclusive" size={14} />
                </label>
              )}
            </div>
            {items.map((item, idx) => (
              <LineItem
                key={item.id}
                item={item}
                rowIndex={idx}
                totalRows={items.length}
                invoiceOptions={invoiceOptions}
                taxInclusive={taxInclusive}
                showGST={showGST}
                isInterstate={totals.isInterstate}
                taxLabel={taxLabel}
                units={units}
                countryTaxRates={countryTaxRates}
                filterUnitsByMode={filterUnitsByMode}
                invoiceMode={invoiceOptions.invoiceMode}
                currency={invoiceOptions.currency}
                profileCountry={profile?.country}
                activeRateTier={activeRateTier}
                suggestions={getProductSuggestions(item.id)}
                onFieldChange={handleItemChange}
                onSelectProduct={selectProduct}
                onSetProductSearch={setProductSearch}
                onAddCustomUnit={handleAddCustomUnit}
                onRemoveCustomUnit={handleRemoveCustomUnit}
                onRemove={removeItem}
                onDuplicate={duplicateItem}
                onMoveRow={moveItemRow}
                onResetTierPrice={resetItemTierPrice}
                clampNonNeg={clampNonNeg}
                isLastRow={idx === items.length - 1}
                isOnlyRow={items.length === 1}
                onAddRow={addItem}
                rowErrors={validationResult.rowErrors?.[item.id] || {}}
                viewMode={lineItemViewMode}
              />
            ))}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-secondary erp-toolbar-btn" onClick={addItem}><Plus size={15} /> Add Item</button>
                {!hasDeliveryCharge && !servicesMode && (
                  <button type="button" className="btn btn-secondary erp-toolbar-btn" onClick={addDeliveryCharge}
                    title="Adds a 'Delivery charges' line, taxed at the goods' GST rate (composite supply)">
                    <Truck size={14} /> Delivery charges
                  </button>
                )}
              </div>

              {servicesMode && !wholeDiscountOpen && !Number(invoiceOptions.invoiceDiscountValue) ? (
                <button type="button" className="btn-link" onClick={() => setWholeDiscountOpen(true)}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  + Discount on the whole bill
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <label htmlFor="invoice-bill-discount" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Bill Discount <HelpButton title="Discounts" doc="invoices#discounts" size={14} /></label>
                  <input id="invoice-bill-discount" type="number" min="0" step="any"
                    className={`form-input num-mono ${validationResult.fieldErrors?.invoiceDiscountValue ? 'input-invalid' : ''}`}
                    value={invoiceOptions.invoiceDiscountValue || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setInvoiceOptions(prev => ({ ...prev, invoiceDiscountValue: clampNonNeg(e.target.value) }))}
                    style={{ width: 85, height: 28 }} placeholder="0" />
                  <select className="form-input"
                    value={invoiceOptions.invoiceDiscountType === 'percent' ? 'percent' : 'fixed'}
                    onChange={(e) => setInvoiceOptions(prev => ({ ...prev, invoiceDiscountType: e.target.value }))}
                    style={{ width: 112, height: 28 }}>
                    <option value="fixed">{currencySymbolFor(invoiceOptions.currency)} (fixed)</option>
                    <option value="percent">% of total</option>
                  </select>
                </div>
              )}
            </div>
            {validationResult.fieldErrors?.invoiceDiscountValue && (
              <small className="field-error-text" style={{ marginTop: 4 }}>{validationResult.fieldErrors.invoiceDiscountValue}</small>
            )}

            {/* Live Invoice Totals & GST Treatment Breakdown Strip */}
            <div style={{
              marginTop: '0.65rem',
              padding: '0.55rem 0.75rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.65rem',
              fontSize: '0.76rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{taxTreatment.badge}:</span>
                <span>{taxTreatment.explanation}</span>
                {taxTreatment.gstinWarning && (
                  <span style={{ color: '#b45309', fontWeight: 600 }}>⚠ {taxTreatment.gstinWarning}</span>
                )}
              </div>
              <div className="num-mono" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <span>Taxable: <strong>{formatCurrency(totals.subtotal, invoiceOptions.currency || 'INR')}</strong></span>
                {totals.totalDiscount > 0.005 && (
                  <span style={{ color: '#15803d' }}>Line Disc: −{formatCurrency(totals.totalDiscount, invoiceOptions.currency || 'INR')}</span>
                )}
                {showGST && (
                  totals.isInterstate ? (
                    <span>IGST: <strong>{formatCurrency(totals.igst, invoiceOptions.currency || 'INR')}</strong></span>
                  ) : (
                    <span>CGST+SGST: <strong>{formatCurrency((Number(totals.cgst) || 0) + (Number(totals.sgst) || 0), invoiceOptions.currency || 'INR')}</strong></span>
                  )
                )}
                {totals.cess > 0.005 && (
                  <span>Cess: <strong>{formatCurrency(totals.cess, invoiceOptions.currency || 'INR')}</strong></span>
                )}
                {totals.invoiceDiscountAmount > 0.005 && (
                  <span style={{ color: '#15803d' }}>Bill Disc: −{formatCurrency(totals.invoiceDiscountAmount, invoiceOptions.currency || 'INR')}</span>
                )}
                {Math.abs(totals.roundOff || 0) > 0.001 && (
                  <span>Round-off: {totals.roundOff > 0 ? '+' : ''}{Number(totals.roundOff).toFixed(2)}</span>
                )}
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--primary)', paddingLeft: '0.4rem', borderLeft: '1px solid var(--border)' }}>
                  Total: {formatCurrency(totals.total, invoiceOptions.currency || 'INR')}
                </span>
              </div>
            </div>
          </div>

          {/* Terms */}
          <div className="glass-panel erp-compact-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 className="section-title" style={{ margin: 0, fontSize: '0.82rem' }}>Terms &amp; Notes <HelpButton title="Terms & Conditions" doc="invoices#terms-notes" size={14} /></h3>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>PDF layout <HelpButton title="PDF layout: Compact or Formatted" doc="invoices#terms-layout" size={14} /></span>
                {[
                  { id: 'compact', label: 'Compact', hint: 'Tiny footer text — saves paper' },
                  { id: 'formatted', label: 'Formatted', hint: 'Larger readable paragraphs' },
                ].map(mode => {
                  const effectiveMode = invoiceOptions.termsFormatMode || _psPrintForRates.termsFormatMode
                    || ((invoiceOptions.invoiceMode || 'goods') === 'services' ? 'formatted' : 'compact');
                  const active = effectiveMode === mode.id;
                  return (
                    <button key={mode.id} type="button"
                      onClick={() => setInvoiceOptions(prev => ({ ...prev, termsFormatMode: mode.id }))}
                      title={mode.hint}
                      style={{
                        fontSize: '0.7rem', fontWeight: 600,
                        padding: '0.2rem 0.55rem', borderRadius: 999,
                        background: active
                          ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                          : 'var(--bg-secondary)',
                        color: active ? '#fff' : 'var(--text)',
                        border: active ? '1px solid transparent' : '1px solid var(--border)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: termsTemplates.length > 0 ? '1fr 1fr' : '1fr', gap: '0.6rem', marginBottom: '0.45rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Insert preset (by business type)</label>
                <select className="form-input" defaultValue=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    const preset = TERMS_PRESETS.find(p => p.id === e.target.value);
                    if (!preset) return;
                    if (htmlHasText(customTerms)) {
                      const skipConfirm = sessionStorage.getItem('gst_termsPresetConfirmed') === '1';
                      if (!skipConfirm) {
                        const proceed = await confirmAction({
                          title: 'Replace current Terms?',
                          message: 'Your existing Terms text will be lost. Subsequent preset swaps this session will happen silently — this confirmation is shown once.',
                          confirmLabel: 'Replace',
                          tone: 'warning',
                        });
                        if (!proceed) { e.target.value = ''; return; }
                        try { sessionStorage.setItem('gst_termsPresetConfirmed', '1'); } catch { /* ignore */ }
                      }
                    }
                    setCustomTerms(preset.body);
                    setSelectedTermsId('');
                    e.target.value = '';
                    if (preset.body) toast(`Inserted "${preset.label}" preset`, 'success');
                  }}>
                  <option value="">— Pick a business type —</option>
                  {TERMS_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              {termsTemplates.length > 0 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Load saved template</label>
                  <select className="form-input" value={selectedTermsId} onChange={(e) => handleTermsSelect(e.target.value)}>
                    <option value="">— Custom —</option>
                    {termsTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label">Terms (appears on invoice)</label>
                <RichEditor toolbar value={customTerms}
                  onChange={(v) => { setCustomTerms(v); setSelectedTermsId(''); }}
                  placeholder="Enter or paste your terms & conditions..." />
              </div>
              <div className="form-group">
                <label className="form-label">Notes / Remarks (optional)</label>
                <RichEditor toolbar value={customNotes}
                  onChange={(v) => setCustomNotes(v)}
                  placeholder="Project details, special instructions..." />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: '0.45rem', background: '#fefce8', border: '1px dashed #ca8a04', borderRadius: 6, padding: '0.45rem 0.75rem' }}>
              <label className="form-label" style={{ color: '#92400e', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v4m0 4h.01"/></svg>
                Private Note (not shown on invoice)
                <HelpButton title="Private Note" doc="invoices#private-note" size={14} />
              </label>
              <textarea rows="1" className="form-input note-textarea" value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                style={{ fontSize: '0.78rem', minHeight: 34 }}
                placeholder="e.g. Client asked for 15-day credit, follow up on 20th..." />
            </div>
          </div>

          {/* Extra Sections */}
          <div className="glass-panel erp-compact-panel">
            <div className="flex justify-between items-center">
              <h3 className="section-title" style={{ margin: 0, fontSize: '0.82rem' }}>Additional Pages / Sections <HelpButton title="Additional Pages / Sections" doc="invoices#extra-pages" size={14} /></h3>
              <button type="button" className="btn btn-secondary erp-toolbar-btn"
                onClick={() => setExtraSections(prev => [...prev, { id: Date.now().toString(), title: '', content: '' }])}>
                <Plus size={14} /> Add Section
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
              Add extra sections that appear after the invoice footer. You can paste formatted HTML content (bold, lists, tables, etc.).
            </p>
            {extraSections.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>No extra sections. Click "Add Section" to create one.</p>
            ) : (
              extraSections.map((section, idx) => (
                <div key={section.id} className="extra-section-editor">
                  <div className="flex gap-2 items-center mb-2">
                    <input type="text" className="form-input" value={section.title}
                      onChange={(e) => setExtraSections(prev => prev.map(s => s.id === section.id ? { ...s, title: e.target.value } : s))}
                      placeholder="Section title (e.g. Scope of Work, Delivery Timeline)" style={{ flex: 1 }} />
                    <button className="icon-btn" onClick={() => {
                      if (idx > 0) setExtraSections(prev => { const arr = [...prev]; [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; return arr; });
                    }} title="Move up" disabled={idx === 0}><ChevronUp size={14} /></button>
                    <button className="icon-btn" onClick={() => {
                      if (idx < extraSections.length - 1) setExtraSections(prev => { const arr = [...prev]; [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]; return arr; });
                    }} title="Move down" disabled={idx === extraSections.length - 1}><ChevronDown size={14} /></button>
                    <button className="icon-btn icon-btn-red" onClick={() => setExtraSections(prev => prev.filter(s => s.id !== section.id))} title="Remove"><Trash2 size={14} /></button>
                  </div>
                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                    <RichEditor
                      value={section.content}
                      onChange={(html) => setExtraSections(prev => prev.map(s => s.id === section.id ? { ...s, content: html } : s))}
                      placeholder="Type or paste formatted content here (supports bold, lists, tables from Word/Docs)..." />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live Preview — visually hidden in focus mode (v1.10.22) but
            kept in the DOM so printRef stays live for PDF generation.
            v1.10.26 — reported: "in this mode print not working" for focus
            mode. Root cause: `display: none` removes the element from
            layout entirely, so html2canvas renders a 0×0 canvas → blank
            PDF and blank print. Fix: move the pane off-screen (position:
            absolute, left: -99999px) instead. The element keeps real
            dimensions so html2canvas can snapshot it, but it's invisible
            to the user and out of the flex flow (so the editor still
            takes the full viewport width in focus mode). */}
        <div ref={previewPaneRef} className="preview-pane" style={previewCollapsed
          ? { position: 'absolute', left: '-99999px', top: 0, width: '794px', pointerEvents: 'none', opacity: 0 }
          : undefined}>
          {/* v1.10.37 — Preview label + zoom control bar redesign.
              Reported: prior label was a plain span with tiny black
              zoom buttons squeezed on the right — visually unfinished.
              Now: single-line pill bar with a preview icon + short
              label, a proper segmented zoom cluster (− / % / +) and
              a dedicated Fit button, all styled consistently with
              the rest of the panel's design language. */}
          <div className="preview-pane-label" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.55rem 0.85rem',
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            marginBottom: '0.5rem',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
            gap: '0.75rem',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '0.85rem' }}>👁</span>
              Live preview
              <HelpButton title="The live preview" doc="invoices#preview" size={16} />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {/* Segmented zoom cluster — three cells welded into one pill */}
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                overflow: 'hidden',
              }}>
                <button type="button" title="Zoom out"
                  onClick={() => setPreviewZoom(z => Math.max(50, z - 10))}
                  style={{ padding: '0.25rem 0.7rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>−</button>
                <span style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', minWidth: 42, textAlign: 'center', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>{previewZoom}%</span>
                <button type="button" title="Zoom in"
                  onClick={() => setPreviewZoom(z => Math.min(200, z + 10))}
                  style={{ padding: '0.25rem 0.7rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>+</button>
              </div>
              {/* v1.10.33 — REAL fit-to-width. Prior code was
                  setPreviewZoom(100), which just set 100%, not "fit". */}
              <button type="button" title="Fit preview to the pane width"
                onClick={handleFitToWidth}
                style={{
                  padding: '0.28rem 0.75rem',
                  border: '1px solid var(--primary)',
                  background: 'var(--primary-light, rgba(30,64,175,0.08))',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 700,
                  borderRadius: 999,
                  letterSpacing: '0.02em',
                }}>Fit</button>
              {/* v1.10.83 - the full-size print preview while making the invoice. */}
              <button type="button" title="See the whole page as it will print"
                onClick={() => setShowPrintPreview(true)}
                style={{
                  padding: '0.28rem 0.75rem',
                  border: '1px solid var(--border)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 700,
                  borderRadius: 999,
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                }}><Maximize2 size={12} /> Full view</button>
            </span>
          </div>
          {/* v1.10.48 — The frame reserves the SCALED size (natural × zoom)
              so the pane's layout matches what is painted. See the
              previewNatural measurement above for why.

              This also subsumes the v1.10.46 thermal-centering hack: that
              used `transform-origin: top center` to stop a 58/80mm receipt
              hugging the left edge, which worked visually but left the
              layout box at full sheet width. Now the frame is exactly the
              receipt's scaled width and .preview-pane centres it, so
              thermal and sheet both land correctly with one origin. */}
          <div className="preview-scaler-frame" style={previewNatural.w ? {
            width: previewNatural.w * (previewZoom / 100),
            height: previewNatural.h * (previewZoom / 100),
          } : undefined}>
            <div className="preview-scaler" style={{
              transform: `scale(${previewZoom / 100})`,
              transformOrigin: 'top left',
            }}>
              <InvoicePreview ref={printRef} profile={profile} client={client} details={details}
                items={items} totals={totals} invoiceType={invoiceType} customTerms={customTerms}
                customNotes={customNotes} extraSections={extraSections} options={invoiceOptions}
                cancelled={editingBill?.status === 'cancelled'} einvoice={einvoice} />
            </div>
          </div>
        </div>
      </div>

      {/* v1.10.36 — Portal print preview modal for thermal invoices.
          Renders the SAME <InvoicePreview> component with the SAME
          props as the on-screen preview → identical output. The Print
          button calls executePrint which uses the parent's printRef
          (the on-screen preview), so what the user sees IS what the
          printer receives. See PrintPreviewModal.jsx for the "why not
          re-serialize" rationale. */}
      <PrintPreviewModal
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        onPrint={printFromPreview}
        onDownloadPdf={generatePDF}
        cancelled={editingBill?.status === 'cancelled'}
        einvoice={einvoice}
        profile={profile}
        client={client}
        details={details}
        items={items}
        totals={totals}
        invoiceType={invoiceType}
        customTerms={customTerms}
        customNotes={customNotes}
        extraSections={extraSections}
        invoiceOptions={invoiceOptions}
      />

      {/* P2 #32 — 3-option leave modal. Replaces the previous confusing
          browser confirm() where OK=save was counterintuitive. */}
      {leaveModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="leave-modal-title" onClick={leaveActions.cancel}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <h3 id="leave-modal-title" style={{ marginTop: 0 }}>Unsaved changes <HelpButton title="Leaving with unsaved changes" doc="invoices#leaving" size={16} /></h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              This invoice has changes that haven't been saved yet. What do you want to do?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={leaveActions.cancel}>
                Keep editing
              </button>
              <button type="button" className="btn btn-secondary" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={leaveActions.discardAndExit}>
                Discard &amp; leave
              </button>
              <button type="button" className="btn btn-primary" onClick={leaveActions.saveAndExit}>
                Save &amp; leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Tier Change Confirmation Modal */}
      {tierChangePrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tier-change-modal-title" onClick={() => setTierChangePrompt(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <h3 id="tier-change-modal-title" style={{ marginTop: 0 }}>
              Change price tier to {tierChangePrompt.targetLabel}?
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              {tierChangePrompt.source === 'client'
                ? `Selected customer uses the "${tierChangePrompt.targetLabel}" price tier. `
                : `You selected the "${tierChangePrompt.targetLabel}" price tier. `}
              How should existing catalog line items be updated?
              {tierChangePrompt.manualCount > 0 && (
                <> ({tierChangePrompt.manualCount} row{tierChangePrompt.manualCount > 1 ? 's have' : ' has'} manual rate overrides.)</>
              )}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => applyTierChangeDecision('keep')}>
                Keep current prices
              </button>
              {tierChangePrompt.manualCount > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => applyTierChangeDecision('replace-all')}>
                  Replace all (including manual)
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => applyTierChangeDecision('update-auto')}>
                Update automatic prices
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
