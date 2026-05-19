const express = require('express');
const path = require('path');
const multer = require('multer');
const { getDB } = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router = express.Router();
const guard      = [requireAuth, checkApp('stock')];
const guardAdmin = [requireAuth, checkApp('stock'), requireCompanyAdmin];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads/products'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5*1024*1024 } });

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', ...guard, (req, res) => {
  const db = getDB();
  const tid = req.user.tenant_id;
  const total_produits = db.prepare('SELECT COUNT(*) as n FROM produits WHERE user_id=? AND archive=0').get(tid).n;
  const alertes        = db.prepare('SELECT COUNT(*) as n FROM produits WHERE user_id=? AND archive=0 AND stock_actuel<=stock_minimum').get(tid).n;
  const total_commandes= db.prepare('SELECT COUNT(*) as n FROM commandes WHERE user_id=?').get(tid).n;
  const ca_mois = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM commandes WHERE user_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now') AND statut_paiement='payé'`).get(tid).t;
  const recent_commandes = db.prepare(`SELECT c.*, cl.nom as client_nom FROM commandes c LEFT JOIN stock_clients cl ON cl.id=c.client_id WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 5`).all(tid);
  res.json({ total_produits, alertes, total_commandes, ca_mois, recent_commandes });
});

// ─── CATÉGORIES (admin : CRUD / user : lecture) ───────────────────────────────

router.get('/categories', ...guard, (req, res) => {
  res.json(getDB().prepare('SELECT * FROM categories WHERE user_id=? ORDER BY nom').all(req.user.tenant_id));
});

