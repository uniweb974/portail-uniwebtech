const express = require('express');
const PDFDocument = require('pdfkit');
const { getDB } = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router = express.Router();
const guard      = [requireAuth, checkApp('facturation')];
const guardAdmin = [requireAuth, checkApp('facturation'), requireCompanyAdmin];

// ─── PARAMÈTRES ENTREPRISE (admin uniquement) ─────────────────────────────────

router.get('/parametres', ...guard, (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM entreprise WHERE user_id=?').get(req.user.tenant_id) || {});
});

router.put('/parametres', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { nom, adresse, code_postal, ville, telephone, email, siret, tva_number, rib, conditions_paiement } = req.body;
  db.prepare(`
    INSERT INTO entreprise (user_id, nom, adresse, code_postal, ville, telephone, email, siret, tva_number, rib, conditions_paiement)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      nom=excluded.nom, adresse=excluded.adresse, code_postal=excluded.code_postal,
      ville=excluded.ville, telephone=excluded.telephone, email=excluded.email,
      siret=excluded.siret, tva_number=excluded.tva_number, rib=excluded.rib,
      conditions_paiement=excluded.conditions_paiement
  `).run(req.user.tenant_id, nom, adresse, code_postal, ville, telephone, email, siret, tva_number, rib, conditions_paiement);
  res.json({ success: true });
});

// ─── CLIENTS (admin : CRUD / user : lecture seule) ────────────────────────────

router.get('/clients', ...guard, (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM fact_clients WHERE user_id=? ORDER BY nom').all(req.user.tenant_id));
});

router.post('/clients', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { nom, prenom, entreprise, adresse, code_postal, ville, email, telephone } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const r = db.prepare(`
    INSERT INTO fact_clients (user_id, nom, prenom, entreprise, adresse, code_postal, ville, email, telephone)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(req.user.tenant_id, nom, prenom, entreprise, adresse, code_postal, ville, email, telephone);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/clients/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { nom, prenom, entreprise, adresse, code_postal, ville, email, telephone } = req.body;
  db.prepare(`UPDATE fact_clients SET nom=?,prenom=?,entreprise=?,adresse=?,code_postal=?,ville=?,email=?,telephone=?
    WHERE id=? AND user_id=?`).run(nom, prenom, entreprise, adresse, code_postal, ville, email, telephone, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/clients/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  const has = db.prepare('SELECT id FROM devis WHERE client_id=? AND user_id=?').get(req.params.id, req.user.tenant_id);
  if (has) return res.status(409).json({ error: 'Ce client a des devis associés' });
  db.prepare('DELETE FROM fact_clients WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── DEVIS (création : tous / modif-suppression : admin) ─────────────────────

router.get('/devis', ...guard, (req, res) => {
  const db = getDB();
  res.json(db.prepare(`
    SELECT d.*, c.nom as client_nom, c.prenom as client_prenom, c.entreprise as client_entreprise
    FROM devis d LEFT JOIN fact_clients c ON c.id=d.client_id
    WHERE d.user_id=? ORDER BY d.created_at DESC
  `).all(req.user.tenant_id));
});

router.get('/devis/:id', ...guard, (req, res) => {
  const db = getDB();
  const devis = db.prepare(`
    SELECT d.*, c.nom as client_nom, c.prenom as client_prenom, c.entreprise as client_entreprise,
           c.adresse as client_adresse, c.email as client_email
    FROM devis d LEFT JOIN fact_clients c ON c.id=d.client_id
    WHERE d.id=? AND d.user_id=?
  `).get(req.params.id, req.user.tenant_id);
  if (!devis) return res.status(404).json({ error: 'Devis introuvable' });
  const lignes = db.prepare('SELECT * FROM lignes_devis WHERE devis_id=?').all(req.params.id);
  res.json({ ...devis, lignes });
});

router.post('/devis', ...guard, (req, res) => {
  const db = getDB();
  const { client_id, date_creation, notes, lignes = [] } = req.body;

  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT numero FROM devis WHERE user_id=? AND numero LIKE 'DEV-${year}-%' ORDER BY id DESC LIMIT 1`).get(req.user.tenant_id);
  const seq = last ? parseInt(last.numero.split('-')[2]) + 1 : 1;
  const numero = `DEV-${year}-${String(seq).padStart(4,'0')}`;

  let total_ht = 0, total_tva = 0, total_ttc = 0;
  lignes.forEach(l => {
    const ht = (l.quantite||1) * (l.prix_unitaire_ht||0);
    const tva = ht * ((l.tva_taux||20)/100);
    total_ht += ht; total_tva += tva; total_ttc += ht + tva;
  });

  const r = db.prepare(`
    INSERT INTO devis (user_id, client_id, numero, date_creation, notes, total_ht, total_tva, total_ttc)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.user.tenant_id, client_id||null, numero, date_creation||new Date().toISOString().split('T')[0], notes, total_ht, total_tva, total_ttc);

  const devisId = r.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO lignes_devis (devis_id, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc)
    VALUES (?,?,?,?,?,?,?,?)`);
  lignes.forEach(l => {
    const ht = (l.quantite||1)*(l.prix_unitaire_ht||0);
    const tva = ht*((l.tva_taux||20)/100);
    ins.run(devisId, l.description, l.quantite||1, l.prix_unitaire_ht||0, l.tva_taux||20, ht, tva, ht+tva);
  });
  res.json({ success: true, id: devisId, numero });
});

