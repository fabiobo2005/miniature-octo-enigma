// ===== treinos.js : tela única do aluno (programa + próximo treino + catálogo básico) =====
const NIVEL_LABEL = { iniciante:'Iniciante', intermediario:'Intermediário', avancado:'Avançado' };
const COR_TO_HEX = {
  amarelo:'#f0c419', verde:'#3aa55a', vermelho:'#d04848', azul:'#3a73c4', laranja:'#e58a2f',
  roxo:'#7e57c2', rosa:'#e26a8a', cinza:'#9aa0a6', preto:'#222', aerobio:'#2a9d8f', 'aeróbio':'#2a9d8f'
};

const TSTATE = { user:null, atual:null, proximo:null, sessions:[], programs:[], filter:'', chooserVisible:false };

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function corHex(c){ return COR_TO_HEX[String(c || '').toLowerCase()] || '#9aa0a6'; }
function nivelLabel(n){ return NIVEL_LABEL[n] || n || '—'; }
function pct(n){ const v = Number(n || 0); return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)); }
function fmtLongDate(v){ if(!v) return '—'; return new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}); }
function statusLabel(s){ return ({in_progress:'em andamento', finished:'finalizado', concluido:'concluído', aborted:'abandonado'}[s] || s || '—'); }
function coachInitials(name){
  const parts = String(name || 'Personal').trim().split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] || 'P'])
    .map(p => p.charAt(0).toUpperCase()).join('');
  return initials || 'P';
}
function coachSpecialtyText(coach){
  const role = coach?.role === 'personal' ? 'Personal' : (coach?.role || 'Personal');
  return [role, coach?.goal].filter(Boolean).join(' - ');
}
function sessionTime(s){ return s.finished_at || s.started_at || s.data; }
function app(){ return document.getElementById('treinosApp'); }

async function loadUser(){
  const stored = USER.get();
  try {
    TSTATE.user = await apiRaw('GET', `/api/users/${encodeURIComponent(stored.id)}`);
    if (TSTATE.user?.name) document.getElementById('userChip').textContent = TSTATE.user.name;
  } catch (e) {
    TSTATE.user = stored;
  }
}

async function loadDashboard(){
  app().innerHTML = '<div class="loading">Carregando treinos…</div>';
  try {
    await loadUser();
    const [atual, proximo] = await Promise.all([
      api('GET','/api/treinos/me/assignments/atual'),
      api('GET','/api/treinos/me/proximo-treino')
    ]);
    TSTATE.atual = atual;
    TSTATE.proximo = proximo;
    TSTATE.sessions = atual?.assignment ? await api('GET','/api/treinos/sessions?limit=200') : [];
    render();
  } catch (e) {
    app().innerHTML = `<div class="card errorBox"><h2>Não foi possível carregar treinos</h2><p class="small">${escapeHtml(e.message)}</p><button class="btn" onclick="loadDashboard()">Tentar novamente</button></div>`;
  }
}

function render(){
  const status = TSTATE.proximo?.status;
  if (!TSTATE.atual?.assignment || status === 'sem-programa') return renderChooserOnly();
  if (status === 'programa-concluido') return renderCompleted();
  return renderActive();
}

function renderActive(){
  const atual = TSTATE.atual;
  const program = atual.program || TSTATE.proximo.program || {};
  const progress = atual.progress || {};
  const currentWeek = progress.semana_atual || TSTATE.proximo.semana_atual || 1;
  const days = progress.dias_no_programa ?? TSTATE.proximo.dias_no_programa ?? 0;
  const percent = pct(progress.pct);
  const next = TSTATE.proximo.proximo_template;
  const programSessions = TSTATE.sessions.filter(s => !program.id || s.program_id === program.id);
  const lastFive = TSTATE.sessions.slice(0,5);
  const coach = atual.coach;
  app().innerHTML = `
    ${programCard(program, currentWeek, days, percent)}
    ${coachPanel(coach)}
    ${nextWorkoutCard(next, TSTATE.proximo.status)}
    <div class="card">
      <h2>Últimas sessões <span class="sub">${lastFive.length} de ${TSTATE.sessions.length}</span></h2>
      ${renderSessions(lastFive)}
    </div>
    <details class="history">
      <summary>Histórico do programa</summary>
      ${renderHistory(programSessions)}
    </details>
    <section id="chooserMount" hidden></section>`;
}

