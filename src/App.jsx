import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Home, FileText, Settings, Plus, Users, Package, BarChart3, Wallet, RefreshCw, Receipt, BookOpen, Moon, Sun, Download, X, ShoppingCart, ChevronDown, Building2, Pencil, HelpCircle, Search, Command, Bell, Calculator, HardDrive, Menu, Heart, Banknote, Laptop, Landmark, FileSpreadsheet } from 'lucide-react';
import { getAllProfiles, saveProfile, getEnabledModules, getMenuOrder, onMenuChanged, getAllBills, getAllProducts, getStockAlertSettings, getAllClients, getAllSuppliers, getAllLedgers, runUpdateNow, getLockStatus } from './store';
import { isModuleEnabled, getUpcomingFilings, countsAsSales, localToday, toLocalIsoDate, DOCS_URL, findLowStock, trackedStock } from './utils';
import { decodeHtmlEntities } from './utils/products';
import { orderedMenu } from './utils/businessTypes';
import Dashboard from './components/Dashboard';
import InvoiceGenerator from './components/InvoiceGenerator';
import SetupWizard from './components/SetupWizard';
import ToastContainer, { toast } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import ConfirmModalContainer from './components/ConfirmModal';
import WelcomeGuide from './components/WelcomeGuide';
import InvoiceSeriesModal from './components/InvoiceSeriesModal';
import QuickMasterModal from './components/QuickMasterModal';
const SettingsView = lazy(() => import('./components/SettingsView'));
const ClientsView = lazy(() => import('./components/ClientsView'));
const InventoryView = lazy(() => import('./components/InventoryView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const ExpenseTracker = lazy(() => import('./components/ExpenseTracker'));
const RecurringInvoices = lazy(() => import('./components/RecurringInvoices'));
const ReceiptVoucher = lazy(() => import('./components/ReceiptVoucher'));
const CashBook = lazy(() => import('./components/CashBook'));
const GSTReturns = lazy(() => import('./components/GSTReturns'));
const IncomeTax = lazy(() => import('./components/IncomeTax'));
const PurchaseBills = lazy(() => import('./components/PurchaseBills'));
const ControlPanel = lazy(() => import('./components/ControlPanel'));
const SupportView = lazy(() => import('./components/SupportView'));
const POSView = lazy(() => import('./components/POSView'));
const AccountingView = lazy(() => import('./components/AccountingView'));
const BusyImportModal = lazy(() => import('./components/BusyImportModal'));
import StarBanner from './components/StarBanner';
import AppFooter from './components/AppFooter';
import LockButton from './components/LockButton';
import OfflineModeButton from './components/OfflineModeButton';
import { isOfflineMode } from './utils/offlineMode';
import HelpButton from './components/HelpButton';
import { lockNow } from './utils/appLock';
import { getPrintSettings } from './utils/printSettings';

const openDocs = () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer');

// v1.10.4 — Lightweight Suspense fallback shown while a lazy view
// downloads. Purely visual — no data fetching, no state.
function ViewLoading() {
  return (
    <div style={{ padding: '3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        <span style={{
          display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)',
          borderTopColor: 'var(--primary)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        Loading…
      </div>
    </div>
  );
}

const MENU_BRAND_KEY = 'gst_menuBrand';

function App() {
  // v1.9.3 — Setup Wizard shown on first-run (before onboardingComplete = true)
  const [showWizard, setShowWizard] = useState(() => {
    try { return !getPrintSettings().onboardingComplete; } catch { return false; }
  });
  const [currentView, setCurrentViewRaw] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('view');
      const valid = ['dashboard', 'new', 'pos', 'clients', 'inventory', 'accounting', 'expenses', 'purchases', 'recurring', 'receipts', 'cashbook', 'reports', 'filing', 'incometax', 'settings', 'controlpanel', 'support'];
      if (v && valid.includes(v)) {
        window.history.replaceState({}, '', window.location.pathname);
        return v;
      }
    } catch { /* sandboxed history API — fall through */ }
    const last = sessionStorage.getItem('gst_currentView');
    return last && last !== 'guide' ? last : 'dashboard';
  });
  const invoiceNavGuardRef = useRef(null);
  const runWithInvoiceGuard = useCallback((action) => {
    if (currentView === 'new' && typeof invoiceNavGuardRef.current === 'function') {
      invoiceNavGuardRef.current(action);
      return;
    }
    action();
  }, [currentView]);
  const setCurrentView = useCallback((nextView, opts = {}) => {
    if (!opts?.bypassGuard && currentView === 'new' && nextView !== 'new' && typeof invoiceNavGuardRef.current === 'function') {
      invoiceNavGuardRef.current(() => setCurrentViewRaw(nextView));
      return;
    }
    setCurrentViewRaw(nextView);
  }, [currentView]);
  const [showBusyModal, setShowBusyModal] = useState(false);
  const [profile, setProfile] = useState(null);
  // v1.10.83 - the menu's own name and logo, as last shown (see `brand` below).
  const [menuBrandCache] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MENU_BRAND_KEY) || 'null'); } catch { return null; }
  });
  useEffect(() => {
    if (!profile) return; // not loaded yet: keep what was there
    try {
      const name = String(profile.businessName || '').trim();
      if (!profile.showInMenu || !name) { localStorage.removeItem(MENU_BRAND_KEY); return; }
      const keep = { showInMenu: true, businessName: name, logo: profile.logo || '' };
      try { localStorage.setItem(MENU_BRAND_KEY, JSON.stringify(keep)); }
      catch { localStorage.setItem(MENU_BRAND_KEY, JSON.stringify({ ...keep, logo: '' })); } // a very large logo: the name at least
    } catch { /* browser storage off: the menu simply waits for the profile */ }
  }, [profile]);
  const [editingBill, setEditingBill] = useState(() => {
    try {
      const saved = sessionStorage.getItem('gst_editingBill');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('freegstbill_theme') === 'dark';
  });
  const [showWelcome, setShowWelcome] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const retryTimer = useRef(null);

  const [serverStatus, setServerStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
  const profileLoaded = useRef(false);
  const [allProfiles, setAllProfiles] = useState([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef(null);

  // Update notification state. Auto-checks GitHub on mount + every 6h.
  // The user can dismiss a specific version (stored in localStorage) so the
  // banner doesn't keep nagging once they've seen it. A NEW version released
  // after that dismissal will re-show the banner.
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      // The server also skips it when Offline mode is on, but it reads the
      // copy in the data folder, which can lag behind this browser's.
      if (isOfflineMode()) return;
      try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        if (!cancelled) setUpdateInfo(data);
      } catch { /* offline — quietly skip */ }
    };
    // First check ~5 seconds after mount so it doesn't fight the initial load.
    const initial = setTimeout(check, 5000);
    // Then re-check every 6 hours while the app is open.
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
  }, []);

  // ---- Notification centre ----
  // Computed from server data on app boot + every 10 minutes; tucked under a
  // bell icon next to dark-mode toggle in the sidebar. Each section is one
  // click away from the relevant page.
  const [notifications, setNotifications] = useState({ overdue: [], dueSoon: [], lowStock: [], filings: [], autoFire: null });
  const [showNotifs, setShowNotifs] = useState(false);

  // v1.10.62 — reported (#53, @sangwanmail-eng): "Notifications should clear
  // after check."
  //
  // They never did, and the reason is that these are not messages — they are
  // computed live from your data every time the app loads ("3 invoices are
  // overdue", "2 products are low on stock"). There was no notion of having
  // read one, so the badge simply reported what was true and stayed lit
  // forever.
  //
  // Marking them read cannot just hide them, though: if an invoice goes
  // overdue tomorrow you must be told, even if you dismissed yesterday's
  // overdue notice. So dismissal is recorded per section as a SIGNATURE of
  // what was actually shown — the specific invoice numbers, the specific
  // products. Dismissing stores that signature; the section stays quiet only
  // while the signature is unchanged. The moment the underlying facts differ
  // — a new overdue invoice, a different product running low — the signature
  // changes and the alert comes back on its own.
  //
  // Kept in localStorage: it is a per-machine reading preference, not
  // business data, and it must not travel in a backup or sync to another PC.
  const DISMISS_KEY = 'fgsb_dismissedNotifs';
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); } catch { return {}; }
  });

  const notifSignatures = useMemo(() => ({
    overdue: notifications.overdue.map(b => b.invoiceNumber || b.id).sort().join('|'),
    dueSoon: notifications.dueSoon.map(b => b.invoiceNumber || b.id).sort().join('|'),
    lowStock: notifications.lowStock.map(p => `${p.id || p.name}:${p.stock ?? ''}`).sort().join('|'),
    filings: notifications.filings.map(f => f.label || f.id || String(f)).sort().join('|'),
    autoFire: notifications.autoFire?.count > 0 ? `autofire:${notifications.autoFire.count}` : '',
  }), [notifications]);

  // A section counts toward the badge only when it has content AND that
  // content is not the exact thing the user already dismissed.
  const isLive = (key) => !!notifSignatures[key] && dismissed[key] !== notifSignatures[key];

  const notifTotal = (isLive('overdue') ? notifications.overdue.length : 0)
    + (isLive('dueSoon') ? notifications.dueSoon.length : 0)
    + (isLive('lowStock') ? notifications.lowStock.length : 0)
    + (isLive('filings') ? notifications.filings.length : 0)
    + (isLive('autoFire') ? 1 : 0);

  // How many sections are currently showing something that could be cleared.
  const dismissableCount = ['overdue', 'dueSoon', 'lowStock', 'filings', 'autoFire']
    .filter(isLive).length;

  const markAllNotifsRead = () => {
    const next = { ...dismissed, ...notifSignatures };
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const [bills, products, stockAlertCfg] = await Promise.all([
          getAllBills().catch(() => []),
          getAllProducts().catch(() => []),
          getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
        ]);
        if (cancelled) return;
        // Local dates: toISOString() is UTC (yesterday in India until 05:30),
        // while the server stamps lastRecurringAutoFire with its local date.
        const today = localToday();
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 3);
        const tomorrowStr = toLocalIsoDate(tomorrow);
        // v1.10.67 (#66 item 12) — never chase payment for a cancelled invoice;
        // nor for a quotation, proforma, challan or credit note (countsAsSales).
        const overdue = bills.filter(b => {
          const d = b.data?.details?.dueDate;
          return d && d < today && b.status !== 'paid' && countsAsSales(b);
        });
        const dueSoon = bills.filter(b => {
          const d = b.data?.details?.dueDate;
          return d && d >= today && d <= tomorrowStr && b.status !== 'paid' && countsAsSales(b);
        });
        // Honour the user's stock-alert preferences. When disabled, the filter
        // returns nothing — bell badge drops to 0 for the stock category.
        // When enabled, use the configured threshold (default 5).
        const stockThreshold = Number(stockAlertCfg?.threshold ?? 5);
        const lowStock = stockAlertCfg?.enabled === false
          ? []
          : findLowStock(products, stockThreshold); // services and uncounted left out (#121)
        const filings = getUpcomingFilings().filter(f => f.daysAway <= 10);
        // Recurring auto-fire breadcrumb — set by server.js processDueRecurring().
        // Only "fresh" (today's) auto-fires count as a notification; older ones
        // would otherwise stay sticky forever.
        let autoFire = null;
        try {
          const r = await fetch('/api/meta/lastRecurringAutoFire');
          if (r.ok) {
            const j = await r.json();
            if (j.value && j.value.date === today && j.value.count > 0) autoFire = j.value;
          }
        } catch { /* fine */ }
        setNotifications({ overdue, dueSoon, lowStock, filings, autoFire });
      } catch { /* offline / server down — leave previous counts */ }
    };
    compute();
    const interval = setInterval(compute, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currentView]); // recompute on view change so the bell stays fresh after the user records a payment

  // ---- Keyboard shortcuts + command palette ----
  // Ctrl+K opens a Spotlight-style command palette; Ctrl+N starts a new
  // invoice from anywhere; Ctrl+/ shows the full shortcuts list. Ctrl+S /
  // Ctrl+P live in InvoiceGenerator (they need invoice-form context). All
  // global handlers also accept Meta (⌘) for macOS users.
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [searchCorpus, setSearchCorpus] = useState({ bills: [], clients: [], suppliers: [], ledgers: [], products: [] });
  useEffect(() => {
    Promise.all([
      getAllBills().catch(() => []),
      getAllClients().catch(() => []),
      getAllSuppliers().catch(() => []),
      getAllLedgers().catch(() => []),
      getAllProducts().catch(() => []),
    ]).then(([bills, clients, suppliers, ledgers, products]) => {
      setSearchCorpus({
        bills: bills.slice(0, 100),
        clients: clients.slice(0, 200),
        suppliers: suppliers.slice(0, 200),
        ledgers: ledgers.slice(0, 200),
        products: products.slice(0, 300),
      });
    });
  }, [showPalette]);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Enterprise ERP UI State
  const [densityMode, setDensityMode] = useState(() => {
    try { return localStorage.getItem('gst_erp_density') || 'optionA'; } catch { return 'optionA'; }
  });
  useEffect(() => {
    document.body.classList.toggle('density-compact', densityMode === 'optionB');
    try { localStorage.setItem('gst_erp_density', densityMode); } catch { /* ignore */ }
  }, [densityMode]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalFy, setGlobalFy] = useState('2026-27');
  const [accountingSubTab, setAccountingSubTab] = useState('vouchers');
  const [accountingVoucherType, setAccountingVoucherType] = useState('Payment');
  const [purchaseSubTab, setPurchaseSubTab] = useState('bills');
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [showQuickMasterModal, setShowQuickMasterModal] = useState(false);
  const [showMoreModules, setShowMoreModules] = useState(false);

  const openAccountingAt = (subTab = 'vouchers', vType = null) => {
    setAccountingSubTab(subTab);
    if (vType) setAccountingVoucherType(vType);
    setCurrentView('accounting');
  };

  const openPurchasesAt = (subTab = 'bills') => {
    setPurchaseSubTab(subTab);
    setCurrentView('purchases');
  };

  const [updating, setUpdating] = useState(false);
  const handleUpdateNow = async () => {
    setUpdating(true);
    toast('Updating… your data is backed up first. This takes about a minute.', 'info', 8000);
    const result = await runUpdateNow();
    setUpdating(false);
    if (result.ok) {
      setShowUpdateModal(false);
      toast('Update finished. Reload the page to use the new version.', 'success', 10000);
    } else {
      toast(`Update failed — ${result.error}`, 'error', 10000);
    }
  };

  const dismissUpdate = () => {
    if (updateInfo?.latest) {
      localStorage.setItem('freegstbill_dismissedUpdate', updateInfo.latest);
    }
    setShowUpdateModal(false);
  };

  // Check if server is running — continuously monitors
  useEffect(() => {
    let cancelled = false;
    let misses = 0;

    const checkServer = async () => {
      try {
        const res = await fetch('/api/profile', { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          if (cancelled) return;
          misses = 0;
          setServerDown(false);
          setServerStatus('online');
          if (!profileLoaded.current) {
            profileLoaded.current = true;
            const p = await res.json();
            setProfile(p);
            if (!p.businessName && !localStorage.getItem('freegstbill_onboarded')) {
              setShowWelcome(true);
            }
          }
          return;
        }
        throw new Error('not ok');
      } catch {
        if (cancelled) return;
        misses += 1;
        if (!profileLoaded.current || misses >= 3) {
          setServerDown(true);
          setServerStatus('offline');
        }
      }
    };

    checkServer();
    retryTimer.current = setInterval(checkServer, 5000);

    return () => {
      cancelled = true;
      if (retryTimer.current) clearInterval(retryTimer.current);
    };
  }, []);

  useEffect(() => {
    sessionStorage.setItem('gst_currentView', currentView);
  }, [currentView]);

  useEffect(() => {
    if (editingBill) {
      const { _printOnOpen, ...toKeep } = editingBill;
      sessionStorage.setItem('gst_editingBill', JSON.stringify(toKeep));
    } else {
      sessionStorage.removeItem('gst_editingBill');
    }
  }, [editingBill]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('freegstbill_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    if (serverStatus === 'online') {
      getAllProfiles().then(setAllProfiles).catch(() => {});
    }
  }, [serverStatus]);

  useEffect(() => {
    if (!showProfileMenu) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProfileMenu]);

  const handleSwitchProfile = (bp) => {
    setShowProfileMenu(false);
    runWithInvoiceGuard(async () => {
      const loaded = { ...bp };
      delete loaded.id;
      await saveProfile(loaded);
      setProfile(loaded);
    });
  };

  const businessKey = String(profile?.gstin || profile?.businessName || '').trim().toUpperCase();

  const [navOpen, setNavOpen] = useState(false);
  const closeNavAfterPick = (e) => {
    const picked = e.target.closest('button');
    if (picked && !picked.classList.contains('profile-switcher-btn')) setNavOpen(false);
  };

  const [editorKey, setEditorKey] = useState(0);
  const [sidebarAutoHide] = useState(() => {
    try { return localStorage.getItem('freegstbill_sidebarAutoHide') === '1'; } catch { return false; }
  });
  const startFreshNewInvoice = useCallback(() => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(null);
    setCurrentViewRaw('new');
  }, []);
  const handleNewInvoice = () => {
    runWithInvoiceGuard(startFreshNewInvoice);
  };

  const handleEditInvoice = (bill) => {
    runWithInvoiceGuard(() => {
      setEditorKey((k) => k + 1);
      sessionStorage.removeItem('gst_invoiceDraft');
      setEditingBill(bill);
      setCurrentViewRaw('new');
    });
  };

  const handlePrintInvoice = (bill) => {
    runWithInvoiceGuard(() => {
      setEditorKey((k) => k + 1);
      sessionStorage.removeItem('gst_invoiceDraft');
      setEditingBill({ ...bill, _printOnOpen: true });
      setCurrentViewRaw('new');
    });
  };

  const handleDuplicateInvoice = (bill) => {
    runWithInvoiceGuard(() => {
      setEditorKey((k) => k + 1);
      sessionStorage.removeItem('gst_invoiceDraft');
      const clone = JSON.parse(JSON.stringify(bill));
      clone._isDuplicate = true;
      setEditingBill(clone);
      setCurrentViewRaw('new');
    });
  };

  const handleConvertToInvoice = (bill) => {
    runWithInvoiceGuard(() => {
      setEditorKey((k) => k + 1);
      sessionStorage.removeItem('gst_invoiceDraft');
      const clone = JSON.parse(JSON.stringify(bill));
      clone._isDuplicate = true;
      clone._convertToType = 'tax-invoice';
      setEditingBill(clone);
      setCurrentViewRaw('new');
    });
  };

  const enabledModules = getEnabledModules();
  const showIfModule = (moduleId) => isModuleEnabled(moduleId, enabledModules);
  const [, setMenuTick] = useState(0);
  useEffect(() => onMenuChanged(() => setMenuTick(t => t + 1)), []);
  const menu = orderedMenu(getMenuOrder()).filter(m => !m.module || showIfModule(m.module));

  useEffect(() => {
    const map = { new: 'invoicing', pos: 'pos', clients: 'clients', inventory: 'inventory', accounting: 'accounting', expenses: 'expenses', purchases: 'purchases', recurring: 'recurring', receipts: 'receipts', cashbook: 'cashBook', reports: 'reports', filing: 'gstReturns', incometax: 'incomeTax' };
    const moduleForView = map[currentView];
    if (moduleForView && !isModuleEnabled(moduleForView, enabledModules)) {
      setCurrentView('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, JSON.stringify(enabledModules)]);

  const NAV_EXTRAS = {
    dashboard: { icon: Home, label: 'Dashboard' },
    new: { icon: Plus, label: 'New Invoice', onClick: handleNewInvoice },
    pos: { icon: Laptop, label: 'POS Counter' },
    clients: { icon: Users, label: 'Clients' },
    inventory: { icon: Package, label: 'Products' },
    accounting: { icon: Landmark, label: 'Accounting & Ledgers' },
    expenses: { icon: Wallet, label: 'Expenses' },
    purchases: { icon: ShoppingCart, label: 'Purchases' },
    recurring: { icon: RefreshCw, label: 'Recurring' },
    receipts: { icon: Receipt, label: 'Receipts' },
    cashbook: { icon: Banknote, label: 'Cash book' },
    reports: { icon: BarChart3, label: 'Reports' },
    filing: { icon: BookOpen, label: 'GST Returns' },
    incometax: { icon: Calculator, label: 'Income Tax' },
    guide: { icon: HelpCircle, label: 'User Guide', onClick: openDocs },
  };
  const navItems = menu.filter(m => m.section === 'main').map(m => ({ id: m.id, ...NAV_EXTRAS[m.id] }));
  const bottomIds = menu.filter(m => m.section === 'bottom').map(m => m.id);
  const topIds = menu.filter(m => m.section === 'top').map(m => m.id);
  const brand = profile || menuBrandCache;
  const ownBrand = !!brand?.showInMenu && !!String(brand?.businessName || '').trim();
  const topActions = topIds.map(id => ({
    guide: (
      <button key={id} type="button" className="topbar-btn" onClick={openDocs}
        title="User guide (opens in your browser)" aria-label="User guide">
        <HelpCircle size={16} />
      </button>
    ),
    notifications: (
      <button key={id} type="button" className="topbar-btn" onClick={() => setShowNotifs(s => !s)}
        title="Notifications" aria-label={notifTotal > 0 ? `Notifications: ${notifTotal}` : 'Notifications'}>
        <Bell size={16} />
        {notifTotal > 0 && <span className="topbar-badge">{notifTotal > 99 ? '99+' : notifTotal}</span>}
      </button>
    ),
    lock: <LockButton key={id} className="topbar-btn" label={null} />,
    offline: <OfflineModeButton key={id} className="topbar-btn" onOpenSettings={() => {
      try { sessionStorage.setItem('gst_settingsTab', 'section-privacy'); } catch { /* storage blocked */ }
      setCurrentView('settings');
    }} />,
    darkMode: (
      <button key={id} type="button" className="topbar-btn" onClick={() => setDarkMode(d => !d)}
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={darkMode ? 'Light mode' : 'Dark mode'}>
        {darkMode ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    ),
  })[id]);

  // Global "Go To" Command Palette actions (Alt+G / Ctrl+K)
  const paletteActions = useMemo(() => {
    const acts = [
      { label: 'Sales Tax Invoice (B2B / B2C)', hint: 'F8', category: 'voucher', run: () => handleNewInvoice() },
      { label: 'POS Counter Fast Billing', hint: 'Alt+P', category: 'voucher', run: () => setCurrentView('pos') },
      { label: 'Purchase Bill / Supplier Inward', hint: 'F9', category: 'voucher', run: () => openPurchasesAt('bills') },
      { label: 'AI/OCR Purchase Bill Capture Workbench', hint: 'Alt+U', category: 'voucher', run: () => openPurchasesAt('ocr') },
      { label: 'Contra Voucher (Cash ↔ Bank Transfer)', hint: 'F4', category: 'voucher', run: () => openAccountingAt('vouchers', 'Contra') },
      { label: 'Payment Voucher (Supplier / Expense)', hint: 'F5', category: 'voucher', run: () => openAccountingAt('vouchers', 'Payment') },
      { label: 'Receipt Voucher (Customer / Income)', hint: 'F6', category: 'voucher', run: () => openAccountingAt('vouchers', 'Receipt') },
      { label: 'Journal Voucher (Adjustment Entry)', hint: 'F7', category: 'voucher', run: () => openAccountingAt('vouchers', 'Journal') },
      { label: 'Instant Master Creation (+ Party / Ledger / Spare Part)', hint: 'Alt+C', category: 'action', run: () => setShowQuickMasterModal(true) },
      { label: 'Manage Invoice & Voucher Numbering Series', hint: 'Rule 46', category: 'action', run: () => setShowSeriesModal(true) },
      { label: 'Go to Executive Dashboard', hint: 'Alt+D', category: 'nav', run: () => setCurrentView('dashboard') },
      { label: 'Go to Parties, General Ledgers & Bank Reconciliation (BRS)', hint: 'Alt+L', category: 'nav', run: () => openAccountingAt('ledgers') },
      { label: 'Go to Spare-Parts Catalog & Stock Master', hint: 'Alt+I', category: 'nav', run: () => setCurrentView('inventory') },
      { label: 'Go to Trial Balance', hint: 'Alt+T', category: 'report', run: () => openAccountingAt('trial-balance') },
      { label: 'Go to Trading & Profit & Loss A/c', hint: 'Alt+F', category: 'report', run: () => openAccountingAt('profit-loss') },
      { label: 'Go to Balance Sheet (Schedule III)', hint: 'Alt+B', category: 'report', run: () => openAccountingAt('balance-sheet') },
      { label: 'Go to GST Compliance Hub (GSTR-1 / 2B / 3B / HSN)', hint: 'Alt+S', category: 'report', run: () => setCurrentView('filing') },
      { label: 'Open BUSY .DAT Migration Wizard', hint: 'Ctrl+Shift+B', category: 'action', run: () => setShowBusyModal(true) },
    ];
    navItems.forEach(item => {
      if (['new', 'pos', 'inventory', 'accounting', 'purchases', 'filing', 'dashboard'].includes(item.id)) return;
      acts.push({ label: `Go to ${item.label}`, hint: '', category: 'nav', run: item.onClick || (() => setCurrentView(item.id)) });
    });
    acts.push({ label: 'Go to Settings & Configuration', hint: 'F11', category: 'nav', run: () => setCurrentView('settings') });
    if (bottomIds.includes('controlpanel')) acts.push({ label: 'Go to Control Panel', hint: '', category: 'nav', run: () => setCurrentView('controlpanel') });
    acts.push({ label: 'Go to Support & About', hint: '', category: 'nav', run: () => setCurrentView('support') });
    acts.push({ label: 'Show Keyboard Shortcuts Reference', hint: 'Ctrl+/', category: 'help', run: () => setShowShortcutsHelp(true) });

    searchCorpus.bills.forEach(b => {
      acts.push({
        label: `📄 ${b.invoiceNumber || 'INV-?'} — ${decodeHtmlEntities(b.clientName || 'Walk-in')}`,
        hint: b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '',
        category: 'invoice',
        run: () => handleEditInvoice(b),
      });
    });
    searchCorpus.clients.forEach(c => {
      acts.push({
        label: `👤 ${decodeHtmlEntities(c.name)} — Customer (Debtor)${c.gstin ? ' · ' + c.gstin : ''}`,
        hint: c.phone || c.state || 'Sundry Debtors',
        category: 'client',
        run: () => openAccountingAt('ledgers'),
      });
    });
    searchCorpus.suppliers.forEach(s => {
      acts.push({
        label: `🏭 ${decodeHtmlEntities(s.name)} — Supplier (Creditor)${s.gstin ? ' · ' + s.gstin : ''}`,
        hint: s.phone || s.state || 'Sundry Creditors',
        category: 'supplier',
        run: () => openAccountingAt('ledgers'),
      });
    });
    searchCorpus.ledgers.forEach(l => {
      acts.push({
        label: `🏛️ ${decodeHtmlEntities(l.name)} — Ledger (${l.group || 'General'})`,
        hint: `${l.openingType || 'Dr'} ₹${Number(l.openingBalance || 0).toLocaleString('en-IN')}`,
        category: 'ledger',
        run: () => openAccountingAt('ledgers'),
      });
    });
    if (navItems.some(i => i.id === 'inventory')) searchCorpus.products.forEach(p => {
      const oem = p.oemPartNo || p.sku || '';
      acts.push({
        label: `🔧 ${decodeHtmlEntities(p.name)}${oem ? ` [${oem}]` : ''}${p.hsn ? ' · HSN: ' + p.hsn : ''}`,
        hint: trackedStock(p) === null ? '' : trackedStock(p) + ' Nos in stock',
        category: 'product',
        run: () => setCurrentView('inventory'),
      });
    });
    return acts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navItems, bottomIds, topIds, updateInfo, handleNewInvoice, searchCorpus]);

  const filteredPalette = paletteActions.filter(a =>
    !paletteQuery.trim() || a.label.toLowerCase().includes(paletteQuery.toLowerCase()) || (a.hint && a.hint.toLowerCase().includes(paletteQuery.toLowerCase()))
  );

  // Standardized Enterprise Keyboard Shortcuts (TallyPrime / BUSY Standard)
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;

      // Function keys F1-F12
      if (e.key === 'F1') {
        e.preventDefault();
        if (allProfiles.length > 1) setShowProfileMenu(v => !v);
        else setShowShortcutsHelp(s => !s);
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        handleNewInvoice();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        openAccountingAt('vouchers', 'Contra');
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        openAccountingAt('vouchers', 'Payment');
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        openAccountingAt('vouchers', 'Receipt');
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        openAccountingAt('vouchers', 'Journal');
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        handleNewInvoice();
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        openPurchasesAt('bills');
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        setCurrentView('pos');
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        setCurrentView('settings');
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        window.print();
        return;
      }

      // Alt + Key Enterprise Navigation & Voucher Shortcuts
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 'g') {
          e.preventDefault();
          setShowPalette(p => !p);
          setPaletteQuery('');
          setPaletteIdx(0);
          return;
        }
        if (k === 'c') {
          e.preventDefault();
          setShowQuickMasterModal(true);
          return;
        }
        if (k === 'p') {
          e.preventDefault();
          setCurrentView('pos');
          return;
        }
        if (k === 'u') {
          e.preventDefault();
          openPurchasesAt('ocr');
          return;
        }
        if (k === 'd') {
          e.preventDefault();
          setCurrentView('dashboard');
          return;
        }
        if (k === 'l') {
          e.preventDefault();
          openAccountingAt('ledgers');
          return;
        }
        if (k === 'i') {
          e.preventDefault();
          setCurrentView('inventory');
          return;
        }
        if (k === 't') {
          e.preventDefault();
          openAccountingAt('trial-balance');
          return;
        }
        if (k === 'f') {
          e.preventDefault();
          openAccountingAt('profit-loss');
          return;
        }
        if (k === 'b') {
          e.preventDefault();
          openAccountingAt('balance-sheet');
          return;
        }
        if (k === 's') {
          e.preventDefault();
          setCurrentView('filing');
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey) {
          e.preventDefault();
          setShowBusyModal(s => !s);
        } else {
          e.preventDefault();
          setSidebarCollapsed(c => !c);
        }
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setShowPalette(p => !p);
        setPaletteQuery('');
        setPaletteIdx(0);
      } else if (e.key === '/') {
        e.preventDefault();
        setShowShortcutsHelp(s => !s);
      } else if ((e.key === 'l' || e.key === 'L') && e.shiftKey) {
        e.preventDefault();
        getLockStatus().then((st) => { if (st?.enabled) lockNow(); }).catch(() => {});
      } else if ((e.key === 'n' || e.key === 'N') && !editable) {
        e.preventDefault();
        handleNewInvoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleNewInvoice, allProfiles.length]);

  useEffect(() => {
    const mirrorTitleToAria = (root = document) => {
      root.querySelectorAll('button.icon-btn[title]:not([aria-label])').forEach(btn => {
        btn.setAttribute('aria-label', btn.getAttribute('title'));
      });
    };
    mirrorTitleToAria();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches?.('button.icon-btn[title]:not([aria-label])')) {
                node.setAttribute('aria-label', node.getAttribute('title'));
              }
              mirrorTitleToAria(node);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
      const top = overlays[overlays.length - 1];
      if (!top) return;
      if (showPalette) return;
      top.click();
    };
    window.addEventListener('keydown', onEsc);
    return () => { observer.disconnect(); window.removeEventListener('keydown', onEsc); };
  }, [showPalette]);

  useEffect(() => {
    if (!showPalette) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setShowPalette(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIdx(i => Math.min(i + 1, filteredPalette.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const action = filteredPalette[paletteIdx];
        if (action) { action.run(); setShowPalette(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPalette, paletteIdx, filteredPalette]);

  if (serverDown) {
    return (
      <div className="server-down-overlay">
        <div className="server-down-modal">
          <FileText size={48} color="#3b82f6" />
          <h2>Free GST Billing Software Needs a Quick Start <HelpButton title="Needs a Quick Start" doc="shortcuts#app-not-running" size={16} /></h2>
          <p>
            Your data is <strong>100% safe</strong> on your computer — nothing is lost.
            The app just needs to be started once.
          </p>
          <div className="server-down-steps">
            <p className="server-down-hint">How to start it:</p>
            <ol>
              <li>Double-click the <strong>Free GST Billing</strong> icon on your Desktop (the blue <strong>B</strong>)</li>
              <li>Or search <strong>"Free GST Billing"</strong> in the Start Menu</li>
            </ol>
            <p className="server-down-hint">Opened this from a Chrome or Edge app icon? That icon cannot start the app. Use the Free GST Billing icon instead; you can remove the other one (right-click it, then Uninstall).</p>
          </div>
          <p className="server-down-safe">All your invoices, clients, and data are safely stored on your computer. They are never deleted or shared.</p>
          <div className="server-down-waiting">
            <div className="server-down-spinner" />
            <span>Starting... this page will open automatically.</span>
          </div>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <>
        <WelcomeGuide onComplete={(p) => {
          if (p) setProfile(p);
          setShowWelcome(false);
        }} />
        <ToastContainer />
        <ConfirmModalContainer />
      </>
    );
  }

  const showResumeSetupPill = (() => {
    try {
      const ps = getPrintSettings();
      return !showWizard && ps.onboardingComplete === true && ps.onboardingSkipped === true;
    } catch { return false; }
  })();

  const activeCompanyName = decodeHtmlEntities(profile?.businessName || 'PRAGYAN ENTERPRISES');
  const activeCompanyGstin = profile?.gstin || '08AABCP1234R1Z5';

  return (
    <div className="erp-shell-wrapper">
      {/* 1. Top Enterprise Context Bar (48px height) */}
      <header className="erp-context-bar">
        {/* Left: Sidebar Collapse Toggle (Ctrl+B), Brand Logo, Full Company Selector Pill (F1), Global FY Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(c => !c)}
            title="Toggle Left Navigation Sidebar (Ctrl+B)"
            style={{
              background: '#1E293B',
              color: '#E2E8F0',
              border: '1px solid #334155',
              borderRadius: '5px',
              padding: '5px 8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
              fontSize: '11.5px',
              fontWeight: 600,
            }}
          >
            <Menu size={15} />
            <span style={{ fontFamily: 'var(--erp-font-mono)', fontSize: '10px', color: '#94A3B8' }}>Ctrl+B</span>
          </button>

          <div
            onClick={() => setCurrentView('dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', paddingRight: '4px' }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '13px',
              }}
            >
              {ownBrand && brand.logo ? (
                <img src={brand.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }} />
              ) : (
                'B'
              )}
            </div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontWeight: 700, fontSize: '12.5px', color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                GST Billing ERP
              </div>
              <div style={{ fontSize: '10px', color: '#94A3B8', whiteSpace: 'nowrap' }}>by DiceCodes</div>
            </div>
          </div>

          {/* Full Company Selector Pill (F1) */}
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowProfileMenu(v => !v)}
              title="Switch or Edit Company Profile (F1)"
              style={{
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '4px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                color: '#F8FAFC',
                cursor: 'pointer',
              }}
            >
              <Building2 size={14} color="#38BDF8" />
              <span style={{ fontWeight: 700, fontSize: '12.5px', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                {activeCompanyName}
              </span>
              <span
                style={{
                  background: '#0F172A',
                  color: '#38BDF8',
                  border: '1px solid #334155',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontFamily: 'var(--erp-font-mono)',
                  fontSize: '10.5px',
                  fontWeight: 600,
                }}
              >
                {activeCompanyGstin}
              </span>
              <span style={{ fontFamily: 'var(--erp-font-mono)', fontSize: '10px', color: '#94A3B8' }}>F1</span>
              <ChevronDown size={13} color="#94A3B8" />
            </button>
            {showProfileMenu && (
              <div className="profile-switcher-menu" style={{ top: '38px', left: 0, minWidth: '260px' }}>
                {allProfiles.map(bp => (
                  <button
                    key={bp.id || bp.businessName}
                    className={`profile-switcher-item${bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase() ? ' active' : ''}`}
                    onClick={() => handleSwitchProfile(bp)}
                  >
                    {decodeHtmlEntities(bp.businessName)} {bp.gstin ? `(${bp.gstin})` : ''}
                  </button>
                ))}
                <button
                  className="profile-switcher-item profile-switcher-manage"
                  onClick={() => { setShowProfileMenu(false); setCurrentView('settings'); }}
                >
                  ⚙️ Edit Company & GSTIN Settings...
                </button>
              </div>
            )}
          </div>

          {/* Global Financial Year Selector */}
          <select
            value={globalFy}
            onChange={(e) => setGlobalFy(e.target.value)}
            aria-label="Global Financial Year"
            title={`Financial Year ${globalFy} (01-Apr to 31-Mar)`}
            style={{
              background: '#1E293B',
              color: '#E2E8F0',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '4px 22px 4px 8px',
              fontSize: '11px',
              fontFamily: 'var(--erp-font-mono)',
              fontWeight: 600,
              cursor: 'pointer',
              height: '28px',
              width: 'auto',
              flexShrink: 0,
            }}
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
            <option value="2024-25">FY 2024-25</option>
          </select>
        </div>

        {/* Center: Global "Go To" Command Palette Trigger (Alt+G / Ctrl+K) */}
        <button
          type="button"
          onClick={() => {
            setShowPalette(true);
            setPaletteQuery('');
            setPaletteIdx(0);
          }}
          title="Global Go To Command Palette (Alt+G or Ctrl+K)"
          style={{
            background: '#1E293B',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '4px 10px',
            height: '28px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: '#CBD5E1',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
            <Search size={13} color="#38BDF8" />
            <span>Go To...</span>
          </span>
          <span
            style={{
              background: '#0F172A',
              color: '#38BDF8',
              border: '1px solid #334155',
              padding: '1px 5px',
              borderRadius: '4px',
              fontFamily: 'var(--erp-font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            Alt+G
          </span>
        </button>

        {/* Right: Live Option A / Option B Density Switcher, + Series, + Master (Alt+C) & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Live Design Direction Switcher (Option A vs Option B) */}
          <div
            style={{
              display: 'inline-flex',
              background: '#1E293B',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '2px',
            }}
            title="Live Design Direction Switcher: Option A (Modern ERP 34px) vs Option B (Compact Accounting Grid 26px)"
          >
            <button
              type="button"
              onClick={() => setDensityMode('optionA')}
              style={{
                background: densityMode === 'optionA' ? '#2563EB' : 'transparent',
                color: densityMode === 'optionA' ? '#FFFFFF' : '#94A3B8',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 7px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              A · Modern
            </button>
            <button
              type="button"
              onClick={() => setDensityMode('optionB')}
              style={{
                background: densityMode === 'optionB' ? '#2563EB' : 'transparent',
                color: densityMode === 'optionB' ? '#FFFFFF' : '#94A3B8',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 7px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              B · Compact
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowSeriesModal(true)}
            title="Configure Multiple Invoice & Voucher Series (CGST Rule 46)"
            style={{
              background: '#1E293B',
              color: '#E2E8F0',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '4px 9px',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Series
          </button>

          <button
            type="button"
            onClick={() => setShowQuickMasterModal(true)}
            title="Instant Party / Ledger / Spare-Part Master Creation (Alt+C)"
            style={{
              background: '#15803D',
              color: '#FFFFFF',
              border: '1px solid #16A34A',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>+ Master</span>
            <span style={{ fontFamily: 'var(--erp-font-mono)', fontSize: '10px', background: 'rgba(0,0,0,0.25)', padding: '1px 4px', borderRadius: '3px' }}>
              Alt+C
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {topActions}
          </div>
        </div>
      </header>

      {/* 2. Persistent Function-Key Voucher Bar (32px height, TallyPrime / BUSY Standard) */}
      <div className="erp-fkey-bar" role="toolbar" aria-label="Accounting Function Key Shortcuts">
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'vouchers' && accountingVoucherType === 'Contra' ? 'active' : ''}`}
          onClick={() => openAccountingAt('vouchers', 'Contra')}
        >
          <span className="erp-fkey-kbd">F4</span> Contra
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'vouchers' && accountingVoucherType === 'Payment' ? 'active' : ''}`}
          onClick={() => openAccountingAt('vouchers', 'Payment')}
        >
          <span className="erp-fkey-kbd">F5</span> Payment
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'vouchers' && accountingVoucherType === 'Receipt' ? 'active' : ''}`}
          onClick={() => openAccountingAt('vouchers', 'Receipt')}
        >
          <span className="erp-fkey-kbd">F6</span> Receipt
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'vouchers' && accountingVoucherType === 'Journal' ? 'active' : ''}`}
          onClick={() => openAccountingAt('vouchers', 'Journal')}
        >
          <span className="erp-fkey-kbd">F7</span> Journal
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'new' ? 'active' : ''}`}
          onClick={handleNewInvoice}
        >
          <span className="erp-fkey-kbd">F8</span> Sales Invoice
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'purchases' && purchaseSubTab !== 'ocr' ? 'active' : ''}`}
          onClick={() => openPurchasesAt('bills')}
        >
          <span className="erp-fkey-kbd">F9</span> Purchase Bill
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'pos' ? 'active' : ''}`}
          onClick={() => setCurrentView('pos')}
        >
          <span className="erp-fkey-kbd">Alt+P</span> POS Counter
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'purchases' && purchaseSubTab === 'ocr' ? 'active' : ''}`}
          onClick={() => openPurchasesAt('ocr')}
        >
          <span className="erp-fkey-kbd">Alt+U</span> AI/OCR Bill
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'ledgers' ? 'active' : ''}`}
          onClick={() => openAccountingAt('ledgers')}
        >
          <span className="erp-fkey-kbd">Alt+L</span> Ledgers &amp; BRS
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'inventory' ? 'active' : ''}`}
          onClick={() => setCurrentView('inventory')}
        >
          <span className="erp-fkey-kbd">Alt+I</span> Spare Parts
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'trial-balance' ? 'active' : ''}`}
          onClick={() => openAccountingAt('trial-balance')}
        >
          <span className="erp-fkey-kbd">Alt+T</span> Trial Bal
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'profit-loss' ? 'active' : ''}`}
          onClick={() => openAccountingAt('profit-loss')}
        >
          <span className="erp-fkey-kbd">Alt+F</span> P&amp;L A/c
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'accounting' && accountingSubTab === 'balance-sheet' ? 'active' : ''}`}
          onClick={() => openAccountingAt('balance-sheet')}
        >
          <span className="erp-fkey-kbd">Alt+B</span> Bal Sheet
        </button>
        <button
          type="button"
          className={`erp-fkey-btn ${currentView === 'filing' ? 'active' : ''}`}
          onClick={() => setCurrentView('filing')}
        >
          <span className="erp-fkey-kbd">Alt+S</span> GST Hub
        </button>
      </div>

      {/* Main Application Shell */}
      <div className={`app-container app-layout${sidebarAutoHide ? ' sidebar-autohide' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
        {showResumeSetupPill && (
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            title="Come back to the setup wizard — pick a business type, paper size, and language."
            style={{
              position: 'fixed', bottom: currentView === 'settings' ? '5.5rem' : '1.25rem', right: '1.25rem', zIndex: 9998,
              padding: '0.6rem 1rem', borderRadius: 999,
              background: 'var(--primary)', color: '#fff', border: 'none',
              fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(30,64,175,0.35), 0 2px 4px rgba(0,0,0,0.15)',
              display: 'flex', alignItems: 'center', gap: '0.4rem',
            }}
          >
            ✨ Finish setup
          </button>
        )}

        <div className="mobile-topbar">
          <button type="button" className="mobile-topbar-btn" onClick={() => setNavOpen(true)}
            aria-label="Open menu" aria-expanded={navOpen}>
            <Menu size={22} />
          </button>
          <span className="mobile-topbar-title">GST Billing</span>
          <span className="mobile-topbar-business">{activeCompanyName}</span>
          {topActions}
        </div>
        {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

        {/* 3. Consolidated 5-Pillar Left Sidebar Navigation */}
        <div className={`sidebar${navOpen ? ' sidebar-open' : ''}`} onClick={closeNavAfterPick}>
          <nav className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: '2px', height: '100%' }}>
            {/* Pillar 1: Overview */}
            <div className="sidebar-pillar-label">1. Overview</div>
            <button
              type="button"
              className={`nav-btn ${currentView === 'dashboard' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('dashboard')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Home size={15} /> Executive Dashboard
              </span>
              <span className="nav-btn-shortcut">Alt+D</span>
            </button>

            {/* Pillar 2: Transactions & Vouchers */}
            <div className="sidebar-pillar-label">2. Transactions &amp; Vouchers</div>
            <button
              type="button"
              className={`nav-btn ${currentView === 'new' ? 'nav-btn-active' : ''}`}
              onClick={handleNewInvoice}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={15} /> Sales &amp; POS Billing
              </span>
              <span className="nav-btn-shortcut">F8</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'pos' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('pos')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Laptop size={15} /> POS Counter Fast
              </span>
              <span className="nav-btn-shortcut">Alt+P</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'purchases' && purchaseSubTab !== 'ocr' ? 'nav-btn-active' : ''}`}
              onClick={() => openPurchasesAt('bills')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCart size={15} /> Purchase Bills &amp; PO
              </span>
              <span className="nav-btn-shortcut">F9</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'accounting' && accountingSubTab === 'vouchers' ? 'nav-btn-active' : ''}`}
              onClick={() => openAccountingAt('vouchers', 'Payment')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Receipt size={15} /> Pay / Rcpt / Jnl / Contra
              </span>
              <span className="nav-btn-shortcut">F4–F7</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'purchases' && purchaseSubTab === 'ocr' ? 'nav-btn-active' : ''}`}
              onClick={() => openPurchasesAt('ocr')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={15} /> AI/OCR Bill Capture
              </span>
              <span className="nav-btn-shortcut">Alt+U</span>
            </button>

            {/* Pillar 3: Masters & Inventory */}
            <div className="sidebar-pillar-label">3. Masters &amp; Inventory</div>
            <button
              type="button"
              className={`nav-btn ${currentView === 'accounting' && accountingSubTab === 'ledgers' ? 'nav-btn-active' : ''}`}
              onClick={() => openAccountingAt('ledgers')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Landmark size={15} /> Parties, Ledgers &amp; BRS
              </span>
              <span className="nav-btn-shortcut">Alt+L</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'inventory' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('inventory')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={15} /> Spare-Parts &amp; Stock
              </span>
              <span className="nav-btn-shortcut">Alt+I</span>
            </button>

            {/* Pillar 4: Financial & GST Reports */}
            <div className="sidebar-pillar-label">4. Financial &amp; GST Reports</div>
            <button
              type="button"
              className={`nav-btn ${currentView === 'accounting' && accountingSubTab === 'trial-balance' ? 'nav-btn-active' : ''}`}
              onClick={() => openAccountingAt('trial-balance')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart3 size={15} /> Trial Balance
              </span>
              <span className="nav-btn-shortcut">Alt+T</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'accounting' && accountingSubTab === 'profit-loss' ? 'nav-btn-active' : ''}`}
              onClick={() => openAccountingAt('profit-loss')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart3 size={15} /> Profit &amp; Loss A/c
              </span>
              <span className="nav-btn-shortcut">Alt+F</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'accounting' && accountingSubTab === 'balance-sheet' ? 'nav-btn-active' : ''}`}
              onClick={() => openAccountingAt('balance-sheet')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Landmark size={15} /> Balance Sheet
              </span>
              <span className="nav-btn-shortcut">Alt+B</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'filing' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('filing')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen size={15} /> GST Compliance Hub
              </span>
              <span className="nav-btn-shortcut">Alt+S</span>
            </button>

            {/* Pillar 5: Migration & Config */}
            <div className="sidebar-pillar-label">5. Migration &amp; Config</div>
            <button
              type="button"
              className="nav-btn"
              onClick={() => setShowBusyModal(true)}
              style={{
                background: '#EFF6FF',
                borderColor: '#BFDBFE',
                color: '#1D4ED8',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileSpreadsheet size={15} /> BUSY .DAT Migration
              </span>
              <span className="nav-btn-shortcut">Import</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${currentView === 'settings' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('settings')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={15} /> BUSY .DAT &amp; Settings
              </span>
              <span className="nav-btn-shortcut">F11</span>
            </button>

            {/* Expandable Classic Sub-Modules (Zero Feature Loss) */}
            <div style={{ marginTop: '6px', borderTop: '1px solid #1E293B', paddingTop: '6px' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMoreModules(m => !m);
                }}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span>Registers &amp; Utilities</span>
                <ChevronDown size={12} style={{ transform: showMoreModules ? 'rotate(180deg)' : 'none' }} />
              </button>

              {(showMoreModules || ['clients', 'expenses', 'receipts', 'cashbook', 'recurring', 'reports', 'incometax', 'controlpanel', 'support'].includes(currentView)) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                  <button type="button" className={`nav-btn ${currentView === 'clients' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('clients')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={14} /> Clients Register</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'expenses' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('expenses')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Wallet size={14} /> Expenses Register</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'receipts' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('receipts')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Receipt size={14} /> Receipts Register</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'cashbook' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('cashbook')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Banknote size={14} /> Cash Book</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'recurring' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('recurring')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={14} /> Recurring Bills</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'reports' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('reports')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><BarChart3 size={14} /> Analytics Reports</span>
                  </button>
                  <button type="button" className={`nav-btn ${currentView === 'incometax' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('incometax')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Calculator size={14} /> Income Tax &amp; 44AD</span>
                  </button>
                  {bottomIds.includes('controlpanel') && (
                    <button type="button" className={`nav-btn ${currentView === 'controlpanel' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('controlpanel')}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><HardDrive size={14} /> Control Panel</span>
                      <span className={`server-status-dot server-status-${serverStatus}`} />
                    </button>
                  )}
                  {bottomIds.includes('support') && (
                    <button type="button" className={`nav-btn ${currentView === 'support' ? 'nav-btn-active' : ''}`} onClick={() => setCurrentView('support')}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Heart size={14} /> Support &amp; About</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </nav>
        </div>

        <div className="main-content">
          <ErrorBoundary key={currentView} onHome={() => setCurrentView('dashboard')}>
            {currentView !== 'new' && <StarBanner />}
            {currentView === 'dashboard' && (
              <Dashboard
                onNew={handleNewInvoice}
                onEdit={handleEditInvoice}
                onPrint={handlePrintInvoice}
                onDuplicate={handleDuplicateInvoice}
                onConvert={handleConvertToInvoice}
                onOpenProducts={() => setCurrentView('inventory')}
                onOpenSettings={() => setCurrentView('settings')}
                onOpenGuide={openDocs}
                onOpenSupport={() => setCurrentView('support')}
                onOpenAccounting={(subTab, vType) => openAccountingAt(subTab, vType)}
                activeProfile={profile}
                globalFy={globalFy}
              />
            )}
            {currentView === 'new' && (
              <InvoiceGenerator
                key={editorKey}
                onBack={() => { setEditingBill(null); setCurrentViewRaw('dashboard'); }}
                onCreateNextInvoice={startFreshNewInvoice}
                onRegisterNavGuard={(fn) => { invoiceNavGuardRef.current = fn; }}
                profile={profile}
                editingBill={editingBill}
                onOpenSeriesModal={() => setShowSeriesModal(true)}
                onOpenQuickMaster={() => setShowQuickMasterModal(true)}
              />
            )}
            <Suspense fallback={<ViewLoading />}>
              {currentView === 'pos' && (
                <POSView key={businessKey} showToast={toast} onOpenFullInvoice={handleNewInvoice} />
              )}
              {currentView === 'clients' && (
                <ClientsView onNew={handleNewInvoice} onEdit={handleEditInvoice} onDuplicate={handleDuplicateInvoice} />
              )}
              {currentView === 'inventory' && (
                <InventoryView
                  key={businessKey}
                  showToast={toast}
                  onOpenBusyImport={() => setShowBusyModal(true)}
                  onAddPartToBill={() => handleNewInvoice()}
                />
              )}
              {currentView === 'accounting' && (
                <AccountingView
                  key={`${businessKey}_${accountingSubTab}_${accountingVoucherType}`}
                  showToast={toast}
                  initialTab={accountingSubTab}
                  initialVoucherType={accountingVoucherType}
                  onOpenQuickMaster={() => setShowQuickMasterModal(true)}
                />
              )}
              {currentView === 'expenses' && (
                <ExpenseTracker key={businessKey} />
              )}
              {currentView === 'purchases' && (
                <PurchaseBills
                  key={`${businessKey}_${purchaseSubTab}`}
                  initialTab={purchaseSubTab}
                  onOpenQuickMaster={() => setShowQuickMasterModal(true)}
                />
              )}
              {currentView === 'recurring' && (
                <RecurringInvoices key={businessKey} onEdit={handleEditInvoice} />
              )}
              {currentView === 'receipts' && (
                <ReceiptVoucher key={businessKey} />
              )}
              {currentView === 'cashbook' && (
                <CashBook key={businessKey} onOpenView={setCurrentView} />
              )}
              {currentView === 'reports' && (
                <ReportsView key={businessKey} />
              )}
              {currentView === 'filing' && (
                <GSTReturns key={businessKey} />
              )}
              {currentView === 'incometax' && (
                <IncomeTax key={businessKey} />
              )}
              {currentView === 'settings' && (
                <SettingsView onSaved={(p) => setProfile(p)} />
              )}
              {currentView === 'controlpanel' && (
                <ControlPanel />
              )}
              {currentView === 'support' && (
                <SupportView />
              )}
            </Suspense>
            {showBusyModal && (
              <Suspense fallback={<ViewLoading />}>
                <BusyImportModal
                  showToast={toast}
                  onClose={() => setShowBusyModal(false)}
                  onImportCompleted={() => {
                    setEditorKey(k => k + 1);
                  }}
                />
              </Suspense>
            )}
            {currentView === 'dashboard' && <AppFooter onOpenSupport={() => setCurrentView('support')} />}
          </ErrorBoundary>
        </div>
      </div>

      {/* Multiple Invoice Series Configuration Modal */}
      <InvoiceSeriesModal
        isOpen={showSeriesModal}
        onClose={() => setShowSeriesModal(false)}
      />

      {/* Instant Master Creation Modal (Alt+C) */}
      <QuickMasterModal
        isOpen={showQuickMasterModal}
        onClose={() => setShowQuickMasterModal(false)}
        onCreated={({ type }) => {
          toast(`Master (${type}) created and synced to ledgers.`, 'success', 4000);
          setEditorKey(k => k + 1);
        }}
      />

      {/* Notification Popover */}
      {showNotifs && (
        <div className="modal-overlay" onClick={() => setShowNotifs(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Notifications <HelpButton title="Notifications" doc="shortcuts#notifications" size={16} /></h3>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {dismissableCount > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={markAllNotifsRead}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                  >
                    Mark all as read
                  </button>
                )}
                <button className="icon-btn" onClick={() => setShowNotifs(false)} title="Close"><X size={18} /></button>
              </span>
            </div>
            {notifTotal === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0', margin: 0 }}>
                All clear ✨ — nothing needs your attention right now.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {isLive('autoFire') && (
                  <button type="button" className="notice notice-info" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">🔁</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.autoFire.count} recurring invoice{notifications.autoFire.count !== 1 ? 's' : ''} auto-generated today</strong>
                    </div>
                  </button>
                )}
                {isLive('overdue') && (
                  <button type="button" className="notice notice-danger" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">⚠</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.overdue.length} overdue invoice{notifications.overdue.length !== 1 ? 's' : ''}</strong>
                    </div>
                  </button>
                )}
                {isLive('dueSoon') && (
                  <button type="button" className="notice notice-warn" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">⏰</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.dueSoon.length} invoice{notifications.dueSoon.length !== 1 ? 's' : ''} due in next 3 days</strong>
                    </div>
                  </button>
                )}
                {isLive('filings') && (
                  <button type="button" className="notice notice-info" onClick={() => { setShowNotifs(false); setCurrentView('filing'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">📋</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.filings.length} GST filing{notifications.filings.length !== 1 ? 's' : ''} due in next 10 days</strong>
                    </div>
                  </button>
                )}
                {isLive('lowStock') && (
                  <button type="button" className="notice notice-note" onClick={() => { setShowNotifs(false); setCurrentView('inventory'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">📦</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.lowStock.length} product{notifications.lowStock.length !== 1 ? 's' : ''} low on stock</strong>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Go To Command Palette — Alt+G / Ctrl+K */}
      {showPalette && (
        <div className="modal-overlay" onClick={() => setShowPalette(false)}>
          <div className="modal-content" style={{ maxWidth: '580px', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', background: '#0F172A', color: '#FFFFFF' }}>
              <Search size={16} color="#38BDF8" />
              <input
                autoFocus
                type="text"
                placeholder="Go To Voucher (F4-F9), Ledger, Party GSTIN, OEM Part No, or Report…"
                value={paletteQuery}
                onChange={e => { setPaletteQuery(e.target.value); setPaletteIdx(0); }}
                style={{ border: 0, background: 'transparent', color: '#FFFFFF', flex: 1, fontSize: '13px', outline: 'none' }}
              />
              <span style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--erp-font-mono)' }}>ESC</span>
            </div>
            <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
              {filteredPalette.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.25rem', margin: 0, fontSize: '0.85rem' }}>
                  Nothing matches "{paletteQuery}".
                </p>
              )}
              {filteredPalette.map((a, i) => (
                <button
                  key={`${a.label}_${i}`}
                  type="button"
                  onClick={() => { a.run(); setShowPalette(false); }}
                  onMouseEnter={() => setPaletteIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 14px', border: 0, borderBottom: '1px solid #F1F5F9', cursor: 'pointer',
                    background: i === paletteIdx ? '#EFF6FF' : 'transparent',
                    color: i === paletteIdx ? '#1D4ED8' : '#0F172A', textAlign: 'left', fontSize: '12.5px', fontWeight: i === paletteIdx ? 600 : 500,
                  }}
                >
                  <span>{a.label}</span>
                  {a.hint && (
                    <span style={{ fontSize: '11px', fontFamily: 'var(--erp-font-mono)', color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '1px 6px', borderRadius: '4px' }}>
                      {a.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: '#64748B', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
              <span><Command size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Alt+G / Ctrl+K · ↑↓ navigate · Enter open</span>
              <button type="button" onClick={() => { setShowPalette(false); setShowShortcutsHelp(true); }} style={{ background: 'none', border: 0, color: '#1D4ED8', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                All Tally/BUSY Shortcuts (Ctrl+/)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standardized Keyboard Shortcuts Reference Modal */}
      {showShortcutsHelp && (
        <div className="modal-overlay" onClick={() => setShowShortcutsHelp(false)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Standardized TallyPrime / BUSY Keyboard Shortcuts</h3>
              <button className="icon-btn" onClick={() => setShowShortcutsHelp(false)} title="Close"><X size={18} /></button>
            </div>
            <table className="kv-list">
              <tbody>
                <tr><td><kbd>F1</kbd></td><td>Switch Company Profile / Help Reference</td></tr>
                <tr><td><kbd>F4</kbd></td><td>Contra Voucher (Cash ↔ Bank Transfer)</td></tr>
                <tr><td><kbd>F5</kbd></td><td>Payment Voucher (Supplier / Expense Payout)</td></tr>
                <tr><td><kbd>F6</kbd></td><td>Receipt Voucher (Customer / Income Inflow)</td></tr>
                <tr><td><kbd>F7</kbd></td><td>Journal Voucher (Double-Entry Adjustment)</td></tr>
                <tr><td><kbd>F8</kbd></td><td>Sales Tax Invoice (B2B / B2C / IGST)</td></tr>
                <tr><td><kbd>F9</kbd></td><td>Purchase Bill / Supplier Inward Voucher</td></tr>
                <tr><td><kbd>F11</kbd></td><td>Company Settings &amp; BUSY .DAT Migration</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>P</kbd></td><td>POS Counter Fast Billing Mode</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>U</kbd></td><td>AI/OCR Purchase Bill Capture Workbench</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>G</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Global "Go To" Command Palette</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>C</kbd></td><td>Instant Master Creation (Party / Ledger / Part)</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>L</kbd></td><td>Parties, General Ledgers &amp; Bank Reconciliation (BRS)</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>I</kbd></td><td>Automotive Spare-Parts &amp; Stock Catalog</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>T</kbd></td><td>Trial Balance Report</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>F</kbd></td><td>Trading &amp; Profit &amp; Loss Account</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>B</kbd></td><td>Balance Sheet (Schedule III)</td></tr>
                <tr><td><kbd>Alt</kbd>+<kbd>S</kbd></td><td>GST Compliance Hub (GSTR-1 / 2B / 3B / HSN)</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>A</kbd></td><td>Save / Post Active Voucher or Invoice</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>Collapse / Expand Left Sidebar</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showUpdateModal && updateInfo && (
        <div className="modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>
                  Update available — v{updateInfo.latest}
                </h3>
              </div>
              <button className="icon-btn" onClick={() => setShowUpdateModal(false)} title="Close"><X size={18} /></button>
            </div>
            <div className="flex gap-2 justify-end" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={dismissUpdate}>Skip this version</button>
              <button type="button" className="btn btn-primary" disabled={updating} onClick={handleUpdateNow}>
                <Download size={16} /> {updating ? 'Updating…' : 'Update Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmModalContainer />
    </div>
  );
}

export default App;
