/* ── FLOTTEPÉI — Gestion de flotte professionnelle (Réunion 974) ─────────── */

const express    = require('express');
const PDFDocument = require('pdfkit');
const { getDB }  = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router     = express.Router();
const APP        = 'flottepei';
const guard      = [requireAuth, checkApp(APP)];
const guardAdmin = [requireAuth, checkApp(APP), requireCompanyAdmin];

const PLAN_LIMITS = { basic: 3, pro: 10, enterprise: Infinity };

// Tables fp_* créées au démarrage dans db/database.js — rien à faire ici.

// ─── STATS DASHBOARD ─────────────────────────────────────────────────────────

router.get('/stats', ...guard, (req, res) => {
  const db  = getDB();
  const uid = req.user.tenant_id;
  const today      = new Date().toISOString().split('T')[0];
  const in30       = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
  const monthStart = today.substring(0, 7) + '-01';

  const vehicules = db.prepare('SELECT * FROM fp_vehicules WHERE user_id=?').all(uid);
  const statuts   = { disponible: 0, en_mission: 0, maintenance: 0 };
  const alertes   = [];

  vehicules.forEach(v => {
    if (statuts[v.statut] !== undefined) statuts[v.statut]++;
    const nom = `${v.immatriculation} ${v.marque} ${v.modele}`;
    if (v.date_ct        && v.date_ct        <= in30) alertes.push({ vehicule: nom, type: 'Contrôle technique', date: v.date_ct,        critique: v.date_ct        < today });
    if (v.date_revision  && v.date_revision  <= in30) alertes.push({ vehicule: nom, type: 'Révision',           date: v.date_revision,  critique: v.date_revision  < today });
    if (v.date_assurance && v.date_assurance <= in30) alertes.push({ vehicule: nom, type: 'Assurance',          date: v.date_assurance, critique: v.date_assurance < today });
  });

  const { km_mois }   = db.prepare("SELECT COALESCE(SUM(km_parcourus),0) as km_mois  FROM fp_trajets   WHERE user_id=? AND date>=?").get(uid, monthStart);
  const { cout_mois } = db.prepare("SELECT COALESCE(SUM(montant),0)     as cout_mois FROM fp_carburant WHERE user_id=? AND date>=?").get(uid, monthStart);

  const recent = db.prepare(`
    SELECT t.*, v.immatriculation, v.marque, v.modele,
           c.prenom || ' ' || c.nom AS chauffeur_nom
    FROM fp_trajets t
    JOIN fp_vehicules v ON v.id = t.vehicule_id
    LEFT JOIN fp_chauffeurs c ON c.id = t.chauffeur_id
    WHERE t.user_id=?
    ORDER BY t.date DESC, t.id DESC LIMIT 8
  `).all(uid);

  const user      = db.prepare('SELECT plan FROM users WHERE id=?').get(req.user.id);
  const plan      = user?.plan || 'basic';
  const planLimit = PLAN_LIMITS[plan] ?? 3;

  res.json({ total_vehicules: vehicules.length, statuts, alertes, km_mois, cout_mois, recent, plan, planLimit });
});

// ─── VÉHICULES ────────────────────────────────────────────────────────────────

router.get('/vehicules', ...guard, (req, res) => {
  res.json(getDB().prepare('SELECT * FROM fp_vehicules WHERE user_id=? ORDER BY marque, modele').all(req.user.tenant_id));
});

