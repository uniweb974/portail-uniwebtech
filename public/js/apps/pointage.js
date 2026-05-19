/* ── POINTAGE APP ────────────────────────────────────────────────────────── */

const BASE = '/api/app/pointage';
let employees = [];
let IS_ADMIN = false;

async function init() {
  const user = await checkAuth();
  if (!user) return;
  IS_ADMIN = applyRoleVisibility(user.role);
  displayUser(user);
  initNav('pointage');

  // Horloge en temps réel
  startClock();

  // Date du jour
  const now = new Date();
  document.getElementById('today-date').textContent = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // Valeurs par défaut
  const today = now.toISOString().split('T')[0];
  document.getElementById('man-date').value = today;
  document.getElementById('man-time').value = now.toTimeString().slice(0,5);
  document.getElementById('week-select').value = currentWeek();

  await loadEmployees();

  document.querySelector('[data-section="employes"]').addEventListener('click', renderEmployees);
  document.querySelector('[data-section="semaine"]').addEventListener('click', loadWeek);
}

function startClock() {
  function update() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('fr-FR');
  }
  update();
  setInterval(update, 1000);
}

// ── EMPLOYÉS ──────────────────────────────────────────────────────────────────

async function loadEmployees() {
  employees = await api.get(`${BASE}/employees`) || [];
  const sel = document.getElementById('emp-select');
  sel.innerHTML = '<option value="">— Choisir un employé —</option>' +
    employees.map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('');
  renderEmployees();
}

function renderEmployees() {
  const tbody = document.getElementById('employees-body');
  if (!tbody) return;
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">👥</div><h3>Aucun employé</h3><p>Ajoutez vos salariés pour commencer le pointage</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = employees.map(e => `<tr>
    <td>${e.prenom}</td>
    <td><strong>${e.nom}</strong></td>
    <td>${e.heures_contrat}h / semaine</td>
    <td><div class="td-actions">
      ${IS_ADMIN ? `
        <button class="btn btn-ghost btn-sm" onclick="openEmpModal(${e.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmp(${e.id},'${e.prenom} ${e.nom}')">🗑️</button>
      ` : '—'}
    </div></td>
  </tr>`).join('');
}

function openEmpModal(id) {
  const e = id ? employees.find(x => x.id === id) : null;
  Modal.open({
    title: e ? `✏️ Modifier ${e.prenom} ${e.nom}` : '➕ Nouvel employé',
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Prénom *</label>
          <input class="form-control" id="emp-prenom" value="${e?.prenom||''}"></div>
        <div class="form-group"><label class="form-label">Nom *</label>
          <input class="form-control" id="emp-nom" value="${e?.nom||''}"></div>
        <div class="form-group"><label class="form-label">Heures contrat / semaine</label>
          <input class="form-control" id="emp-h" type="number" step="0.5" min="0" max="60" value="${e?.heures_contrat||35}"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Annuler</button>
             <button class="btn btn-primary" onclick="saveEmp(${id||'null'})">Enregistrer</button>`
  });
}

