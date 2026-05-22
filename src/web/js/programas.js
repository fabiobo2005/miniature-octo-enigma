// ===== programas.js : SPA do aluno (catálogo / detalhe / execução) =====
// Roteamento por hash:
//   #/                     -> catálogo de programas
//   #/programa/:id         -> semanas + templates
//   #/treino/:tplId        -> inicia/continua sessão e abre execução
//   #/sessao/:sessionId    -> abre uma sessão já existente

const COR_TO_HEX = {
  amarelo:'#f0c419', verde:'#3aa55a', vermelho:'#d04848',
  azul:'#3a73c4', laranja:'#e58a2f', roxo:'#7e57c2',
  rosa:'#e26a8a', cinza:'#9aa0a6', preto:'#222',
  aerobio:'#2a9d8f', 'aeróbio':'#2a9d8f'
};
const NIVEL_LABEL = { iniciante:'Iniciante', intermediario:'Intermediário', avancado:'Avançado' };

const STATE = {
  currentSessionId: null,
  currentTemplate: null,
  currentProgram: null,
  totalTimer: { startedAt:null, intervalId:null },
  restTimer: { execId:null, remaining:0, intervalId:null, defaultSec:60 },
  saveDebouncers: new Map(),
};

function corHex(c){ return COR_TO_HEX[(c||'').toLowerCase()] || 'transparent'; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function num(v){ if(v===''||v==null) return null; const n=Number(v); return Number.isFinite(n)?n:null; }

// ---------- ROUTER ----------
function route(){
  const h = location.hash.replace(/^#/, '') || '/';
  const m1 = h.match(/^\/programa\/(\d+)$/);
  const m2 = h.match(/^\/treino\/(\d+)(?:\?semana=(\d+))?$/);
  const m3 = h.match(/^\/sessao\/(\d+)$/);
  stopTotalTimer();
  stopRestTimer();
  if (m1)      renderProgram(Number(m1[1]));
  else if (m2) startOrShowSession({templateId:Number(m2[1]), semana:m2[2]?Number(m2[2]):null});
  else if (m3) showSession(Number(m3[1]));
  else         renderList();
}

function show(view){
  ['List','Prog','Exec'].forEach(v => {
    const el = document.getElementById('view'+v);
    if (el) el.hidden = v.toLowerCase() !== view;
  });
}

// ---------- CATÁLOGO ----------
let _filterNivel = '';
async function renderList(){
  show('list');
  const grid = document.getElementById('progGrid');
  grid.innerHTML = '<div style="grid-column:1/-1;color:var(--mut);padding:16px;text-align:center">Carregando…</div>';
  try {
    const qs = _filterNivel ? `?nivel=${_filterNivel}` : '';
    const list = await api('GET', `/api/treinos/programas${qs}`);
    if (!list.length){
      grid.innerHTML = '<div style="grid-column:1/-1;color:var(--mut);padding:24px;text-align:center">Nenhum programa cadastrado.<br>Rode o importer (<code>npm run import:treinos</code>) na API.</div>';
      return;
    }
    grid.innerHTML = list.map(p => `
      <div class="progCard" onclick="location.hash='#/programa/${p.id}'">
        <h3>${escapeHtml(p.nome)}</h3>
        <div class="meta">
          <span class="nivelTag ${p.nivel}">${NIVEL_LABEL[p.nivel]||p.nivel}</span>
          <span class="small" style="color:var(--mut)">${p.duracao_semanas} semana(s)</span>
          <span class="small" style="color:var(--mut)">${p.templates_count} treinos</span>
        </div>
        ${p.objetivo?`<p class="small" style="margin:4px 0 0;color:var(--mut)">${escapeHtml(p.objetivo)}</p>`:''}
      </div>`).join('');
  } catch(e){
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--err);padding:16px;text-align:center">${escapeHtml(e.message)}</div>`;
  }
}

document.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.filterChip');
  if (!chip || !chip.parentElement || chip.parentElement.id !== 'filterBar') return;
  document.querySelectorAll('#filterBar .filterChip').forEach(c => c.classList.remove('on'));
  chip.classList.add('on');
  _filterNivel = chip.dataset.n || '';
  renderList();
});

