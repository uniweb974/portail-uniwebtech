const express = require('express');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/apps', requireAuth, (req, res) => {
  const db = getDB();

  // Résolution robuste du tenant depuis la BDD
  // (ne pas se fier uniquement au JWT qui peut contenir un tenant_id obsolète)
  // • sous-utilisateur (role='user' ou role='admin' avec company_id) → company_id
  // • tête de compte / superadmin (company_id NULL) → propre id
  const userRow = db.prepare('SELECT company_id FROM users WHERE id = ?').get(req.user.id);
  const tenantId = userRow?.company_id || req.user.id;

  const apps = db.prepare('SELECT app_slug, active FROM tenant_apps WHERE user_id = ?').all(tenantId);
  res.json(apps);
});

router.get('/profile', requireAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, email, name, role, plan, created_at FROM users WHERE id=?').get(req.user.id);
  res.json({ ...user, tenant_id: req.user.tenant_id });
});

module.exports = router;
