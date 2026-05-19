const express = require('express');
const { getDB } = require('../../db/database');
const { requireAuth, requireCompanyAdmin } = require('../../middleware/auth');
const { checkApp } = require('../../middleware/checkApp');

const router = express.Router();
const guard      = [requireAuth, checkApp('pointage')];
const guardAdmin = [requireAuth, checkApp('pointage'), requireCompanyAdmin];

// ─── EMPLOYÉS (admin uniquement) ─────────────────────────────────────────────

router.get('/employees', ...guard, (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM employees WHERE user_id=? ORDER BY nom, prenom').all(req.user.tenant_id));
});

router.post('/employees', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { prenom, nom, heures_contrat } = req.body;
  if (!prenom || !nom) return res.status(400).json({ error: 'Prénom et nom requis' });
  const r = db.prepare('INSERT INTO employees (user_id, prenom, nom, heures_contrat) VALUES (?,?,?,?)')
    .run(req.user.tenant_id, prenom, nom, heures_contrat || 35);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/employees/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { prenom, nom, heures_contrat } = req.body;
  db.prepare('UPDATE employees SET prenom=?, nom=?, heures_contrat=? WHERE id=? AND user_id=?')
    .run(prenom, nom, heures_contrat || 35, req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

router.delete('/employees/:id', ...guardAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM employees WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── POINTAGES (tous les rôles) ───────────────────────────────────────────────

router.get('/', ...guard, (req, res) => {
  const db = getDB();
  const { employee_id, date, week } = req.query;
  let sql = `SELECT p.*, e.prenom, e.nom, e.heures_contrat
             FROM pointages p JOIN employees e ON e.id=p.employee_id
             WHERE p.user_id=?`;
  const params = [req.user.tenant_id];
  if (employee_id) { sql += ' AND p.employee_id=?'; params.push(employee_id); }
  if (date)  { sql += ' AND date(p.timestamp)=?'; params.push(date); }
  if (week)  {
    const [year, w] = week.split('-W');
    sql += ' AND strftime(\'%Y-%W\', p.timestamp)=?';
    params.push(`${year}-${w.padStart(2,'0')}`);
  }
  sql += ' ORDER BY p.timestamp';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', ...guard, (req, res) => {
  const db = getDB();
  const { employee_id, type, timestamp } = req.body;
  if (!employee_id || !type) return res.status(400).json({ error: 'Employé et type requis' });

  const emp = db.prepare('SELECT id FROM employees WHERE id=? AND user_id=?').get(employee_id, req.user.tenant_id);
  if (!emp) return res.status(404).json({ error: 'Employé introuvable' });

  const ts = timestamp || new Date().toISOString();
  const date = ts.split('T')[0];

  const last = db.prepare(`SELECT type FROM pointages WHERE employee_id=? AND date(timestamp)=?
    ORDER BY timestamp DESC LIMIT 1`).get(employee_id, date);

  if (type === 'ARRIVEE' && last?.type === 'ARRIVEE')
    return res.status(409).json({ error: 'Arrivée déjà enregistrée — enregistrez d\'abord un départ' });
  if (type === 'DEPART' && (!last || last.type === 'DEPART'))
    return res.status(409).json({ error: 'Aucune arrivée en cours pour ce salarié' });

  const r = db.prepare('INSERT INTO pointages (user_id, employee_id, type, timestamp) VALUES (?,?,?,?)')
    .run(req.user.tenant_id, employee_id, type, ts);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.delete('/:id', ...guard, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM pointages WHERE id=? AND user_id=?').run(req.params.id, req.user.tenant_id);
  res.json({ success: true });
});

// ─── RÉSUMÉ HEBDO (tous les rôles) ───────────────────────────────────────────

router.get('/weekly-summary', ...guard, (req, res) => {
  const db = getDB();
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: 'Paramètre week requis' });
  const [year, w] = week.split('-W');
  const weekStr = `${year}-${w.padStart(2,'0')}`;

  const employees = db.prepare('SELECT * FROM employees WHERE user_id=? ORDER BY nom, prenom').all(req.user.tenant_id);
  const pointages = db.prepare(`
    SELECT * FROM pointages WHERE user_id=? AND strftime('%Y-%W', timestamp)=?
    ORDER BY employee_id, timestamp
  `).all(req.user.tenant_id, weekStr);

  const summary = employees.map(emp => {
    const pts = pointages.filter(p => p.employee_id === emp.id);
    const days = {};
    let total_minutes = 0;
    pts.forEach(p => {
      const day = p.timestamp.split('T')[0];
      if (!days[day]) days[day] = [];
      days[day].push(p);
    });
    Object.values(days).forEach(dayPts => {
      for (let i = 0; i < dayPts.length - 1; i += 2) {
        if (dayPts[i]?.type === 'ARRIVEE' && dayPts[i+1]?.type === 'DEPART') {
          total_minutes += (new Date(dayPts[i+1].timestamp) - new Date(dayPts[i].timestamp)) / 60000;
        }
      }
    });
    const total_heures = total_minutes / 60;
    return {
      employee: emp,
      total_heures: Math.round(total_heures * 100) / 100,
      heures_contrat: emp.heures_contrat,
      heures_sup: Math.max(0, Math.round((total_heures - emp.heures_contrat) * 100) / 100),
      days
    };
  });
  res.json(summary);
});

// ─── EXPORT CSV (admin uniquement) ───────────────────────────────────────────

router.get('/export-csv', ...guardAdmin, (req, res) => {
  const db = getDB();
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: 'Paramètre week requis' });
  const [year, w] = week.split('-W');
  const weekStr = `${year}-${w.padStart(2,'0')}`;

  const rows = db.prepare(`
    SELECT e.prenom, e.nom, e.heures_contrat, p.type, p.timestamp
    FROM pointages p JOIN employees e ON e.id=p.employee_id
    WHERE p.user_id=? AND strftime('%Y-%W', p.timestamp)=?
    ORDER BY e.nom, p.timestamp
  `).all(req.user.tenant_id, weekStr);

  let csv = 'Prénom,Nom,Type,Date,Heure,Heures contrat\n';
  rows.forEach(r => {
    const dt = new Date(r.timestamp);
    csv += `"${r.prenom}","${r.nom}","${r.type}","${dt.toLocaleDateString('fr-FR')}","${dt.toLocaleTimeString('fr-FR')}","${r.heures_contrat}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pointage-${week}.csv"`);
  res.send('﻿' + csv);
});

module.exports = router;
