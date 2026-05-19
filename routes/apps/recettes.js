const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { getDB, persistDB } = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router = express.Router();
const guard      = [requireAuth, checkApp('recettes')];
const guardAdmin = [requireAuth, checkApp('recettes'), requireCompanyAdmin];

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', ...guard, (req, res) => {
  try {
    const db = getDB();
    const tid = req.user.tenant_id;
    const settings = db.prepare('SELECT opening_balance FROM user_settings WHERE user_id=?').get(tid);
    const opening = settings?.opening_balance || 0;
    const totals = db.prepare('SELECT type, COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id=? GROUP BY type').all(tid);
    const income  = totals.find(t => t.type === 'income')?.total  || 0;
    const expense = totals.find(t => t.type === 'expense')?.total || 0;
    const month = new Date().toISOString().slice(0, 7);
    const mt = db.prepare('SELECT type, COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id=? AND date LIKE ? GROUP BY type').all(tid, `${month}%`);
    const mi = mt.find(t => t.type === 'income')?.total  || 0;
    const me = mt.find(t => t.type === 'expense')?.total || 0;
    const recent = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, created_at DESC LIMIT 10').all(tid);
    res.json({ opening_balance: opening, total_income: income, total_expense: expense, balance: opening + income - expense, month_income: mi, month_expense: me, month_balance: mi - me, recent });
  } catch (e) {
    console.error('[GET /recettes/stats]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ── LISTE DES TRANSACTIONS ────────────────────────────────────────────────────
router.get('/', ...guard, (req, res) => {
  try {
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
  } catch (e) {
    console.error('[GET /recettes/]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ── PARAMÈTRES — AVANT les routes /:id pour éviter le conflit de routage ──────
router.get('/settings', ...guard, (req, res) => {
  try {
    const db = getDB();
    res.json(db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(req.user.tenant_id) || { opening_balance: 0 });
  } catch (e) {
    console.error('[GET /recettes/settings]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

router.put('/settings', ...guardAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare('INSERT INTO user_settings (user_id, opening_balance) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET opening_balance=excluded.opening_balance')
      .run(req.user.tenant_id, req.body.opening_balance || 0);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /recettes/settings]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ── EXPORT PDF — AVANT les routes /:id ────────────────────────────────────────
router.get('/export-pdf', ...guard, (req, res) => {
  try {
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
    transactions.forEach(t => { if (t.type === 'income') ti += t.amount; else te += t.amount; });

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="livre-recettes-${from || 'debut'}-${to || 'fin'}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#5D288F').font('Helvetica-Bold').text('LIVRE DES RECETTES', { align: 'center' });
    doc.fontSize(12).fillColor('#333').font('Helvetica').text(user?.name || '', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#777').text(`Période : ${from || 'Début'} → ${to || 'Fin'}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' });
    doc.moveDown();
    doc.roundedRect(50, doc.y, 495, 30, 6).fill('#f5f0ff');
    doc.fontSize(10).fillColor('#5D288F').font('Helvetica-Bold').text(`Solde d'ouverture : ${opening.toFixed(2)} €`, 60, doc.y - 22);
    doc.moveDown(2);

    const tY = doc.y;
    doc.rect(50, tY, 495, 18).fill('#5D288F');
    doc.fontSize(8).fillColor('#fff').font('Helvetica-Bold');
    doc.text('Date', 55, tY + 5, { width: 65 });
    doc.text('Type', 120, tY + 5, { width: 50 });
    doc.text('Catégorie', 170, tY + 5, { width: 100 });
    doc.text('Description', 270, tY + 5, { width: 155 });
    doc.text('Montant', 425, tY + 5, { width: 115, align: 'right' });

    let y = tY + 22;
    doc.font('Helvetica').fontSize(8);
    transactions.forEach((t, i) => {
      if (y > 750) { doc.addPage(); y = 50; }
      if (i % 2 === 0) doc.rect(50, y - 2, 495, 16).fill('#fafafa');
      const color = t.type === 'income' ? '#008F68' : '#e53e3e';
      doc.fillColor('#333').text(t.date, 55, y, { width: 65 });
      doc.fillColor(color).text(t.type === 'income' ? 'Recette' : 'Dépense', 120, y, { width: 50 });
      doc.fillColor('#555').text(t.category || '-', 170, y, { width: 100 });
      doc.fillColor('#333').text(t.description || '', 270, y, { width: 155 });
      doc.fillColor(color).text(`${t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(2)} €`, 425, y, { width: 115, align: 'right' });
      y += 18;
    });
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#ddd').stroke(); y += 10;
    doc.fontSize(10).fillColor('#008F68').font('Helvetica-Bold').text(`Total recettes : +${ti.toFixed(2)} €`, 270, y); y += 18;
    doc.fillColor('#e53e3e').text(`Total dépenses : -${te.toFixed(2)} €`, 270, y); y += 18;
    doc.fillColor('#5D288F').text(`Solde final : ${(opening + ti - te).toFixed(2)} €`, 270, y);
    doc.end();
  } catch (e) {
    console.error('[GET /recettes/export-pdf]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Erreur export PDF' });
  }
});

// ── EXPORT EXCEL ──────────────────────────────────────────────────────────────
router.get('/export-excel', ...guard, async (req, res) => {
  try {
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
    transactions.forEach(t => { if (t.type === 'income') ti += t.amount; else te += t.amount; });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portail Métier';
    wb.created = new Date();
    const ws = wb.addWorksheet('Livre des Recettes');

    // Titre
    ws.mergeCells('A1:F1');
    const t1 = ws.getCell('A1');
    t1.value = 'LIVRE DES RECETTES';
    t1.font = { bold: true, size: 16, color: { argb: 'FF5D288F' } };
    t1.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:F2');
    const t2 = ws.getCell('A2');
    t2.value = user?.name || '';
    t2.font = { bold: true, size: 12 };
    t2.alignment = { horizontal: 'center' };

    ws.mergeCells('A3:F3');
    const t3 = ws.getCell('A3');
    t3.value = `Période : ${from || 'Début'} → ${to || 'Fin'}  •  Généré le ${new Date().toLocaleDateString('fr-FR')}`;
    t3.font = { size: 9, color: { argb: 'FF666666' } };
    t3.alignment = { horizontal: 'center' };

    ws.addRow([]);

    ws.mergeCells('A4:F4');
    const t4 = ws.getCell('A4');
    t4.value = `Solde d'ouverture : ${opening.toFixed(2)} €`;
    t4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0FF' } };
    t4.font = { bold: true, color: { argb: 'FF5D288F' } };
    t4.alignment = { horizontal: 'center' };

    ws.addRow([]);

    // En-têtes colonnes
    const hdr = ws.addRow(['Date', 'Type', 'Catégorie', 'Description', 'Mode de paiement', 'Montant (€)']);
    hdr.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5D288F' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF4A1E7A' } } };
    });
    hdr.height = 22;

    // Largeurs colonnes
    ws.getColumn(1).width = 13;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 20;
    ws.getColumn(4).width = 35;
    ws.getColumn(5).width = 20;
    ws.getColumn(6).width = 16;

    // Lignes de données
    transactions.forEach((t, i) => {
      const row = ws.addRow([
        t.date,
        t.type === 'income' ? 'Recette' : 'Dépense',
        t.category || '',
        t.description || '',
        t.payment_method || '',
        t.type === 'income' ? t.amount : -t.amount
      ]);
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F5FF' } };
        });
      }
      const amtCell = row.getCell(6);
      amtCell.numFmt = '#,##0.00';
      amtCell.font = { bold: true, color: { argb: t.type === 'income' ? 'FF008F68' : 'FFE53E3E' } };
    });

    // Totaux
    ws.addRow([]);
    const r1 = ws.addRow(['', '', '', '', 'Total recettes', ti]);
    r1.getCell(5).font = { bold: true };
    r1.getCell(6).font = { bold: true, color: { argb: 'FF008F68' } };
    r1.getCell(6).numFmt = '#,##0.00';

    const r2 = ws.addRow(['', '', '', '', 'Total dépenses', -te]);
    r2.getCell(5).font = { bold: true };
    r2.getCell(6).font = { bold: true, color: { argb: 'FFE53E3E' } };
    r2.getCell(6).numFmt = '#,##0.00';

    const r3 = ws.addRow(['', '', '', '', 'Solde final', opening + ti - te]);
    r3.getCell(5).font = { bold: true };
    r3.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0FF' } };
    r3.getCell(6).font = { bold: true, size: 12, color: { argb: 'FF5D288F' } };
    r3.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0FF' } };
    r3.getCell(6).numFmt = '#,##0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="livre-recettes-${from || 'debut'}-${to || 'fin'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[GET /recettes/export-excel]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Erreur export Excel' });
  }
});

// ── AJOUTER UNE TRANSACTION ───────────────────────────────────────────────────
router.post('/', ...guard, (req, res) => {
  try {
    const db = getDB();
    const { type, amount, category, description, payment_method, date } = req.body;
    if (!type || !amount || !date) return res.status(400).json({ error: 'Type, montant et date requis' });
    const r = db.prepare('INSERT INTO transactions (user_id, type, amount, category, description, payment_method, date) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.tenant_id, type, amount, category, description, payment_method, date);
    persistDB();
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    console.error('[POST /recettes/]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ── MODIFIER UNE TRANSACTION (:id APRÈS les routes nommées) ───────────────────
router.put('/:id', ...guardAdmin, (req, res) => {
  try {
    const db = getDB();
    const { type, amount, category, description, payment_method, date } = req.body;
    db.prepare('UPDATE transactions SET type=?,amount=?,category=?,description=?,payment_method=?,date=? WHERE id=? AND user_id=?')
      .run(type, amount, category, description, payment_method, date, req.params.id, req.user.tenant_id);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /recettes/:id]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ── SUPPRIMER UNE TRANSACTION ─────────────────────────────────────────────────
router.delete('/:id', ...guardAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /recettes/:id]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

module.exports = router;
