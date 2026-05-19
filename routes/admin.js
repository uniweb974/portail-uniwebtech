const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB, persistDB } = require('../db/database');
const { requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const APP_SLUGS = ['facturation', 'stock', 'recettes', 'pointage', 'flottepei'];

// ─── SOCIÉTÉS (anciens "clients") ─────────────────────────────────────────────

router.get('/clients', requireSuperAdmin, (req, res) => {
  try {
    const db = getDB();
    const companies = db.prepare(`
      SELECT id, email, name, plan, active, created_at
      FROM users WHERE role='admin' AND company_id IS NULL
      ORDER BY created_at DESC
    `).all();

    const apps = db.prepare('SELECT user_id, app_slug, active FROM tenant_apps').all();
    const appsMap = {};
    apps.forEach(a => {
      if (!appsMap[a.user_id]) appsMap[a.user_id] = {};
      appsMap[a.user_id][a.app_slug] = a.active;
    });

    const result = companies.map(c => ({ ...c, apps: appsMap[c.id] || {} }));
    res.json(result);
  } catch (e) {
    console.error('[GET /clients]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// Créer une société (compte admin)
router.post('/clients', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, password, plan = 'basic' } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(`
      INSERT INTO users (email, password_hash, role, name, plan, active)
      VALUES (?, ?, 'admin', ?, ?, 1)
    `).run(email.toLowerCase().trim(), hash, name, plan);

    const userId = r.lastInsertRowid;
    if (!userId) throw new Error('Échec de la création du compte (lastInsertRowid=0)');

    const ins = db.prepare('INSERT OR IGNORE INTO tenant_apps (user_id, app_slug, active) VALUES (?,?,0)');
    APP_SLUGS.forEach(slug => ins.run(userId, slug));

    persistDB();
    console.log(`[POST /clients] Société créée : id=${userId}, email=${email}`);
    res.json({ success: true, id: userId });
  } catch (e) {
    console.error('[POST /clients]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// Modifier une société
router.put('/clients/:id', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, plan, active, password } = req.body;
    const db = getDB();
    if (password) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?')
        .run(bcrypt.hashSync(password, 10), req.params.id);
    }
    db.prepare('UPDATE users SET name=?, email=?, plan=?, active=? WHERE id=?')
      .run(name, email?.toLowerCase().trim(), plan, active ? 1 : 0, req.params.id);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /clients/:id]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// Supprimer une société (cascade sur sous-utilisateurs)
router.delete('/clients/:id', requireSuperAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare("DELETE FROM users WHERE id=? AND role='admin'").run(req.params.id);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /clients/:id]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// Toggle app pour une société
router.put('/clients/:id/apps/:slug', requireSuperAdmin, (req, res) => {
  try {
    const { active } = req.body;
    const db = getDB();
    db.prepare(`
      INSERT INTO tenant_apps (user_id, app_slug, active) VALUES (?,?,?)
      ON CONFLICT(user_id, app_slug) DO UPDATE SET active=excluded.active
    `).run(req.params.id, req.params.slug, active ? 1 : 0);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /clients/:id/apps/:slug]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ─── SOUS-UTILISATEURS D'UNE SOCIÉTÉ ─────────────────────────────────────────

router.get('/clients/:id/users', requireSuperAdmin, (req, res) => {
  try {
    const db = getDB();
    const users = db.prepare(`
      SELECT id, email, name, role, active, created_at
      FROM users WHERE company_id=?
      ORDER BY name
    `).all(parseInt(req.params.id, 10));
    res.json(users);
  } catch (e) {
    console.error('[GET /clients/:id/users]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

router.post('/clients/:id/users', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, password, role = 'user' } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (!['admin', 'user'].includes(role))
      return res.status(400).json({ error: 'Rôle invalide' });

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return res.status(400).json({ error: 'ID société invalide' });
    const company = db.prepare("SELECT id FROM users WHERE id=? AND role='admin'").get(companyId);
    if (!company) return res.status(404).json({ error: 'Société introuvable' });

    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(
      'INSERT INTO users (email, password_hash, role, name, active, company_id) VALUES (?,?,?,?,1,?)'
    ).run(email.toLowerCase().trim(), hash, role, name, companyId);

    persistDB();
    console.log(`[POST /clients/:id/users] Sous-utilisateur créé : id=${r.lastInsertRowid}, email=${email}`);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    console.error('[POST /clients/:id/users]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

router.put('/clients/:id/users/:uid', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, role, active, password } = req.body;
    const db = getDB();
    const cid = parseInt(req.params.id, 10);
    const uid = parseInt(req.params.uid, 10);
    if (password) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=? AND company_id=?')
        .run(bcrypt.hashSync(password, 10), uid, cid);
    }
    db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=? AND company_id=?')
      .run(name, email?.toLowerCase().trim(), role, active ? 1 : 0, uid, cid);
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /clients/:id/users/:uid]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

router.delete('/clients/:id/users/:uid', requireSuperAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare('DELETE FROM users WHERE id=? AND company_id=?')
      .run(parseInt(req.params.uid, 10), parseInt(req.params.id, 10));
    persistDB();
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /clients/:id/users/:uid]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

// ─── STATS GLOBALES ───────────────────────────────────────────────────────────

router.get('/stats', requireSuperAdmin, (req, res) => {
  try {
    const db = getDB();
    const total    = db.prepare("SELECT COUNT(*) as n FROM users WHERE role='admin' AND company_id IS NULL").get().n;
    const active   = db.prepare("SELECT COUNT(*) as n FROM users WHERE role='admin' AND company_id IS NULL AND active=1").get().n;
    const subUsers = db.prepare("SELECT COUNT(*) as n FROM users WHERE company_id IS NOT NULL").get().n;
    const appsOn   = db.prepare('SELECT COUNT(*) as n FROM tenant_apps WHERE active=1').get().n;
    res.json({ total_clients: total, active_clients: active, sub_users: subUsers, apps_enabled: appsOn });
  } catch (e) {
    console.error('[GET /stats]', e.message);
    res.status(500).json({ error: e.message || 'Erreur serveur interne' });
  }
});

module.exports = router;
