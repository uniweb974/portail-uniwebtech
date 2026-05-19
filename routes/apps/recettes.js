const express = require('express');
const PDFDocument = require('pdfkit');
const { getDB } = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router = express.Router();
const guard      = [requireAuth, checkApp('recettes')];
const guardAdmin = [requireAuth, checkApp('recettes'), requireCompanyAdmin];

router.get('/stats', ...guard, (req, res) => {
  const db = getDB();
  const tid = req.user.tenant_id;
  const settings = db.prepare('SELECT opening_balance FROM user_settings WHERE user_id=?').get(tid);
  const opening = settings?.opening_balance || 0;
  const totals = db.prepare('SELECT type, COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id=? GROUP BY type').all(tid);
  const income  = totals.find(t=>t.type==='income')?.total || 0;
  const expense = totals.find(t=>t.type==='expense')?.total || 0;
  const month = new Date().toISOString().slice(0,7);
  const mt = db.prepare('SELECT type, COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id=? AND date LIKE ? GROUP BY type').all(tid, `${month}%`);
  const mi = mt.find(t=>t.type==='income')?.total || 0;
  const me = mt.find(t=>t.type==='expense')?.total || 0;
  const recent = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, created_at DESC LIMIT 10').all(tid);
  res.json({ opening_balance: opening, total_income: income, total_expense: expense, balance: opening+income-expense, month_income: mi, month_expense: me, month_balance: mi-me, recent });
});

router.get('/', ...guard, (req, res) => {
  const db = getDB();
  const { type, from, to, search } = req.query;
  let sql = 'SELECT * FROM transactions WHERE user_id=?';
  const p = [req.user.tenant_id];
  if (type)   { sql += ' AND type=?'; p.push(type); }
  if (from)   { sql += ' AND date>=?'; p.push(from); }
  if (to)     { sql += ' AND date<=?'; p.push(to); }
  if (search) { sql += ' AND (description LIKE ? OR category LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY date DESC, created_at DESC';
  res.json(db.prepare(sql).all(...p));
});

// Ajouter une transaction (tous les rôles)
router.post('/', ...guard, (req, res) => {
  const db = getDB();
  const { type, amount, category, description, payment_method, date } = req.body;
  if (!type || !amount || !date) return res.status(400).json({ error: 'Type, montant et date requis' });
  const r = db.prepare('INSERT INTO transactions (user_id, type, amount, category, description, payment_method, date) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.tenant_id, type, amount, category, description, payment_method, date);
  res.json({ success: true, id: r.lastInsertRowid });
});

// Modifier/supprimer une transaction (admin uniquement)
router.put('/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { type, amount, category, description, payment_method, date } = req.body;
  db.prepare('UPDATE transactions SET type=?,amount=?,category=?,description=?,payment_method=?,date=? WHERE id=? AND user_id=?')
    .run(type, amount, category, description, payment_method, date, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// Paramètres (admin uniquement)
router.get('/settings', ...guard, (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(req.user.tenant_id) || { opening_balance: 0 });
});

router.put('/settings', ...guardAdmin, (req, res) => {
  const db = getDB();
  db.prepare('INSERT INTO user_settings (user_id, opening_balance) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET opening_balance=excluded.opening_balance')
    .run(req.user.tenant_id, req.body.opening_balance || 0);
  res.json({ success: true });
});

// Export PDF (tous les rôles)
router.get('/export-pdf', ...guard, (req, res) => {
  const db = getDB();
  const { from, to } = req.query;
  const tid = req.user.tenant_id;
  let sql = 'SELECT * FROM transactions WHERE user_id=?';
  const p = [tid];
  if (from) { sql += ' AND date>=?'; p.push(from); }
  if (to)   { sql += ' AND date<=?'; p.push(to); }
  sql += ' ORDER BY date ASC';
  const transactions = db.prepare(sql).all(...p);
  const settings = db.prepare('SELECT opening_balance FROM user_settings WHERE user_id=?').get(tid);
  const opening = settings?.opening_balance || 0;
  const user = db.prepare('SELECT name FROM users WHERE id=?').get(tid);
  let ti = 0, te = 0;
  transactions.forEach(t => { if (t.type==='income') ti+=t.amount; else te+=t.amount; });

  const doc = new PDFDocument({ size:'A4', margin:50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="livre-recettes-${from||'debut'}-${to||'fin'}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).fillColor('#5D288F').font('Helvetica-Bold').text('LIVRE DES RECETTES', { align:'center' });
  doc.fontSize(12).fillColor('#333').font('Helvetica').text(user?.name||'', { align:'center' });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#777').text(`Période : ${from||'Début'} → ${to||'Fin'}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`, { align:'center' });
  doc.moveDown();
  doc.roundedRect(50, doc.y, 495, 30, 6).fill('#f5f0ff');
  doc.fontSize(10).fillColor('#5D288F').font('Helvetica-Bold').text(`Solde d'ouverture : ${opening.toFixed(2)} €`, 60, doc.y-22);
  doc.moveDown(2);

  const tY = doc.y;
  doc.rect(50, tY, 495, 18).fill('#5D288F');
  doc.fontSize(8).fillColor('#fff').font('Helvetica-Bold');
  doc.text('Date', 55, tY+5, { width:65 });
  doc.text('Type', 120, tY+5, { width:50 });
  doc.text('Catégorie', 170, tY+5, { width:100 });
  doc.text('Description', 270, tY+5, { width:155 });
  doc.text('Montant', 425, tY+5, { width:115, align:'right' });

  let y = tY + 22;
  doc.font('Helvetica').fontSize(8);
  transactions.forEach((t, i) => {
    if (y > 750) { doc.addPage(); y = 50; }
    if (i%2===0) doc.rect(50, y-2, 495, 16).fill('#fafafa');
    const color = t.type==='income' ? '#008F68' : '#e53e3e';
    doc.fillColor('#333').text(t.date, 55, y, { width:65 });
    doc.fillColor(color).text(t.type==='income'?'Recette':'Dépense', 120, y, { width:50 });
    doc.fillColor('#555').text(t.category||'-', 170, y, { width:100 });
    doc.fillColor('#333').text(t.description||'', 270, y, { width:155 });
    doc.fillColor(color).text(`${t.type==='expense'?'-':'+'}${t.amount.toFixed(2)} €`, 425, y, { width:115, align:'right' });
    y += 18;
  });
  y += 10;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#ddd').stroke(); y += 10;
  doc.fontSize(10).fillColor('#008F68').font('Helvetica-Bold').text(`Total recettes : +${ti.toFixed(2)} €`, 270, y); y += 18;
  doc.fillColor('#e53e3e').text(`Total dépenses : -${te.toFixed(2)} €`, 270, y); y += 18;
  doc.fillColor('#5D288F').text(`Solde final : ${(opening+ti-te).toFixed(2)} €`, 270, y);
  doc.end();
});

module.exports = router;
