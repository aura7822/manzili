import PDFDocument from 'pdfkit';

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderReceipt(res, r) {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.receipt_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('Rent Payment Receipt', { align: 'center' }).moveDown(0.3);
  doc.fontSize(10).fillColor('#555').text(r.property_name, { align: 'center' }).moveDown(1.2);
  doc.fillColor('#000').fontSize(11);

  const rows = [
    ['Receipt no.', r.receipt_number],
    ['Date paid', r.paid_at_label],
    ['Tenant', r.tenant_name],
    ['Unit', r.unit_number],
    ['Period', r.period_label],
    ['Method', String(r.method).replace('_', ' ')],
    ['Reference', r.provider_reference || '-'],
    ['Amount paid', kes(r.amount)],
    ['Invoice balance', kes(r.balance)],
  ];
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(String(value)).moveDown(0.2);
  }
  doc.moveDown(1).fontSize(9).fillColor('#777').text('Thank you for your payment. This receipt was generated electronically.', { align: 'center' });
  doc.end();
}
