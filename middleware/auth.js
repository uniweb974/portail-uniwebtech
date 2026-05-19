const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Session expirée' });
  }
}

// Réservé au super admin du portail
function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
    next();
  });
}

// Réservé aux admins de société (+ superadmin)
function requireCompanyAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.user.role === 'user') {
    return res.status(403).json({ error: 'Action réservée aux administrateurs de la société' });
  }
  next();
}

module.exports = { requireAuth, requireSuperAdmin, requireCompanyAdmin };
