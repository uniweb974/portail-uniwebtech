# 🚀 Portail Unifié — Applications Métier

Portail Node.js unifiant 4 applications en un seul serveur avec authentification JWT partagée et gestion multi-tenant.

## Applications intégrées

| App | URL | Description |
|-----|-----|-------------|
| 🧾 Facturation & Devis | `/app/facturation` | Clients, devis, lignes, export PDF |
| 📦 Gestion Stock | `/app/stock` | Produits, commandes, livraisons, catégories |
| 📒 Livre des Recettes | `/app/recettes` | Comptabilité association, export PDF |
| ✅ Pointage | `/app/pointage` | Salariés, pointages, récap hebdo, CSV |

## Stack technique

- **Backend** : Node.js + Express
- **Base de données** : SQLite (better-sqlite3)
- **Auth** : JWT en cookie httpOnly
- **PDF** : pdfkit
- **Frontend** : HTML/CSS/JS vanilla

## Installation locale

```bash
cd PORTAIL
npm install
cp .env.example .env
# Éditez .env avec vos valeurs
node server.js
```

Accès : http://localhost:3010

## Comptes par défaut

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Super Admin | `admin@portail.fr` | `Admin123!` |

*(Modifiables dans `.env` avant le premier démarrage)*

## Super Admin `/admin`

- Créer des clients (email + mot de passe)
- Activer/désactiver chaque app par client
- Gérer les plans et l'accès

## Structure des fichiers

```
PORTAIL/
├── server.js               # Point d'entrée
├── db/database.js          # Schéma SQLite + seed
├── middleware/
│   ├── auth.js             # Vérification JWT
│   └── checkApp.js         # Contrôle accès app
├── routes/
│   ├── auth.js             # Login / logout / me
│   ├── admin.js            # Super admin CRUD
│   ├── dashboard.js        # Apps activées
│   └── apps/               # Routes métier
│       ├── facturation.js
│       ├── stock.js
│       ├── recettes.js
│       └── pointage.js
└── public/
    ├── login.html
    ├── dashboard.html
    ├── admin.html
    ├── apps/               # SPA de chaque app
    ├── css/style.css       # Thème unifié
    └── js/
        ├── api.js          # Fetch helper partagé
        ├── main.js         # Utilitaires partagés
        └── apps/           # JS de chaque app
```

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `3010` |
| `JWT_SECRET` | Secret de signature JWT | — |
| `ADMIN_EMAIL` | Email du super admin | `admin@portail.fr` |
| `ADMIN_PASSWORD` | Mot de passe admin | `Admin123!` |
| `DB_PATH` | Chemin de la base SQLite | `./data/portail.db` |
