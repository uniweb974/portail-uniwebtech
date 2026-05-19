/* ── FLOTTEPÉI APP ────────────────────────────────────────────────────────── */

const BASE = '/api/app/flottepei';
let IS_ADMIN  = false;
let vehicules = [], chauffeurs = [];

async function init() {
  const user = await checkAuth();
  if (!user) return;
  IS_ADMIN = applyRoleVisibility(user.role);
  displayUser(user);
  initNav('dashboard');

  await Promise.all([loadDashboard(), loadVehicules(), loadChauffeurs()]);

  document.querySelector('[data-section="vehicules"]').addEventListener('click', loadVehicules);
  document.querySelector('[data-section="carnets"]').addEventListener('click', loadTrajets);
  document.querySelector('[data-section="chauffeurs"]').addEventListener('click', loadChauffeurs);
  document.querySelector('[data-section="carburant"]').addEventListener('click', loadCarburant);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function alerteBadge(dateStr) {
  if (!dateStr) return `<span style="color:var(--text-d)">—</span>`;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 864e5);
  if (diff < 0)   return `<span class="badge badge-danger">⚠️ ${fmtDate(dateStr)}</span>`;
  if (diff <= 30) return `<span class="badge badge-warning">⏰ ${fmtDate(dateStr)} J-${diff}</span>`;
  return `<span class="badge badge-success">${fmtDate(dateStr)}</span>`;
}

function statutBadge(s) {
  const cfg = {
    disponible: ['success',  '🟢 Disponible'],
    en_mission: ['accent',   '🟡 En mission'],
    maintenance:['warning',  '🔴 Maintenance']
  };
  const [cls, lbl] = cfg[s] || ['neutral', s];
  return `<span class="badge badge-${cls}">${lbl}</span>`;
}

function motifBadge(m) {
  return m === 'pro'
    ? '<span class="badge badge-accent">🔵 Pro</span>'
    : '<span class="badge badge-neutral">⚪ Perso</span>';
}

function fillVehiculeSelect(id, val = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">— Choisir un véhicule —</option>` +
    vehicules.map(v => `<option value="${v.id}" ${v.id == val ? 'selected' : ''}>${v.immatriculation} — ${v.marque} ${v.modele}</option>`).join('');
}

function fillChauffeurSelect(id, val = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">— Aucun —</option>` +
    chauffeurs.filter(c => c.actif).map(c => `<option value="${c.id}" ${c.id == val ? 'selected' : ''}>${c.prenom} ${c.nom}</option>`).join('');
}

function updateFiltersVehicules() {
  ['f-vehicule','f-veh-carb'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">Tous les véhicules</option>` +
      vehicules.map(v => `<option value="${v.id}" ${v.id == cur ? 'selected' : ''}>${v.immatriculation} — ${v.marque} ${v.modele}</option>`).join('');
  });
  const fc = document.getElementById('f-chauffeur');
  if (fc) {
    const cur = fc.value;
    fc.innerHTML = `<option value="">Tous les chauffeurs</option>` +
      chauffeurs.map(c => `<option value="${c.id}" ${c.id == cur ? 'selected' : ''}>${c.prenom} ${c.nom}</option>`).join('');
  }
}

// ── TABLEAU DE BORD ───────────────────────────────────────────────────────────

