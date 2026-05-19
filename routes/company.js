/**
 * Routes pour les admins de société
 * Un admin peut gérer les sous-utilisateurs de sa propre société
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db/database');
const { requireAuth, requireCompanyAdmin } = require('../middleware/auth');

const router = express.Router();

// Récupérer les utilisateurs de la société
router.get('/users', requireAuth, requireCompanyAdmin, (req, res) => {
  const db = getDB();
  // tenant_id = ID de la société (l'admin lui-même pour un admin)
  const users = db.prepare(`
    SELECT id, email, name, role, active, created_at
    FROM users WHERE company_id = ?
    ORDER BY name
  `).all(req.user.tenant_id);
  res.json(users);
});

// Créer un utilisateur dans la société
router.post('/users', requireAuth, requireCompanyAdmin, (req, res) => {
  const { name, email, password, role = 'user' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

  const db = getDB();
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(`
    INSERT INTO users (email, password_hash, role, name, active, company_id)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(email.toLowerCase().trim(), hash, role, name, req.user.tenant_id);

  res.json({ success: true, id: r.lastInsertRowid });
});

// Modifier un utilisateur de la société
router.put('/users/:id', requireAuth, requireCompanyAdmin, (req, res) => {
  const { name, email, role, active, password } = req.body;
  if (role && !['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });

  const db = getDB();
  // Vérifier que l'utilisateur appartient bien à cette société
  const target = db.prepare('SELECT id FROM users WHERE id=? AND company_id=?').get(req.params.id, req.user.tenant_id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?')
      .run(bcrypt.hashSync(password, 10), req.params.id);
  }
  db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=? AND company_id=?')
    .run(name, email?.toLowerCase().trim(), role, active ? 1 : 0, req.params.id, req.user.tenant_id);

  res.json({ success: true });
});

// Supprimer un utilisateur de la société
router.delete('/users/:id', requireAuth, requireCompanyAdmin, (req, res) => {
  const db = getDB();
  const target = db.prepare('SELECT id FROM users WHERE id=? AND company_id=?').get(req.params.id, req.user.tenant_id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  db.prepare('DELETE FROM users WHERE id=? AND company_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

module.exports = router;
