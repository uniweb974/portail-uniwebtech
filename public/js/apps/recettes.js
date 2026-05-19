/* ── RECETTES APP ────────────────────────────────────────────────────────── */

const BASE = '/api/app/recettes';
let currentType = 'income';
let IS_ADMIN = false;

async function init() {
  const user = await checkAuth();
  if (!user) return;
  IS_ADMIN = applyRoleVisibility(user.role);
  displayUser(user);
  initNav('dashboard');

  // Date par défaut = aujourd'hui
  const today = new Date().toISOString().split('T')[0];
  document.querySelector('[name="date"]').value = today;

  document.getElementById('add-form').addEventListener('submit', addTransaction);
  document.querySelector('[data-section="historique"]').addEventListener('click', loadHistorique);
  document.querySelector('[data-section="parametres"]').addEventListener('click', loadSettings);

  await loadDashboard();
}

// ── TYPE SELECTOR ─────────────────────────────────────────────────────────────

function selectType(type) {
  currentType = type;
  document.getElementById('type-income').checked = type === 'income';
  document.getElementById('type-expense').checked = type === 'expense';

  const incBtn = document.getElementById('btn-income');
  const expBtn = document.getElementById('btn-expense');
  if (type === 'income') {
    incBtn.style.cssText = 'background:rgba(0,143,104,.2);border:2px solid var(--secondary);border-radius:var(--radius);padding:16px;text-align:center;color:var(--secondary)';
    expBtn.style.cssText = 'background:transparent;border:2px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;color:var(--text-m)';
  } else {
    expBtn.style.cssText = 'background:rgba(229,62,62,.15);border:2px solid var(--danger);border-radius:var(--radius);padding:16px;text-align:center;color:var(--danger)';
    incBtn.style.cssText = 'background:transparent;border:2px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;color:var(--text-m)';
  }
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const d = await api.get(`${BASE}/stats`);
  if (!d) return;

  const balanceColor = d.balance >= 0 ? 'var(--secondary)' : 'var(--danger)';
  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">💰</div>
      <div class="stat-label">Solde total</div>
      <div class="stat-value" style="color:${balanceColor}">${fmtEuros(d.balance)}</div>
      <div class="stat-sub">Solde ouverture : ${fmtEuros(d.opening_balance)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📈</div>
      <div class="stat-label">Recettes totales</div>
      <div class="stat-value text-secondary">${fmtEuros(d.total_income)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📉</div>
      <div class="stat-label">Dépenses totales</div>
      <div class="stat-value text-danger">${fmtEuros(d.total_expense)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📅</div>
      <div class="stat-label">Ce mois</div>
      <div class="stat-value" style="color:${d.month_balance>=0?'var(--secondary)':'var(--danger)'}">${fmtEuros(d.month_balance)}</div>
      <div class="stat-sub">+${fmtEuros(d.month_income)} / -${fmtEuros(d.month_expense)}</div>
    </div>
  `;

  const el = document.getElementById('recent-transactions');
  if (!d.recent?.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📒</div><h3>Aucune opération</h3><p>Ajoutez votre première recette ou dépense</p></div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Catégorie</th><th>Description</th><th>Montant</th></tr></thead><tbody>
    ${d.recent.map(t => `<tr>
      <td>${fmtDate(t.date)}</td>
      <td>${t.type==='income'
        ? '<span class="badge badge-success">Recette</span>'
        : '<span class="badge badge-danger">Dépense</span>'}</td>
      <td>${t.category || '—'}</td>
      <td>${t.description || '—'}</td>
      <td style="font-weight:600;color:${t.type==='income'?'var(--secondary)':'var(--danger)'}">
        ${t.type==='income'?'+':'-'}${fmtEuros(t.amount)}
      </td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

// ── AJOUTER ───────────────────────────────────────────────────────────────────

async function addTransaction(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.type = currentType;

  if (!data.amount || parseFloat(data.amount) <= 0) return toast('Montant invalide', 'error');
  if (!data.date) return toast('Date requise', 'error');

  const res = await api.post(`${BASE}/`, data);
  if (res?.success) {
    toast(`${currentType === 'income' ? 'Recette' : 'Dépense'} ajoutée`, 'success');
    form.reset();
    form.querySelector('[name="date"]').value = new Date().toISOString().split('T')[0];
    selectType('income');
    await loadDashboard();
  } else toast(res?.error || 'Erreur', 'error');
}

// ── HISTORIQUE ────────────────────────────────────────────────────────────────

async function loadHistorique() {
  const type   = document.getElementById('f-type')?.value || '';
  const from   = document.getElementById('f-from')?.value || '';
  const to     = document.getElementById('f-to')?.value || '';
  const search = document.getElementById('f-search')?.value || '';

  const params = new URLSearchParams({ type, from, to, search }).toString();
  const list = await api.get(`${BASE}/?${params}`) || [];
  const tbody = document.getElementById('historique-body');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📜</div><h3>Aucune opération</h3></div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => `<tr>
    <td>${fmtDate(t.date)}</td>
    <td>${t.type==='income'
      ? '<span class="badge badge-success">Recette</span>'
      : '<span class="badge badge-danger">Dépense</span>'}</td>
    <td>${t.category || '—'}</td>
    <td>${t.description || '—'}</td>
    <td style="color:var(--text-m)">${t.payment_method || '—'}</td>
    <td style="font-weight:600;color:${t.type==='income'?'var(--secondary)':'var(--danger)'}">
      ${t.type==='income'?'+':'-'}${fmtEuros(t.amount)}
    </td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="editTransaction(${t.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTransaction(${t.id})">🗑️</button>
      ` : ''}
    </div></td>
  </tr>`).join('');
}

async function editTransaction(id) {
  const list = await api.get(`${BASE}/`) || [];
  const t = list.find(x => x.id === id);
  if (!t) return;

  Modal.open({
    title: '✏️ Modifier l\'opération',
    body: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div id="edit-inc" onclick="editSelectType('income')"
          style="background:${t.type==='income'?'rgba(0,143,104,.2)':'transparent'};border:2px solid ${t.type==='income'?'var(--secondary)':'var(--border)'};border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:${t.type==='income'?'var(--secondary)':'var(--text-m)'}">
          💰 Recette
        </div>
        <div id="edit-exp" onclick="editSelectType('expense')"
          style="background:${t.type==='expense'?'rgba(229,62,62,.15)':'transparent'};border:2px solid ${t.type==='expense'?'var(--danger)':'var(--border)'};border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:${t.type==='expense'?'var(--danger)':'var(--text-m)'}">
          💸 Dépense
        </div>
      </div>
      <input type="hidden" id="edit-type" value="${t.type}">
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Montant (€)</label>
          <input class="form-control" id="et-amount" type="number" step="0.01" value="${t.amount}"></div>
        <div class="form-group"><label class="form-label">Date</label>
          <input class="form-control" id="et-date" type="date" value="${t.date}"></div>
        <div class="form-group"><label class="form-label">Catégorie</label>
          <input class="form-control" id="et-cat" value="${t.category||''}"></div>
        <div class="form-group"><label class="form-label">Mode de paiement</label>
          <select class="form-control" id="et-pm">
            <option value="">Non précisé</option>
            <option value="espèces" ${t.payment_method==='espèces'?'selected':''}>Espèces</option>
            <option value="virement" ${t.payment_method==='virement'?'selected':''}>Virement</option>
            <option value="chèque" ${t.payment_method==='chèque'?'selected':''}>Chèque</option>
            <option value="carte" ${t.payment_method==='carte'?'selected':''}>Carte bancaire</option>
            <option value="prélèvement" ${t.payment_method==='prélèvement'?'selected':''}>Prélèvement</option>
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">Description</label>
        <input class="form-control" id="et-desc" value="${t.description||''}"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveTransaction(${id})">Enregistrer</button>`
  });
}

function editSelectType(type) {
  document.getElementById('edit-type').value = type;
  const inc = document.getElementById('edit-inc');
  const exp = document.getElementById('edit-exp');
  if (type === 'income') {
    inc.style.cssText = 'background:rgba(0,143,104,.2);border:2px solid var(--secondary);border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:var(--secondary)';
    exp.style.cssText = 'background:transparent;border:2px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:var(--text-m)';
  } else {
    exp.style.cssText = 'background:rgba(229,62,62,.15);border:2px solid var(--danger);border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:var(--danger)';
    inc.style.cssText = 'background:transparent;border:2px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;color:var(--text-m)';
  }
}

async function saveTransaction(id) {
  const res = await api.put(`${BASE}/${id}`, {
    type: document.getElementById('edit-type').value,
    amount: parseFloat(document.getElementById('et-amount').value),
    date: document.getElementById('et-date').value,
    category: document.getElementById('et-cat').value,
    payment_method: document.getElementById('et-pm').value,
    description: document.getElementById('et-desc').value
  });
  if (res?.success) { Modal.close(); toast('Opération mise à jour', 'success'); await loadHistorique(); await loadDashboard(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteTransaction(id) {
  confirm('Supprimer cette opération ?', async () => {
    const res = await api.del(`${BASE}/${id}`);
    if (res?.success) { toast('Supprimée', 'success'); await loadHistorique(); await loadDashboard(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── EXPORT (PDF / EXCEL) ──────────────────────────────────────────────────────

let _exportFmt = 'pdf';

function openExportModal() {
  _exportFmt = 'pdf';
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  const defFrom = `${y}-${m}-01`;
  const defTo   = new Date(y, now.getMonth() + 1, 0).toISOString().split('T')[0];

  Modal.open({
    title: '📤 Exporter le livre des recettes',
    body: `
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Format</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
          <div id="xfmt-pdf" onclick="selectExportFmt('pdf')"
            style="border:2px solid var(--primary);background:rgba(93,40,143,.12);border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--primary)">
            <div style="font-size:1.4rem">📄</div>
            <div style="font-weight:700;margin-top:4px">PDF</div>
          </div>
          <div id="xfmt-xlsx" onclick="selectExportFmt('xlsx')"
            style="border:2px solid var(--border);background:transparent;border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--text-m)">
            <div style="font-size:1.4rem">📊</div>
            <div style="font-weight:700;margin-top:4px">Excel (.xlsx)</div>
          </div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Période</label>
        <select class="form-control" id="xperiod" onchange="onExportPeriod()">
          <option value="this-month">Ce mois-ci</option>
          <option value="last-month">Mois dernier</option>
          <option value="this-year">Cette année</option>
          <option value="custom">Personnalisé</option>
        </select>
      </div>
      <div id="xcustom" style="display:none">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Du</label>
            <input class="form-control" id="xfrom" type="date" value="${defFrom}">
          </div>
          <div class="form-group">
            <label class="form-label">Au</label>
            <input class="form-control" id="xto" type="date" value="${defTo}">
          </div>
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="doExport()">📥 Télécharger</button>`
  });
}

function selectExportFmt(fmt) {
  _exportFmt = fmt;
  const pdf  = document.getElementById('xfmt-pdf');
  const xlsx = document.getElementById('xfmt-xlsx');
  if (!pdf || !xlsx) return;
  if (fmt === 'pdf') {
    pdf.style.cssText  = 'border:2px solid var(--primary);background:rgba(93,40,143,.12);border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--primary)';
    xlsx.style.cssText = 'border:2px solid var(--border);background:transparent;border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--text-m)';
  } else {
    xlsx.style.cssText = 'border:2px solid var(--secondary);background:rgba(0,143,104,.12);border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--secondary)';
    pdf.style.cssText  = 'border:2px solid var(--border);background:transparent;border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;color:var(--text-m)';
  }
}

function onExportPeriod() {
  const period = document.getElementById('xperiod')?.value;
  const custom = document.getElementById('xcustom');
  if (!custom) return;
  custom.style.display = period === 'custom' ? 'block' : 'none';
}

function _periodDates(period) {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth();
  if (period === 'this-month')  return { from: new Date(y, m, 1).toISOString().split('T')[0], to: new Date(y, m + 1, 0).toISOString().split('T')[0] };
  if (period === 'last-month')  return { from: new Date(y, m - 1, 1).toISOString().split('T')[0], to: new Date(y, m, 0).toISOString().split('T')[0] };
  if (period === 'this-year')   return { from: `${y}-01-01`, to: `${y}-12-31` };
  return {
    from: document.getElementById('xfrom')?.value || '',
    to:   document.getElementById('xto')?.value   || ''
  };
}

function doExport() {
  const period = document.getElementById('xperiod')?.value || 'this-month';
  const { from, to } = _periodDates(period);
  Modal.close();
  const route = _exportFmt === 'xlsx' ? 'export-excel' : 'export-pdf';
  window.open(`${BASE}/${route}?from=${from}&to=${to}`, '_blank');
}

// ── PARAMÈTRES ────────────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await api.get(`${BASE}/settings`);
  if (s) document.getElementById('opening-balance').value = s.opening_balance || 0;
}

async function saveSettings() {
  const res = await api.put(`${BASE}/settings`, {
    opening_balance: parseFloat(document.getElementById('opening-balance').value) || 0
  });
  if (res?.success) { toast('Paramètres enregistrés', 'success'); await loadDashboard(); }
  else toast(res?.error || 'Erreur', 'error');
}

init();