router.post('/vehicules', ...guardAdmin, (req, res) => {
  const db    = getDB();
  const uid   = req.user.tenant_id;
  const user  = db.prepare('SELECT plan FROM users WHERE id=?').get(req.user.id);
  const limit = PLAN_LIMITS[user?.plan || 'basic'] ?? 3;
  const count = db.prepare('SELECT COUNT(*) AS n FROM fp_vehicules WHERE user_id=?').get(uid).n;

  if (count >= limit) {
    const labels = { basic: 'Starter (3 véh.)', pro: 'Pro (10 véh.)', enterprise: 'Business' };
    return res.status(403).json({ error: `Limite du plan ${labels[user?.plan||'basic']} atteinte. Passez au plan supérieur.` });
  }

  const { immatriculation, marque, modele, annee, km_actuel, statut, date_ct, date_revision, date_assurance, notes } = req.body;
  if (!immatriculation || !marque || !modele) return res.status(400).json({ error: 'Immatriculation, marque et modèle requis' });

  const r = db.prepare(`
    INSERT INTO fp_vehicules (user_id, immatriculation, marque, modele, annee, km_actuel, statut, date_ct, date_revision, date_assurance, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(uid, immatriculation.toUpperCase().trim(), marque, modele, annee||null, km_actuel||0,
         statut||'disponible', date_ct||null, date_revision||null, date_assurance||null, notes||null);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/vehicules/:id', ...guardAdmin, (req, res) => {
  const { immatriculation, marque, modele, annee, km_actuel, statut, date_ct, date_revision, date_assurance, notes } = req.body;
  getDB().prepare(`
    UPDATE fp_vehicules
    SET immatriculation=?, marque=?, modele=?, annee=?, km_actuel=?, statut=?,
        date_ct=?, date_revision=?, date_assurance=?, notes=?
    WHERE id=? AND user_id=?
  `).run(immatriculation?.toUpperCase().trim(), marque, modele, annee||null, km_actuel||0,
         statut||'disponible', date_ct||null, date_revision||null, date_assurance||null, notes||null,
         req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/vehicules/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM fp_vehicules WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── CHAUFFEURS ───────────────────────────────────────────────────────────────

router.get('/chauffeurs', ...guard, (req, res) => {
  res.json(getDB().prepare('SELECT * FROM fp_chauffeurs WHERE user_id=? ORDER BY nom, prenom').all(req.user.tenant_id));
});

router.post('/chauffeurs', ...guardAdmin, (req, res) => {
  const { nom, prenom, numero_permis, validite_permis } = req.body;
  if (!nom || !prenom) return res.status(400).json({ error: 'Nom et prénom requis' });
  const r = getDB().prepare('INSERT INTO fp_chauffeurs (user_id, nom, prenom, numero_permis, validite_permis) VALUES (?,?,?,?,?)')
    .run(req.user.tenant_id, nom, prenom, numero_permis||null, validite_permis||null);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/chauffeurs/:id', ...guardAdmin, (req, res) => {
  const { nom, prenom, numero_permis, validite_permis, actif } = req.body;
  getDB().prepare('UPDATE fp_chauffeurs SET nom=?, prenom=?, numero_permis=?, validite_permis=?, actif=? WHERE id=? AND user_id=?')
    .run(nom, prenom, numero_permis||null, validite_permis||null, actif ? 1 : 0, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/chauffeurs/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM fp_chauffeurs WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── TRAJETS ─────────────────────────────────────────────────────────────────

router.get('/trajets', ...guard, (req, res) => {
  const { vehicule_id, chauffeur_id, from, to, motif } = req.query;
  let sql = `
    SELECT t.*, v.immatriculation, v.marque, v.modele,
           c.prenom || ' ' || c.nom AS chauffeur_nom
    FROM fp_trajets t
    JOIN fp_vehicules v ON v.id = t.vehicule_id
    LEFT JOIN fp_chauffeurs c ON c.id = t.chauffeur_id
    WHERE t.user_id=?`;
  const params = [req.user.tenant_id];
  if (vehicule_id)  { sql += ' AND t.vehicule_id=?';  params.push(vehicule_id); }
  if (chauffeur_id) { sql += ' AND t.chauffeur_id=?'; params.push(chauffeur_id); }
  if (from)         { sql += ' AND t.date>=?';         params.push(from); }
  if (to)           { sql += ' AND t.date<=?';         params.push(to); }
  if (motif)        { sql += ' AND t.motif=?';         params.push(motif); }
  sql += ' ORDER BY t.date DESC, t.id DESC';
  res.json(getDB().prepare(sql).all(...params));
});

router.post('/trajets', ...guard, (req, res) => {
  const { vehicule_id, chauffeur_id, date, depart, arrivee, km_debut, km_fin, motif, description } = req.body;
  if (!vehicule_id || !date || !depart || !arrivee) return res.status(400).json({ error: 'Véhicule, date, départ et arrivée requis' });
  const kdeb = parseInt(km_debut) || 0;
  const kfin = parseInt(km_fin)   || 0;
  if (kfin < kdeb) return res.status(400).json({ error: 'Km arrivée doit être ≥ km départ' });
  const km_parcourus = kfin - kdeb;
  const db = getDB();
  const r = db.prepare(`
    INSERT INTO fp_trajets (user_id, vehicule_id, chauffeur_id, date, depart, arrivee, km_debut, km_fin, km_parcourus, motif, description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.user.tenant_id, vehicule_id, chauffeur_id||null, date, depart, arrivee, kdeb, kfin, km_parcourus, motif||'pro', description||null);
  // Mise à jour kilométrage véhicule
  db.prepare('UPDATE fp_vehicules SET km_actuel=MAX(km_actuel,?) WHERE id=? AND user_id=?')
    .run(kfin, vehicule_id, req.user.tenant_id);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/trajets/:id', ...guardAdmin, (req, res) => {
  const { vehicule_id, chauffeur_id, date, depart, arrivee, km_debut, km_fin, motif, description } = req.body;
  const kdeb = parseInt(km_debut) || 0;
  const kfin = parseInt(km_fin)   || 0;
  getDB().prepare(`
    UPDATE fp_trajets
    SET vehicule_id=?, chauffeur_id=?, date=?, depart=?, arrivee=?,
        km_debut=?, km_fin=?, km_parcourus=?, motif=?, description=?
    WHERE id=? AND user_id=?
  `).run(vehicule_id, chauffeur_id||null, date, depart, arrivee,
         kdeb, kfin, Math.max(0, kfin - kdeb), motif||'pro', description||null,
         req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/trajets/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM fp_trajets WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── EXPORT PDF CARNET DE BORD ────────────────────────────────────────────────

router.get('/trajets/pdf', ...guard, (req, res) => {
  const db  = getDB();
  const uid = req.user.tenant_id;
  const { vehicule_id, from, to } = req.query;

  let sql = `
    SELECT t.*, v.immatriculation, v.marque, v.modele,
           c.prenom || ' ' || c.nom AS chauffeur_nom
    FROM fp_trajets t
    JOIN fp_vehicules v ON v.id = t.vehicule_id
    LEFT JOIN fp_chauffeurs c ON c.id = t.chauffeur_id
    WHERE t.user_id=?`;
  const params = [uid];
  if (vehicule_id) { sql += ' AND t.vehicule_id=?'; params.push(vehicule_id); }
  if (from)        { sql += ' AND t.date>=?';        params.push(from); }
  if (to)          { sql += ' AND t.date<=?';        params.push(to); }
  sql += ' ORDER BY t.date ASC, t.id ASC';
  const trajets = db.prepare(sql).all(...params);

  const owner   = db.prepare('SELECT name FROM users WHERE id=?').get(uid);
  const veh     = vehicule_id ? db.prepare('SELECT * FROM fp_vehicules WHERE id=?').get(vehicule_id) : null;
  const kmPro   = trajets.filter(t => t.motif === 'pro').reduce((a, t) => a + (t.km_parcourus || 0), 0);
  const kmPerso = trajets.filter(t => t.motif === 'perso').reduce((a, t) => a + (t.km_parcourus || 0), 0);
  const fmtD    = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

  const doc      = new PDFDocument({ margin: 40, size: 'A4' });
  const filename = `carnet-bord${veh ? '-' + veh.immatriculation : ''}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  // ── En-tête ──
  doc.rect(0, 0, doc.page.width, 75).fill('#1a0a2e');
  doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
     .text('FlottePéi — Carnet de Bord', 40, 18);
  doc.fontSize(9).font('Helvetica')
     .text(owner?.name || '', 40, 40)
     .text(`Période : ${from || '…'} → ${to || '…'}`, 250, 40);
  if (veh) doc.text(`Véhicule : ${veh.immatriculation} — ${veh.marque} ${veh.modele} (${veh.annee || '?'})`, 40, 56);

  // ── Résumé ──
  const sy = 90;
  doc.roundedRect(40, sy, 515, 46, 6).fill('#f0e8ff');
  doc.fillColor('#5D288F').fontSize(8).font('Helvetica-Bold').text('RÉCAPITULATIF', 55, sy + 8);
  doc.fillColor('#333333').fontSize(10).font('Helvetica')
     .text(`${trajets.length} trajet(s)`, 55, sy + 22)
     .text(`Pro : ${kmPro.toLocaleString('fr-FR')} km`, 180, sy + 22)
     .text(`Perso : ${kmPerso.toLocaleString('fr-FR')} km`, 310, sy + 22)
     .text(`Total : ${(kmPro + kmPerso).toLocaleString('fr-FR')} km`, 420, sy + 22);

  // ── En-tête tableau ──
  const cols = [40, 88, 148, 230, 310, 378, 433, 480];
  const ty   = sy + 62;
  doc.rect(40, ty, 515, 18).fill('#5D288F');
  doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
  ['Date','Immat.','Départ','Arrivée','Km départ','Km fin','Km +','Motif'].forEach((h, i) => {
    doc.text(h, cols[i] + 2, ty + 5, { width: (cols[i+1]||555) - cols[i] - 4, lineBreak: false });
  });

  // ── Lignes ──
  let y = ty + 18;
  doc.fontSize(7.5).font('Helvetica');
  trajets.forEach((t, idx) => {
    if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
    doc.rect(40, y, 515, idx % 2 === 0 ? 16 : 16).fill(idx % 2 === 0 ? '#ffffff' : '#f8f4ff');
    doc.fillColor(t.motif === 'pro' ? '#0d5c46' : '#7a4800');
    [fmtD(t.date), t.immatriculation, t.depart, t.arrivee,
     (t.km_debut||0).toLocaleString('fr-FR'), (t.km_fin||0).toLocaleString('fr-FR'),
     (t.km_parcourus||0).toLocaleString('fr-FR'), t.motif === 'pro' ? 'Pro' : 'Perso'
    ].forEach((v, i) => {
      doc.text(String(v||''), cols[i] + 2, y + 4, { width: (cols[i+1]||555) - cols[i] - 4, lineBreak: false });
    });
    y += 16;
    if (t.description) {
      if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
      doc.fillColor('#888888').text(`   ↳ ${t.description}`, 50, y + 2, { width: 490, lineBreak: false });
      y += 14;
    }
  });

  // ── Pied de page ──
  doc.fontSize(7).fillColor('#aaaaaa')
     .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')} — FlottePéi · Portail Unifié`,
           40, doc.page.height - 35, { align: 'center', width: 515 });
  doc.end();
});

// ─── CARBURANT ────────────────────────────────────────────────────────────────

router.get('/carburant', ...guard, (req, res) => {
  const { vehicule_id } = req.query;
  let sql = `SELECT c.*, v.immatriculation, v.marque, v.modele
             FROM fp_carburant c JOIN fp_vehicules v ON v.id=c.vehicule_id
             WHERE c.user_id=?`;
  const params = [req.user.tenant_id];
  if (vehicule_id) { sql += ' AND c.vehicule_id=?'; params.push(vehicule_id); }
  sql += ' ORDER BY c.date DESC, c.id DESC';
  res.json(getDB().prepare(sql).all(...params));
});

router.post('/carburant', ...guard, (req, res) => {
  const { vehicule_id, date, litres, prix_litre, station, km_compteur } = req.body;
  if (!vehicule_id || !date || !litres || !prix_litre) return res.status(400).json({ error: 'Véhicule, date, litres et prix/L requis' });
  const l = parseFloat(litres), p = parseFloat(prix_litre);
  const r = getDB().prepare(`
    INSERT INTO fp_carburant (user_id, vehicule_id, date, litres, prix_litre, montant, station, km_compteur)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.user.tenant_id, vehicule_id, date, l, p, Math.round(l * p * 100) / 100, station||null, km_compteur||null);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.delete('/carburant/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM fp_carburant WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

module.exports = router;
