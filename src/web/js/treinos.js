// ===== treinos.js : Treinos standalone app (multiusuário) =====
let state = { workouts: [] };

async function loadWorkouts(){
  try{
    state.workouts = await api('GET','/api/treinos/workouts?days=60');
    renderTreinos();
  }catch(e){console.error(e)}
}

async function addWorkout(){
  const trained_on = $('#wkDate').value || todayStr();
  const name = $('#wkName').value.trim();
  if(!name){ toast('Informe o nome do treino', true); return; }
  const body = {
    trained_on, name,
    category: $('#wkCategory').value || null,
    duration_min: parseInt($('#wkDuration').value)||null,
    intensity: $('#wkIntensity').value || null,
    notes: $('#wkNotes').value.trim() || null
  };
  try{
    await api('POST','/api/treinos/workouts', body);
    ['wkName','wkDuration','wkNotes'].forEach(id=>$('#'+id).value='');
    $('#wkCategory').value=''; $('#wkIntensity').value='';
    await loadWorkouts();
    toast('Treino registrado ✓');
  }catch(e){ toast('Erro: '+e.message, true); }
}

async function deleteWorkout(id){
  if(!confirm('Remover este treino?'))return;
  try{
    await api('DELETE',`/api/treinos/workouts/${id}`);
    await loadWorkouts();
    toast('Removido ✓');
  }catch(e){ toast('Erro: '+e.message, true); }
}

function renderTreinos(){
  const today=new Date();
  const wkAgo=new Date(today.getTime()-6*86400000);
  const recent = (state.workouts||[]).filter(w=>new Date(w.trained_on)>=wkAgo);
  $('#wkSessions').textContent = String(recent.length);
  $('#wkMinutes').textContent  = String(recent.reduce((a,b)=>a+(b.duration_min||0),0));
  const lastW = (state.workouts||[])[0];
  $('#wkLast').textContent = lastW ? fmtDate(lastW.trained_on) : '—';

  const catIcon = {Push:'💪',Pull:'🪢',Pernas:'🦵','Full Body':'🔥',Cardio:'🏃',Tênis:'🎾',Mobilidade:'🧘',HIIT:'⚡'};
  $('#wkList').innerHTML = (state.workouts||[]).length
    ? state.workouts.map(w=>`
      <div class="wkRow">
        <div class="wkIco">${catIcon[w.category]||'🏋️'}</div>
        <div class="wkMeta">
          <b>${w.name} ${w.intensity?`<span class="wkIntense ${w.intensity}">${w.intensity}</span>`:''}</b>
          <span>${fmtDate(w.trained_on)} ${w.category?'· '+w.category:''} ${w.duration_min?'· '+w.duration_min+'min':''}${w.notes?' · '+w.notes:''}</span>
        </div>
        <div class="wkAct"><button onclick="deleteWorkout(${w.id})" title="Remover">✕</button></div>
      </div>`).join('')
    : `<div class="empty"><div class="em">🏋️</div><p>Nenhum treino registrado ainda.</p></div>`;
}

async function checkTreinosReq(){
  try{
    const st = await apiRaw('GET', `/api/users/${USER.id()}/status`);
    if (!st.treinos.has_data){
      showRequiredOverlay({
        title: '💪 Primeiro treino',
        html: `
          <div class="row2">
            <div class="field"><label>Data <span style="color:var(--err)">*</span></label><input type="date" id="rqDate" value="${todayStr()}"></div>
            <div class="field"><label>Duração (min) <span style="color:var(--err)">*</span></label><input type="number" id="rqDur" step="1" placeholder="60"></div>
          </div>
          <div class="field"><label>Nome do treino <span style="color:var(--err)">*</span></label><input type="text" id="rqName" placeholder="Ex: Push A · Peito e ombro"></div>
          <div class="row2">
            <div class="field"><label>Categoria</label>
              <select id="rqCat">
                <option value="">—</option>
                <option>Push</option><option>Pull</option><option>Pernas</option>
                <option>Full Body</option><option>Cardio</option><option>Tênis</option>
                <option>Mobilidade</option><option>HIIT</option>
              </select>
            </div>
            <div class="field"><label>Intensidade</label>
              <select id="rqInt">
                <option value="">—</option>
                <option value="leve">Leve</option>
                <option value="moderado">Moderado</option>
                <option value="forte">Forte</option>
                <option value="maximo">Máximo</option>
              </select>
            </div>
          </div>`,
        onSubmit: async ()=>{
          const trained_on = $('#rqDate').value || todayStr();
          const name = $('#rqName').value.trim();
          const dur  = parseInt($('#rqDur').value);
          if (!name) throw new Error('Nome obrigatório');
          if (!dur || dur<=0) throw new Error('Duração obrigatória');
          await api('POST','/api/treinos/workouts', {
            trained_on, name, duration_min: dur,
            category: $('#rqCat').value || null,
            intensity: $('#rqInt').value || null
          });
          toast('Primeiro treino registrado ✓');
          await loadWorkouts();
        }
      });
    }
  }catch(e){ console.warn('status check failed', e); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  if(!USER.require()) return;
  $('#wkDate').value = todayStr();
  await checkTreinosReq();
  loadWorkouts();
});