// ---------- DETALHE ----------
async function renderProgram(id){
  show('prog');
  document.getElementById('progTitle').textContent = 'Carregando…';
  document.getElementById('weeksWrap').innerHTML = '';
  try {
    const p = await api('GET', `/api/treinos/programas/${id}`);
    STATE.currentProgram = p;
    document.getElementById('progTitle').textContent = p.nome;
    document.getElementById('progObj').textContent = p.objetivo || '';
    const nivelEl = document.getElementById('progNivel');
    nivelEl.className = `nivelTag ${p.nivel}`;
    nivelEl.textContent = NIVEL_LABEL[p.nivel] || p.nivel;
    document.getElementById('progSemanas').textContent = `${p.duracao_semanas} semana(s)`;
    const totalTpls = (p.semanas||[]).reduce((a,s)=>a+s.templates.length, 0);
    document.getElementById('progTpls').textContent = `${totalTpls} treinos`;

    const wrap = document.getElementById('weeksWrap');
    wrap.innerHTML = (p.semanas||[]).map((s, idx) => `
      <div class="weekBlock ${idx===0?'open':''}">
        <div class="weekHead" onclick="this.parentElement.classList.toggle('open')">
          <span>Semana ${s.semana_numero} <span style="font-weight:400;color:var(--mut);font-size:12px">· ${s.templates.length} treinos</span></span>
          <span class="chev">▸</span>
        </div>
        <div class="weekBody">
          ${s.templates.map(t => `
            <div class="tplRow" onclick="location.hash='#/treino/${t.id}'">
              <span class="corPill" style="background:${corHex(t.cor)}"></span>
              <div class="nm">${escapeHtml(t.nome_treino)}<div class="ct">${escapeHtml(t.cor)} · ${t.exercicios_count} exercícios</div></div>
              <span style="color:var(--pri);font-weight:700">▶︎</span>
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch(e){
    document.getElementById('weeksWrap').innerHTML = `<div style="color:var(--err);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- EXECUÇÃO ----------
async function startOrShowSession({templateId, semana}){
  show('exec');
  document.getElementById('execTitle').textContent = 'Iniciando…';
  document.getElementById('execExercises').innerHTML = '';
  try {
    // Se já houver sessão in_progress nesse template e hoje, reusa
    const existing = await api('GET', `/api/treinos/sessions?status=in_progress&limit=20`);
    const today = todayStr();
    const found = (existing||[]).find(s => s.workout_template_id === templateId && s.data && s.data.slice(0,10) === today);
    let sessionId;
    if (found) {
      sessionId = found.id;
      toast('Continuando treino em andamento');
    } else {
      const created = await api('POST', `/api/treinos/sessions`, { workout_template_id: templateId, ...(semana?{semana_numero:semana}:{}) });
      sessionId = created.id;
    }
    location.replace('#/sessao/' + sessionId);
  } catch(e){
    document.getElementById('execExercises').innerHTML = `<div style="color:var(--err);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function showSession(sessionId){
  show('exec');
  STATE.currentSessionId = sessionId;
  stopTotalTimer();
  stopRestTimer();
  document.getElementById('totalTimerBar').hidden = true;
  document.getElementById('execActions').hidden = true;
  document.getElementById('sessionStart').innerHTML = '';
  document.getElementById('execTitle').textContent = 'Carregando…';
  document.getElementById('execExercises').innerHTML = '';
  try {
    const s = await api('GET', `/api/treinos/sessions/${sessionId}`);
    STATE.currentTemplate = s;
    document.getElementById('execTitle').textContent = `${s.program_nome||'Programa'} · ${s.nome_treino||''}`;
    document.getElementById('execSub').textContent = `Semana ${s.semana_numero||'-'} · ${s.cor||''}`;
    document.getElementById('execBack').href = '#/programa/' + s.program_id;
    document.getElementById('sessionStart').innerHTML = renderSessionStart(s);
    const exercisesEl = document.getElementById('execExercises');
    exercisesEl.innerHTML = (s.exercicios||[]).map(renderExerciseCard).join('');
    exercisesEl.hidden = true;
    document.querySelectorAll('#execExercises input').forEach(inp => {
      inp.addEventListener('change', () => saveSetFromInput(inp));
    });
    const localStarted = getLocalStartedAt(sessionId);
    if (localStarted) activateWorkout(localStarted, { silent:true });
  } catch(e){
    document.getElementById('execExercises').innerHTML = `<div style="color:var(--err);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

function renderSessionStart(s){
  const exercises = s.exercicios || [];
  const qtd = exercises.length;
  const grupos = [...new Set(exercises.map(ex => ex.grupo_muscular).filter(Boolean))];
  const grupoTxt = grupos.length ? grupos.join(', ') : (s.cor || '—');
  const estMin = estimateWorkoutMinutes(exercises);
  return `
    <div class="sessionStartCard" id="sessionStartCard">
      <div class="small" style="text-transform:uppercase;letter-spacing:.5px;font-weight:700">Resumo da sessão</div>
      <h2 style="margin:4px 0 0">${escapeHtml(s.nome_treino || 'Treino')}</h2>
      <div class="sessionSummary">
        <div><b>${escapeHtml(grupoTxt)}</b><span>Grupo muscular</span></div>
        <div><b>${qtd}</b><span>Exercícios</span></div>
        <div><b>${estMin} min</b><span>Tempo estimado</span></div>
        <div><b>${escapeHtml(s.cor || '—')}</b><span>Treino</span></div>
      </div>
      <button class="btn full" onclick="confirmStartWorkout()">Iniciar treino</button>
    </div>`;
}

function estimateWorkoutMinutes(exercises){
  const totalSec = (exercises||[]).reduce((acc, ex) => {
    const sets = Number(ex.series) || (ex.sets?.length || 3);
    const rest = Number(ex.intervalo_seg) || 60;
    return acc + Math.max(1, sets) * (45 + rest);
  }, 0);
  return Math.max(1, Math.round(totalSec / 60));
}

function getLocalStartedAt(sessionId){
  const raw = localStorage.getItem(`workout-started-at:${sessionId}`);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function confirmStartWorkout(){
  if (!STATE.currentSessionId) return;
  if (!confirm('Pronto para começar?')) return;
  const startedAt = Date.now();
  localStorage.setItem(`workout-started-at:${STATE.currentSessionId}`, String(startedAt));
  if (STATE.currentTemplate) STATE.currentTemplate.started_at = new Date(startedAt).toISOString();
  activateWorkout(startedAt);
}

function activateWorkout(startedAt, opts={}){
  STATE.totalTimer.startedAt = startedAt;
  const startCard = document.getElementById('sessionStartCard');
  if (startCard) startCard.hidden = true;
  document.getElementById('execExercises').hidden = false;
  document.getElementById('totalTimerBar').hidden = false;
  document.getElementById('execActions').hidden = false;
  updateTotalTimer();
  if (STATE.totalTimer.intervalId) clearInterval(STATE.totalTimer.intervalId);
  STATE.totalTimer.intervalId = setInterval(updateTotalTimer, 1000);
  if (!opts.silent) toast('Treino iniciado');
}

function stopTotalTimer(){
  if (STATE.totalTimer.intervalId) clearInterval(STATE.totalTimer.intervalId);
  STATE.totalTimer.intervalId = null;
  STATE.totalTimer.startedAt = null;
}

function updateTotalTimer(){
  if (!STATE.totalTimer.startedAt) return;
  const elapsed = Math.floor((Date.now() - STATE.totalTimer.startedAt) / 1000);
  document.getElementById('totalTimerDisplay').textContent = fmtMMSS(elapsed);
}

function renderExerciseCard(ex){
  const sets = ex.sets && ex.sets.length ? ex.sets : [];
  const seriesAlvo = ex.series || Math.max(sets.length, 3);
  const restSec = Number(ex.intervalo_seg) || 60;
  const allSets = [];
  for (let i=1; i<=Math.max(seriesAlvo, sets.length); i++){
    const found = sets.find(x => x.set_numero === i);
    allSets.push(found || { set_numero:i, reps:null, carga:null, rpe:null });
  }
  return `
    <div class="exerCard ${ex.concluido?'done':''}" data-exec-id="${ex.id}" data-rest-sec="${restSec}">
      <div class="exerHead">
        <div>
          <h4>${escapeHtml(ex.exercise_nome || ex.nome_original || '—')}</h4>
          <div class="sub">${escapeHtml([ex.grupo_muscular, ex.metodo].filter(Boolean).join(' · '))||'&nbsp;'}</div>
        </div>
        <button class="doneBtn ${ex.concluido?'on':''}" onclick="toggleExecDone(${ex.id}, this)">
          ${ex.concluido?'✓ feito':'marcar'}
        </button>
      </div>
      <div class="prescGrid">
        <div><b>séries</b>${ex.series ?? '—'}</div>
        <div><b>reps</b>${escapeHtml(ex.reps||'—')}</div>
        <div><b>cadência</b>${escapeHtml(ex.cadencia||'—')}</div>
        <div><b>intervalo</b>${restSec}s</div>
      </div>
      <table class="setsTable">
        <thead><tr><th style="width:30px">#</th><th>reps</th><th>kg</th><th>RPE</th></tr></thead>
        <tbody>
          ${allSets.map(st => `
            <tr data-set="${st.set_numero}">
              <td style="text-align:center;font-weight:700;color:var(--mut)">${st.set_numero}</td>
              <td><input type="number" inputmode="numeric" min="0" max="999" step="1" data-f="reps" value="${st.reps??''}" placeholder="—"></td>
              <td><input type="number" inputmode="decimal" min="0" max="9999" step="0.5" data-f="carga" value="${st.carga??''}" placeholder="—"></td>
              <td><input type="number" inputmode="decimal" min="0" max="10" step="0.5" data-f="rpe" value="${st.rpe??''}" placeholder="—"></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="restPanel">
        <div>
          <div class="restClock" id="restClock-${ex.id}">${fmtMMSS(restSec)}</div>
          <div class="restMeta">Descanso prescrito · <span class="restBadge">✓ Descansado</span></div>
        </div>
        <div class="restBtns">
          <button class="pri" onclick="startRest(${ex.id})">Iniciar descanso</button>
          <button onclick="skipRest(${ex.id})">Pular descanso</button>
        </div>
      </div>
    </div>`;
}

async function saveSetFromInput(inp){
  const tr = inp.closest('tr[data-set]');
  const card = inp.closest('.exerCard');
  if (!tr || !card) return;
  const execId = Number(card.dataset.execId);
  const setNum = Number(tr.dataset.set);
  const reps  = num(tr.querySelector('input[data-f="reps"]').value);
  const carga = num(tr.querySelector('input[data-f="carga"]').value);
  const rpe   = num(tr.querySelector('input[data-f="rpe"]').value);
  if (reps==null && carga==null && rpe==null) return;
  const key = `${execId}-${setNum}`;
  clearTimeout(STATE.saveDebouncers.get(key));
  STATE.saveDebouncers.set(key, setTimeout(async () => {
    try {
      await api('POST', '/api/treinos/sets', { exercise_execution_id: execId, set_numero: setNum, reps, carga, rpe });
      inp.style.borderColor = 'var(--pri)';
      setTimeout(() => inp.style.borderColor = '', 600);
    } catch(e){ toast('Erro ao salvar: '+e.message, true); }
  }, 400));
}

async function toggleExecDone(execId, btn){
  const card = btn.closest('.exerCard');
  const willBeDone = !card.classList.contains('done');
  try {
    await api('PATCH', `/api/treinos/executions/${execId}`, { concluido: willBeDone });
    card.classList.toggle('done', willBeDone);
    btn.classList.toggle('on', willBeDone);
    btn.textContent = willBeDone ? '✓ feito' : 'marcar';
  } catch(e){ toast('Erro: '+e.message, true); }
}

async function finishSession(){
  if (!STATE.currentSessionId) return;
  const elapsedSec = STATE.totalTimer.startedAt ? Math.max(0, Math.floor((Date.now() - STATE.totalTimer.startedAt)/1000)) : 0;
  const duration = fmtMMSS(elapsedSec);
  if (!confirm(`Concluir treino?\nDuração total: ${duration}`)) return;
  try {
    const dur = elapsedSec ? Math.max(1, Math.round(elapsedSec/60)) : null;
    await api('PATCH', `/api/treinos/sessions/${STATE.currentSessionId}`, { status:'finished', ...(dur?{duracao_min:dur}:{}) });
    localStorage.removeItem(`workout-started-at:${STATE.currentSessionId}`);
    stopTotalTimer();
    stopRestTimer();
    toast(`Treino concluído em ${duration} ✓`);
    setTimeout(() => location.hash = '#/', 800);
  } catch(e){ toast('Erro: '+e.message, true); }
}
async function abortSession(){
  if (!STATE.currentSessionId) return;
  if (!confirm('Abandonar este treino? O progresso fica registrado, mas a sessão será marcada como abortada.')) return;
  try {
    await api('PATCH', `/api/treinos/sessions/${STATE.currentSessionId}`, { status:'aborted' });
    localStorage.removeItem(`workout-started-at:${STATE.currentSessionId}`);
    stopTotalTimer();
    stopRestTimer();
    toast('Sessão abortada');
    setTimeout(() => location.hash = '#/', 600);
  } catch(e){ toast('Erro: '+e.message, true); }
}

// ---------- TIMERS ----------
function fmtMMSS(s){ s=Math.max(0,Math.floor(s)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function startRest(execId){
  const card = document.querySelector(`.exerCard[data-exec-id="${execId}"]`);
  if (!card) return;
  stopRestTimer();
  card.classList.remove('rested');
  STATE.restTimer.execId = execId;
  STATE.restTimer.defaultSec = Number(card.dataset.restSec) || 60;
  STATE.restTimer.remaining = STATE.restTimer.defaultSec;
  updateRestDisplay(execId);
  STATE.restTimer.intervalId = setInterval(tickRestTimer, 1000);
}
function stopRestTimer(){
  if (STATE.restTimer.intervalId) clearInterval(STATE.restTimer.intervalId);
  STATE.restTimer.intervalId = null;
  STATE.restTimer.execId = null;
}
function tickRestTimer(){
  STATE.restTimer.remaining--;
  const execId = STATE.restTimer.execId;
  if (!execId) return;
  if (STATE.restTimer.remaining <= 0){
    finishRest(execId, true);
    return;
  }
  updateRestDisplay(execId);
}
function updateRestDisplay(execId){
  const el = document.getElementById(`restClock-${execId}`);
  if (!el) return;
  el.textContent = fmtMMSS(STATE.restTimer.remaining);
  el.className = 'restClock' + (STATE.restTimer.remaining <= 3 ? ' go' : (STATE.restTimer.remaining <= 10 ? ' warn' : ''));
}
function skipRest(execId){
  finishRest(execId, false);
}
function finishRest(execId, shouldBeep){
  const el = document.getElementById(`restClock-${execId}`);
  const card = document.querySelector(`.exerCard[data-exec-id="${execId}"]`);
  if (STATE.restTimer.execId === execId) stopRestTimer();
  if (el) { el.textContent = '00:00'; el.className = 'restClock'; }
  if (card) card.classList.add('rested');
  if (shouldBeep) {
    beep();
    if (navigator.vibrate) navigator.vibrate([180,80,180]);
  }
}
function beep(){
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 880; g.gain.value = 0.2;
    o.start();
    setTimeout(() => { o.stop(); ac.close(); }, 250);
  } catch {}
}

// ---------- bootstrap ----------
document.addEventListener('DOMContentLoaded', () => {
  if (!USER.require()) return;
  applyUserChip();
  window.addEventListener('hashchange', route);
  route();
});