async function loadDashboard() {
  const d = await api.get(`${BASE}/stats`);
  if (!d) return;

  // Badge plan (sidebar)
  const PLAN_LABELS = {
    basic:      'Starter · 49€/mois<br>3 véhicules max',
    pro:        'Pro · 99€/mois<br>10 véhicules max',
    enterprise: 'Business · 179€/mois<br>Véhicules illimités'
  };
  const planEl = document.getElementById('plan-badge');
  if (planEl) {
    const lim = d.planLimit === null || d.planLimit >= 999 ? '∞' : d.planLimit;
    planEl.innerHTML = `${PLAN_LABELS[d.plan] || d.plan}<br>
      <strong style="color:var(--accent)">${d.total_vehicules} / ${lim} véhicule(s)</strong>`;
  }

  // Stat cards
  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">🚗</div>
      <div class="stat-label">Véhicules</div>
      <div class="stat-value">${d.total_vehicules}</div>
      <div class="stat-sub">🟢 ${d.statuts.disponible} · 🟡 ${d.statuts.en_mission} · 🔴 ${d.statuts.maintenance}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">⚠️</div>
      <div class="stat-label">Alertes</div>
      <div class="stat-value ${d.alertes.length > 0 ? 'text-danger' : 'text-secondary'}">${d.alertes.length}</div>
      <div class="stat-sub">CT · Révision · Assurance</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📍</div>
      <div class="stat-label">Km ce mois</div>
      <div class="stat-value">${(d.km_mois || 0).toLocaleString('fr-FR')}</div>
      <div class="stat-sub">kilomètres parcourus</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">⛽</div>
      <div class="stat-label">Carburant ce mois</div>
      <div class="stat-value text-accent">${fmtEuros(d.cout_mois)}</div>
      <div class="stat-sub">coût total</div>
    </div>
  `;

  // Alertes
  const alEl = document.getElementById('alertes-container');
  if (d.alertes.length) {
    alEl.innerHTML = `
      <div class="card mt-2" style="border:1px solid var(--danger);background:rgba(229,62,62,.05)">
        <div class="card-title" style="color:var(--danger);margin-bottom:12px">⚠️ Alertes échéances</div>
        ${d.alertes.map(a => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(229,62,62,.12)">
            <div><strong>${a.vehicule}</strong><span style="color:var(--text-m)"> — ${a.type}</span></div>
            <span class="badge badge-${a.critique ? 'danger' : 'warning'}">${a.critique ? '⚠️ Expiré' : '⏰'} ${fmtDate(a.date)}</span>
          </div>`).join('')}
      </div>`;
  } else {
    alEl.innerHTML = '';
  }

  // Derniers trajets
  const rEl = document.getElementById('recent-trajets');
  if (!d.recent.length) {
    rEl.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🚗</div>
      <h3>Aucun trajet enregistré</h3>
      <p>Ajoutez votre premier trajet dans le carnet de bord</p>
    </div>`;
    return;
  }
  rEl.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Véhicule</th><th>Chauffeur</th><th>Départ → Arrivée</th><th>Km</th><th>Motif</th></tr></thead>
    <tbody>
      ${d.recent.map(t => `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><strong>${t.immatriculation}</strong><br><span style="font-size:.75rem;color:var(--text-m)">${t.marque} ${t.modele}</span></td>
        <td>${t.chauffeur_nom || '<em style="color:var(--text-d)">—</em>'}</td>
        <td>${t.depart} → ${t.arrivee}</td>
        <td><strong>${(t.km_parcourus || 0).toLocaleString('fr-FR')} km</strong></td>
        <td>${motifBadge(t.motif)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── VÉHICULES ─────────────────────────────────────────────────────────────────

async function loadVehicules() {
  vehicules = await api.get(`${BASE}/vehicules`) || [];
  updateFiltersVehicules();
  const tbody = document.getElementById('vehicules-body');
  if (!vehicules.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">🚗</div>
      <h3>Aucun véhicule</h3>
      <p class="admin-only">Cliquez sur "+ Véhicule" pour commencer</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = vehicules.map(v => `<tr>
    <td><strong>${v.immatriculation}</strong></td>
    <td>${v.marque} ${v.modele}${v.annee ? ` <span style="color:var(--text-d)">(${v.annee})</span>` : ''}</td>
    <td>${(v.km_actuel || 0).toLocaleString('fr-FR')} km</td>
    <td>${statutBadge(v.statut)}</td>
    <td>${alerteBadge(v.date_ct)}</td>
    <td>${alerteBadge(v.date_revision)}</td>
    <td>${alerteBadge(v.date_assurance)}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openVehiculeModal(${v.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteVehicule(${v.id},'${v.immatriculation}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openVehiculeModal(id) {
  const v = id ? vehicules.find(x => x.id === id) : null;
  Modal.open({
    title: v ? `✏️ ${v.immatriculation}` : '🚗 Nouveau véhicule',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Immatriculation *</label>
          <input class="form-control" id="veh-immat" value="${v?.immatriculation || ''}" placeholder="AB-123-CD" style="text-transform:uppercase"></div>
        <div class="form-group"><label class="form-label">Marque *</label>
          <input class="form-control" id="veh-marque" value="${v?.marque || ''}" placeholder="Renault"></div>
        <div class="form-group"><label class="form-label">Modèle *</label>
          <input class="form-control" id="veh-modele" value="${v?.modele || ''}" placeholder="Clio"></div>
        <div class="form-group"><label class="form-label">Année</label>
          <input class="form-control" id="veh-annee" type="number" value="${v?.annee || ''}" min="1990" max="2030"></div>
        <div class="form-group"><label class="form-label">Km actuel (compteur)</label>
          <input class="form-control" id="veh-km" type="number" value="${v?.km_actuel || 0}" min="0"></div>
        <div class="form-group"><label class="form-label">Statut</label>
          <select class="form-control" id="veh-statut">
            <option value="disponible"  ${(!v || v.statut === 'disponible')  ? 'selected' : ''}>🟢 Disponible</option>
            <option value="en_mission"  ${v?.statut === 'en_mission'         ? 'selected' : ''}>🟡 En mission</option>
            <option value="maintenance" ${v?.statut === 'maintenance'        ? 'selected' : ''}>🔴 Maintenance</option>
          </select></div>
      </div>
      <div style="margin:14px 0 6px;font-size:.78rem;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.05em">Échéances à surveiller</div>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">🔍 Contrôle technique</label>
          <input class="form-control" id="veh-ct"       type="date" value="${v?.date_ct       || ''}"></div>
        <div class="form-group"><label class="form-label">🔧 Prochaine révision</label>
          <input class="form-control" id="veh-revision" type="date" value="${v?.date_revision || ''}"></div>
        <div class="form-group"><label class="form-label">🛡️ Fin d'assurance</label>
          <input class="form-control" id="veh-assurance" type="date" value="${v?.date_assurance || ''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-control" id="veh-notes" value="${v?.notes || ''}" placeholder="Informations complémentaires…"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveVehicule(${id || 'null'})">Enregistrer</button>`
  });
}

async function saveVehicule(id) {
  const data = {
    immatriculation: document.getElementById('veh-immat').value.trim().toUpperCase(),
    marque:          document.getElementById('veh-marque').value.trim(),
    modele:          document.getElementById('veh-modele').value.trim(),
    annee:           document.getElementById('veh-annee').value       || null,
    km_actuel:       document.getElementById('veh-km').value          || 0,
    statut:          document.getElementById('veh-statut').value,
    date_ct:         document.getElementById('veh-ct').value          || null,
    date_revision:   document.getElementById('veh-revision').value    || null,
    date_assurance:  document.getElementById('veh-assurance').value   || null,
    notes:           document.getElementById('veh-notes').value       || null
  };
  if (!data.immatriculation || !data.marque || !data.modele) return toast('Immatriculation, marque et modèle requis', 'error');
  const res = id ? await api.put(`${BASE}/vehicules/${id}`, data) : await api.post(`${BASE}/vehicules`, data);
  if (res?.success) { Modal.close(); toast('Véhicule enregistré ✅', 'success'); await loadVehicules(); await loadDashboard(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteVehicule(id, immat) {
  confirm(`Supprimer le véhicule ${immat} et tous ses trajets / pleins ?`, async () => {
    const res = await api.del(`${BASE}/vehicules/${id}`);
    if (res?.success) { toast('Véhicule supprimé', 'success'); await loadVehicules(); await loadDashboard(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── CHAUFFEURS ────────────────────────────────────────────────────────────────

async function loadChauffeurs() {
  chauffeurs = await api.get(`${BASE}/chauffeurs`) || [];
  updateFiltersVehicules();
  const tbody = document.getElementById('chauffeurs-body');
  if (!chauffeurs.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-icon">👤</div><h3>Aucun chauffeur</h3>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = chauffeurs.map(c => `<tr>
    <td><strong>${c.prenom} ${c.nom}</strong></td>
    <td>${c.numero_permis || '—'}</td>
    <td>${alerteBadge(c.validite_permis)}</td>
    <td>${c.actif ? '<span class="badge badge-success">Actif</span>' : '<span class="badge badge-danger">Inactif</span>'}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openChauffeurModal(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteChauffeur(${c.id},'${c.prenom} ${c.nom}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openChauffeurModal(id) {
  const c = id ? chauffeurs.find(x => x.id === id) : null;
  Modal.open({
    title: c ? `✏️ ${c.prenom} ${c.nom}` : '👤 Nouveau chauffeur',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Prénom *</label>
          <input class="form-control" id="ch-prenom" value="${c?.prenom || ''}"></div>
        <div class="form-group"><label class="form-label">Nom *</label>
          <input class="form-control" id="ch-nom" value="${c?.nom || ''}"></div>
        <div class="form-group"><label class="form-label">N° Permis</label>
          <input class="form-control" id="ch-permis" value="${c?.numero_permis || ''}"></div>
        <div class="form-group"><label class="form-label">Validité permis</label>
          <input class="form-control" id="ch-validite" type="date" value="${c?.validite_permis || ''}"></div>
      </div>
      ${c ? `<div class="form-group mt-1">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <label class="switch"><input type="checkbox" id="ch-actif" ${c.actif ? 'checked' : ''}><span class="switch-slider"></span></label>
          <span class="form-label" style="margin:0">Chauffeur actif</span>
        </label>
      </div>` : ''}`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveChauffeur(${id || 'null'})">Enregistrer</button>`
  });
}

async function saveChauffeur(id) {
  const prenom = document.getElementById('ch-prenom').value.trim();
  const nom    = document.getElementById('ch-nom').value.trim();
  if (!prenom || !nom) return toast('Prénom et nom requis', 'error');
  const data = {
    prenom, nom,
    numero_permis:   document.getElementById('ch-permis').value    || null,
    validite_permis: document.getElementById('ch-validite').value  || null,
    actif: id ? (document.getElementById('ch-actif')?.checked ? 1 : 0) : 1
  };
  const res = id ? await api.put(`${BASE}/chauffeurs/${id}`, data) : await api.post(`${BASE}/chauffeurs`, data);
  if (res?.success) { Modal.close(); toast('Chauffeur enregistré ✅', 'success'); await loadChauffeurs(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteChauffeur(id, nom) {
  confirm(`Supprimer le chauffeur "${nom}" ?`, async () => {
    const res = await api.del(`${BASE}/chauffeurs/${id}`);
    if (res?.success) { toast('Chauffeur supprimé', 'success'); await loadChauffeurs(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── CARNET DE BORD (TRAJETS) ──────────────────────────────────────────────────

async function loadTrajets() {
  const params = new URLSearchParams({
    vehicule_id:  document.getElementById('f-vehicule')?.value  || '',
    chauffeur_id: document.getElementById('f-chauffeur')?.value || '',
    motif:        document.getElementById('f-motif')?.value     || '',
    from:         document.getElementById('f-from')?.value      || '',
    to:           document.getElementById('f-to')?.value        || ''
  });
  const list  = await api.get(`${BASE}/trajets?${params}`) || [];
  const tbody = document.getElementById('trajets-body');

  // Résumé km
  const kmPro   = list.filter(t => t.motif === 'pro').reduce((a, t) => a + (t.km_parcourus || 0), 0);
  const kmPerso = list.filter(t => t.motif === 'perso').reduce((a, t) => a + (t.km_parcourus || 0), 0);
  const total   = kmPro + kmPerso;
  const statsEl = document.getElementById('carnets-stats');
  if (list.length) {
    statsEl.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap">
      <span class="badge badge-primary">📋 ${list.length} trajet(s)</span>
      <span class="badge badge-accent">🔵 Pro : ${kmPro.toLocaleString('fr-FR')} km ${total ? `(${Math.round(kmPro/total*100)}%)` : ''}</span>
      <span class="badge badge-neutral">⚪ Perso : ${kmPerso.toLocaleString('fr-FR')} km ${total ? `(${Math.round(kmPerso/total*100)}%)` : ''}</span>
      <span class="badge badge-success">Total : ${total.toLocaleString('fr-FR')} km</span>
    </div>`;
  } else { statsEl.innerHTML = ''; }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">📋</div><h3>Aucun trajet</h3>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(t => `<tr>
    <td>${fmtDate(t.date)}</td>
    <td><strong>${t.immatriculation}</strong><br><span style="font-size:.75rem;color:var(--text-m)">${t.marque} ${t.modele}</span></td>
    <td>${t.chauffeur_nom || '<em style="color:var(--text-d)">—</em>'}</td>
    <td>${t.depart}</td>
    <td>${t.arrivee}</td>
    <td><strong>${(t.km_parcourus || 0).toLocaleString('fr-FR')} km</strong></td>
    <td>${motifBadge(t.motif)}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `<button class="btn btn-danger btn-sm" onclick="deleteTrajet(${t.id})">🗑️</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openTrajetModal() {
  const today = new Date().toISOString().split('T')[0];
  Modal.open({
    title: '📋 Enregistrer un trajet',
    large: true,
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Véhicule *</label>
          <select class="form-control" id="tr-vehicule">
            <option value="">— Choisir —</option>
            ${vehicules.map(v => `<option value="${v.id}">${v.immatriculation} — ${v.marque} ${v.modele}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Chauffeur</label>
          <select class="form-control" id="tr-chauffeur">
            <option value="">— Aucun —</option>
            ${chauffeurs.filter(c => c.actif).map(c => `<option value="${c.id}">${c.prenom} ${c.nom}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Date *</label>
          <input class="form-control" id="tr-date" type="date" value="${today}"></div>
        <div class="form-group"><label class="form-label">Motif *</label>
          <select class="form-control" id="tr-motif">
            <option value="pro">🔵 Professionnel (URSSAF)</option>
            <option value="perso">⚪ Personnel</option>
          </select></div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Lieu de départ *</label>
          <input class="form-control" id="tr-depart" placeholder="Saint-Denis"></div>
        <div class="form-group"><label class="form-label">Lieu d'arrivée *</label>
          <input class="form-control" id="tr-arrivee" placeholder="Saint-Pierre"></div>
        <div class="form-group"><label class="form-label">Km compteur départ *</label>
          <input class="form-control" id="tr-km-deb" type="number" min="0" placeholder="12 345" oninput="calcKm()"></div>
        <div class="form-group"><label class="form-label">Km compteur arrivée *</label>
          <input class="form-control" id="tr-km-fin" type="number" min="0" placeholder="12 400" oninput="calcKm()"></div>
      </div>
      <div id="tr-km-calc" style="text-align:right;font-size:.9rem;min-height:20px;margin-bottom:8px"></div>
      <div class="form-group"><label class="form-label">Description / motif détaillé</label>
        <input class="form-control" id="tr-desc" placeholder="Visite client, livraison, réunion…"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveTrajet()">Enregistrer</button>`
  });
}

function calcKm() {
  const d  = parseInt(document.getElementById('tr-km-deb')?.value) || 0;
  const f  = parseInt(document.getElementById('tr-km-fin')?.value) || 0;
  const el = document.getElementById('tr-km-calc');
  if (!el) return;
  if (f > d)   el.innerHTML = `<span style="color:var(--secondary)">✅ ${(f - d).toLocaleString('fr-FR')} km parcourus</span>`;
  else if (f && d) el.innerHTML = `<span style="color:var(--danger)">⚠️ Km arrivée doit être supérieur au km départ</span>`;
  else el.textContent = '';
}

async function saveTrajet() {
  const data = {
    vehicule_id:  document.getElementById('tr-vehicule').value,
    chauffeur_id: document.getElementById('tr-chauffeur').value || null,
    date:         document.getElementById('tr-date').value,
    depart:       document.getElementById('tr-depart').value.trim(),
    arrivee:      document.getElementById('tr-arrivee').value.trim(),
    km_debut:     parseInt(document.getElementById('tr-km-deb').value) || 0,
    km_fin:       parseInt(document.getElementById('tr-km-fin').value) || 0,
    motif:        document.getElementById('tr-motif').value,
    description:  document.getElementById('tr-desc').value || null
  };
  if (!data.vehicule_id)                     return toast('Sélectionnez un véhicule', 'error');
  if (!data.date || !data.depart || !data.arrivee) return toast('Date, départ et arrivée requis', 'error');
  if (data.km_fin < data.km_debut)           return toast('Km arrivée doit être ≥ km départ', 'error');
  const res = await api.post(`${BASE}/trajets`, data);
  if (res?.success) { Modal.close(); toast('Trajet enregistré ✅', 'success'); await loadTrajets(); await loadDashboard(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteTrajet(id) {
  confirm('Supprimer ce trajet du carnet de bord ?', async () => {
    const res = await api.del(`${BASE}/trajets/${id}`);
    if (res?.success) { toast('Trajet supprimé', 'success'); await loadTrajets(); await loadDashboard(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

function exportCarnet() {
  const vehicule_id = document.getElementById('f-vehicule')?.value || '';
  const from        = document.getElementById('f-from')?.value     || '';
  const to          = document.getElementById('f-to')?.value       || '';
  window.open(`${BASE}/trajets/pdf?vehicule_id=${vehicule_id}&from=${from}&to=${to}`, '_blank');
}

// ── CARBURANT ─────────────────────────────────────────────────────────────────

async function loadCarburant() {
  const vehicule_id = document.getElementById('f-veh-carb')?.value || '';
  const list  = await api.get(`${BASE}/carburant?vehicule_id=${vehicule_id}`) || [];
  const tbody = document.getElementById('carburant-body');

  const totalMontant = list.reduce((a, c) => a + (c.montant || 0), 0);
  const totalLitres  = list.reduce((a, c) => a + (c.litres  || 0), 0);
  const el = document.getElementById('carburant-stats');
  if (list.length) {
    el.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap">
      <span class="badge badge-accent">⛽ ${list.length} plein(s)</span>
      <span class="badge badge-primary">${fmt(totalLitres, 1)} L</span>
      <span class="badge badge-success">${fmtEuros(totalMontant)}</span>
      ${totalLitres > 0 ? `<span class="badge badge-neutral">Moy. ${fmtEuros(totalMontant / totalLitres)}/L</span>` : ''}
    </div>`;
  } else { el.innerHTML = ''; }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">⛽</div><h3>Aucun plein enregistré</h3>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => `<tr>
    <td>${fmtDate(c.date)}</td>
    <td><strong>${c.immatriculation}</strong> ${c.marque}</td>
    <td>${c.station || '—'}</td>
    <td>${fmt(c.litres, 2)} L</td>
    <td>${fmt(c.prix_litre, 3)} €</td>
    <td><strong>${fmtEuros(c.montant)}</strong></td>
    <td>${c.km_compteur ? c.km_compteur.toLocaleString('fr-FR') + ' km' : '—'}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `<button class="btn btn-danger btn-sm" onclick="deleteCarburant(${c.id})">🗑️</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openCarburantModal() {
  const today = new Date().toISOString().split('T')[0];
  Modal.open({
    title: '⛽ Enregistrer un plein',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Véhicule *</label>
          <select class="form-control" id="carb-vehicule">
            <option value="">— Choisir —</option>
            ${vehicules.map(v => `<option value="${v.id}">${v.immatriculation} — ${v.marque} ${v.modele}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Date *</label>
          <input class="form-control" id="carb-date" type="date" value="${today}"></div>
        <div class="form-group"><label class="form-label">Litres *</label>
          <input class="form-control" id="carb-litres" type="number" step="0.01" min="0" placeholder="45.00" oninput="calcCarburant()"></div>
        <div class="form-group"><label class="form-label">Prix au litre (€) *</label>
          <input class="form-control" id="carb-prix" type="number" step="0.001" min="0" placeholder="1.89" oninput="calcCarburant()"></div>
        <div class="form-group"><label class="form-label">Station / pompe</label>
          <input class="form-control" id="carb-station" placeholder="Total, Carrefour, SARA…"></div>
        <div class="form-group"><label class="form-label">Km compteur</label>
          <input class="form-control" id="carb-km" type="number" min="0" placeholder="12 450"></div>
      </div>
      <div id="carb-calc" style="text-align:right;font-size:1rem;font-weight:700;color:var(--accent);min-height:22px"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveCarburant()">Enregistrer</button>`
  });
}

function calcCarburant() {
  const l  = parseFloat(document.getElementById('carb-litres')?.value) || 0;
  const p  = parseFloat(document.getElementById('carb-prix')?.value)   || 0;
  const el = document.getElementById('carb-calc');
  if (el) el.textContent = l && p ? `Total : ${fmtEuros(l * p)}` : '';
}

async function saveCarburant() {
  const data = {
    vehicule_id: document.getElementById('carb-vehicule').value,
    date:        document.getElementById('carb-date').value,
    litres:      parseFloat(document.getElementById('carb-litres').value) || 0,
    prix_litre:  parseFloat(document.getElementById('carb-prix').value)   || 0,
    station:     document.getElementById('carb-station').value || null,
    km_compteur: document.getElementById('carb-km').value      || null
  };
  if (!data.vehicule_id)                return toast('Sélectionnez un véhicule', 'error');
  if (!data.date || !data.litres || !data.prix_litre) return toast('Date, litres et prix requis', 'error');
  const res = await api.post(`${BASE}/carburant`, data);
  if (res?.success) { Modal.close(); toast('Plein enregistré ✅', 'success'); await loadCarburant(); await loadDashboard(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteCarburant(id) {
  confirm('Supprimer ce plein ?', async () => {
    const res = await api.del(`${BASE}/carburant/${id}`);
    if (res?.success) { toast('Supprimé', 'success'); await loadCarburant(); await loadDashboard(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

init();
