// ===== personal-aluno.js : drill-down do aluno =====
const COR_TO_HEX = { amarelo:'#f0c419', verde:'#3aa55a', vermelho:'#d04848', azul:'#3a73c4', laranja:'#e58a2f', roxo:'#7e57c2', rosa:'#e26a8a', cinza:'#9aa0a6', preto:'#222', aerobio:'#2a9d8f', 'aeróbio':'#2a9d8f' };
const PAGE_SIZE = 20;
const NIVEL_LABEL = { iniciante:'Iniciante', intermediario:'Intermediário', avancado:'Avançado' };
let ALUNO_ID = null;
let offset = 0;
let total = 0;
let catalogPrograms = [];

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function corHex(c){ return COR_TO_HEX[(c||'').toLowerCase()] || 'transparent'; }
function fmtDateTime(v){ return v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'; }
function pct(v){ const n = Number(v || 0); return Math.max(0, Math.min(100, n)); }
function kg(v){ const n = Number(v || 0); return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`; }

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

async function loadDashboard(){
  const data = await api('GET', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/dashboard`);
  renderDashboard(data);
}

async function loadHistory(reset){
  if (reset) { offset = 0; total = 0; $('#sessionsList').innerHTML = '<div class="empty">Carregando…</div>'; }
  const data = await api('GET', `/api/treinos/coach/alunos/${encodeURIComponent(ALUNO_ID)}/historico?limit=${PAGE_SIZE}&offset=${offset}`);
  total = data.total || 0;
  const html = (data.sessoes || []).map(renderSession).join('');
  if (offset === 0) $('#sessionsList').innerHTML = html || '<div class="empty">Nenhuma sessão registrada.</div>';
  else $('#sessionsList').insertAdjacentHTML('beforeend', html);
  offset += (data.sessoes || []).length;
  $('#loadMoreBtn').hidden = offset >= total;
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
    await loadDashboard();
    await loadHistory(true);
    $('#loadMoreBtn').addEventListener('click', () => loadHistory(false).catch(e => toast('Erro: '+e.message, true)));
  } catch (e) {
    toast('Erro: ' + e.message, true);
    $('#sessionsList').innerHTML = `<div class="empty" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', initAluno);
