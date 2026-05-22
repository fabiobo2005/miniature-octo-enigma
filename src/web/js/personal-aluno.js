// ===== personal-aluno.js : drill-down do aluno =====
const COR_TO_HEX = { amarelo:'#f0c419', verde:'#3aa55a', vermelho:'#d04848', azul:'#3a73c4', laranja:'#e58a2f', roxo:'#7e57c2', rosa:'#e26a8a', cinza:'#9aa0a6', preto:'#222', aerobio:'#2a9d8f', 'aeróbio':'#2a9d8f' };
const HISTORY_PAGE_SIZE = 200;
const DETAIL_PAGE_SIZE = 20;
const NIVEL_LABEL = { iniciante:'Iniciante', intermediario:'Intermediário', avancado:'Avançado' };
let ALUNO_ID = null;
let offset = 0;
let total = 0;
let renderedSessions = 0;
let historySessions = [];
let catalogPrograms = [];
let weeklyChart = null;

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function corHex(c){ return COR_TO_HEX[(c||'').toLowerCase()] || 'transparent'; }
function fmtDateTime(v){ return v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'; }
function fmtDateOnly(v){ return v ? new Date(v).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' }) : '—'; }
function pct(v){ const n = Number(v || 0); return Math.max(0, Math.min(100, n)); }
function kg(v){ const n = Number(v || 0); return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`; }
function sessionDurationMin(s){
  const direct = Number(s.duracao_min ?? s.duration_min ?? 0);
  if (direct > 0) return Math.round(direct);
  if (s.started_at && s.finished_at) {
    const diff = (new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 60000;
    if (Number.isFinite(diff) && diff > 0) return Math.round(diff);
  }
  return null;
}
function sessionIntensity(s){
  if (s.intensidade) return s.intensidade;
  if (s.intensity) return s.intensity;
  if (s.pse == null) return '—';
  const pse = Number(s.pse);
  if (!Number.isFinite(pse)) return '—';
  if (pse <= 3) return 'leve';
  if (pse <= 6) return 'moderado';
  if (pse <= 8) return 'forte';
  return 'maximo';
}

function ensureUserFromLegacy(user){ if (!USER.id() && user?.id) USER.set(user); }
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

function renderDashboard(data){
  const aluno = data.aluno || {};
  const m = data.metricas || {};
  $('#studentName').textContent = aluno.name || 'Aluno';
  document.title = `APEX · ${aluno.name || 'Aluno'}`;
  $('#mSess30').textContent = m.sessoes_ultimos_30d || 0;
  $('#mVolume').textContent = kg(m.volume_total_kg);
  $('#mAdesao').textContent = `${pct(m.pct_adesao_30d)}%`;

  const pa = data.programa_atual;
  if (!pa) {
    $('#programBox').className = 'empty';
    $('#programBox').textContent = 'Sem programa ativo.';
    return;
  }
  const dur = pa.duracao_semanas || pa.program?.duracao_semanas || 1;
  const week = pa.semana_atual || 1;
  const progress = pct((week / dur) * 100);
  $('#programBox').className = '';
  $('#programBox').innerHTML = `
    <div><b>${escapeHtml(pa.program?.nome || pa.nome || 'Programa')}</b></div>
    <div class="metaLine">Semana ${week} de ${dur} · iniciado em ${pa.started_on ? fmtDate(pa.started_on) : '—'}</div>
    <div class="progress"><i style="width:${progress}%"></i></div>
    <div class="metaLine" style="margin-top:10px">${(pa.dias||[]).length} treino(s) previstos para a semana atual</div>`;
}

function renderSession(s){
  return `<details class="session">
    <summary><span class="dot" style="background:${corHex(s.cor)}"></span><div><b>${escapeHtml(s.nome_treino || 'Treino')}</b><div class="metaLine">Semana ${s.semana_numero || '—'} · ${fmtDateTime(s.started_at)} · ${escapeHtml(s.status || '')}</div></div></summary>
    <div class="sessBody">
      ${(s.exercicios || []).length ? s.exercicios.map(ex => `
        <div class="exBlock">
          <b>${escapeHtml(ex.exercise_nome || 'Exercício')}</b>
          <div class="metaLine">${escapeHtml(ex.grupo_muscular || '')}</div>
          ${(ex.sets || []).length ? `<table class="sets"><thead><tr><th>#</th><th>Reps</th><th>Kg</th><th>RPE</th></tr></thead><tbody>${ex.sets.map(st => `<tr><td>${st.set_numero ?? '—'}</td><td>${st.reps ?? '—'}</td><td>${st.carga ?? '—'}</td><td>${st.rpe ?? '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="metaLine">Sem sets registrados.</div>'}
        </div>`).join('') : '<div class="empty">Sem exercícios nesta sessão.</div>'}
    </div>
  </details>`;
}

function updateLoadMoreVisibility(){
  $('#loadMoreBtn').hidden = renderedSessions >= historySessions.length && offset >= total;
}

function renderDetailedSessions(reset){
  if (reset) {
    renderedSessions = 0;
    $('#sessionsList').innerHTML = '';
  }
  const next = historySessions.slice(renderedSessions, renderedSessions + DETAIL_PAGE_SIZE);
  const html = next.map(renderSession).join('');
  if (!renderedSessions) $('#sessionsList').innerHTML = html || '<div class="empty">Nenhuma sessão registrada.</div>';
  else $('#sessionsList').insertAdjacentHTML('beforeend', html);
  renderedSessions += next.length;
  updateLoadMoreVisibility();
}

function renderLastSessionsTable(){
  const rows = historySessions.slice(0, 10);
  const box = $('#lastSessionsTable');
  box.className = rows.length ? '' : 'empty';
  box.innerHTML = rows.length ? `<table class="sessionTable"><thead><tr><th>Data</th><th>Programa</th><th>Intensidade</th><th>Duração</th></tr></thead><tbody>${rows.map(s => {
    const dur = sessionDurationMin(s);
    return `<tr><td>${escapeHtml(fmtDateOnly(s.started_at || s.data))}</td><td>${escapeHtml(s.programa_nome || s.program_nome || s.nome_treino || '—')}</td><td>${escapeHtml(sessionIntensity(s))}</td><td>${dur == null ? '—' : `${dur} min`}</td></tr>`;
  }).join('')}</tbody></table>` : 'Nenhuma sessão registrada.';
}

function startOfWeek(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const delta = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - delta);
  return d;
}
function keyDate(d){ return d.toISOString().slice(0,10); }

function renderWeeklyChart(){
  const canvas = $('#weeklySessionsChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const current = startOfWeek(new Date());
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(current);
    d.setDate(current.getDate() - (i * 7));
    weeks.push({ key: keyDate(d), label: d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }), count: 0 });
  }
  const firstWeek = new Date(weeks[0].key + 'T00:00:00');
  historySessions.forEach(s => {
    const raw = s.started_at || s.data;
    if (!raw) return;
    const d = new Date(raw);
    if (d < firstWeek) return;
    const key = keyDate(startOfWeek(d));
    const bucket = weeks.find(w => w.key === key);
    if (bucket) bucket.count += 1;
  });
  if (weeklyChart) weeklyChart.destroy();
  const styles = getComputedStyle(document.body);
  weeklyChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: weeks.map(w => w.label), datasets: [{ label: 'Sessões', data: weeks.map(w => w.count), backgroundColor: styles.getPropertyValue('--pri').trim() || '#7BC4A4', borderRadius: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function csvEscape(v){ return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function exportCsv(){
  if (!historySessions.length) { toast('Sem histórico para exportar.', true); return; }
  const header = ['data','programa','duracao_min','intensidade'];
  const lines = historySessions.map(s => [
    fmtDateOnly(s.started_at || s.data),
    s.programa_nome || s.program_nome || s.nome_treino || '',
    sessionDurationMin(s) ?? '',
    sessionIntensity(s)
  ].map(csvEscape).join(','));
  const blob = new Blob(['\ufeff' + [header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio-aluno-${ALUNO_ID}-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadDashboard(){
  const data = await api('GET', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/dashboard`);
  renderDashboard(data);
}

async function fetchHistoryPage(){
  const data = await api('GET', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/historico?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`);
  total = data.total || 0;
  const sessoes = data.sessoes || [];
  historySessions = historySessions.concat(sessoes);
  offset += sessoes.length;
}

async function loadHistory(reset){
  if (reset) {
    offset = 0;
    total = 0;
    renderedSessions = 0;
    historySessions = [];
    $('#sessionsList').innerHTML = '<div class="empty">Carregando…</div>';
    $('#lastSessionsTable').innerHTML = '<div class="empty">Carregando…</div>';
    await fetchHistoryPage();
    renderDetailedSessions(true);
    renderLastSessionsTable();
    renderWeeklyChart();
    return;
  }
  if (renderedSessions >= historySessions.length && offset < total) await fetchHistoryPage();
  renderDetailedSessions(false);
  renderLastSessionsTable();
  renderWeeklyChart();
}

function openProgramModal(){
  $('#programModalScrim').hidden = false;
  $('#programModalScrim').classList.add('open');
  $('#programModal').classList.add('open');
  loadProgramCatalog().catch(e => toast('Erro: ' + e.message, true));
}

function closeProgramModal(){
  $('#programModalScrim').classList.remove('open');
  $('#programModal').classList.remove('open');
  $('#programModalScrim').hidden = true;
}

function renderProgramCatalog(){
  const nivel = $('#programNivelFilter').value;
  const rows = catalogPrograms.filter(p => !nivel || p.nivel === nivel);
  $('#programCatalogList').innerHTML = rows.length ? rows.map(p => `
    <div class="programRow">
      <div>
        <b>${escapeHtml(p.nome)}</b>
        <div class="metaLine">${escapeHtml(NIVEL_LABEL[p.nivel] || p.nivel)} · ${p.duracao_semanas || '—'} semana(s) · ${p.templates_count || 0} treino(s)</div>
        <p>${escapeHtml(p.objetivo || 'Sem objetivo descrito.')}</p>
      </div>
      <button class="btn" type="button" data-assign-program="${p.id}">Atribuir</button>
    </div>`).join('') : '<div class="empty">Nenhum programa encontrado para o filtro.</div>';
}

async function loadProgramCatalog(){
  $('#programCatalogList').innerHTML = '<div class="empty">Carregando…</div>';
  catalogPrograms = await api('GET', '/api/treinos/programas?ativo=true');
  renderProgramCatalog();
}

async function assignProgram(programId){
  const program = catalogPrograms.find(p => Number(p.id) === Number(programId));
  const msg = program ? `Atribuir "${program.nome}" a este aluno?` : 'Atribuir este programa ao aluno?';
  if (!confirm(msg)) return;
  await api('POST', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/assign-program`, { programa_id: Number(programId) });
  toast('Programa atribuído.');
  closeProgramModal();
  await loadDashboard();
  await loadHistory(true);
}

async function createAndAssignProgram(form){
  const fd = new FormData(form);
  const payload = {
    nivel: fd.get('nivel'),
    nome: String(fd.get('nome') || '').trim() || undefined,
    objetivo: String(fd.get('objetivo') || '').trim() || undefined,
    duracao_semanas: Number(fd.get('duracao_semanas') || 1),
  };
  const programa = await api('POST', '/api/treinos/coach/programas', payload);
  catalogPrograms.push(programa);
  await api('POST', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/assign-program`, { programa_id: Number(programa.id) });
  toast('Programa criado e atribuído.');
  form.reset();
  closeProgramModal();
  await loadDashboard();
  await loadHistory(true);
}

function bindProgramModal(){
  $('#assignProgramBtn').addEventListener('click', openProgramModal);
  $('#closeProgramModalBtn').addEventListener('click', closeProgramModal);
  $('#programModalScrim').addEventListener('click', ev => { if (ev.target === $('#programModalScrim')) closeProgramModal(); });
  $('#programNivelFilter').addEventListener('change', renderProgramCatalog);
  $('#reloadProgramsBtn').addEventListener('click', () => loadProgramCatalog().catch(e => toast('Erro: ' + e.message, true)));
  $('#programCatalogList').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-assign-program]');
    if (!btn) return;
    assignProgram(btn.dataset.assignProgram).catch(e => toast('Erro: ' + e.message, true));
  });
  document.querySelectorAll('[data-program-tab]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-program-tab]').forEach(b => b.classList.toggle('on', b === btn));
    const tab = btn.dataset.programTab;
    $('#programCatalogTab').hidden = tab !== 'catalog';
    $('#programCreateTab').hidden = tab !== 'create';
  }));
  $('#quickProgramForm').addEventListener('submit', ev => {
    ev.preventDefault();
    createAndAssignProgram(ev.currentTarget).catch(e => toast('Erro: ' + e.message, true));
  });
}

async function initAluno(){
  try {
    const params = new URLSearchParams(location.search);
    ALUNO_ID = params.get('id');
    if (!ALUNO_ID) { location.replace('/personal.html'); return; }
    const user = await requirePersonal();
    if (!user) return;
    bindProgramModal();
    $('#exportCsvBtn').addEventListener('click', exportCsv);
    await loadDashboard();
    await loadHistory(true);
    $('#loadMoreBtn').addEventListener('click', () => loadHistory(false).catch(e => toast('Erro: '+e.message, true)));
  } catch (e) {
    toast('Erro: ' + e.message, true);
    $('#sessionsList').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    $('#lastSessionsTable').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', initAluno);
