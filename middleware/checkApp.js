const { getDB } = require('../db/database');

function checkApp(appSlug) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.role === 'superadmin') return next();

    const db = getDB();
    // Résolution robuste du tenant (même logique que dashboard.js)
    const userRow = db.prepare('SELECT company_id FROM users WHERE id = ?').get(req.user.id);
    const tenantId = userRow?.company_id || req.user.id;

    const row = db.prepare(
      'SELECT active FROM tenant_apps WHERE user_id = ? AND app_slug = ?'
    ).get(tenantId, appSlug);

    if (!row || !row.active) {
      return res.status(403).json({
        error: 'Application non activée',
        app: appSlug,
        redirect: '/dashboard'
      });
    }
    next();
  };
}

module.exports = { checkApp };
