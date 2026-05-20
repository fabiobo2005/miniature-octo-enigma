// ===== treinos.js : Treinos standalone app (multiusuário) =====
const CATS = ['Push','Pull','Pernas','Full Body','Cardio','Tênis','Mobilidade','HIIT'];
const CAT_ICON = {Push:'💪',Pull:'🪢',Pernas:'🦵','Full Body':'🔥',Cardio:'🏃',Tênis:'🎾',Mobilidade:'🧘',HIIT:'⚡'};

let state = { workouts: [], filterCat: null };
let chWk = null;

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
    $$('#catChipsForm .catChip').forEach(b=>b.classList.remove('on'));
    $$('#intChipsForm .intChip').forEach(b=>b.classList.remove('on'));
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

function setupChips(){
  const cats=$('#catChipsForm');
  if(cats && !cats.dataset.ready){
    cats.innerHTML = CATS.map(c=>`<button type="button" class="catChip" data-v="${c}">${CAT_ICON[c]} ${c}</button>`).join('');
    cats.addEventListener('click', e=>{
      const b=e.target.closest('.catChip'); if(!b)return;
      const wasOn=b.classList.contains('on');
      $$('#catChipsForm .catChip').forEach(x=>x.classList.remove('on'));
      if(!wasOn){ b.classList.add('on'); $('#wkCategory').value=b.dataset.v; }
      else { $('#wkCategory').value=''; }
    });
    cats.dataset.ready='1';
  }
  const ints=$('#intChipsForm');
  if(ints && !ints.dataset.ready){
    ints.addEventListener('click', e=>{
      const b=e.target.closest('.intChip'); if(!b)return;
      const wasOn=b.classList.contains('on');
      $$('#intChipsForm .intChip').forEach(x=>x.classList.remove('on'));
      if(!wasOn){ b.classList.add('on'); $('#wkIntensity').value=b.dataset.v; }
      else { $('#wkIntensity').value=''; }
    });
    ints.dataset.ready='1';
  }
}

function setFilter(cat){
  state.filterCat = (state.filterCat===cat) ? null : cat;
  renderTreinos();
}

function renderTreinos(){
  setupChips();
  const today=new Date();
  const wkAgo=new Date(today.getTime()-6*86400000);
  const lastWkAgo=new Date(today.getTime()-13*86400000);
  const all=(state.workouts||[]);
  const recent = all.filter(w=>new Date(w.trained_on)>=wkAgo);
  const lastWk = all.filter(w=>{const d=new Date(w.trained_on); return d>=lastWkAgo && d<wkAgo});
  $('#wkSessions').textContent = String(recent.length);
  $('#wkMinutes').textContent  = String(recent.reduce((a,b)=>a+(b.duration_min||0),0));
  const lastW = all[0];
  $('#wkLast').textContent = lastW ? fmtDate(lastW.trained_on) : '—';
  $('#wkHistCount').textContent = `${all.length} treinos · 60d`;

  // delta vs last week
  const delta = $('#heroDelta');
  if(delta){
    if(lastWk.length>0 || recent.length>0){
      const d = recent.length - lastWk.length;
      delta.hidden=false;
      delta.className='heroDelta '+(d<0?'up':d>0?'down':'flat');
      delta.textContent = (d>0?'▲ +':d<0?'▼ ':'• ')+Math.abs(d)+' vs sem. ant.';
    } else delta.hidden=true;
  }

  // hero metrics
  const minWk = recent.reduce((a,b)=>a+(b.duration_min||0),0);
  const avgDur = recent.length ? Math.round(minWk/recent.length) : 0;
  const intensity = recent.filter(w=>w.intensity==='forte'||w.intensity==='maximo').length;
  const hm=$('#heroMetrics');
  if(hm){
    const items=[
      `<div class="hm"><span>Média/treino</span><b>${avgDur} min</b></div>`,
      `<div class="hm"><span>Forte/Máx</span><b>${intensity}</b></div>`,
      `<div class="hm"><span>Total 60d</span><b>${all.length}</b></div>`
    ];
    hm.innerHTML=items.join('');
  }

  // hero chart - últimos 14 dias por dia
  const ctx=$('#chWk');
  if(ctx){
    if(chWk) chWk.destroy();
    const days=[]; const counts=[]; const mins=[];
    for(let i=13;i>=0;i--){
      const d=new Date(today.getTime()-i*86400000);
      const ds=d.toISOString().slice(0,10);
      days.push(fmtDate(ds));
      const dayWk=all.filter(w=>w.trained_on.slice(0,10)===ds);
      counts.push(dayWk.length);
      mins.push(dayWk.reduce((a,b)=>a+(b.duration_min||0),0));
    }
    if(all.length===0){
      ctx.parentElement.innerHTML='<div class="empty mini"><div class="em">📈</div><p>Registre um treino para ver tendência.</p></div>';
    } else {
      chWk = new Chart(ctx,{
        type:'bar',
        data:{ labels:days,
          datasets:[{label:'Min', data:mins,
            backgroundColor:mins.map(m=>m===0?'rgba(221,231,225,.5)':m>=60?'#5fb594':m>=30?'#7BC4A4':'#a8d4be'),
            borderRadius:4, barPercentage:.9, categoryPercentage:.95}]},
        options:{responsive:true,maintainAspectRatio:false,
          animation:{duration:600,easing:'easeOutQuart'},
          plugins:{legend:{display:false},tooltip:{
            backgroundColor:'rgba(20,40,30,.92)',padding:8,cornerRadius:8,displayColors:false,
            callbacks:{label:(c)=>`${c.parsed.y} min · ${counts[c.dataIndex]} treino${counts[c.dataIndex]===1?'':'s'}`}}},
          scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10},maxTicksLimit:3}},
                  x:{grid:{display:false},ticks:{font:{size:9},maxTicksLimit:7}}}}
      });
    }
  }

  // category filter chips
  const filterEl=$('#catFilter');
  if(filterEl){
    const cats = [...new Set(all.map(w=>w.category).filter(Boolean))];
    filterEl.innerHTML = cats.length ? cats.map(c=>
      `<button type="button" class="catChip ${state.filterCat===c?'on':''}" onclick="setFilter('${c.replace(/'/g,"\\'")}')">${CAT_ICON[c]||'🏋️'} ${c}</button>`
    ).join('') : '';
  }

  // history list (filtered)
  const list = state.filterCat ? all.filter(w=>w.category===state.filterCat) : all;
  $('#wkList').innerHTML = list.length
    ? list.map((w,i)=>`
      <div class="wkRow fadeUp" style="animation-delay:${Math.min(i,8)*40}ms">
        <div class="wkIco">${CAT_ICON[w.category]||'🏋️'}</div>
        <div class="wkMeta">
          <b>${w.name} ${w.intensity?`<span class="wkIntense ${w.intensity}">${w.intensity}</span>`:''}</b>
          <span>${fmtDate(w.trained_on)} ${w.category?'· '+w.category:''} ${w.duration_min?'· '+w.duration_min+'min':''}${w.notes?' · '+w.notes:''}</span>
        </div>
        <div class="wkAct"><button onclick="deleteWorkout(${w.id})" title="Remover">✕</button></div>
      </div>`).join('')
    : (state.filterCat
        ? `<div class="empty"><div class="em">🔍</div><p>Nenhum treino em "${state.filterCat}".</p></div>`
        : `<div class="empty"><div class="em">🏋️</div><p>Nenhum treino registrado ainda.</p></div>`);
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
