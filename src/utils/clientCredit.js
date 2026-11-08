/*
 * v1.10.24 — Client credit balance from overpayments.
 *
 * Reported: "this extra payment can be added to the next bill of
 * customer, u enabled that — auto or manual."
 *
 * Design.
 * When a client pays more than the invoice total on Bill A, the excess
 * sits as an overpayment on Bill A. When Bill B is later created for
 * the same client, we let the user "apply" that credit — accounting is
 * a dual-entry transfer:
 *
 *   Bill A gets an extra payment entry `{amount: -X, mode:
 *     'credit-transferred-out', creditTargetBillId: <new bill id>}` so
 *     Bill A's outstanding stops showing overpaid.
 *   Bill B gets `{amount: +X, mode: 'credit-applied', creditSourceBillIds:
 *     [source ids]}` so Bill B's outstanding drops by X and the
 *     application is auditable.
 *
 * The two entries net to zero (no new cash), so total-paid-vs-invoiced
 * for the client is unchanged.
 */

import { amountDue, paymentStatusFor, isCancelledBill, SALES_INVOICE_TYPES, localToday } from '../utils.js';

// What the client owes on a bill: the total less TDS they deduct. Nothing on
// a cancelled invoice, or on a quotation / proforma / challan (not a sale), so
// money received against one - an advance, or a payment before the invoice was
// cancelled - is the client's credit instead of disappearing.
const owedOn = (bill) => {
  if (isCancelledBill(bill)) return 0;
  const type = bill.invoiceType || 'tax-invoice';
  if (type !== 'credit-note' && !SALES_INVOICE_TYPES.includes(type)) return 0;
  return amountDue(bill);
};

// Overpayment on a single bill: paid - owed, ignoring the client-credit
// paper trail so we don't double-count our own transfer entries.
export function getBillOverpayment(bill) {
  if (!bill) return 0;
  const total = owedOn(bill);
  const cashPaid = (bill.payments || []).reduce((s, p) => {
    // 'credit-transferred-out' entries reduce the raw paidAmount to show
    // that the excess has been moved off this bill. Skip 'credit-applied'
    // entries — those are inbound-from-another-bill and don't affect our
    // overpayment tally.
    if (p.mode === 'credit-applied') return s;
    return s + (Number(p.amount) || 0);
  }, 0);
  return cashPaid - total; // positive → overpaid, negative → underpaid
}

function billMatchesClient(bill, clientNameOrObj, clientIdOpt = null) {
  if (!bill) return false;
  const targetId = (typeof clientNameOrObj === 'object' && clientNameOrObj !== null)
    ? (clientNameOrObj.id || clientNameOrObj.clientId || clientIdOpt)
    : clientIdOpt;
  const targetName = (typeof clientNameOrObj === 'object' && clientNameOrObj !== null)
    ? String(clientNameOrObj.name || clientNameOrObj.clientName || '').trim().toLowerCase()
    : String(clientNameOrObj || '').trim().toLowerCase();
  const billClientId = bill.clientId || bill.data?.client?.id || bill.data?.clientId || null;
  if (targetId && billClientId) {
    return String(targetId) === String(billClientId);
  }
  if (!targetName) return false;
  return (bill.clientName || bill.data?.client?.name || '').trim().toLowerCase() === targetName;
}

/*
 * Available credit for a client = sum of overpayments across all bills.
 * Returns { available, sources } where sources is a FIFO-sortable list
 * used by the apply flow to know which bill(s) to debit.
 */
export function getClientCredit(arg1, arg2, clientId = null) {
  const isBillsFirst = Array.isArray(arg1);
  const allBills = isBillsFirst ? arg1 : arg2;
  const clientName = isBillsFirst ? arg2 : arg1;
  const hasName = typeof clientName === 'object' && clientName !== null
    ? Boolean((clientName.name || clientName.clientName || '').trim() || clientName.id || clientName.clientId)
    : Boolean(String(clientName || '').trim() || clientId);
  if (!hasName) return { available: 0, sources: [] };
  const bills = (allBills || []).filter(b => billMatchesClient(b, clientName, clientId));
  const sources = [];
  let available = 0;
  for (const b of bills) {
    const over = getBillOverpayment(b);
    if (over > 0.005) {
      sources.push({ billId: b.id, invoiceNumber: b.invoiceNumber, overpaid: over, invoiceDate: b.invoiceDate });
      available += over;
    }
  }
  // Oldest first — natural FIFO allocation on apply.
  sources.sort((a, b) => new Date(a.invoiceDate || 0) - new Date(b.invoiceDate || 0));
  return { available, sources };
}