function programCard(program, currentWeek, days, percent){
  return `<section class="programHero">
    <div class="heroContent">
      <div class="heroTop">
        <div>
          <h2>${escapeHtml(program.nome || 'Programa atual')}</h2>
          <div class="programMeta">
            <span>Semana ${currentWeek} de ${program.duracao_semanas || '—'} (${percent}%)</span>
            <span>·</span><span>Há ${days} dia${Number(days) === 1 ? '' : 's'}</span>
          </div>
        </div>
        <span class="nivelTag ${escapeHtml(program.nivel || '')}">${escapeHtml(nivelLabel(program.nivel))}</span>
      </div>
      <div class="progressTrack" aria-label="Progresso do programa"><div class="progressFill" style="width:${percent}%"></div></div>
      <div class="programActions"><button class="subtleLink" id="toggleChooser" type="button">Trocar programa</button></div>
    </div>
  </section>`;
}

function coachPanel(coach){
  if (!coach) {
    return `<div class="noCoachNote">💡 Você ainda não tem um personal atribuído. <a href="/treinos.html">Encontrar personal</a></div>`;
  }
  const name = coach.name || 'Seu personal';
  const avatar = coach.avatar_url
    ? `<img src="${escapeHtml(coach.avatar_url)}" alt="${escapeHtml(name)}">`
    : escapeHtml(coachInitials(name));
  return `<section class="coach-card" aria-label="Seu personal">
    <div class="coach-avatar">${avatar}</div>
    <div>
      <p class="coach-label">Seu personal</p>
      <h3>${escapeHtml(name)}</h3>
      <p class="coach-specialty">${escapeHtml(coachSpecialtyText(coach))}</p>
      <button class="coach-message-btn" type="button" disabled title="Em breve — chat com seu personal">Enviar mensagem</button>
    </div>
  </section>`;
}

function nextWorkoutCard(next, status){
  if (!next) {
    const msg = status === 'semana-completa' ? 'Semana completa. O próximo treino aparecerá na próxima etapa.' : 'Nenhum treino sugerido agora.';
    return `<div class="nextCard disabled"><p class="lbl">Próximo treino</p><h2>${msg}</h2></div>`;
  }
  return `<a class="nextCard" href="/programas.html#/treino/${encodeURIComponent(next.id)}">
    <p class="lbl">Iniciar treino sugerido</p>
    <h2>▶ ${escapeHtml(next.nome_treino || 'Treino')}</h2>
    <div class="desc"><span class="colorDot" style="background:${corHex(next.cor)}"></span>${escapeHtml(next.cor || 'treino')} · ${escapeHtml(next.nome_treino || '')} · ${next.exercicios_count || 0} exercícios</div>
  </a>`;
}

function renderSessions(list){
  if (!list.length) return '<div class="empty"><div class="em">🏋️</div><p>Nenhuma sessão registrada ainda.</p></div>';
  return `<div class="sessionList">${list.map(s => `<a class="sessionRow" href="/programas.html#/sessao/${encodeURIComponent(s.id)}">
    <span class="colorDot" style="background:${corHex(s.cor)}"></span>
    <span><span class="sessionTitle">${escapeHtml(s.nome_treino || s.program_nome || 'Treino')}</span><span class="sessionMeta">${fmtLongDate(sessionTime(s))}${s.cor ? ' · ' + escapeHtml(s.cor) : ''}</span></span>
    <span class="statusTag ${escapeHtml(s.status || '')}">${escapeHtml(statusLabel(s.status))}</span>
  </a>`).join('')}</div>`;
}

function renderHistory(list){
  if (!list.length) return '<div class="weekGroup"><div class="empty"><p>Sem sessões neste programa ainda.</p></div></div>';
  const groups = new Map();
  for (const s of list) {
    const key = s.semana_numero || '—';
    const arr = groups.get(key) || [];
    arr.push(s); groups.set(key, arr);
  }
  return [...groups.entries()].sort((a,b) => Number(b[0]) - Number(a[0])).map(([week, rows]) => `
    <div class="weekGroup"><h3>Semana ${escapeHtml(week)}</h3>${renderSessions(rows)}</div>`).join('');
}

function renderCompleted(){
  const program = TSTATE.proximo.program || TSTATE.atual.program || {};
  const programSessions = TSTATE.sessions.filter(s => !program.id || s.program_id === program.id);
  const sugestoes = (TSTATE.proximo.sugestoes || []).slice(0,5);
  app().innerHTML = `
    <section class="doneHero">
      <h2>🎉 Você concluiu o ${escapeHtml(program.nome || 'programa')}!</h2>
      <p>${program.duracao_semanas || '—'} semanas, ${programSessions.length} sessões.</p>
    </section>
    <div class="card">
      <h2>Sugestões</h2>
      ${sugestoes.length ? `<div class="suggestGrid">${sugestoes.map(renderSuggestion).join('')}</div>` : '<div class="empty"><p>Nenhuma sugestão disponível agora.</p></div>'}
    </div>
    <p style="text-align:center"><a class="subtleLink" href="/programas.html">Ver catálogo completo →</a></p>`;
}

