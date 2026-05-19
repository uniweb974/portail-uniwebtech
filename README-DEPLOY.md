# 🚢 Guide de déploiement — Railway + Hostinger

## 1. Préparer le dépôt GitHub

```bash
# Dans le dossier PORTAIL
git init
git add .
git commit -m "Initial commit — Portail Unifié"

# Créer un dépôt sur github.com puis :
git remote add origin https://github.com/VOTRE_USER/portail-unifie.git
git push -u origin main
```

> **Important** : vérifiez que `.env` est bien dans `.gitignore` (il l'est par défaut).

---

## 2. Déployer sur Railway

### a) Créer le projet

1. Allez sur [railway.app](https://railway.app) → **New Project**
2. Choisissez **Deploy from GitHub repo**
3. Sélectionnez votre dépôt `portail-unifie`
4. Railway détecte automatiquement Node.js via `nixpacks`

### b) Configurer les variables d'environnement

Dans Railway → votre service → onglet **Variables**, ajoutez :

| Variable | Valeur |
|----------|--------|
| `JWT_SECRET` | Une chaîne aléatoire longue (ex: `openssl rand -hex 32`) |
| `ADMIN_EMAIL` | `admin@votre-domaine.fr` |
| `ADMIN_PASSWORD` | Un mot de passe fort |
| `NODE_ENV` | `production` |

> `PORT` et `DB_PATH` sont gérés automatiquement par Railway.

### c) Persistance de la base de données

Railway est **éphémère** : le système de fichiers est réinitialisé à chaque déploiement.

**Solution recommandée** : ajouter un **Volume Railway** :

1. Dans Railway → votre projet → **+ New** → **Volume**
2. Montez-le sur `/app/data`
3. Ajoutez la variable `DB_PATH=/app/data/portail.db`

La base SQLite sera alors persistante entre les redéploiements.

### d) Vérifier le déploiement

- Onglet **Deployments** → logs en temps réel
- Vous devriez voir : `🚀 PORTAIL démarré sur http://localhost:PORT`
- Cliquez sur l'URL Railway générée (ex: `portail-unifie.up.railway.app`)

---

## 3. Connecter le domaine Hostinger → app.uniwebtech.fr

### a) Ajouter le domaine custom dans Railway

1. Railway → votre service → onglet **Settings** → **Domains**
2. Cliquez **+ Custom Domain**
3. Entrez : `app.uniwebtech.fr`
4. Railway vous donne un **CNAME cible** (ex: `portail-unifie.up.railway.app`)

### b) Configurer le DNS chez Hostinger

1. Connectez-vous à [hpanel.hostinger.com](https://hpanel.hostinger.com)
2. **Domaines** → `uniwebtech.fr` → **DNS / Nameservers** → **Gérer les DNS**
3. Ajoutez un enregistrement :

| Type | Nom (Host) | Valeur (Points to) | TTL |
|------|------------|-------------------|-----|
| `CNAME` | `app` | `portail-unifie.up.railway.app` | `3600` |

4. Attendez la propagation DNS (5 à 30 minutes)

### c) SSL automatique

Railway génère automatiquement un certificat SSL via Let's Encrypt.
Votre portail sera accessible en HTTPS : `https://app.uniwebtech.fr`

---

## 4. Checklist post-déploiement

- [ ] Accès à `https://app.uniwebtech.fr/login` ✓
- [ ] Connexion Super Admin (email/mot de passe du `.env`) ✓
- [ ] Création d'un premier client ✓
- [ ] Activation des apps pour ce client ✓
- [ ] Test de connexion client → dashboard → app ✓
- [ ] Test export PDF (facturation + recettes) ✓
- [ ] Test export CSV (pointage) ✓
- [ ] Volume Railway monté → données persistent après redéploiement ✓

---

## 5. Mise à jour du portail

```bash
# Après vos modifications en local
git add .
git commit -m "Mise à jour : description"
git push origin main
```

Railway redéploie automatiquement à chaque push sur `main`.

---

## 6. Commandes utiles

```bash
# Démarrer en local
npm start

# Développement (rechargement auto)
npm run dev

# Voir les logs Railway
railway logs

# Ouvrir Railway CLI
npm install -g @railway/cli
railway login
railway link
```