router.put('/devis/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { client_id, date_creation, statut, notes, lignes } = req.body;
  if (lignes !== undefined) {
    db.prepare('DELETE FROM lignes_devis WHERE devis_id=?').run(req.params.id);
    let ht = 0, tva = 0, ttc = 0;
    const ins = db.prepare(`INSERT INTO lignes_devis (devis_id, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc)
      VALUES (?,?,?,?,?,?,?,?)`);
    lignes.forEach(l => {
      const lht = (l.quantite||1)*(l.prix_unitaire_ht||0);
      const ltva = lht*((l.tva_taux||20)/100);
      ht += lht; tva += ltva; ttc += lht+ltva;
      ins.run(req.params.id, l.description, l.quantite||1, l.prix_unitaire_ht||0, l.tva_taux||20, lht, ltva, lht+ltva);
    });
    db.prepare('UPDATE devis SET client_id=?,date_creation=?,statut=?,notes=?,total_ht=?,total_tva=?,total_ttc=? WHERE id=? AND user_id=?')
      .run(client_id||null, date_creation, statut, notes, ht, tva, ttc, req.params.id, req.user.tenant_id);
  } else {
    db.prepare('UPDATE devis SET client_id=?,date_creation=?,statut=?,notes=? WHERE id=? AND user_id=?')
      .run(client_id||null, date_creation, statut, notes, req.params.id, req.user.tenant_id);
  }
  res.json({ success: true });
});

