// ===== saude.js : Saúde standalone app (multiusuário) =====

let state = { evol:[], supps:[], supLog:[], discSummary:[] };

// ----- evolution -----
async function loadEvol(){
  try{
    state.evol = await api('GET','/api/saude/evol');
    renderWeightChart();
    renderSaude();
  }catch(e){console.error(e)}
}
async function addEvol(){
  const d=$('#iData').value||todayStr();
  const p=parseFloat($('#iPeso').value)||null;
  const bf=parseFloat($('#iBF').value)||null;
  const mm=parseFloat($('#iMM').value)||null;
  if(!p && !bf && !mm){toast('Informe ao menos peso, %GC ou MM', true); return}
  try{
    await api('PUT','/api/saude/evol',{d, p, bf, mm,
      visc: parseInt($('#iVisc').value)||null,
      agua: parseFloat($('#iAgua').value)||null,
      mskel: parseFloat($('#iMskel').value)||null,
      gsub: parseFloat($('#iGsub').value)||null,
      osso: parseFloat($('#iOsso').value)||null,
      prot: parseFloat($('#iProt').value)||null,
      tmb: parseInt($('#iTmb').value)||null,
      idade: parseInt($('#iIdade').value)||null
    });
    toast('Medição registrada ✓');
    ['iPeso','iBF','iMM','iVisc','iAgua','iMskel','iGsub','iOsso','iProt','iTmb','iIdade'].forEach(id=>$('#'+id).value='');
    loadEvol();
  }catch(e){toast('Erro: '+e.message,true)}
}

let chWeight=null;
function renderWeightChart(){
  const ctx=$('#chWeight'); if(!ctx)return;
  const data=[...state.evol].reverse().filter(r=>r.peso);
  if(chWeight) chWeight.destroy();
  if(!data.length){
    ctx.parentElement.innerHTML='<div class="empty"><div class="em">📊</div><p>Sem medições ainda. Registre acima.</p></div>';
    return;
  }
  chWeight = new Chart(ctx,{
    type:'line',
    data:{
      labels:data.map(r=>fmtDate(r.measured_on)),
      datasets:[{
        label:'Peso (kg)',
        data:data.map(r=>parseFloat(r.peso)),
        borderColor:'#5fb594', backgroundColor:'rgba(95,181,148,.15)',
        tension:.35, fill:true, pointRadius:3, pointBackgroundColor:'#5fb594'
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:false,grid:{color:'rgba(0,0,0,.05)'}},x:{grid:{display:false}}}}
  });
}

// ----- supplements -----
async function loadSupps(){
  try{
    state.supps = await api('GET','/api/saude/supplements');
    state.supLog = await api('GET','/api/saude/supplements/log?days=14');
    renderSaude();
  }catch(e){console.error(e)}
}
async function loadDietaSummary(){
  // for streak only
  try{ state.discSummary = await api('GET','/api/dieta/meals/summary?days=30'); renderSaude(); }
  catch(e){ /* dieta module optional */ }
}

function takenToday(supId, time){
  const t=todayStr();
  return state.supLog.some(l => l.supplement_id===supId && l.taken_on.slice(0,10)===t && (!time || l.scheduled_time===time) && l.status==='taken');
}
async function logSupp(supId, time){
  try{
    await api('POST',`/api/saude/supplements/${supId}/log`,{scheduled_time:time, status:'taken'});
    state.supLog = await api('GET','/api/saude/supplements/log?days=14');
    renderSaude();
    toast('Registrado ✓');
  }catch(e){toast('Erro: '+e.message,true)}
}

