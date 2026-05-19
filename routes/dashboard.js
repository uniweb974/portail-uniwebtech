const express = require('express');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/apps', requireAuth, (req, res) => {
  const db = getDB();
  const apps = db.prepare('SELECT app_slug, active FROM tenant_apps WHERE user_id=?').all(req.user.tenant_id);
  res.json(apps);
});

router.get('/profile', requireAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, email, name, role, plan, created_at FROM users WHERE id=?').get(req.user.id);
  res.json({ ...user, tenant_id: req.user.tenant_id });
});

module.exports = router;
