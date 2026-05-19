require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initDB } = require('./db/database');
const authRoutes       = require('./routes/auth');
const adminRoutes      = require('./routes/admin');
const dashboardRoutes  = require('./routes/dashboard');
const companyRoutes    = require('./routes/company');
const facturationRoutes = require('./routes/apps/facturation');
const stockRoutes      = require('./routes/apps/stock');
const recettesRoutes   = require('./routes/apps/recettes');
const pointageRoutes   = require('./routes/apps/pointage');
const flotteRoutes     = require('./routes/apps/flottepei');

const app = express();
const PORT = process.env.PORT || 3010;

initDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// No-cache pour que le navigateur ne garde jamais de vieux JS/HTML
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ──────────────────────────────────────────────────────────────────────
app.use('/api/auth',              authRoutes);
app.use('/api/admin',             adminRoutes);
app.use('/api/dashboard',         dashboardRoutes);
app.use('/api/company',           companyRoutes);
app.use('/api/app/facturation',   facturationRoutes);
app.use('/api/app/stock',         stockRoutes);
app.use('/api/app/recettes',      recettesRoutes);
app.use('/api/app/pointage',      pointageRoutes);
app.use('/api/app/flottepei',    flotteRoutes);

// ─── PAGES ────────────────────────────────────────────────────────────────────
app.get('/',                (req, res) => res.redirect('/login'));
app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/app/facturation', (req, res) => res.sendFile(path.join(__dirname, 'public', 'apps', 'facturation.html')));
app.get('/app/stock',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'apps', 'stock.html')));
app.get('/app/recettes',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'apps', 'recettes.html')));
app.get('/app/pointage',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'apps', 'pointage.html')));
app.get('/app/flottepei',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'apps', 'flottepei.html')));

// ─── ERREUR GLOBALE (retourne toujours du JSON) ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: err.message || 'Erreur serveur interne' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 PORTAIL démarré sur http://localhost:${PORT}`);
  console.log(`   Dashboard → http://localhost:${PORT}/dashboard`);
  console.log(`   Admin     → http://localhost:${PORT}/admin`);
});
