// ===== personal.js : portal do personal =====
const COR_TO_HEX = { amarelo:'#f0c419', verde:'#3aa55a', vermelho:'#d04848', azul:'#3a73c4', laranja:'#e58a2f', roxo:'#7e57c2', rosa:'#e26a8a', cinza:'#9aa0a6', preto:'#222', aerobio:'#2a9d8f', 'aeróbio':'#2a9d8f' };

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function corHex(c){ return COR_TO_HEX[(c||'').toLowerCase()] || 'transparent'; }
function fmtDateTime(v){ return v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'; }
function pct(v){ const n = Number(v || 0); return Math.max(0, Math.min(100, n)); }
function min(v){ const n = Number(v || 0); return `${Math.round(n)} min`; }

function ensureUserFromLegacy(user){
  if (!USER.id() && user?.id) USER.set(user);
}

async function requirePersonal(){
  let selected = USER.get();
  const legacyId = localStorage.getItem('userId');
  const id = selected?.id || legacyId;
  if (!id) { location.replace('/index.html'); return null; }
  const user = await apiRaw('GET', `/api/users/${encodeURIComponent(id)}`);
  ensureUserFromLegacy(user);
  if (user.role !== 'personal') { location.replace('/index.html'); return null; }
  return user;
}

function renderOverview(data){
  $('#heroTotal').textContent = data.total_alunos ?? 0;
  $('#heroAtivos').textContent = data.alunos_ativos_7d ?? 0;
  $('#totalAlunos').textContent = data.total_alunos ?? 0;
  $('#ativos7d').textContent = data.alunos_ativos_7d ?? 0;
  const next = data.proximos_treinos || [];
  $('#nextList').className = next.length ? '' : 'empty';
  $('#nextList').innerHTML = next.length ? next.map(t => `
    <div class="suggestion">
      <span class="dot" style="background:${corHex(t.cor)}"></span>
      <div style="flex:1"><b>${escapeHtml(t.aluno_nome)}</b><div class="metaLine">Semana ${t.semana_atual || '—'} · ${escapeHtml(t.nome_treino || 'Treino')}</div></div>
      <a class="btn ghost" href="/personal-aluno.html?id=${encodeURIComponent(t.aluno_id)}">Detalhes</a>
    </div>`).join('') : 'Nenhum treino sugerido ainda.';
}

function renderAdvancedMetrics(metrics){
  $('#aderencia30d').textContent = `${pct(metrics?.aderencia_30d)}%`;
  $('#duracaoMedia30d').textContent = min(metrics?.duracao_media_30d);
  const inactive = metrics?.alunos_inativos_7d || [];
  const box = $('#inactiveList');
  box.className = inactive.length ? '' : 'empty';
  box.innerHTML = inactive.length ? inactive.map(a => `
    <a class="inactiveRow" href="/personal-aluno.html?id=${encodeURIComponent(a.id)}">
      <span class="dot" style="background:#d04848"></span>
      <div style="flex:1"><b>${escapeHtml(a.name)}</b><div class="metaLine">${a.dias_inativo} dia(s) sem treino</div></div>
      <span class="btn ghost">Detalhes</span>
    </a>`).join('') : 'Todos os alunos ativos treinaram nos últimos 7 dias.';
}

function renderStudents(data){
  const alunos = data.alunos || [];
  const grid = $('#studentGrid');
  grid.innerHTML = alunos.length ? alunos.map(a => {
    const adherence = pct(a.pct_adesao_30d);
    return `<div class="studentCard">
      <h3>${escapeHtml(a.name)}</h3>
      <div class="metaLine">Programa: <b>${escapeHtml(a.programa_atual_nome || 'sem programa ativo')}</b></div>
      <div class="metaLine">Último treino: ${escapeHtml(fmtDateTime(a.ultimo_treino_at))}</div>
      <div class="metaLine">Sessões 7d: ${a.sessoes_7d || 0}</div>
      <div><div class="metaLine">Adesão 30d: ${adherence}%</div><div class="progress"><i style="width:${adherence}%"></i></div></div>
      <a class="btn" href="/personal-aluno.html?id=${encodeURIComponent(a.id)}">Detalhes</a>
    </div>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">Nenhum aluno vinculado.</div>';
}

function bindTabs(){
  document.querySelectorAll('.tabBtn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tabBtn').forEach(b => b.classList.toggle('on', b === btn));
    const tab = btn.dataset.tab;
    $('#tabOverview').hidden = tab !== 'overview';
    $('#tabStudents').hidden = tab !== 'students';
  }));
}

async function initPersonal(){
  bindTabs();
  try {
    const user = await requirePersonal();
    if (!user) return;
    $('#userChip').textContent = user.name || 'Personal';
    $('#avInit').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    const [data, metrics] = await Promise.all([
      api('GET', '/api/treinos/coach/me/dashboard'),
      api('GET', '/api/treinos/coach/me/metrics')
    ]);
    renderOverview(data);
    renderAdvancedMetrics(metrics);
    renderStudents(data);
  } catch (e) {
    toast('Erro: ' + e.message, true);
    $('#nextList').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    $('#studentGrid').innerHTML = `<div class="empty" style="grid-column:1/-1;color:var(--err)">${escapeHtml(e.message)}</div>`;
    $('#inactiveList').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', initPersonal);
