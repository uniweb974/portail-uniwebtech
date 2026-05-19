/* ── FACTURATION APP ─────────────────────────────────────────────────────── */

const BASE = '/api/app/facturation';
let clients = [], devisList = [], entreprise = {};
let IS_ADMIN = false;

function navTo(section) {
  document.querySelector(`[data-section="${section}"]`)?.click();
}

async function init() {
  const user = await checkAuth();
  if (!user) return;
  IS_ADMIN = applyRoleVisibility(user.role);
  displayUser(user);
  initNav('dashboard');
  await Promise.all([loadDashboard(), loadClients(), loadDevis(), loadParametres()]);

  document.getElementById('param-form').addEventListener('submit', saveParametres);
  document.querySelector('[data-section="clients"]').addEventListener('click', loadClients);
  document.querySelector('[data-section="devis"]').addEventListener('click', loadDevis);
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const data = await api.get(`${BASE}/stats`);
  if (!data) return;

  const statMap = { brouillon: 0, 'envoyé': 0, accepté: 0, refusé: 0 };
  let totalTTC = 0;
  data.counts.forEach(c => { statMap[c.statut] = c.n; if (c.total) totalTTC += c.total; });

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card"><div class="stat-icon">📄</div><div class="stat-label">Total devis</div>
      <div class="stat-value">${Object.values(statMap).reduce((a,b)=>a+b,0)}</div></div>
    <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-label">Acceptés</div>
      <div class="stat-value text-secondary">${statMap.accepté}</div></div>
    <div class="stat-card"><div class="stat-icon">📤</div><div class="stat-label">Envoyés</div>
      <div class="stat-value text-accent">${statMap['envoyé']}</div></div>
    <div class="stat-card"><div class="stat-icon">💶</div><div class="stat-label">CA accepté</div>
      <div class="stat-value">${fmtEuros(totalTTC)}</div></div>
  `;

  const recentEl = document.getElementById('recent-devis');
  if (!data.recent.length) {
    recentEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><h3>Aucun devis</h3><p>Créez votre premier devis</p></div>';
    return;
  }
  recentEl.innerHTML = `<div class="table-wrap"><table><thead><tr><th>N°</th><th>Client</th><th>Statut</th><th>Total TTC</th><th></th></tr></thead><tbody>
    ${data.recent.map(d => `<tr>
      <td><strong>${d.numero}</strong></td>
      <td>${d.client_nom || '<em style="color:var(--text-d)">Sans client</em>'}</td>
      <td>${devisBadge(d.statut)}</td>
      <td>${fmtEuros(d.total_ttc)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewDevis(${d.id})">Voir</button></td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

// ── CLIENTS ──────────────────────────────────────────────────────────────────

async function loadClients() {
  clients = await api.get(`${BASE}/clients`) || [];
  const tbody = document.getElementById('clients-body');
  if (!clients.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👥</div><h3>Aucun client</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = clients.map(c => `<tr>
    <td><strong>${c.nom}</strong>${c.prenom ? ' ' + c.prenom : ''}</td>
    <td>${c.entreprise || '-'}</td>
    <td>${c.email || '-'}</td>
    <td>${c.telephone || '-'}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openClientModal(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.id},'${c.nom}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openClientModal(id) {
  const c = id ? clients.find(x => x.id === id) : null;
  Modal.open({
    title: c ? '✏️ Modifier client' : '➕ Nouveau client',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Nom *</label><input class="form-control" id="cl-nom" value="${c?.nom||''}"></div>
        <div class="form-group"><label class="form-label">Prénom</label><input class="form-control" id="cl-prenom" value="${c?.prenom||''}"></div>
        <div class="form-group"><label class="form-label">Entreprise</label><input class="form-control" id="cl-entreprise" value="${c?.entreprise||''}"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="cl-email" type="email" value="${c?.email||''}"></div>
        <div class="form-group"><label class="form-label">Téléphone</label><input class="form-control" id="cl-telephone" value="${c?.telephone||''}"></div>
        <div class="form-group"><label class="form-label">Adresse</label><input class="form-control" id="cl-adresse" value="${c?.adresse||''}"></div>
        <div class="form-group"><label class="form-label">Code postal</label><input class="form-control" id="cl-cp" value="${c?.code_postal||''}"></div>
        <div class="form-group"><label class="form-label">Ville</label><input class="form-control" id="cl-ville" value="${c?.ville||''}"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveClient(${id||'null'})">Enregistrer</button>`
  });
}

async function saveClient(id) {
  const data = {
    nom: document.getElementById('cl-nom').value.trim(),
    prenom: document.getElementById('cl-prenom').value,
    entreprise: document.getElementById('cl-entreprise').value,
    email: document.getElementById('cl-email').value,
    telephone: document.getElementById('cl-telephone').value,
    adresse: document.getElementById('cl-adresse').value,
    code_postal: document.getElementById('cl-cp').value,
    ville: document.getElementById('cl-ville').value
  };
  if (!data.nom) return toast('Nom requis', 'error');
  const res = id ? await api.put(`${BASE}/clients/${id}`, data) : await api.post(`${BASE}/clients`, data);
  if (res?.success) { Modal.close(); toast('Client enregistré', 'success'); await loadClients(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteClient(id, nom) {
  confirm(`Supprimer le client "${nom}" ?`, async () => {
    const res = await api.del(`${BASE}/clients/${id}`);
    if (res?.success) { toast('Client supprimé', 'success'); await loadClients(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── DEVIS ────────────────────────────────────────────────────────────────────

async function loadDevis() {
  devisList = await api.get(`${BASE}/devis`) || [];
  renderDevis();
}

function renderDevis() {
  const filtre = document.getElementById('filter-statut')?.value;
  const list = filtre ? devisList.filter(d => d.statut === filtre) : devisList;
  const tbody = document.getElementById('devis-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📄</div><h3>Aucun devis</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(d => `<tr>
    <td><strong>${d.numero}</strong></td>
    <td>${d.client_nom ? (d.client_prenom ? d.client_prenom + ' ' : '') + d.client_nom : '<em style="color:var(--text-d)">—</em>'}</td>
    <td>${fmtDate(d.date_creation)}</td>
    <td>${devisBadge(d.statut)}</td>
    <td>${fmtEuros(d.total_ttc)}</td>
    <td><div class="td-actions">
      <button class="btn btn-ghost btn-sm" onclick="viewDevis(${d.id})">👁</button>
      <button class="btn btn-accent btn-sm" onclick="downloadPDF(${d.id},'${d.numero}')">PDF</button>
      ${IS_ADMIN ? `<button class="btn btn-danger btn-sm" onclick="deleteDevis(${d.id},'${d.numero}')">🗑️</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openDevisModal(id) {
  const d = id ? devisList.find(x => x.id === id) : null;
  const clientOptions = clients.map(c =>
    `<option value="${c.id}" ${d?.client_id===c.id?'selected':''}>
      ${c.prenom ? c.prenom+' ':''} ${c.nom}${c.entreprise?' — '+c.entreprise:''}
    </option>`).join('');

  Modal.open({
    title: d ? `✏️ Modifier ${d.numero}` : '➕ Nouveau devis',
    large: true,
    body: `
      <div class="form-grid mb-2">
        <div class="form-group"><label class="form-label">Client</label>
          <select class="form-control" id="dv-client"><option value="">Sans client</option>${clientOptions}</select></div>
        <div class="form-group"><label class="form-label">Date</label>
          <input class="form-control" id="dv-date" type="date" value="${d?.date_creation||new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label class="form-label">Statut</label>
          <select class="form-control" id="dv-statut">
            <option value="brouillon" ${d?.statut==='brouillon'?'selected':''}>Brouillon</option>
            <option value="envoyé" ${d?.statut==='envoyé'?'selected':''}>Envoyé</option>
            <option value="accepté" ${d?.statut==='accepté'?'selected':''}>Accepté</option>
            <option value="refusé" ${d?.statut==='refusé'?'selected':''}>Refusé</option>
          </select></div>
      </div>
      <div class="form-group mb-2"><label class="form-label">Notes</label>
        <input class="form-control" id="dv-notes" value="${d?.notes||''}" placeholder="Conditions, remarques…"></div>

      <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:.85rem">Lignes du devis</strong>
        <button class="btn btn-ghost btn-sm" onclick="addLigne()">+ Ligne</button>
      </div>
      <div id="lignes-container" style="margin-bottom:8px"></div>
      <div style="text-align:right;font-size:.9rem;color:var(--text-m)">
        HT : <strong id="tot-ht">0,00 €</strong> · TVA : <strong id="tot-tva">0,00 €</strong> ·
        <span style="color:var(--accent)">TTC : <strong id="tot-ttc">0,00 €</strong></span>
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveDevis(${id||'null'})">Enregistrer</button>`,
    onOpen: () => {
      if (d) {
        api.get(`${BASE}/devis/${d.id}`).then(full => {
          if (full?.lignes) full.lignes.forEach(l => addLigne(l));
        });
      } else {
        addLigne();
      }
    }
  });
}

function addLigne(l = {}) {
  const container = document.getElementById('lignes-container');
  const idx = Date.now() + Math.random();
  const div = document.createElement('div');
  div.className = 'ligne-row';
  div.dataset.idx = idx;
  div.innerHTML = `
    <input class="form-control" placeholder="Description" value="${l.description||''}" data-field="description">
    <input class="form-control" type="number" placeholder="Qté" value="${l.quantite||1}" min="0" step="0.01" data-field="quantite">
    <input class="form-control" type="number" placeholder="PU HT €" value="${l.prix_unitaire_ht||0}" min="0" step="0.01" data-field="prix">
    <input class="form-control" type="number" placeholder="TVA %" value="${l.tva_taux||20}" min="0" max="100" data-field="tva">
    <button class="btn btn-danger btn-sm btn-icon" onclick="this.closest('.ligne-row').remove();calcTotaux()">✕</button>
  `;
  div.querySelectorAll('input').forEach(i => i.addEventListener('input', calcTotaux));
  container.appendChild(div);
  calcTotaux();
}

function calcTotaux() {
  let ht = 0, tva = 0;
  document.querySelectorAll('.ligne-row').forEach(row => {
    const qty = parseFloat(row.querySelector('[data-field="quantite"]')?.value) || 0;
    const pu = parseFloat(row.querySelector('[data-field="prix"]')?.value) || 0;
    const t = parseFloat(row.querySelector('[data-field="tva"]')?.value) || 0;
    const lineHT = qty * pu;
    ht += lineHT; tva += lineHT * t / 100;
  });
  document.getElementById('tot-ht').textContent = fmtEuros(ht);
  document.getElementById('tot-tva').textContent = fmtEuros(tva);
  document.getElementById('tot-ttc').textContent = fmtEuros(ht + tva);
}

function getLignes() {
  return [...document.querySelectorAll('.ligne-row')].map(row => ({
    description: row.querySelector('[data-field="description"]').value,
    quantite: parseFloat(row.querySelector('[data-field="quantite"]').value) || 1,
    prix_unitaire_ht: parseFloat(row.querySelector('[data-field="prix"]').value) || 0,
    tva_taux: parseFloat(row.querySelector('[data-field="tva"]').value) || 20
  })).filter(l => l.description);
}

async function saveDevis(id) {
  const data = {
    client_id: document.getElementById('dv-client').value || null,
    date_creation: document.getElementById('dv-date').value,
    statut: document.getElementById('dv-statut').value,
    notes: document.getElementById('dv-notes').value,
    lignes: getLignes()
  };
  const res = id ? await api.put(`${BASE}/devis/${id}`, data) : await api.post(`${BASE}/devis`, data);
  if (res?.success) {
    Modal.close();
    toast(id ? 'Devis mis à jour' : `Devis ${res.numero} créé`, 'success');
    await loadDevis();
    await loadDashboard();
  } else toast(res?.error || 'Erreur', 'error');
}

async function viewDevis(id) {
  const d = devisList.find(x => x.id === id);
  if (d) openDevisModal(id);
}

function downloadPDF(id, numero) {
  window.open(`${BASE}/devis/${id}/pdf`, '_blank');
}

async function deleteDevis(id, numero) {
  confirm(`Supprimer le devis ${numero} ?`, async () => {
    const res = await api.del(`${BASE}/devis/${id}`);
    if (res?.success) { toast('Devis supprimé', 'success'); await loadDevis(); await loadDashboard(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── PARAMÈTRES ────────────────────────────────────────────────────────────────

async function loadParametres() {
  entreprise = await api.get(`${BASE}/parametres`) || {};
  const form = document.getElementById('param-form');
  Object.keys(entreprise).forEach(k => {
    const el = form.querySelector(`[name="${k}"]`);
    if (el) el.value = entreprise[k] || '';
  });
}

async function saveParametres(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const res = await api.put(`${BASE}/parametres`, data);
  if (res?.success) toast('Paramètres enregistrés', 'success');
  else toast(res?.error || 'Erreur', 'error');
}

init();