/*
 * Given a client's credit sources + an amount to apply, produce the
 * dual-entry patches:
 *
 *   returnValue.sourcePatches = [{ billId, updatedBill }]
 *   returnValue.targetEntry   = payment entry to add to the new bill
 *
 * FIFO across sources. If `amountToApply` exceeds available credit, we
 * apply only what's available (caller should cap; we clamp defensively).
 */
export function planCreditApplication(arg1, arg2, amountToApply, newBillOrId, clientId = null) {
  const isBillsFirst = Array.isArray(arg1);
  const allBills = isBillsFirst ? arg1 : arg2;
  const clientName = isBillsFirst ? arg2 : arg1;
  const newBillId = (typeof newBillOrId === 'object' && newBillOrId !== null)
    ? (newBillOrId.id || newBillOrId.invoiceNumber)
    : newBillOrId;

  const { available, sources } = getClientCredit(clientName, allBills, clientId);
  const amount = Math.max(0, Math.min(Number(amountToApply) || 0, available));
  if (amount <= 0.005) return isBillsFirst ? { appliedAmount: 0, amountApplied: 0, sourcePatches: [], sourceUpdates: [] } : null;

  let remaining = amount;
  const sourcePatches = [];
  const consumedFrom = [];
  for (const src of sources) {
    if (remaining <= 0.005) break;
    const take = Math.min(remaining, src.overpaid);
    const srcBill = allBills.find(b => b.id === src.billId);
    if (!srcBill) continue;
    // Idempotency guard: if this source bill already transferred credit to newBillId, skip
    if (newBillId && (srcBill.payments || []).some(p => p?.mode === 'credit-transferred-out' && p?.creditTargetBillId === newBillId)) {
      continue;
    }
    const newPayments = [
      ...(srcBill.payments || []),
      {
        id: 'credit_out_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        amount: -take,
        date: localToday(),
        mode: 'credit-transferred-out',
        note: `Transferred to ${newBillId}`,
        recordedAt: new Date().toISOString(),
        creditTargetBillId: newBillId,
      },
    ];
    const newTotalPaid = newPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // A source keeps its status when it is cancelled or not a sale.
    const newStatus = isCancelledBill(srcBill) ? 'cancelled'
      : (owedOn(srcBill) > 0 ? paymentStatusFor(srcBill, newTotalPaid) : (srcBill.status || 'unpaid'));
    sourcePatches.push({
      billId: src.billId,
      updatedBill: { ...srcBill, payments: newPayments, paidAmount: newTotalPaid, status: newStatus },
    });
    consumedFrom.push({ billId: src.billId, invoiceNumber: src.invoiceNumber, amount: take });
    remaining -= take;
  }

  const actualApplied = consumedFrom.reduce((s, c) => s + c.amount, 0);
  if (actualApplied <= 0.005) return isBillsFirst ? { appliedAmount: 0, amountApplied: 0, sourcePatches: [], sourceUpdates: [] } : null;

  const targetEntry = {
    id: 'credit_in_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    amount: actualApplied,
    date: localToday(),
    mode: 'credit-applied',
    note: `Applied from prior overpayment${consumedFrom.length > 1 ? 's' : ''} (${consumedFrom.map(c => c.invoiceNumber).join(', ')})`,
    recordedAt: new Date().toISOString(),
    creditSourceBillIds: consumedFrom.map(c => c.billId),
  };

  return {
    amountApplied: actualApplied,
    appliedAmount: actualApplied,
    sourcePatches,
    sourceUpdates: sourcePatches.map(p => p.updatedBill),
    targetEntry,
    consumedFrom,
  };
}
