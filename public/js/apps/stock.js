/* ── STOCK APP ───────────────────────────────────────────────────────────── */

const BASE = '/api/app/stock';
let produits = [], categories = [], stockClients = [], commandes = [];
let IS_ADMIN = false;

async function init() {
  const user = await checkAuth();
  if (!user) return;
  IS_ADMIN = applyRoleVisibility(user.role);
  displayUser(user);
  initNav('dashboard');
  await Promise.all([loadDashboard(), loadCategories(), loadStockClients()]);
  document.querySelector('[data-section="produits"]').addEventListener('click', () => loadProduits());
  document.querySelector('[data-section="commandes"]').addEventListener('click', loadCommandes);
  document.querySelector('[data-section="livraisons"]').addEventListener('click', loadLivraisons);
  document.querySelector('[data-section="categories"]').addEventListener('click', loadCategories);
  document.querySelector('[data-section="clients"]').addEventListener('click', loadStockClients);
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const d = await api.get(`${BASE}/stats`);
  if (!d) return;
  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">Produits</div><div class="stat-value">${d.total_produits}</div></div>
    <div class="stat-card"><div class="stat-icon">⚠️</div><div class="stat-label">Alertes stock</div><div class="stat-value text-danger">${d.alertes}</div></div>
    <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-label">Commandes</div><div class="stat-value">${d.total_commandes}</div></div>
    <div class="stat-card"><div class="stat-icon">💶</div><div class="stat-label">CA ce mois</div><div class="stat-value text-secondary">${fmtEuros(d.ca_mois)}</div></div>
  `;
  const el = document.getElementById('recent-commandes');
  if (!d.recent_commandes?.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><h3>Aucune commande</h3></div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>N°</th><th>Client</th><th>Statut</th><th>Total TTC</th></tr></thead><tbody>
    ${d.recent_commandes.map(c => `<tr>
      <td><strong>${c.numero}</strong></td>
      <td>${c.client_nom || '—'}</td>
      <td>${commandeBadge(c.statut)}</td>
      <td>${fmtEuros(c.total_ttc)}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

// ── CATÉGORIES ────────────────────────────────────────────────────────────────

async function loadCategories() {
  categories = await api.get(`${BASE}/categories`) || [];
  const sel = document.getElementById('filter-categorie');
  if (sel) {
    sel.innerHTML = '<option value="">Toutes catégories</option>' +
      categories.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');
  }
  const tbody = document.getElementById('categories-body');
  if (!tbody) return;
  if (!categories.length) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">🏷️</div><h3>Aucune catégorie</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = categories.map(c => `<tr>
    <td><strong>${c.nom}</strong></td>
    <td><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${c.couleur};vertical-align:middle"></span> ${c.couleur}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openCatModal(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCat(${c.id},'${c.nom}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openCatModal(id) {
  const c = id ? categories.find(x => x.id === id) : null;
  Modal.open({
    title: c ? '✏️ Modifier catégorie' : '➕ Nouvelle catégorie',
    body: `
      <div class="form-group"><label class="form-label">Nom *</label><input class="form-control" id="cat-nom" value="${c?.nom||''}"></div>
      <div class="form-group"><label class="form-label">Couleur</label><input class="form-control" id="cat-couleur" type="color" value="${c?.couleur||'#5D288F'}" style="height:44px;padding:4px"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveCat(${id||'null'})">Enregistrer</button>`
  });
}

async function saveCat(id) {
  const data = { nom: document.getElementById('cat-nom').value.trim(), couleur: document.getElementById('cat-couleur').value };
  if (!data.nom) return toast('Nom requis', 'error');
  const res = id ? await api.put(`${BASE}/categories/${id}`, data) : await api.post(`${BASE}/categories`, data);
  if (res?.success) { Modal.close(); toast('Enregistré', 'success'); await loadCategories(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteCat(id, nom) {
  confirm(`Supprimer la catégorie "${nom}" ?`, async () => {
    const res = await api.del(`${BASE}/categories/${id}`);
    if (res?.success) { toast('Supprimée', 'success'); await loadCategories(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── PRODUITS ──────────────────────────────────────────────────────────────────

async function loadProduits(alertesOnly = false) {
  const search = document.getElementById('search-produit')?.value || '';
  const cat = document.getElementById('filter-categorie')?.value || '';
  let url = `${BASE}/produits?search=${encodeURIComponent(search)}&categorie=${cat}`;
  if (alertesOnly) url += '&alertes=1';
  produits = await api.get(url) || [];
  const tbody = document.getElementById('produits-body');
  if (!produits.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📦</div><h3>Aucun produit</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = produits.map(p => {
    const alerte = p.stock_actuel <= p.stock_minimum;
    return `<tr>
      <td>
        ${p.photo_url ? `<img src="${p.photo_url}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:8px">` : ''}
        <strong>${p.nom}</strong>
      </td>
      <td style="color:var(--text-m)">${p.sku || '—'}</td>
      <td>${p.categorie_nom ? `<span class="badge badge-primary">${p.categorie_nom}</span>` : '—'}</td>
      <td>${fmtEuros(p.prix_ht)}</td>
      <td>
        <span class="${alerte ? 'text-danger' : 'text-secondary'}" style="font-weight:600">${p.stock_actuel}</span>
        <span style="color:var(--text-d);font-size:.75rem"> / min. ${p.stock_minimum}</span>
        ${alerte ? '<span class="badge badge-danger" style="margin-left:4px">⚠️</span>' : ''}
      </td>
      <td><div class="td-actions">
        ${IS_ADMIN ? `<button class="btn btn-ghost btn-sm" onclick="openProduitModal(${p.id})">✏️</button>` : ''}
        <button class="btn btn-accent btn-sm" onclick="openStockModal(${p.id},'${p.nom}')">📊</button>
        ${IS_ADMIN ? `<button class="btn btn-danger btn-sm" onclick="archiveProduit(${p.id},'${p.nom}')">🗑️</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function openProduitModal(id) {
  const p = id ? produits.find(x => x.id === id) : null;
  const catOpts = categories.map(c => `<option value="${c.id}" ${p?.categorie_id===c.id?'selected':''}>${c.nom}</option>`).join('');
  Modal.open({
    title: p ? '✏️ Modifier produit' : '➕ Nouveau produit',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Nom *</label><input class="form-control" id="pr-nom" value="${p?.nom||''}"></div>
        <div class="form-group"><label class="form-label">SKU</label><input class="form-control" id="pr-sku" value="${p?.sku||''}"></div>
        <div class="form-group"><label class="form-label">Catégorie</label>
          <select class="form-control" id="pr-cat"><option value="">Sans catégorie</option>${catOpts}</select></div>
        <div class="form-group"><label class="form-label">Prix HT (€)</label><input class="form-control" id="pr-prix" type="number" step="0.01" value="${p?.prix_ht||0}"></div>
        <div class="form-group"><label class="form-label">TVA (%)</label><input class="form-control" id="pr-tva" type="number" value="${p?.tva||20}"></div>
        <div class="form-group"><label class="form-label">Stock initial</label><input class="form-control" id="pr-stock" type="number" value="${p?.stock_actuel||0}" ${p?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Stock minimum</label><input class="form-control" id="pr-min" type="number" value="${p?.stock_minimum||5}"></div>
      </div>
      <div class="form-group"><label class="form-label">Photo</label><input class="form-control" id="pr-photo" type="file" accept="image/*" style="padding:8px"></div>
    `,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveProduit(${id||'null'})">Enregistrer</button>`
  });
}

async function saveProduit(id) {
  const fd = new FormData();
  fd.append('nom', document.getElementById('pr-nom').value.trim());
  fd.append('sku', document.getElementById('pr-sku').value);
  fd.append('categorie_id', document.getElementById('pr-cat').value);
  fd.append('prix_ht', document.getElementById('pr-prix').value);
  fd.append('tva', document.getElementById('pr-tva').value);
  fd.append('stock_minimum', document.getElementById('pr-min').value);
  if (!id) fd.append('stock_actuel', document.getElementById('pr-stock').value);
  const photoInput = document.getElementById('pr-photo');
  if (photoInput.files[0]) fd.append('photo', photoInput.files[0]);
  if (!fd.get('nom')) return toast('Nom requis', 'error');
  const res = id ? await api.putForm(`${BASE}/produits/${id}`, fd) : await api.postForm(`${BASE}/produits`, fd);
  if (res?.success) { Modal.close(); toast('Produit enregistré', 'success'); await loadProduits(); }
  else toast(res?.error || 'Erreur', 'error');
}

function openStockModal(id, nom) {
  Modal.open({
    title: `📊 Ajustement stock — ${nom}`,
    body: `
      <div class="form-group"><label class="form-label">Type de mouvement</label>
        <select class="form-control" id="mv-type">
          <option value="entrée">Entrée</option>
          <option value="sortie">Sortie</option>
          <option value="ajustement">Ajustement (quantité exacte)</option>
          <option value="retour">Retour client</option>
        </select></div>
      <div class="form-group"><label class="form-label">Quantité</label>
        <input class="form-control" id="mv-qty" type="number" min="1" value="1"></div>
      <div class="form-group"><label class="form-label">Note</label>
        <input class="form-control" id="mv-note" placeholder="Motif, référence…"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveStock(${id})">Enregistrer</button>`
  });
}

async function saveStock(id) {
  const res = await api.post(`${BASE}/produits/${id}/stock`, {
    type: document.getElementById('mv-type').value,
    quantite: parseInt(document.getElementById('mv-qty').value),
    note: document.getElementById('mv-note').value
  });
  if (res?.success) { Modal.close(); toast(`Stock mis à jour → ${res.stock_apres}`, 'success'); await loadProduits(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function archiveProduit(id, nom) {
  confirm(`Archiver le produit "${nom}" ?`, async () => {
    const res = await api.del(`${BASE}/produits/${id}`);
    if (res?.success) { toast('Produit archivé', 'success'); await loadProduits(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── CLIENTS STOCK ─────────────────────────────────────────────────────────────

async function loadStockClients() {
  stockClients = await api.get(`${BASE}/clients`) || [];
  const tbody = document.getElementById('stock-clients-body');
  if (!tbody) return;
  if (!stockClients.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👥</div><h3>Aucun client</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = stockClients.map(c => `<tr>
    <td><strong>${c.nom}</strong></td>
    <td>${c.email || '—'}</td>
    <td>${c.telephone || '—'}</td>
    <td>${c.adresse || '—'}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openClientModal(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStockClient(${c.id},'${c.nom}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openClientModal(id) {
  const c = id ? stockClients.find(x => x.id === id) : null;
  Modal.open({
    title: c ? '✏️ Modifier client' : '➕ Nouveau client',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Nom *</label><input class="form-control" id="sc-nom" value="${c?.nom||''}"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="sc-email" type="email" value="${c?.email||''}"></div>
        <div class="form-group"><label class="form-label">Téléphone</label><input class="form-control" id="sc-tel" value="${c?.telephone||''}"></div>
        <div class="form-group"><label class="form-label">Adresse</label><input class="form-control" id="sc-adr" value="${c?.adresse||''}"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveStockClient(${id||'null'})">Enregistrer</button>`
  });
}

async function saveStockClient(id) {
  const data = { nom: document.getElementById('sc-nom').value.trim(), email: document.getElementById('sc-email').value, telephone: document.getElementById('sc-tel').value, adresse: document.getElementById('sc-adr').value };
  if (!data.nom) return toast('Nom requis', 'error');
  const res = id ? await api.put(`${BASE}/clients/${id}`, data) : await api.post(`${BASE}/clients`, data);
  if (res?.success) { Modal.close(); toast('Client enregistré', 'success'); await loadStockClients(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteStockClient(id, nom) {
  confirm(`Supprimer "${nom}" ?`, async () => {
    const res = await api.del(`${BASE}/clients/${id}`);
    if (res?.success) { toast('Supprimé', 'success'); await loadStockClients(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── COMMANDES ─────────────────────────────────────────────────────────────────

async function loadCommandes() {
  commandes = await api.get(`${BASE}/commandes`) || [];
  const tbody = document.getElementById('commandes-body');
  if (!commandes.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🛒</div><h3>Aucune commande</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = commandes.map(c => `<tr>
    <td><strong>${c.numero}</strong></td>
    <td>${c.client_nom || '—'}</td>
    <td>${commandeBadge(c.statut)}</td>
    <td>${paiementBadge(c.statut_paiement)}</td>
    <td>${fmtEuros(c.total_ttc)}</td>
    <td style="color:var(--text-m)">${fmtDate(c.created_at)}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openCommandeStatusModal(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCommande(${c.id},'${c.numero}')">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

function openCommandeModal() {
  if (!produits.length) { loadProduits().then(() => _openCommandeForm()); }
  else _openCommandeForm();
}

function _openCommandeForm() {
  const clientOpts = stockClients.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');

  Modal.open({
    title: '➕ Nouvelle commande', large: true,
    body: `
      <div class="form-grid mb-2">
        <div class="form-group"><label class="form-label">Client</label>
          <select class="form-control" id="cmd-client"><option value="">Sans client</option>${clientOpts}</select></div>
        <div class="form-group"><label class="form-label">Mode de paiement</label>
          <select class="form-control" id="cmd-paiement">
            <option value="">Non défini</option>
            <option value="espèces">Espèces</option>
            <option value="carte">Carte bancaire</option>
            <option value="virement">Virement</option>
            <option value="chèque">Chèque</option>
          </select></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:.85rem">Lignes de commande</strong>
        <button class="btn btn-ghost btn-sm" onclick="addCmdLigne()">+ Produit</button>
      </div>
      <div id="cmd-lignes"></div>
      <div style="text-align:right;margin-top:8px;font-size:.9rem">
        TTC total : <strong id="cmd-total" style="color:var(--accent)">0,00 €</strong>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveCommande()">Créer</button>`
  });
  addCmdLigne();
}

// BUG 2 FIX : addCmdLigne utilise le tableau global `produits` au lieu de recevoir
// du HTML en paramètre (les balises <option> dans un onclick="" cassaient l'attribut)
function addCmdLigne() {
  const prodOpts = produits.map(p =>
    `<option value="${p.id}" data-prix="${p.prix_ht}" data-tva="${p.tva}">${p.nom}${p.sku ? ' (' + p.sku + ')' : ''} — Stock: ${p.stock_actuel}</option>`
  ).join('');
  const container = document.getElementById('cmd-lignes');
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 100px 80px auto;gap:8px;margin-bottom:8px;align-items:end';
  div.innerHTML = `
    <select class="form-control" onchange="updateCmdPrix(this)"><option value="">Sélectionner…</option>${prodOpts}</select>
    <input class="form-control" type="number" placeholder="Qté" value="1" min="1" oninput="calcCmdTotal()">
    <input class="form-control" type="number" placeholder="PU HT" step="0.01" oninput="calcCmdTotal()">
    <input class="form-control" type="number" placeholder="TVA%" value="20" oninput="calcCmdTotal()">
    <button class="btn btn-danger btn-sm btn-icon" onclick="this.parentElement.remove();calcCmdTotal()">✕</button>
  `;
  container.appendChild(div);
}

function updateCmdPrix(sel) {
  const opt = sel.options[sel.selectedIndex];
  const row = sel.parentElement;
  if (opt.dataset.prix) { row.querySelectorAll('input')[1].value = opt.dataset.prix; row.querySelectorAll('input')[2].value = opt.dataset.tva; }
  calcCmdTotal();
}

function calcCmdTotal() {
  let total = 0;
  document.querySelectorAll('#cmd-lignes > div').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const qty = parseFloat(inputs[0]?.value) || 0;
    const pu = parseFloat(inputs[1]?.value) || 0;
    const tva = parseFloat(inputs[2]?.value) || 20;
    total += qty * pu * (1 + tva / 100);
  });
  document.getElementById('cmd-total').textContent = fmtEuros(total);
}

async function saveCommande() {
  const lignes = [];
  document.querySelectorAll('#cmd-lignes > div').forEach(row => {
    const sel = row.querySelector('select');
    const inputs = row.querySelectorAll('input');
    const prodId = sel?.value;
    const prodNom = sel?.options[sel.selectedIndex]?.text?.split(' (')[0] || '';
    if (prodNom && prodNom !== 'Sélectionner…') {
      lignes.push({
        produit_id: prodId || null, nom_produit: prodNom,
        quantite: parseInt(inputs[0]?.value) || 1,
        prix_unitaire_ht: parseFloat(inputs[1]?.value) || 0,
        tva: parseFloat(inputs[2]?.value) || 20
      });
    }
  });
  const res = await api.post(`${BASE}/commandes`, {
    client_id: document.getElementById('cmd-client').value || null,
    mode_paiement: document.getElementById('cmd-paiement').value,
    lignes
  });
  if (res?.success) { Modal.close(); toast(`Commande ${res.numero} créée`, 'success'); await loadCommandes(); }
  else toast(res?.error || 'Erreur', 'error');
}

function openCommandeStatusModal(id) {
  const c = commandes.find(x => x.id === id);
  if (!c) return;
  Modal.open({
    title: `✏️ Commande ${c.numero}`,
    body: `
      <div class="form-group"><label class="form-label">Statut commande</label>
        <select class="form-control" id="cs-statut">
          <option value="en_attente" ${c.statut==='en_attente'?'selected':''}>En attente</option>
          <option value="confirmée" ${c.statut==='confirmée'?'selected':''}>Confirmée</option>
          <option value="en_preparation" ${c.statut==='en_preparation'?'selected':''}>En préparation</option>
          <option value="expédiée" ${c.statut==='expédiée'?'selected':''}>Expédiée</option>
          <option value="livrée" ${c.statut==='livrée'?'selected':''}>Livrée</option>
          <option value="annulée" ${c.statut==='annulée'?'selected':''}>Annulée</option>
        </select></div>
      <div class="form-group"><label class="form-label">Statut paiement</label>
        <select class="form-control" id="cs-paiement">
          <option value="impayé" ${c.statut_paiement==='impayé'?'selected':''}>Impayé</option>
          <option value="partiel" ${c.statut_paiement==='partiel'?'selected':''}>Partiel</option>
          <option value="payé" ${c.statut_paiement==='payé'?'selected':''}>Payé</option>
        </select></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveCommandeStatus(${id})">Enregistrer</button>`
  });
}

async function saveCommandeStatus(id) {
  const c = commandes.find(x => x.id === id);
  const res = await api.put(`${BASE}/commandes/${id}`, {
    statut: document.getElementById('cs-statut').value,
    statut_paiement: document.getElementById('cs-paiement').value,
    mode_paiement: c.mode_paiement
  });
  if (res?.success) { Modal.close(); toast('Commande mise à jour', 'success'); await loadCommandes(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteCommande(id, numero) {
  confirm(`Supprimer la commande ${numero} ?`, async () => {
    const res = await api.del(`${BASE}/commandes/${id}`);
    if (res?.success) { toast('Commande supprimée', 'success'); await loadCommandes(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── LIVRAISONS ────────────────────────────────────────────────────────────────

async function loadLivraisons() {
  const livraisons = await api.get(`${BASE}/livraisons`) || [];
  const tbody = document.getElementById('livraisons-body');
  if (!livraisons.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🚚</div><h3>Aucune livraison</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = livraisons.map(l => `<tr>
    <td><strong>${l.commande_numero}</strong></td>
    <td>${l.client_nom || '—'}</td>
    <td>${l.livreur_nom || '—'}</td>
    <td>${livraisonBadge(l.statut)}</td>
    <td>${fmtDate(l.date_prevue)}</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `<button class="btn btn-ghost btn-sm" onclick="openLivraisonModal(${l.id})">✏️</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openLivraisonModal(id) {
  const livraisons_data = [];
  api.get(`${BASE}/livraisons`).then(all => {
    const l = all?.find(x => x.id === id);
    if (!l) return;
    Modal.open({
      title: `🚚 Livraison — ${l.commande_numero}`,
      body: `
        <div class="form-group"><label class="form-label">Statut</label>
          <select class="form-control" id="lv-statut">
            <option value="preparee" ${l.statut==='preparee'?'selected':''}>Préparée</option>
            <option value="en_route" ${l.statut==='en_route'?'selected':''}>En route</option>
            <option value="livree" ${l.statut==='livree'?'selected':''}>Livrée</option>
            <option value="echec" ${l.statut==='echec'?'selected':''}>Échec</option>
          </select></div>
        <div class="form-group"><label class="form-label">Livreur</label>
          <input class="form-control" id="lv-livreur" value="${l.livreur_nom||''}"></div>
        <div class="form-group"><label class="form-label">Date livraison réelle</label>
          <input class="form-control" id="lv-date" type="date" value="${l.date_livraison||''}"></div>`,
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
               <button class="btn btn-primary" onclick="saveLivraison(${id})">Enregistrer</button>`
    });
  });
}

async function saveLivraison(id) {
  const res = await api.put(`${BASE}/livraisons/${id}`, {
    statut: document.getElementById('lv-statut').value,
    livreur_nom: document.getElementById('lv-livreur').value,
    date_livraison: document.getElementById('lv-date').value || null
  });
  if (res?.success) { Modal.close(); toast('Livraison mise à jour', 'success'); await loadLivraisons(); }
  else toast(res?.error || 'Erreur', 'error');
}

// ── CRÉER LIVRAISON ───────────────────────────────────────────────────────────

async function openCreateLivraisonModal() {
  // Charger les commandes si pas encore fait
  if (!commandes.length) await loadCommandes();

  if (!commandes.length) {
    toast('Aucune commande disponible — créez d\'abord une commande', 'error');
    return;
  }

  const cmdOpts = commandes.map(c =>
    `<option value="${c.id}">${c.numero}${c.client_nom ? ' — ' + c.client_nom : ''}</option>`
  ).join('');
  const today = new Date().toISOString().split('T')[0];

  Modal.open({
    title: '➕ Nouvelle livraison',
    body: `
      <div class="form-group">
        <label class="form-label">Commande *</label>
        <select class="form-control" id="nlv-cmd">
          <option value="">Sélectionner une commande…</option>
          ${cmdOpts}
        </select>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Livreur</label>
          <input class="form-control" id="nlv-livreur" placeholder="Nom du livreur">
        </div>
        <div class="form-group">
          <label class="form-label">Date prévue</label>
          <input class="form-control" id="nlv-date" type="date" value="${today}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Statut</label>
        <select class="form-control" id="nlv-statut">
          <option value="preparee">Préparée</option>
          <option value="en_route">En route</option>
          <option value="livree">Livrée</option>
          <option value="echec">Échec</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Adresse de livraison</label>
        <input class="form-control" id="nlv-adresse" placeholder="Adresse complète…">
      </div>
      <div id="nlv-err" style="display:none;color:var(--danger);font-size:.83rem;margin-top:8px"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveNewLivraison()">Créer</button>`
  });
}

async function saveNewLivraison() {
  const commande_id = document.getElementById('nlv-cmd').value;
  const err = document.getElementById('nlv-err');
  err.style.display = 'none';

  if (!commande_id) {
    err.textContent = 'Veuillez sélectionner une commande';
    err.style.display = 'block';
    return;
  }

  const btn = document.querySelector('.modal-footer .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création…'; }
  Modal._locked = true;

  try {
    const res = await api.post(`${BASE}/livraisons`, {
      commande_id: parseInt(commande_id),
      livreur_nom:       document.getElementById('nlv-livreur').value.trim() || null,
      date_prevue:       document.getElementById('nlv-date').value || null,
      statut:            document.getElementById('nlv-statut').value,
      adresse_livraison: document.getElementById('nlv-adresse').value.trim() || null
    });
    Modal._locked = false;
    if (res?.success) {
      Modal.close();
      toast('✅ Livraison créée', 'success');
      await loadLivraisons();
    } else {
      err.textContent = res?.error || 'Erreur serveur';
      err.style.display = 'block';
      if (btn) { btn.disabled = false; btn.textContent = 'Créer'; }
    }
  } catch (e) {
    Modal._locked = false;
    err.textContent = 'Erreur réseau';
    err.style.display = 'block';
    if (btn) { btn.disabled = false; btn.textContent = 'Créer'; }
  }
}

init();
