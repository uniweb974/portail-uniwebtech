const { getDB } = require('../db/database');

function checkApp(appSlug) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.role === 'superadmin') return next();

    const db = getDB();
    // tenant_id = ID de la société (admin.id pour les admins, company_id pour les users)
    const row = db.prepare(
      'SELECT active FROM tenant_apps WHERE user_id = ? AND app_slug = ?'
    ).get(req.user.tenant_id, appSlug);

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
