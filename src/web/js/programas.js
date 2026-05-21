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
  timer: { remaining:0, running:false, intervalId:null, defaultSec:60 },
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
  closeTimer();
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
  document.getElementById('execTitle').textContent = 'Carregando…';
  document.getElementById('execExercises').innerHTML = '';
  try {
    const s = await api('GET', `/api/treinos/sessions/${sessionId}`);
    STATE.currentTemplate = s;
    document.getElementById('execTitle').textContent = `${s.program_nome||'Programa'} · ${s.nome_treino||''}`;
    document.getElementById('execSub').textContent = `Semana ${s.semana_numero||'-'} · ${s.cor||''} · iniciado em ${new Date(s.started_at).toLocaleString('pt-BR')}`;
    document.getElementById('execBack').href = '#/programa/' + s.program_id;
    document.getElementById('execExercises').innerHTML = (s.exercicios||[]).map(renderExerciseCard).join('');
    // Bind autosave em todos inputs
    document.querySelectorAll('#execExercises input').forEach(inp => {
      inp.addEventListener('change', () => saveSetFromInput(inp));
    });
  } catch(e){
    document.getElementById('execExercises').innerHTML = `<div style="color:var(--err);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

function renderExerciseCard(ex){
  const sets = ex.sets && ex.sets.length ? ex.sets : [];
  const seriesAlvo = ex.series || Math.max(sets.length, 3);
  // Garante linhas para o nº de séries prescritas (preenchidas com vazias)
  const allSets = [];
  for (let i=1; i<=Math.max(seriesAlvo, sets.length); i++){
    const found = sets.find(x => x.set_numero === i);
    allSets.push(found || { set_numero:i, reps:null, carga:null, rpe:null });
  }
  return `
    <div class="exerCard ${ex.concluido?'done':''}" data-exec-id="${ex.id}">
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
        <div><b>intervalo</b>${ex.intervalo_seg?ex.intervalo_seg+'s':'—'}</div>
      </div>
      <table class="setsTable">
        <thead><tr><th style="width:30px">#</th><th>reps</th><th>kg</th><th>RPE</th><th style="width:34px"></th></tr></thead>
        <tbody>
          ${allSets.map(st => `
            <tr data-set="${st.set_numero}">
              <td style="text-align:center;font-weight:700;color:var(--mut)">${st.set_numero}</td>
              <td><input type="number" inputmode="numeric" min="0" max="999" step="1" data-f="reps" value="${st.reps??''}" placeholder="—"></td>
              <td><input type="number" inputmode="decimal" min="0" max="9999" step="0.5" data-f="carga" value="${st.carga??''}" placeholder="—"></td>
              <td><input type="number" inputmode="decimal" min="0" max="10" step="0.5" data-f="rpe" value="${st.rpe??''}" placeholder="—"></td>
              <td style="text-align:center">
                <button title="Iniciar timer (${ex.intervalo_seg||60}s)" style="background:transparent;border:none;cursor:pointer;font-size:16px;padding:4px"
                  onclick="openTimer(${ex.intervalo_seg||60})">⏱</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
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
  if (!confirm('Finalizar este treino?')) return;
  try {
    const started = STATE.currentTemplate?.started_at ? new Date(STATE.currentTemplate.started_at) : null;
    const dur = started ? Math.max(1, Math.round((Date.now() - started.getTime())/60000)) : null;
    await api('PATCH', `/api/treinos/sessions/${STATE.currentSessionId}`, { status:'finished', ...(dur?{duracao_min:dur}:{}) });
    toast('Treino finalizado ✓');
    setTimeout(() => location.hash = '#/', 600);
  } catch(e){ toast('Erro: '+e.message, true); }
}
async function abortSession(){
  if (!STATE.currentSessionId) return;
  if (!confirm('Abandonar este treino? O progresso fica registrado, mas a sessão será marcada como abortada.')) return;
  try {
    await api('PATCH', `/api/treinos/sessions/${STATE.currentSessionId}`, { status:'aborted' });
    toast('Sessão abortada');
    setTimeout(() => location.hash = '#/', 600);
  } catch(e){ toast('Erro: '+e.message, true); }
}

// ---------- TIMER ----------
function fmtMMSS(s){ s=Math.max(0,Math.floor(s)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function openTimer(sec){
  STATE.timer.defaultSec = sec || 60;
  STATE.timer.remaining = STATE.timer.defaultSec;
  STATE.timer.running = false;
  document.getElementById('timerBar').hidden = false;
  document.getElementById('timerToggle').textContent = '▶︎ Iniciar';
  updateTimerDisplay();
  if (window.scrollY > 200) window.scrollTo({top: window.scrollY, behavior:'instant'});
}
function closeTimer(){
  const bar = document.getElementById('timerBar');
  if (bar) bar.hidden = true;
  if (STATE.timer.intervalId) { clearInterval(STATE.timer.intervalId); STATE.timer.intervalId = null; }
  STATE.timer.running = false;
}
function toggleTimer(){
  if (STATE.timer.running) {
    clearInterval(STATE.timer.intervalId);
    STATE.timer.intervalId = null;
    STATE.timer.running = false;
    document.getElementById('timerToggle').textContent = '▶︎ Continuar';
  } else {
    STATE.timer.running = true;
    document.getElementById('timerToggle').textContent = '⏸ Pausar';
    if (STATE.timer.remaining <= 0) STATE.timer.remaining = STATE.timer.defaultSec;
    STATE.timer.intervalId = setInterval(tickTimer, 1000);
  }
}
function resetTimer(){
  STATE.timer.remaining = STATE.timer.defaultSec;
  updateTimerDisplay();
}
function tickTimer(){
  STATE.timer.remaining--;
  if (STATE.timer.remaining <= 0){
    beep(880, 200); setTimeout(()=>beep(880, 200), 250); setTimeout(()=>beep(1320, 400), 500);
    clearInterval(STATE.timer.intervalId); STATE.timer.intervalId = null;
    STATE.timer.running = false;
    STATE.timer.remaining = 0;
    document.getElementById('timerToggle').textContent = '▶︎ Reiniciar';
    if (navigator.vibrate) navigator.vibrate([200,100,200]);
  }
  updateTimerDisplay();
}
function updateTimerDisplay(){
  const el = document.getElementById('timerDisplay');
  el.textContent = fmtMMSS(STATE.timer.remaining);
  el.className = 'timerDisplay' + (STATE.timer.remaining <= 3 ? ' go' : (STATE.timer.remaining <= 10 ? ' warn' : ''));
}
let _audioCtx;
function beep(freq, durMs){
  try {
    _audioCtx = _audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = _audioCtx.createOscillator();
    const g = _audioCtx.createGain();
    o.type='sine'; o.frequency.value = freq; o.connect(g); g.connect(_audioCtx.destination);
    g.gain.setValueAtTime(0.001, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, _audioCtx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + durMs/1000);
    o.start(); o.stop(_audioCtx.currentTime + durMs/1000 + 0.05);
  } catch {}
}

// ---------- bootstrap ----------
document.addEventListener('DOMContentLoaded', () => {
  if (!USER.require()) return;
  applyUserChip();
  window.addEventListener('hashchange', route);
  route();
});