function renderSuggestion(p){
  const id = p.program_id || p.id;
  return `<article class="progCard">
    <div class="meta"><span class="nivelTag ${escapeHtml(p.nivel || '')}">${escapeHtml(nivelLabel(p.nivel))}</span></div>
    <h3>${escapeHtml(p.nome)}</h3>
    <p>Motivo: ${escapeHtml(p.motivo || 'Boa sequência para seu progresso.')}</p>
    <button class="btn full assignProgram" data-id="${escapeHtml(id)}">Atribuir este programa</button>
  </article>`;
}

async function renderChooserOnly(){
  app().innerHTML = `${chooserBanner()}<section class="card"><h2>Escolher programa</h2>${filterBar()}<div id="programGrid" class="progGrid"><div class="loading">Carregando catálogo…</div></div></section>`;
  await loadPrograms();
}

function chooserBanner(){
  return `<section class="banner"><h2>Você ainda não tem um programa ativo.</h2><p>Escolha um programa para começar:</p></section>`;
}
function filterBar(){
  const chips = [['iniciante','Iniciante'],['intermediario','Intermediário'],['avancado','Avançado'],['','Todos']];
  return `<div class="filterBar" id="filterBar">${chips.map(([v,label]) => `<button class="filterChip ${TSTATE.filter === v ? 'on' : ''}" data-filter="${v}">${label}</button>`).join('')}</div>`;
}

async function showChooserInline(){
  const mount = document.getElementById('chooserMount');
  if (!mount) return;
  TSTATE.chooserVisible = !TSTATE.chooserVisible;
  mount.hidden = !TSTATE.chooserVisible;
  if (!TSTATE.chooserVisible) return;
  mount.innerHTML = `<section class="card"><h2>Trocar programa</h2><p class="small" style="color:var(--mut);margin-top:-6px">Ao iniciar outro programa, ele substituirá o atual.</p>${filterBar()}<div id="programGrid" class="progGrid"><div class="loading">Carregando catálogo…</div></div></section>`;
  await loadPrograms();
  mount.scrollIntoView({behavior:'smooth', block:'start'});
}

async function loadPrograms(){
  const grid = document.getElementById('programGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Carregando catálogo…</div>';
  try {
    const qs = TSTATE.filter ? `?nivel=${encodeURIComponent(TSTATE.filter)}` : '';
    TSTATE.programs = await api('GET', `/api/treinos/programas${qs}`);
    grid.innerHTML = TSTATE.programs.length ? TSTATE.programs.map(renderProgramChoice).join('') : '<div class="empty"><p>Nenhum programa encontrado.</p></div>';
  } catch (e) {
    grid.innerHTML = `<div class="empty" style="color:var(--err)"><p>${escapeHtml(e.message)}</p></div>`;
  }
}

function renderProgramChoice(p){
  return `<article class="progCard">
    <div class="meta"><span class="nivelTag ${escapeHtml(p.nivel || '')}">${escapeHtml(nivelLabel(p.nivel))}</span><span>${p.duracao_semanas || '—'} semanas</span><span>${p.templates_count || 0} treinos</span></div>
    <h3>${escapeHtml(p.nome)}</h3>
    ${p.objetivo ? `<p>${escapeHtml(p.objetivo)}</p>` : ''}
    <button class="btn full assignProgram" data-id="${escapeHtml(p.id)}">Iniciar este programa</button>
  </article>`;
}

async function assignProgram(programId, btn){
  if (!programId) return;
  const oldText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Atribuindo…'; }
  try {
    await api('POST','/api/treinos/me/assignments', { program_id:Number(programId) });
    toast('Programa atribuído ✓');
    await loadDashboard();
  } catch (e) {
    toast('Erro: ' + e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

document.addEventListener('click', (ev) => {
  const filter = ev.target.closest('.filterChip');
  if (filter) {
    TSTATE.filter = filter.dataset.filter || '';
    document.querySelectorAll('.filterChip').forEach(b => b.classList.toggle('on', b === filter));
    loadPrograms();
    return;
  }
  const assign = ev.target.closest('.assignProgram');
  if (assign) {
    assignProgram(assign.dataset.id, assign);
    return;
  }
  const toggle = ev.target.closest('#toggleChooser');
  if (toggle) showChooserInline();
});

document.addEventListener('DOMContentLoaded', () => {
  if (!USER.require()) return;
  applyUserChip();
  loadDashboard();
});
