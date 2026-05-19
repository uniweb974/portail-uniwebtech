const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  if (!user.active)
    return res.status(403).json({ error: 'Compte désactivé' });

  // tenant_id = l'ID de la tête de compte de la société
  // Règle : si l'utilisateur a un company_id (sous-utilisateur quel que soit son rôle),
  //         le tenant est sa société (company_id).
  //         Sinon (superadmin, admin tête de compte) le tenant est son propre id.
  // IMPORTANT : un sous-admin (role='admin' + company_id défini) doit utiliser
  //             company_id comme tenant, PAS son propre id.
  const tenant_id = user.company_id || user.id;

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, tenant_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('token', token, COOKIE_OPTS);

  let redirect = '/dashboard';
  if (user.role === 'superadmin') redirect = '/admin';

  res.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role, name: user.name, tenant_id },
    redirect
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, email, role, name, plan, active, company_id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ ...user, tenant_id: req.user.tenant_id });
});

router.put('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Champs requis' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

module.exports = router;
