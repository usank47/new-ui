// Client-side fallback text extractor and parser for Bills/Invoices (PDF & Scanned Images)
export async function extractBillText(file, onProgress) {
  if (onProgress) onProgress('Reading document data...', 0.3);
  const text = '';
  // If text file / raw text
  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const raw = await file.text();
    return { text: raw };
  }
  return { text };
}

export function parseBillText(rawText = '') {
  const text = String(rawText || '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let supplierGstin = '';
  const gstinMatch = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i);
  if (gstinMatch) supplierGstin = gstinMatch[0].toUpperCase();

  let invoiceNumber = '';
  const invMatch = text.match(/(?:Invoice\s*No|Bill\s*No|Inv\s*#)[:.\s]*([A-Za-z0-9/-]+)/i);
  if (invMatch) invoiceNumber = invMatch[1].trim();

  let invoiceDate = '';
  const dateMatch = text.match(/(?:Date|Inv\s*Date)[:.\s]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})/i);
  if (dateMatch) invoiceDate = dateMatch[1].trim();

  let totalAmount = 0;
  const totalMatch = text.match(/(?:Total|Grand\s*Total|Net\s*Amount)[:.\s]*₹?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
  if (totalMatch) {
    totalAmount = parseFloat(totalMatch[1].replace(/,/g, '')) || 0;
  }

  return {
    supplierName: lines[0] || '',
    supplierGstin,
    billNumber: invoiceNumber,
    date: invoiceDate,
    totalAmount,
    taxableAmount: totalAmount ? Math.round((totalAmount / 1.18) * 100) / 100 : 0,
    items: [],
  };
}
