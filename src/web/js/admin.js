// ===== admin.js : portal do administrador =====
const ADMIN_STATE = { users: [], pending: [], audit: [], metrics: null, tab: 'overview' };
const ROLES = ['aluno', 'personal', 'admin'];

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDateTime(v){ return v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'; }
function roleLabel(role){ return ({ aluno:'Aluno', personal:'Personal', admin:'Admin' })[role] || role || '—'; }
function statusClass(status){ return status === 'active' ? 'ok' : (status === 'disabled' ? 'err' : 'warn'); }
function firstInitial(name){ return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

async function adminApi(method, path, body){
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = '';
    try { const data = await res.json(); detail = data.error || data.message || ''; } catch {}
    throw new Error(`${res.status}${detail ? ' — ' + detail : ''}`);
  }
  return res.status === 204 ? null : res.json();
}

function countMetric(rows, role, status){
  return (rows || []).filter(r => (!role || r.role === role) && (!status || r.status === status)).reduce((sum, r) => sum + Number(r.count || 0), 0);
}

function renderMetricNumbers(data){
  const rows = data?.users || [];
  const totalUsers = countMetric(rows);
  const activeStudents = countMetric(rows, 'aluno', 'active');
  const activePersonals = countMetric(rows, 'personal', 'active');
  const pendingUsers = Number(data?.pending_users || 0);
  $('#metricTotalUsers').textContent = totalUsers;
  $('#metricActiveStudents').textContent = activeStudents;
  $('#metricActivePersonals').textContent = activePersonals;
  $('#metricPendingUsers').textContent = pendingUsers;
  $('#metricActivePrograms').textContent = Number(data?.active_programs || 0);
  $('#metricSessions30d').textContent = Number(data?.sessions_30d || 0);
  $('#heroUsers').textContent = totalUsers;
  $('#heroPending').textContent = pendingUsers;
  $('#heroSessions').textContent = Number(data?.sessions_30d || 0);
}

function pendingCard(user, compact){
  const roleHint = user.requested_role || user.intended_role || user.signup_role || user.role || 'aluno';
  return `<div class="adminCard">
    <div><h3>${escapeHtml(user.name || 'Sem nome')}</h3><div class="metaLine">${escapeHtml(user.email || user.upn || 'sem email')}</div></div>
    <div><span class="pill warn">${escapeHtml(roleLabel(roleHint))}</span> <span class="pill ${statusClass(user.status)}">${escapeHtml(user.status || 'pending')}</span></div>
    ${compact ? '' : `<div class="metaLine"><b>Especialização:</b> ${escapeHtml(user.specialization || '—')}</div><div class="metaLine"><b>Bio:</b> ${escapeHtml(user.bio || '—')}</div>`}
    <div class="metaLine"><b>Criado em:</b> ${escapeHtml(fmtDateTime(user.created_at))}</div>
    <div class="actions">
      <button class="btn" type="button" data-action="approve" data-id="${escapeHtml(user.id)}" data-role="aluno">Aprovar como Aluno</button>
      <button class="btn" type="button" data-action="approve" data-id="${escapeHtml(user.id)}" data-role="personal">Aprovar como Personal</button>
      <button class="btn danger" type="button" data-action="reject" data-id="${escapeHtml(user.id)}">Rejeitar</button>
    </div>
  </div>`;
}

function renderPendingPreview(){
  const users = ADMIN_STATE.pending.slice(-5).reverse();
  const box = $('#pendingPreview');
  box.className = users.length ? 'adminGrid' : 'empty';
  box.innerHTML = users.length ? users.map(u => pendingCard(u, true)).join('') : 'Nenhum usuário pendente.';
}

function renderPending(){
  const grid = $('#pendingList');
  grid.className = ADMIN_STATE.pending.length ? 'adminGrid' : 'empty';
  grid.innerHTML = ADMIN_STATE.pending.length ? ADMIN_STATE.pending.map(u => pendingCard(u, false)).join('') : 'Nenhuma aprovação pendente.';
}

function filteredUsers(){
  const q = ($('#filterSearch')?.value || '').trim().toLowerCase();
  return ADMIN_STATE.users.filter(u => {
    if (q && !`${u.name || ''} ${u.email || ''} ${u.upn || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderUsers(){
  const users = filteredUsers();
  const box = $('#usersTable');
  if (!users.length) { box.innerHTML = '<div class="empty">Nenhum usuário encontrado.</div>'; return; }
  box.innerHTML = `<table><thead><tr><th>Usuário</th><th>Role</th><th>Status</th><th>Especialização</th><th>Criado</th><th>Ações</th></tr></thead><tbody>${users.map(u => `
    <tr>
      <td><b>${escapeHtml(u.name || 'Sem nome')}</b><div class="metaLine">${escapeHtml(u.email || u.upn || 'sem email')}</div></td>
      <td><span class="pill">${escapeHtml(roleLabel(u.role))}</span></td>
      <td><span class="pill ${statusClass(u.status)}">${escapeHtml(u.status || '—')}</span></td>
      <td>${escapeHtml(u.specialization || '—')}</td>
      <td>${escapeHtml(fmtDateTime(u.created_at))}</td>
      <td><div class="rowActions"><select class="roleSelect" data-action="set-role" data-id="${escapeHtml(u.id)}" aria-label="Alterar role de ${escapeHtml(u.name || 'usuário')}">${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select>${u.status === 'disabled' ? `<button class="btn" type="button" data-action="enable" data-id="${escapeHtml(u.id)}">Enable</button>` : `<button class="btn danger" type="button" data-action="disable" data-id="${escapeHtml(u.id)}">Disable</button>`}</div></td>
    </tr>`).join('')}</tbody></table>`;
}

function compactDetails(details){
  if (details == null) return '—';
  if (typeof details === 'string') {
    try { return JSON.stringify(JSON.parse(details)); } catch { return details; }
  }
  try { return JSON.stringify(details); } catch { return String(details); }
}

function renderAudit(){
  const box = $('#auditTable');
  const rows = ADMIN_STATE.audit;
  if (!rows.length) { box.innerHTML = '<div class="empty">Nenhum evento de auditoria.</div>'; return; }
  box.innerHTML = `<table><thead><tr><th>Timestamp</th><th>Ator</th><th>Ação</th><th>Alvo</th><th>Detalhes</th></tr></thead><tbody>${rows.map(e => `
    <tr>
      <td>${escapeHtml(fmtDateTime(e.created_at))}</td>
      <td><b>${escapeHtml(e.actor_name || e.actor_email || e.actor_id || '—')}</b></td>
      <td><span class="pill">${escapeHtml(e.action || '—')}</span></td>
      <td>${escapeHtml([e.target_type, e.target_id].filter(Boolean).join(': ') || '—')}</td>
      <td class="compactJson">${escapeHtml(compactDetails(e.details))}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function loadMetrics(){
  ADMIN_STATE.metrics = await adminApi('GET', '/api/admin/metrics');
  renderMetricNumbers(ADMIN_STATE.metrics);
  if (!ADMIN_STATE.pending.length) await loadPending();
  renderPendingPreview();
}

async function loadPending(){
  ADMIN_STATE.pending = await adminApi('GET', '/api/admin/users/pending');
  renderPending();
  renderPendingPreview();
}

async function loadUsers(filters = {}){
  const params = new URLSearchParams();
  const status = filters.status ?? $('#filterStatus')?.value;
  const role = filters.role ?? $('#filterRole')?.value;
  if (status) params.set('status', status);
  if (role) params.set('role', role);
  ADMIN_STATE.users = await adminApi('GET', `/api/admin/users${params.toString() ? '?' + params.toString() : ''}`);
  renderUsers();
}

async function loadAudit(){
  ADMIN_STATE.audit = await adminApi('GET', '/api/admin/audit?limit=100');
  renderAudit();
}

const PROFESSION_LABELS = {
  personal_trainer: 'Personal Trainer',
  nutricionista: 'Nutricionista',
  fisioterapeuta: 'Fisioterapeuta',
  psicologo: 'Psicólogo',
  medico: 'Médico',
  educador_fisico: 'Educador Físico',
  outro: 'Outro'
};
function profLabel(p){ return PROFESSION_LABELS[p] || (p ? p : '—'); }

function renderLeads(){
  const box = $('#leadsTable');
  const search = ($('#leadFilterSearch')?.value || '').trim().toLowerCase();
  const rows = (ADMIN_STATE.leads || []).filter(l => {
    if (!search) return true;
    return [l.name, l.email, l.message, l.phone].some(v => String(v||'').toLowerCase().includes(search));
  });
  if (!rows.length) { box.innerHTML = '<div class="empty">Nenhum lead encontrado.</div>'; return; }
  box.innerHTML = `<table>
    <thead><tr><th>Data</th><th>Nome / Contato</th><th>Interesse</th><th>Profissão</th><th>Mensagem</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${rows.map(l => `
      <tr>
        <td>${escapeHtml(fmtDateTime(l.created_at))}</td>
        <td>
          <b>${escapeHtml(l.name)}</b><br>
          <span class="metaLine">${escapeHtml(l.email)}${l.phone ? ' · ' + escapeHtml(l.phone) : ''}</span>
        </td>
        <td><span class="pill">${escapeHtml(l.role_interest || '—')}</span></td>
        <td>${escapeHtml(profLabel(l.profession))}</td>
        <td class="compactJson">${escapeHtml(l.message || '—')}</td>
        <td>${l.contacted_at
            ? `<span class="pill ok">Contatado</span><br><span class="metaLine">${escapeHtml(fmtDateTime(l.contacted_at))}</span>`
            : '<span class="pill warn">Pendente</span>'}</td>
        <td><div class="rowActions">
          ${l.contacted_at
            ? `<button class="btn" data-action="lead-reset" data-id="${escapeHtml(l.id)}">Reabrir</button>`
            : `<button class="btn" data-action="lead-contact" data-id="${escapeHtml(l.id)}">Marcar contatado</button>`}
          <button class="btn danger" data-action="lead-delete" data-id="${escapeHtml(l.id)}">Excluir</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
}

async function loadLeads(){
  const status = $('#leadFilterStatus')?.value || 'pending';
  const data = await adminApi('GET', `/api/admin/leads?status=${encodeURIComponent(status)}&limit=300`);
  ADMIN_STATE.leads = data.leads || [];
  renderLeads();
}

async function leadAction(action, id){
  if (action === 'lead-contact') {
    const notes = prompt('Notas sobre este contato (opcional):', '') || null;
    await adminApi('POST', `/api/admin/leads/${encodeURIComponent(id)}/contact`, { notes });
    toast('Lead marcado como contatado.');
  } else if (action === 'lead-reset') {
    if (!confirm('Reabrir este lead?')) return;
    await adminApi('POST', `/api/admin/leads/${encodeURIComponent(id)}/reset`);
    toast('Lead reaberto.');
  } else if (action === 'lead-delete') {
    if (!confirm('Excluir este lead permanentemente?')) return;
    await adminApi('DELETE', `/api/admin/leads/${encodeURIComponent(id)}`);
    toast('Lead excluído.');
  }
  await loadLeads();
}

async function approve(id, role){
  if (!confirm(`Aprovar este usuário como ${roleLabel(role)}?`)) return;
  await adminApi('POST', `/api/admin/users/${encodeURIComponent(id)}/approve`, { role });
  toast('Aprovado!');
  await refreshAll();
}

async function reject(id, reason){
  const finalReason = reason ?? prompt('Motivo da rejeição (opcional):', '') ?? '';
  if (!confirm('Rejeitar e desabilitar este usuário?')) return;
  await adminApi('POST', `/api/admin/users/${encodeURIComponent(id)}/reject`, { reason: finalReason });
  toast('Rejeitado.');
  await refreshAll();
}

async function setRole(id, role){
  if (!confirm(`Alterar role para ${roleLabel(role)}?`)) { renderUsers(); return; }
  await adminApi('PATCH', `/api/admin/users/${encodeURIComponent(id)}/role`, { role });
  toast('Role atualizada!');
  await refreshAll();
}

async function toggleStatus(id, action){
  const destructive = action === 'disable';
  if (destructive && !confirm('Desabilitar este usuário?')) return;
  if (!destructive && !confirm('Habilitar este usuário?')) return;
  await adminApi('POST', `/api/admin/users/${encodeURIComponent(id)}/${action}`);
  toast(action === 'disable' ? 'Usuário desabilitado.' : 'Usuário habilitado!');
  await refreshAll();
}

async function refreshAll(){
  await Promise.all([loadMetrics(), loadPending(), loadUsers(), loadAudit()]);
}

function bindTabs(){
  document.querySelectorAll('.tabBtn').forEach(btn => btn.addEventListener('click', async () => {
    document.querySelectorAll('.tabBtn').forEach(b => b.classList.toggle('on', b === btn));
    const tab = btn.dataset.tab;
    ADMIN_STATE.tab = tab;
    $('#tabOverview').hidden = tab !== 'overview';
    $('#tabPending').hidden = tab !== 'pending';
    $('#tabUsers').hidden = tab !== 'users';
    $('#tabAudit').hidden = tab !== 'audit';
    const tl = $('#tabLeads'); if (tl) tl.hidden = tab !== 'leads';
    try {
      if (tab === 'pending') await loadPending();
      if (tab === 'users') await loadUsers();
      if (tab === 'audit') await loadAudit();
      if (tab === 'leads') await loadLeads();
    } catch (e) { toast('Erro: ' + e.message, true); }
  }));
}

function bindControls(){
  $('#filterStatus').addEventListener('change', () => loadUsers().catch(e => toast('Erro: ' + e.message, true)));
  $('#filterRole').addEventListener('change', () => loadUsers().catch(e => toast('Erro: ' + e.message, true)));
  $('#filterSearch').addEventListener('input', renderUsers);
  const lfs = $('#leadFilterStatus'); if (lfs) lfs.addEventListener('change', () => loadLeads().catch(e => toast('Erro: ' + e.message, true)));
  const lfx = $('#leadFilterSearch'); if (lfx) lfx.addEventListener('input', renderLeads);
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id, role } = btn.dataset;
    let run = null;
    if (action === 'approve') run = approve(id, role);
    else if (action === 'reject') run = reject(id);
    else if (action === 'disable' || action === 'enable') run = toggleStatus(id, action);
    else if (action === 'lead-contact' || action === 'lead-reset' || action === 'lead-delete') run = leadAction(action, id);
    if (run) run.catch(err => toast('Erro: ' + err.message, true));
  });
  document.body.addEventListener('change', e => {
    const sel = e.target.closest('select[data-action="set-role"]');
    if (!sel) return;
    setRole(sel.dataset.id, sel.value).catch(err => toast('Erro: ' + err.message, true));
  });
}

async function requireAdminPortal(){
  if (!window.apexAuth?.ensureLogin) throw new Error('auth.js não carregado');
  await window.apexAuth.ensureLogin();
  const data = await adminApi('GET', '/api/admin/me');
  const user = data?.user || data;
  if (user?.role !== 'admin') { location.replace('/'); return null; }
  $('#userChip').textContent = user.name || user.email || user.upn || 'Administrador';
  $('#avInit').textContent = firstInitial(user.name || user.email || user.upn);
  return user;
}

async function adminLogout(){
  if (window.apexAuth?.logout) await window.apexAuth.logout();
  else if (window.logoutUser) await window.logoutUser();
  else location.replace('/');
}

async function initAdmin(){
  bindTabs();
  bindControls();
  try {
    const user = await requireAdminPortal();
    if (!user) return;
    await refreshAll();
  } catch (e) {
    toast('Erro: ' + e.message, true);
    $('#pendingPreview').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', initAdmin);