function renderSaude(){
  const last = (state.evol||[])[0];
  $('#todayWeight').textContent = last ? parseFloat(last.peso).toFixed(1) : '—';
  const t=todayStr();
  const taken = (state.supLog||[]).filter(l=>l.taken_on.slice(0,10)===t && l.status==='taken').length;
  $('#todaySupps').textContent = String(taken);

  let streak=0;
  const sortedDays = (state.discSummary||[]).slice().sort((a,b)=>b.day.localeCompare(a.day));
  for(const d of sortedDays){ if(d.score>0) streak++; else break; }
  $('#streak').textContent = streak+'d';

  // next supps
  const now=new Date(), curMin=now.getHours()*60+now.getMinutes();
  const upcoming=[];
  for(const s of (state.supps||[])){
    for(const tm of (s.schedule||'').split(',').map(x=>x.trim()).filter(Boolean)){
      const [hh,mm]=tm.split(':').map(Number);
      const min=hh*60+mm;
      const delta = min>=curMin ? min-curMin : min-curMin+1440;
      upcoming.push({s,tm,delta,taken:takenToday(s.id,tm)});
    }
  }
  upcoming.sort((a,b)=>a.delta-b.delta);
  const next3 = upcoming.filter(u=>!u.taken).slice(0,4);
  $('#nextSupps').innerHTML = next3.length ? `<div class="supList">${next3.map(u=>`
    <div class="supItem">
      <div class="pill" style="background:${u.s.color||'#7BC4A4'}">${u.s.icon||'💊'}</div>
      <div class="meta"><b>${u.s.name}</b><span>${u.s.dose||''} · ${u.tm} ${u.delta<60?`(em ${u.delta}min)`:''}</span></div>
      <div class="actions"><button onclick="logSupp(${u.s.id},'${u.tm}')" title="Marcar tomado" style="color:var(--pri-d)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button></div>
    </div>`).join('')}</div>`
    : '<div class="empty"><div class="em">🎉</div><p>Tudo em dia por hoje!</p></div>';

  $('#supList').innerHTML = state.supps.map(s=>{
    const times = (s.schedule||'').split(',').map(t=>t.trim()).filter(Boolean);
    return `<div class="supItem">
      <div class="pill" style="background:${s.color||'#7BC4A4'}">${s.icon||'💊'}</div>
      <div class="meta">
        <b>${s.name}</b><span>${s.dose||''}</span>
        <div class="schedTimes">${times.map(t=>{
          const tk=takenToday(s.id,t);
          return `<em onclick="logSupp(${s.id},'${t}')" style="cursor:pointer;${tk?'background:#5fb594;color:#fff;border-color:#5fb594':''}" title="${tk?'Tomado':'Marcar como tomado'}">${tk?'✓ ':''}${t}</em>`;
        }).join('')}</div>
      </div>
      <div class="actions">
        <button onclick="editSupp(${s.id})" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      </div>
    </div>`;
  }).join('') || `<div class="empty"><div class="em">💊</div><p>Sem suplementos cadastrados.</p></div>`;

  $('#supHistory').innerHTML = state.supLog.length
    ? state.supLog.slice(0,20).map(l=>{
        const s=state.supps.find(x=>x.id===l.supplement_id);
        if(!s) return '';
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
          <span>${s.icon} <b>${s.name}</b> <span class="small">${l.scheduled_time||''}</span></span>
          <span class="small">${new Date(l.taken_at).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
        </div>`;
      }).join('')
    : `<div class="empty"><div class="em">📜</div><p>Sem registros recentes.</p></div>`;

  if(state.evol && state.evol.length) renderWeightChart();

  const ns=$('#notifState');
  if(ns){
    if(!('Notification' in window)) ns.textContent='Não suportado neste navegador';
    else if(Notification.permission==='granted') ns.textContent='✅ Ativadas';
    else if(Notification.permission==='denied') ns.textContent='❌ Bloqueadas (libere nas configurações)';
    else ns.textContent='Toque em "Ativar" para liberar';
  }
}

// ----- modal -----
function openSupModal(){
  $('#supModalTitle').textContent='Novo suplemento';
  $('#supId').value=''; $('#supName').value=''; $('#supDose').value='';
  $('#supSchedule').value=''; $('#supNotes').value='';
  $('#supIcon').value='💊'; $('#supColor').value='#7BC4A4';
  $('#supDeleteBtn').hidden=true;
  $('#scrim').classList.add('open'); $('#supModal').classList.add('open');
}
function editSupp(id){
  const s=state.supps.find(x=>x.id===id); if(!s)return;
  $('#supModalTitle').textContent='Editar suplemento';
  $('#supId').value=s.id; $('#supName').value=s.name; $('#supDose').value=s.dose||'';
  $('#supSchedule').value=s.schedule||''; $('#supNotes').value=s.notes||'';
  $('#supIcon').value=s.icon||'💊'; $('#supColor').value=s.color||'#7BC4A4';
  $('#supDeleteBtn').hidden=false;
  $('#scrim').classList.add('open'); $('#supModal').classList.add('open');
}
async function saveSup(){
  const id=$('#supId').value;
  const body={
    name:$('#supName').value.trim(),
    dose:$('#supDose').value.trim(),
    schedule:$('#supSchedule').value.trim(),
    icon:$('#supIcon').value.trim()||'💊',
    color:$('#supColor').value,
    notes:$('#supNotes').value.trim()
  };
  if(!body.name){toast('Nome obrigatório',true);return}
  try{
    if(id) await api('PUT',`/api/saude/supplements/${id}`, body);
    else   await api('POST','/api/saude/supplements', body);
    closeAll(); await loadSupps(); toast('Salvo ✓');
  }catch(e){toast('Erro: '+e.message,true)}
}
async function deleteSup(){
  const id=$('#supId').value; if(!id)return;
  if(!confirm('Remover este suplemento?'))return;
  try{ await api('DELETE',`/api/saude/supplements/${id}`); closeAll(); await loadSupps(); toast('Removido ✓');}
  catch(e){toast('Erro: '+e.message,true)}
}
function closeAll(){
  $('#scrim').classList.remove('open');
  $$('.modal').forEach(m=>m.classList.remove('open'));
}

// ----- notifications -----
async function reqNotifPermission(){
  if(!('Notification' in window)){toast('Notificações não suportadas',true);return}
  if(Notification.permission==='granted'){toast('Já ativadas ✓');return}
  if(Notification.permission==='denied'){toast('Bloqueado — libere nas configs do navegador',true);return}
  const p=await Notification.requestPermission();
  if(p==='granted'){toast('Notificações ativadas ✓'); startNotifLoop();}
  else toast('Permissão negada',true);
  renderSaude();
}
let notifFired = new Set();
function startNotifLoop(){
  if(window._notifTimer) return;
  window._notifTimer = setInterval(checkNotif, 30000);
  checkNotif();
}
async function checkNotif(){
  if(Notification.permission!=='granted')return;
  const now=new Date();
  const curMin=now.getHours()*60+now.getMinutes();
  const today=todayStr();
  for(const s of (state.supps||[])){
    for(const tm of (s.schedule||'').split(',').map(x=>x.trim()).filter(Boolean)){
      const key=`${s.id}-${tm}-${today}`;
      const [hh,mm]=tm.split(':').map(Number);
      const schedMin=hh*60+mm;
      if(curMin>=schedMin && curMin-schedMin<=5 && !notifFired.has(key) && !takenToday(s.id,tm)){
        notifFired.add(key);
        try{
          const reg=await navigator.serviceWorker?.ready;
          const opts={body:`${s.dose||''} · ${tm}`, icon:'/icons/icon-192.png', tag:key, data:{supId:s.id,time:tm}, badge:'/icons/icon-192.png'};
          if(reg) reg.showNotification(`💊 ${s.name}`, opts);
          else new Notification(`💊 ${s.name}`, opts);
        }catch(e){console.warn(e)}
      }
    }
  }
}

// ----- init -----
async function checkSaudeReq(){
  // Se o usuário não tem nenhuma medição NEM suplemento → overlay obrigatório
  try{
    const st = await apiRaw('GET', `/api/users/${USER.id()}/status`);
    if (!st.saude.has_data){
      showRequiredOverlay({
        title: '⚖️ Primeira medição',
        html: `
          <div class="row2">
            <div class="field"><label>Data <span style="color:var(--err)">*</span></label><input type="date" id="rqDate" value="${todayStr()}"></div>
            <div class="field"><label>Peso (kg) <span style="color:var(--err)">*</span></label><input type="number" id="rqPeso" step="0.1" placeholder="82.5" required></div>
          </div>
          <div class="row2">
            <div class="field"><label>% Gordura (opcional)</label><input type="number" id="rqBF" step="0.1"></div>
            <div class="field"><label>Massa Muscular kg (opcional)</label><input type="number" id="rqMM" step="0.1"></div>
          </div>`,
        onSubmit: async ()=>{
          const d = $('#rqDate').value || todayStr();
          const p = parseFloat($('#rqPeso').value);
          if (!p || isNaN(p)) throw new Error('Peso é obrigatório');
          await api('PUT','/api/saude/evol', { d, p,
            bf: parseFloat($('#rqBF').value)||null,
            mm: parseFloat($('#rqMM').value)||null
          });
          toast('Medição inicial registrada ✓');
          await loadEvol();
        }
      });
    }
  }catch(e){ console.warn('status check failed', e); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  if(!USER.require()) return;
  $('#iData').value = todayStr();
  await checkSaudeReq();
  loadEvol();
  loadSupps();
  loadDietaSummary();
  if('Notification' in window && Notification.permission==='granted') startNotifLoop();
});