router.delete('/devis/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM devis WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', ...guard, (req, res) => {
  const db = getDB();
  const counts = db.prepare('SELECT statut, COUNT(*) as n, SUM(total_ttc) as total FROM devis WHERE user_id=? GROUP BY statut').all(req.user.tenant_id);
  const recent = db.prepare(`
    SELECT d.id, d.numero, d.statut, d.total_ttc, d.date_creation, c.nom as client_nom
    FROM devis d LEFT JOIN fact_clients c ON c.id=d.client_id
    WHERE d.user_id=? ORDER BY d.created_at DESC LIMIT 5
  `).all(req.user.tenant_id);
  res.json({ counts, recent });
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

router.get('/devis/:id/pdf', ...guard, (req, res) => {
  const db = getDB();
  const devis = db.prepare(`
    SELECT d.*, c.nom as client_nom, c.prenom as client_prenom,
           c.entreprise as client_entreprise, c.adresse as client_adresse,
           c.code_postal as client_cp, c.ville as client_ville, c.email as client_email
    FROM devis d LEFT JOIN fact_clients c ON c.id=d.client_id
    WHERE d.id=? AND d.user_id=?
  `).get(req.params.id, req.user.tenant_id);
  if (!devis) return res.status(404).json({ error: 'Devis introuvable' });

  const lignes = db.prepare('SELECT * FROM lignes_devis WHERE devis_id=?').all(req.params.id);
  const ent = db.prepare('SELECT * FROM entreprise WHERE user_id=?').get(req.user.tenant_id);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="devis-${devis.numero}.pdf"`);
  doc.pipe(res);

  doc.fontSize(22).fillColor('#5D288F').font('Helvetica-Bold').text(ent?.nom || 'Mon Entreprise', 50, 50);
  doc.fontSize(9).fillColor('#555').font('Helvetica');
  if (ent?.adresse) doc.text(`${ent.adresse}, ${ent.code_postal||''} ${ent.ville||''}`);
  if (ent?.telephone) doc.text(`Tél : ${ent.telephone}`);
  if (ent?.siret) doc.text(`SIRET : ${ent.siret}`);

  doc.fontSize(28).fillColor('#1a0a2e').font('Helvetica-Bold').text('DEVIS', 350, 50, { width:195, align:'right' });
  doc.fontSize(10).fillColor('#333').font('Helvetica');
  doc.text(`N° ${devis.numero}`, 350, 85, { width:195, align:'right' });
  doc.text(`Date : ${devis.date_creation}`, { width:195, align:'right' });

  doc.roundedRect(50, 155, 220, 80, 6).fillAndStroke('#f5f0ff', '#5D288F');
  doc.fontSize(9).fillColor('#5D288F').font('Helvetica-Bold').text('CLIENT', 60, 163);
  doc.font('Helvetica').fillColor('#222');
  if (devis.client_nom) {
    doc.text(`${devis.client_prenom||''} ${devis.client_nom}`.trim(), 60, 175);
    if (devis.client_entreprise) doc.text(devis.client_entreprise);
    if (devis.client_adresse) doc.text(devis.client_adresse);
    if (devis.client_email) doc.text(devis.client_email);
  } else { doc.text('Client non spécifié'); }

  const tY = 255;
  doc.rect(50, tY, 495, 20).fill('#5D288F');
  doc.fontSize(9).fillColor('#fff').font('Helvetica-Bold');
  doc.text('Description', 58, tY+6, { width:220 });
  doc.text('Qté',   285, tY+6, { width:40, align:'right' });
  doc.text('PU HT', 330, tY+6, { width:60, align:'right' });
  doc.text('TVA',   395, tY+6, { width:40, align:'right' });
  doc.text('Total TTC', 440, tY+6, { width:100, align:'right' });

  let y = tY + 22;
  doc.font('Helvetica').fontSize(9);
  lignes.forEach((l, i) => {
    if (i%2===0) doc.rect(50, y-2, 495, 18).fill('#f9f5ff');
    doc.fillColor('#222').text(l.description, 58, y, { width:220 });
    doc.text(String(l.quantite), 285, y, { width:40, align:'right' });
    doc.text(`${l.prix_unitaire_ht.toFixed(2)} €`, 330, y, { width:60, align:'right' });
    doc.text(`${l.tva_taux}%`, 395, y, { width:40, align:'right' });
    doc.text(`${l.total_ttc.toFixed(2)} €`, 440, y, { width:100, align:'right' });
    y += 20;
  });

  y += 10;
  doc.moveTo(350, y).lineTo(545, y).strokeColor('#ddd').stroke(); y += 10;
  doc.fontSize(10).fillColor('#333').font('Helvetica');
  doc.text('Total HT :', 370, y); doc.text(`${devis.total_ht.toFixed(2)} €`, 460, y, { width:80, align:'right' }); y += 18;
  doc.text('TVA :', 370, y); doc.text(`${devis.total_tva.toFixed(2)} €`, 460, y, { width:80, align:'right' }); y += 18;
  doc.rect(350, y-4, 200, 26).fill('#5D288F');
  doc.fontSize(12).fillColor('#fff').font('Helvetica-Bold');
  doc.text('TOTAL TTC :', 358, y+2); doc.text(`${devis.total_ttc.toFixed(2)} €`, 460, y+2, { width:80, align:'right' });
  if (devis.notes) doc.fontSize(9).fillColor('#555').font('Helvetica').text(`Notes : ${devis.notes}`, 50, y+50);
  if (ent?.conditions_paiement) doc.text(`Conditions de paiement : ${ent.conditions_paiement}`, 50, y+68);
  doc.end();
});

module.exports = router;