async function saveEmp(id) {
  const prenom = document.getElementById('emp-prenom').value.trim();
  const nom    = document.getElementById('emp-nom').value.trim();
  const heures = parseFloat(document.getElementById('emp-h').value) || 35;
  if (!prenom || !nom) return toast('Prénom et nom requis', 'error');
  const res = id
    ? await api.put(`${BASE}/employees/${id}`, { prenom, nom, heures_contrat: heures })
    : await api.post(`${BASE}/employees`, { prenom, nom, heures_contrat: heures });
  if (res?.success) { Modal.close(); toast('Employé enregistré', 'success'); await loadEmployees(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deleteEmp(id, nom) {
  confirm(`Supprimer ${nom} et tout son historique de pointage ?`, async () => {
    const res = await api.del(`${BASE}/employees/${id}`);
    if (res?.success) { toast('Supprimé', 'success'); await loadEmployees(); }
    else toast(res?.error || 'Erreur', 'error');
  });
}

// ── POINTAGE DU JOUR ──────────────────────────────────────────────────────────

async function loadTodayPointages() {
  const empId = document.getElementById('emp-select').value;
  const container = document.getElementById('today-pointages');
  const lastEl = document.getElementById('last-pointage');

  if (!empId) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><h3>Sélectionnez un employé</h3></div>';
    lastEl.textContent = '';
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const pts = await api.get(`${BASE}/?employee_id=${empId}&date=${today}`) || [];

  // Dernier pointage
  if (pts.length) {
    const last = pts[pts.length - 1];
    lastEl.innerHTML = `Dernier : <strong>${last.type === 'ARRIVEE' ? '🟢 Arrivée' : '🔴 Départ'}</strong> à ${new Date(last.timestamp).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`;
  } else {
    lastEl.textContent = 'Pas de pointage aujourd\'hui';
  }

  if (!pts.length) {
    container.innerHTML = '<p style="color:var(--text-m);text-align:center;padding:20px">Aucun pointage enregistré aujourd\'hui</p>';
    return;
  }

  // Paires arrivée/départ
  let totalMin = 0;
  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const time = new Date(p.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const isAr = p.type === 'ARRIVEE';
    html += `<div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(${isAr?'0,143,104':'229,62,62'},.1);border-radius:8px;border-left:3px solid var(--${isAr?'secondary':'danger'})">
      <span style="font-size:1.2rem">${isAr ? '🟢' : '🔴'}</span>
      <div>
        <div style="font-weight:600">${isAr ? 'Arrivée' : 'Départ'}</div>
        <div style="font-size:.8rem;color:var(--text-m)">${time}</div>
      </div>`;

    if (isAr && pts[i+1]?.type === 'DEPART') {
      const depTime = new Date(pts[i+1].timestamp);
      const arrTime = new Date(p.timestamp);
      const diffMin = Math.round((depTime - arrTime) / 60000);
      totalMin += diffMin;
      const h = Math.floor(diffMin / 60), m = diffMin % 60;
      html += `<div style="margin-left:auto;font-weight:700;color:var(--accent)">${h}h${m.toString().padStart(2,'0')}</div>`;
    }
    html += `<button class="btn btn-danger btn-sm btn-icon" style="margin-left:auto" onclick="deletePointage(${p.id})" title="Supprimer">✕</button></div>`;
  }
  html += '</div>';

  if (totalMin > 0) {
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    html += `<div style="margin-top:12px;text-align:right;font-size:.9rem;color:var(--accent);font-weight:700">
      Total aujourd'hui : ${h}h${m.toString().padStart(2,'0')}
    </div>`;
  }
  container.innerHTML = html;
}

async function doPointage(type) {
  const empId = document.getElementById('emp-select').value;
  if (!empId) return toast('Sélectionnez un employé', 'error');

  const btn = document.getElementById(type === 'ARRIVEE' ? 'btn-arrivee' : 'btn-depart');
  btn.disabled = true;

  const res = await api.post(`${BASE}/`, { employee_id: parseInt(empId), type });
  btn.disabled = false;

  if (res?.success) {
    const emp = employees.find(e => e.id === parseInt(empId));
    toast(`${type === 'ARRIVEE' ? '🟢 Arrivée' : '🔴 Départ'} enregistré${emp ? ' pour ' + emp.prenom : ''}`, 'success');
    await loadTodayPointages();
  } else {
    toast(res?.error || 'Erreur', 'error');
  }
}

async function saveManuel() {
  const empId = document.getElementById('emp-select').value;
  if (!empId) return toast('Sélectionnez un employé', 'error');
  const type = document.getElementById('man-type').value;
  const date = document.getElementById('man-date').value;
  const time = document.getElementById('man-time').value;
  if (!date || !time) return toast('Date et heure requises', 'error');
  const timestamp = new Date(`${date}T${time}:00`).toISOString();
  const res = await api.post(`${BASE}/`, { employee_id: parseInt(empId), type, timestamp });
  if (res?.success) { toast('Pointage manuel enregistré', 'success'); await loadTodayPointages(); }
  else toast(res?.error || 'Erreur', 'error');
}

async function deletePointage(id) {
  const res = await api.del(`${BASE}/${id}`);
  if (res?.success) { toast('Pointage supprimé', 'success'); await loadTodayPointages(); }
  else toast(res?.error || 'Erreur', 'error');
}

// ── SEMAINE ───────────────────────────────────────────────────────────────────

async function loadWeek() {
  const week = document.getElementById('week-select').value || currentWeek();
  const summary = await api.get(`${BASE}/weekly-summary?week=${week}`) || [];
  const container = document.getElementById('week-summary');

  if (!summary.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><h3>Aucun employé</h3></div>';
    return;
  }

  container.innerHTML = summary.map(s => {
    const emp = s.employee;
    const contratH = emp.heures_contrat;
    const travH = s.total_heures;
    const pct = contratH > 0 ? Math.min(100, (travH / contratH) * 100) : 0;
    const color = pct >= 100 ? 'var(--secondary)' : pct >= 80 ? 'var(--accent)' : 'var(--warning)';

    return `
      <div class="card mb-2">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <strong style="font-size:1rem">${emp.prenom} ${emp.nom}</strong>
            <div style="font-size:.8rem;color:var(--text-m)">Contrat : ${contratH}h/sem</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.4rem;font-weight:800;color:${color}">${travH.toFixed(1)}h</div>
            ${s.heures_sup > 0 ? `<div style="font-size:.75rem;color:var(--accent)">+${s.heures_sup.toFixed(1)}h sup.</div>` : ''}
          </div>
        </div>
        <div style="background:var(--bg3);border-radius:99px;height:6px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;transition:.3s"></div>
        </div>
        ${Object.keys(s.days).length ? `
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">
          ${Object.entries(s.days).map(([day, pts]) => {
            const pairs = [];
            for (let i = 0; i < pts.length; i+=2) {
              if (pts[i]?.type === 'ARRIVEE' && pts[i+1]?.type === 'DEPART') {
                const diffMin = Math.round((new Date(pts[i+1].timestamp) - new Date(pts[i].timestamp)) / 60000);
                const h = Math.floor(diffMin/60), m = diffMin%60;
                pairs.push(`${h}h${m.toString().padStart(2,'0')}`);
              }
            }
            const dayLabel = new Date(day).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
            return `<span class="badge badge-accent">${dayLabel} · ${pairs.join(', ') || '?'}</span>`;
          }).join('')}
        </div>` : ''}
      </div>`;
  }).join('');
}

function exportCSV() {
  const week = document.getElementById('week-select').value || currentWeek();
  window.open(`${BASE}/export-csv?week=${encodeURIComponent(week)}`, '_blank');
}

init();
