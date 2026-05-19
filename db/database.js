const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'portail.db');

let db;

function getDB() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    -- ═══════════════════════════════════════
    --  TABLES CŒUR DU PORTAIL
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      name TEXT NOT NULL,
      plan TEXT DEFAULT 'basic',
      active INTEGER DEFAULT 1,
      company_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      app_slug TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, app_slug)
    );

    -- ═══════════════════════════════════════
    --  APP : FACTURATION
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS entreprise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      nom TEXT, adresse TEXT, code_postal TEXT, ville TEXT,
      telephone TEXT, email TEXT, siret TEXT, tva_number TEXT,
      logo_path TEXT, rib TEXT,
      conditions_paiement TEXT DEFAULT '30 jours',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS fact_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      nom TEXT NOT NULL, prenom TEXT, entreprise TEXT,
      adresse TEXT, code_postal TEXT, ville TEXT, email TEXT, telephone TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      client_id INTEGER,
      numero TEXT NOT NULL,
      date_creation TEXT DEFAULT (date('now')),
      statut TEXT DEFAULT 'brouillon',
      total_ht REAL DEFAULT 0, total_tva REAL DEFAULT 0, total_ttc REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES fact_clients(id)
    );

    CREATE TABLE IF NOT EXISTS lignes_devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      devis_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      quantite REAL DEFAULT 1, prix_unitaire_ht REAL DEFAULT 0, tva_taux REAL DEFAULT 20,
      total_ht REAL DEFAULT 0, total_tva REAL DEFAULT 0, total_ttc REAL DEFAULT 0,
      FOREIGN KEY (devis_id) REFERENCES devis(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════
    --  APP : STOCK
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, nom TEXT NOT NULL, couleur TEXT DEFAULT '#5D288F',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, nom TEXT NOT NULL, sku TEXT, categorie_id INTEGER,
      prix_ht REAL DEFAULT 0, tva REAL DEFAULT 20,
      stock_actuel INTEGER DEFAULT 0, stock_minimum INTEGER DEFAULT 5,
      photo_url TEXT, archive INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (categorie_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
      type TEXT NOT NULL, quantite INTEGER NOT NULL,
      stock_avant INTEGER, stock_apres INTEGER, note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (produit_id) REFERENCES produits(id)
    );

    CREATE TABLE IF NOT EXISTS stock_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, nom TEXT NOT NULL,
      email TEXT, telephone TEXT, adresse TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, numero TEXT NOT NULL, client_id INTEGER,
      statut TEXT DEFAULT 'en_attente', mode_paiement TEXT,
      statut_paiement TEXT DEFAULT 'impayé',
      total_ht REAL DEFAULT 0, total_ttc REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES stock_clients(id)
    );

    CREATE TABLE IF NOT EXISTS lignes_commande (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commande_id INTEGER NOT NULL, produit_id INTEGER, nom_produit TEXT NOT NULL,
      quantite INTEGER DEFAULT 1, prix_unitaire_ht REAL DEFAULT 0,
      tva REAL DEFAULT 20, remise REAL DEFAULT 0,
      FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id)
    );

    CREATE TABLE IF NOT EXISTS livraisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, commande_id INTEGER NOT NULL,
      livreur_nom TEXT, statut TEXT DEFAULT 'preparee',
      adresse_livraison TEXT, date_prevue TEXT, date_livraison TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (commande_id) REFERENCES commandes(id)
    );

    -- ═══════════════════════════════════════
    --  APP : RECETTES
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL,
      category TEXT, description TEXT, payment_method TEXT, date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE, opening_balance REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ═══════════════════════════════════════
    --  APP : POINTAGE
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, prenom TEXT NOT NULL, nom TEXT NOT NULL,
      heures_contrat REAL DEFAULT 35,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pointages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
      type TEXT NOT NULL, timestamp DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
  `);

  migrate(db);
  seedSuperAdmin(db);
  console.log('✅ Base de données initialisée');
}

function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.find(c => c.name === 'company_id')) {
    db.exec('ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
    console.log('✅ Migration : colonne company_id ajoutée');
  }
  if (!cols.find(c => c.name === 'plan')) {
    db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'basic'");
    console.log('✅ Migration : colonne plan ajoutée');
  }
  db.exec("UPDATE users SET role='admin' WHERE role='client'");
}

function seedSuperAdmin(db) {
  const email = process.env.ADMIN_EMAIL || 'admin@portail.fr';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const existing = db.prepare("SELECT id FROM users WHERE role='superadmin'").get();
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`INSERT INTO users (email, password_hash, role, name, active)
                VALUES (?, ?, 'superadmin', 'Super Admin', 1)`).run(email, hash);
    console.log(`✅ Super Admin créé : ${email}`);
  }

  // Assurer que toutes les sociétés ont leurs lignes tenant_apps
  const apps = ['facturation', 'stock', 'recettes', 'pointage'];
  const companies = db.prepare("SELECT id FROM users WHERE role='admin' AND company_id IS NULL").all();
  const ins = db.prepare('INSERT OR IGNORE INTO tenant_apps (user_id, app_slug, active) VALUES (?,?,0)');
  companies.forEach(c => apps.forEach(slug => ins.run(c.id, slug)));
}

module.exports = { getDB, initDB };
