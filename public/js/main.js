/* Utilitaires partagés du portail */

// ── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ── MODAL ────────────────────────────────────────────────────────────────────
const Modal = {
  _overlay: null,
  _modal: null,
  _locked: false,   // true pendant une requête → empêche fermeture par clic overlay

  _ensure() {
    if (!this._overlay) {
      this._overlay = document.createElement('div');
      this._overlay.className = 'modal-overlay hidden';
      this._modal = document.createElement('div');
      this._modal.className = 'modal';
      this._overlay.appendChild(this._modal);
      document.body.appendChild(this._overlay);
      this._overlay.addEventListener('click', e => { if (e.target === this._overlay && !this._locked) this.close(); });
    }
  },

  open({ title, body, footer, large = false, onOpen }) {
    this._ensure();
    this._modal.className = 'modal' + (large ? ' modal-lg' : '');
    this._modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${title}</h2>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    `;
    this._overlay.classList.remove('hidden');
    if (onOpen) onOpen(this._modal);
  },

  close() {
    if (this._overlay) this._overlay.classList.add('hidden');
  }
};

// ── CONFIRM ──────────────────────────────────────────────────────────────────
function confirm(msg, onYes) {
  Modal.open({
    title: 'Confirmation',
    body: `<p>${msg}</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
      <button class="btn btn-danger" id="confirm-yes">Confirmer</button>
    `
  });
  document.getElementById('confirm-yes').onclick = () => { Modal.close(); onYes(); };
}

// ── NAVIGATION SECTIONS ───────────────────────────────────────────────────────
function initNav(defaultSection) {
  const items = document.querySelectorAll('.nav-item[data-section]');
  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      const sectionId = 'section-' + item.dataset.section;
      document.getElementById(sectionId)?.classList.add('active');
    });
  });
  if (defaultSection) {
    document.querySelector(`[data-section="${defaultSection}"]`)?.click();
  } else {
    items[0]?.click();
  }
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function logout() {
  await api.post('/api/auth/logout', {});
  window.location.href = '/login';
}

// ── FORMATTERS ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('fr-FR');
}

function fmtDatetime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtEuros(n) { return `${fmt(n)} €`; }

// ── AUTH CHECK ────────────────────────────────────────────────────────────────
// Vérifie l'authentification et retourne l'utilisateur.
// onlySuperAdmin=true → réservé au super admin.
// Sans argument → tout utilisateur connecté (admin, user) est accepté.
async function checkAuth(onlySuperAdmin) {
  const user = await api.get('/api/auth/me');

  // Non connecté → login (sans boucle)
  if (!user || user.error) {
    if (window.location.pathname !== '/login') window.location.href = '/login';
    return null;
  }

  // Superadmin sur une page app → renvoyer vers /admin
  if (user.role === 'superadmin' && !onlySuperAdmin) {
    window.location.href = '/admin';
    return null;
  }

  // Page réservée au superadmin → vérifier
  if (onlySuperAdmin && user.role !== 'superadmin') {
    window.location.href = '/dashboard';
    return null;
  }

  return user;
}

// ── DISPLAY USER NAME ─────────────────────────────────────────────────────────
function displayUser(user, el = '#user-name') {
  const target = document.querySelector(el);
  if (target) target.textContent = user.name;
}

// ── BADGE HELPERS ─────────────────────────────────────────────────────────────
function devisBadge(statut) {
  const map = {
    brouillon: 'neutral', 'envoyé': 'accent', accepté: 'success', refusé: 'danger'
  };
  return `<span class="badge badge-${map[statut] || 'neutral'}">${statut}</span>`;
}

function commandeBadge(statut) {
  const map = {
    en_attente: 'warning', confirmée: 'accent', en_preparation: 'primary',
    expédiée: 'secondary', livrée: 'success', annulée: 'danger'
  };
  return `<span class="badge badge-${map[statut] || 'neutral'}">${statut.replace('_', ' ')}</span>`;
}

function paiementBadge(statut) {
  const map = { payé: 'success', partiel: 'warning', impayé: 'danger' };
  return `<span class="badge badge-${map[statut] || 'neutral'}">${statut}</span>`;
}

function livraisonBadge(statut) {
  const map = { preparee: 'warning', en_route: 'accent', livree: 'success', echec: 'danger' };
  return `<span class="badge badge-${map[statut] || 'neutral'}">${statut.replace('_', ' ')}</span>`;
}

// ── ROLE VISIBILITY ───────────────────────────────────────────────────────────
// Hides .admin-only elements for non-admin roles. Returns true if user is admin.
function applyRoleVisibility(role) {
  const isAdmin = role === 'admin' || role === 'superadmin';
  if (!isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  return isAdmin;
}

// ── WEEK HELPER ───────────────────────────────────────────────────────────────
function currentWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
