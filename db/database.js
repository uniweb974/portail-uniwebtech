/* ── database.js — sql.js wrapper (API compatible better-sqlite3) ────────────
 *
 *  sql.js est une compilation WebAssembly de SQLite : aucun module natif,
 *  aucun node-gyp, fonctionne partout (Railway, Render, Vercel…).
 *
 *  Le wrapper ci-dessous expose exactement la même interface que better-sqlite3
 *  (prepare / .get / .all / .run / .exec) pour que tous les fichiers de routes
 *  restent inchangés.
 * ──────────────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'portail.db');

let _sqlJs = null;   // module sql.js initialisé
let _db    = null;   // instance DBWrapper

// ── Wrapper Statement ─────────────────────────────────────────────────────────

class Statement {
  constructor (wrapper, sql) {
    this._w   = wrapper;
    this._sql = sql;
  }

  /* Normalise les arguments : spread (a,b,c) ou tableau ([a,b,c]) → [a,b,c] */
  _p (args) {
    if (!args.length) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args;
  }

  /** INSERT / UPDATE / DELETE → { lastInsertRowid, changes } */
  run (...args) {
    const params = this._p(args);
    const raw    = this._w._raw;
    const stmt   = raw.prepare(this._sql);
    try {
      if (params.length) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }

    /* Récupérer l'ID avant _persist() (exec retourne [{columns, values}]) */
    let lastInsertRowid = 0;
    const idRes = raw.exec('SELECT last_insert_rowid()');
    if (idRes.length && idRes[0].values.length) {
      lastInsertRowid = Number(idRes[0].values[0][0]) || 0;
    }
    const changes = raw.getRowsModified();

    this._w._persist();
    return { lastInsertRowid, changes };
  }

  /** SELECT → une ligne (objet) ou undefined */
  get (...args) {
    const params = this._p(args);
    const stmt   = this._w._raw.prepare(this._sql);
    try {
      if (params.length) stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  /** SELECT → tableau de lignes */
  all (...args) {
    const params = this._p(args);
    const stmt   = this._w._raw.prepare(this._sql);
    const rows   = [];
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }
}

// ── Wrapper Database ──────────────────────────────────────────────────────────

class DBWrapper {
  constructor (raw) { this._raw = raw; }

  prepare (sql) { return new Statement(this, sql); }

  /** Exécute un bloc SQL multi-instructions sans paramètres (DDL, migrations…) */
  exec (sql) {
    this._raw.exec(sql);
    this._persist();
    return this;
  }

  /** Sérialise la base en mémoire et l'écrit sur disque */
  _persist () {
    const data = this._raw.export();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

function getDB () {
  if (!_db) throw new Error('DB non initialisée — appelez initDB() en premier');
  return _db;
}

async function initDB () {
  if (_db) return;

  /* Localise le fichier WASM de sql.js de façon fiable sur tous les envs */
  const initSqlJs = require('sql.js');
  const sqlJsDir  = path.dirname(require.resolve('sql.js'));
  _sqlJs = await initSqlJs({
    locateFile: file => path.join(sqlJsDir, file)
  });

  /* Charge la base existante ou en crée une vide */
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    rawDb = new _sqlJs.Database(fs.readFileSync(DB_PATH));
  } else {
    rawDb = new _sqlJs.Database();
  }

  rawDb.run('PRAGMA foreign_keys = ON');
  _db = new DBWrapper(rawDb);

  /* ── Création de toutes les tables ─────────────────────────────────────── */
  _db.exec(`

    -- ═══════════════════════════════════════
    --  TABLES CŒUR DU PORTAIL
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT    UNIQUE NOT NULL,
      password_hash TEXT   NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'admin',
      name         TEXT    NOT NULL,
      plan         TEXT    DEFAULT 'basic',
      active       INTEGER DEFAULT 1,
      company_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_apps (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL,
      app_slug TEXT    NOT NULL,
      active   INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, app_slug)
    );

    -- ═══════════════════════════════════════
    --  APP : FACTURATION
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS entreprise (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL UNIQUE,
      nom TEXT, adresse TEXT, code_postal TEXT, ville TEXT,
      telephone TEXT, email TEXT, siret TEXT, tva_number TEXT,
      logo_path TEXT, rib TEXT,
      conditions_paiement  TEXT DEFAULT '30 jours',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS fact_clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      nom TEXT NOT NULL, prenom TEXT, entreprise TEXT,
      adresse TEXT, code_postal TEXT, ville TEXT, email TEXT, telephone TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS devis (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      client_id      INTEGER,
      numero         TEXT NOT NULL,
      date_creation  TEXT DEFAULT (date('now')),
      statut         TEXT DEFAULT 'brouillon',
      total_ht       REAL DEFAULT 0,
      total_tva      REAL DEFAULT 0,
      total_ttc      REAL DEFAULT 0,
      notes          TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)   REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES fact_clients(id)
    );

    CREATE TABLE IF NOT EXISTS lignes_devis (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      devis_id          INTEGER NOT NULL,
      description       TEXT    NOT NULL,
      quantite          REAL DEFAULT 1,
      prix_unitaire_ht  REAL DEFAULT 0,
      tva_taux          REAL DEFAULT 20,
      total_ht          REAL DEFAULT 0,
      total_tva         REAL DEFAULT 0,
      total_ttc         REAL DEFAULT 0,
      FOREIGN KEY (devis_id) REFERENCES devis(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════
    --  APP : STOCK
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS categories (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL,
      nom      TEXT NOT NULL,
      couleur  TEXT DEFAULT '#5D288F',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS produits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      nom            TEXT    NOT NULL,
      sku            TEXT,
      categorie_id   INTEGER,
      prix_ht        REAL    DEFAULT 0,
      tva            REAL    DEFAULT 20,
      stock_actuel   INTEGER DEFAULT 0,
      stock_minimum  INTEGER DEFAULT 5,
      photo_url      TEXT,
      archive        INTEGER DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)      REFERENCES users(id),
      FOREIGN KEY (categorie_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      produit_id  INTEGER NOT NULL,
      type        TEXT    NOT NULL,
      quantite    INTEGER NOT NULL,
      stock_avant INTEGER,
      stock_apres INTEGER,
      note        TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)    REFERENCES users(id),
      FOREIGN KEY (produit_id) REFERENCES produits(id)
    );

    CREATE TABLE IF NOT EXISTS stock_clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      nom       TEXT NOT NULL,
      email     TEXT,
      telephone TEXT,
      adresse   TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS commandes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      numero           TEXT    NOT NULL,
      client_id        INTEGER,
      statut           TEXT    DEFAULT 'en_attente',
      mode_paiement    TEXT,
      statut_paiement  TEXT    DEFAULT 'impayé',
      total_ht         REAL    DEFAULT 0,
      total_ttc        REAL    DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)   REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES stock_clients(id)
    );

    CREATE TABLE IF NOT EXISTS lignes_commande (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      commande_id      INTEGER NOT NULL,
      produit_id       INTEGER,
      nom_produit      TEXT    NOT NULL,
      quantite         INTEGER DEFAULT 1,
      prix_unitaire_ht REAL    DEFAULT 0,
      tva              REAL    DEFAULT 20,
      remise           REAL    DEFAULT 0,
      FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id)  REFERENCES produits(id)
    );

    CREATE TABLE IF NOT EXISTS livraisons (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      commande_id       INTEGER NOT NULL,
      livreur_nom       TEXT,
      statut            TEXT DEFAULT 'preparee',
      adresse_livraison TEXT,
      date_prevue       TEXT,
      date_livraison    TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)      REFERENCES users(id),
      FOREIGN KEY (commande_id)  REFERENCES commandes(id)
    );

    -- ═══════════════════════════════════════
    --  APP : RECETTES
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      type           TEXT    NOT NULL,
      amount         REAL    NOT NULL,
      category       TEXT,
      description    TEXT,
      payment_method TEXT,
      date           TEXT    NOT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL UNIQUE,
      opening_balance REAL    DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ═══════════════════════════════════════
    --  APP : POINTAGE
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS employees (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      prenom         TEXT    NOT NULL,
      nom            TEXT    NOT NULL,
      heures_contrat REAL    DEFAULT 35,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pointages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      type        TEXT    NOT NULL,
      timestamp   DATETIME NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)     REFERENCES users(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════
    --  APP : FLOTTEPÉI
    -- ═══════════════════════════════════════

    CREATE TABLE IF NOT EXISTS fp_vehicules (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      immatriculation  TEXT    NOT NULL,
      marque           TEXT    NOT NULL,
      modele           TEXT    NOT NULL,
      annee            INTEGER,
      km_actuel        INTEGER DEFAULT 0,
      statut           TEXT    DEFAULT 'disponible',
      date_ct          TEXT,
      date_revision    TEXT,
      date_assurance   TEXT,
      notes            TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS fp_chauffeurs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      nom             TEXT    NOT NULL,
      prenom          TEXT    NOT NULL,
      numero_permis   TEXT,
      validite_permis TEXT,
      actif           INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS fp_trajets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      vehicule_id  INTEGER NOT NULL,
      chauffeur_id INTEGER,
      date         TEXT    NOT NULL,
      depart       TEXT    NOT NULL,
      arrivee      TEXT    NOT NULL,
      km_debut     INTEGER NOT NULL,
      km_fin       INTEGER NOT NULL,
      km_parcourus INTEGER NOT NULL DEFAULT 0,
      motif        TEXT    DEFAULT 'pro',
      description  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)      REFERENCES users(id),
      FOREIGN KEY (vehicule_id)  REFERENCES fp_vehicules(id)  ON DELETE CASCADE,
      FOREIGN KEY (chauffeur_id) REFERENCES fp_chauffeurs(id)
    );

    CREATE TABLE IF NOT EXISTS fp_carburant (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      vehicule_id INTEGER NOT NULL,
      date        TEXT    NOT NULL,
      litres      REAL    NOT NULL,
      prix_litre  REAL    NOT NULL,
      montant     REAL    NOT NULL,
      station     TEXT,
      km_compteur INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)     REFERENCES users(id),
      FOREIGN KEY (vehicule_id) REFERENCES fp_vehicules(id) ON DELETE CASCADE
    );
  `);

  _migrate(_db);
  _seedSuperAdmin(_db);
  console.log('✅ Base de données initialisée (sql.js / WebAssembly)');
}

// ── Migrations (colonnes ajoutées dans les premières versions) ────────────────

function _migrate (db) {
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

// ── Seed Super Admin ──────────────────────────────────────────────────────────

function _seedSuperAdmin (db) {
  const email    = process.env.ADMIN_EMAIL    || 'admin@portail.fr';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';

  const existing = db.prepare("SELECT id FROM users WHERE role='superadmin'").get();
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`INSERT INTO users (email, password_hash, role, name, active)
                VALUES (?, ?, 'superadmin', 'Super Admin', 1)`)
      .run(email, hash);
    console.log(`✅ Super Admin créé : ${email} / ${password}`);
  }

  /* Garantit que toutes les sociétés ont leurs lignes tenant_apps */
  const ALL_APPS   = ['facturation', 'stock', 'recettes', 'pointage', 'flottepei'];
  const companies  = db.prepare("SELECT id FROM users WHERE role='admin' AND company_id IS NULL").all();
  const ins        = db.prepare('INSERT OR IGNORE INTO tenant_apps (user_id, app_slug, active) VALUES (?,?,0)');
  companies.forEach(c => ALL_APPS.forEach(slug => ins.run(c.id, slug)));
}

/** Force la persistance sur disque (utile après des écritures multiples) */
function persistDB () {
  if (!_db) return;
  _db._persist();
}

module.exports = { getDB, initDB, persistDB };