router.post('/categories', ...guardAdmin, (req, res) => {
  const { nom, couleur } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const r = getDB().prepare('INSERT INTO categories (user_id, nom, couleur) VALUES (?,?,?)').run(req.user.tenant_id, nom, couleur||'#5D288F');
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/categories/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('UPDATE categories SET nom=?,couleur=? WHERE id=? AND user_id=?').run(req.body.nom, req.body.couleur, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/categories/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE produits SET categorie_id=NULL WHERE categorie_id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── PRODUITS (admin : CRUD / user : lecture + stock ajustement) ──────────────

router.get('/produits', ...guard, (req, res) => {
  const db = getDB();
  const tid = req.user.tenant_id;
  const { search, categorie, alertes } = req.query;
  let sql = `SELECT p.*, c.nom as categorie_nom, c.couleur as categorie_couleur
             FROM produits p LEFT JOIN categories c ON c.id=p.categorie_id
             WHERE p.user_id=? AND p.archive=0`;
  const p = [tid];
  if (search)   { sql += ' AND p.nom LIKE ?'; p.push(`%${search}%`); }
  if (categorie){ sql += ' AND p.categorie_id=?'; p.push(categorie); }
  if (alertes==='1') sql += ' AND p.stock_actuel<=p.stock_minimum';
  sql += ' ORDER BY p.nom';
  const rows = db.prepare(sql).all(...p);
  console.log(`[GET /produits] tenant_id=${tid} alertes=${alertes||'0'} → ${rows.length} produit(s)`);
  res.json(rows);
});

router.post('/produits', ...guardAdmin, upload.single('photo'), (req, res) => {
  const db = getDB();
  const { nom, sku, categorie_id, prix_ht, tva, stock_actuel, stock_minimum } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const photo_url = req.file ? `/uploads/products/${req.file.filename}` : null;
  const r = db.prepare('INSERT INTO produits (user_id, nom, sku, categorie_id, prix_ht, tva, stock_actuel, stock_minimum, photo_url) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.tenant_id, nom, sku||null, categorie_id||null, prix_ht||0, tva||20, stock_actuel||0, stock_minimum||5, photo_url);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/produits/:id', ...guardAdmin, upload.single('photo'), (req, res) => {
  const db = getDB();
  const { nom, sku, categorie_id, prix_ht, tva, stock_minimum } = req.body;
  let photo_url = req.body.photo_url;
  if (req.file) photo_url = `/uploads/products/${req.file.filename}`;
  db.prepare('UPDATE produits SET nom=?,sku=?,categorie_id=?,prix_ht=?,tva=?,stock_minimum=?,photo_url=? WHERE id=? AND user_id=?')
    .run(nom, sku||null, categorie_id||null, prix_ht||0, tva||20, stock_minimum||5, photo_url, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/produits/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('UPDATE produits SET archive=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// Ajustement stock (tous les rôles)
router.post('/produits/:id/stock', ...guard, (req, res) => {
  const db = getDB();
  const { type, quantite, note } = req.body;
  const produit = db.prepare('SELECT * FROM produits WHERE id=? AND user_id=?').get(req.params.id, req.user.tenant_id);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  const avant = produit.stock_actuel;
  let apres;
  if (type==='entrée'||type==='retour') apres = avant + parseInt(quantite);
  else if (type==='sortie'||type==='vente') apres = avant - parseInt(quantite);
  else apres = parseInt(quantite);
  if (apres < 0) return res.status(400).json({ error: 'Stock insuffisant' });
  db.prepare('UPDATE produits SET stock_actuel=? WHERE id=?').run(apres, req.params.id);
  db.prepare('INSERT INTO mouvements_stock (user_id, produit_id, type, quantite, stock_avant, stock_apres, note) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.tenant_id, req.params.id, type, quantite, avant, apres, note||null);
  res.json({ success: true, stock_apres: apres });
});

// ─── CLIENTS STOCK (admin : CRUD / user : lecture) ────────────────────────────

router.get('/clients', ...guard, (req, res) => {
  res.json(getDB().prepare('SELECT * FROM stock_clients WHERE user_id=? ORDER BY nom').all(req.user.tenant_id));
});

router.post('/clients', ...guardAdmin, (req, res) => {
  const { nom, email, telephone, adresse } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const r = getDB().prepare('INSERT INTO stock_clients (user_id, nom, email, telephone, adresse) VALUES (?,?,?,?,?)').run(req.user.tenant_id, nom, email, telephone, adresse);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/clients/:id', ...guardAdmin, (req, res) => {
  const { nom, email, telephone, adresse } = req.body;
  getDB().prepare('UPDATE stock_clients SET nom=?,email=?,telephone=?,adresse=? WHERE id=? AND user_id=?').run(nom, email, telephone, adresse, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/clients/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM stock_clients WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── COMMANDES (création : tous / modif-suppression : admin) ─────────────────

router.get('/commandes', ...guard, (req, res) => {
  res.json(getDB().prepare(`SELECT c.*, cl.nom as client_nom FROM commandes c LEFT JOIN stock_clients cl ON cl.id=c.client_id WHERE c.user_id=? ORDER BY c.created_at DESC`).all(req.user.tenant_id));
});

router.get('/commandes/:id', ...guard, (req, res) => {
  const db = getDB();
  const cmd = db.prepare(`SELECT c.*, cl.nom as client_nom, cl.email as client_email FROM commandes c LEFT JOIN stock_clients cl ON cl.id=c.client_id WHERE c.id=? AND c.user_id=?`).get(req.params.id, req.user.tenant_id);
  if (!cmd) return res.status(404).json({ error: 'Commande introuvable' });
  const lignes = db.prepare('SELECT lc.*, p.stock_actuel FROM lignes_commande lc LEFT JOIN produits p ON p.id=lc.produit_id WHERE lc.commande_id=?').all(req.params.id);
  res.json({ ...cmd, lignes });
});

router.post('/commandes', ...guard, (req, res) => {
  const db = getDB();
  const { client_id, mode_paiement, lignes=[] } = req.body;
  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT numero FROM commandes WHERE user_id=? AND numero LIKE 'CMD-${year}-%' ORDER BY id DESC LIMIT 1`).get(req.user.tenant_id);
  const seq = last ? parseInt(last.numero.split('-')[2])+1 : 1;
  const numero = `CMD-${year}-${String(seq).padStart(4,'0')}`;
  let ht=0, ttc=0;
  lignes.forEach(l => { const lht=l.quantite*l.prix_unitaire_ht*(1-(l.remise||0)/100); ht+=lht; ttc+=lht*(1+(l.tva||20)/100); });
  const r = db.prepare('INSERT INTO commandes (user_id, numero, client_id, mode_paiement, total_ht, total_ttc) VALUES (?,?,?,?,?,?)').run(req.user.tenant_id, numero, client_id||null, mode_paiement||null, ht, ttc);
  const ins = db.prepare('INSERT INTO lignes_commande (commande_id, produit_id, nom_produit, quantite, prix_unitaire_ht, tva, remise) VALUES (?,?,?,?,?,?,?)');
  lignes.forEach(l => ins.run(r.lastInsertRowid, l.produit_id||null, l.nom_produit, l.quantite, l.prix_unitaire_ht, l.tva||20, l.remise||0));
  res.json({ success: true, id: r.lastInsertRowid, numero });
});

router.put('/commandes/:id', ...guardAdmin, (req, res) => {
  const { statut, statut_paiement, mode_paiement } = req.body;
  getDB().prepare('UPDATE commandes SET statut=?,statut_paiement=?,mode_paiement=? WHERE id=? AND user_id=?').run(statut, statut_paiement, mode_paiement, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/commandes/:id', ...guardAdmin, (req, res) => {
  getDB().prepare('DELETE FROM commandes WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── LIVRAISONS (admin uniquement) ───────────────────────────────────────────

router.get('/livraisons', ...guard, (req, res) => {
  res.json(getDB().prepare(`SELECT l.*, c.numero as commande_numero, cl.nom as client_nom FROM livraisons l JOIN commandes c ON c.id=l.commande_id LEFT JOIN stock_clients cl ON cl.id=c.client_id WHERE l.user_id=? ORDER BY l.created_at DESC`).all(req.user.tenant_id));
});

router.post('/livraisons', ...guardAdmin, (req, res) => {
  try {
    const { commande_id, livreur_nom, adresse_livraison, date_prevue, statut } = req.body;
    if (!commande_id) return res.status(400).json({ error: 'commande_id requis' });
    const r = getDB().prepare(
      'INSERT INTO livraisons (user_id, commande_id, livreur_nom, adresse_livraison, date_prevue, statut) VALUES (?,?,?,?,?,?)'
    ).run(req.user.tenant_id, commande_id, livreur_nom||null, adresse_livraison||null, date_prevue||null, statut||'preparee');
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    console.error('[POST /livraisons]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

router.put('/livraisons/:id', ...guardAdmin, (req, res) => {
  const { statut, livreur_nom, date_livraison } = req.body;
  getDB().prepare('UPDATE livraisons SET statut=?,livreur_nom=?,date_livraison=? WHERE id=? AND user_id=?').run(statut, livreur_nom, date_livraison||null, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

module.exports = router;
