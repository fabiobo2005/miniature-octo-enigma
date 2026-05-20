// ===== launcher.js : home (user picker + hub) =====

function showView(name){
  $('#viewPicker').hidden = name !== 'picker';
  $('#viewHub').hidden    = name !== 'hub';
}

async function initHome(){
  // Defesa: sempre tentamos exibir o picker como fallback em qualquer falha.
  try {
    const u = USER.get();
    if (u && u.id) {
      try {
        await apiRaw('GET', `/api/users/${u.id}`);
        showView('hub');
        applyUserChip();
        loadHub();
        return;
      } catch {
        // Usuário foi removido ou API falhou — limpa e cai para picker.
        USER.clear();
      }
    }
    showView('picker');
    await loadUsers();
  } catch (e) {
    console.error('initHome failed', e);
    showView('picker');
    const g = document.getElementById('userGrid');
    if (g) g.innerHTML = `<div style="grid-column:1/-1;color:var(--err);padding:16px;text-align:center">Erro ao inicializar: ${escapeHtml(e.message||String(e))}</div>`;
  }
}

async function loadUsers(){
  try{
    const users = await apiRaw('GET','/api/users');
    const grid = $('#userGrid');
    const cards = users.map(u=>{
      const init = (u.name||'?').trim().charAt(0).toUpperCase();
      const avStyle = u.avatar_url ? `background-image:url(${u.avatar_url});background-color:transparent` : '';
      return `<div class="userCard" onclick="pickUser('${u.id}','${(u.name||'').replace(/'/g,"\\'")}', ${u.avatar_url?`'${u.avatar_url}'`:'null'})">
        <div class="av" style="${avStyle}">${u.avatar_url?'':init}</div>
        <b>${escapeHtml(u.name||'—')}</b>
        <span>${u.goal ? escapeHtml(u.goal) : 'sem objetivo'}</span>
      </div>`;
    }).join('');
    const addBtn = `<div class="userCard addNew" onclick="openUserModal()">
      <div class="av">＋</div>
      <b>Novo perfil</b>
      <span>Cadastrar</span>
    </div>`;
    grid.innerHTML = cards + addBtn;
  }catch(e){
    $('#userGrid').innerHTML = `<div style="grid-column:1/-1;color:var(--err);padding:16px;text-align:center">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function pickUser(id, name, avatar_url){
  USER.set({id, name, avatar_url: avatar_url==='null'? null : avatar_url});
  showView('hub');
  applyUserChip();
  loadHub();
}

function openUserModal(){
  $('#userModalTitle').textContent = 'Novo perfil';
  ['uId','uName','uEmail','uBirth','uHeight','uGoal'].forEach(id=>$('#'+id).value='');
  $('#scrim').classList.add('open');
  $('#userModal').classList.add('open');
  setTimeout(()=>$('#uName').focus(), 50);
}
function closeUserModal(){
  $('#scrim').classList.remove('open');
  $('#userModal').classList.remove('open');
}
async function saveUser(){
  const name   = $('#uName').value.trim();
  const email  = $('#uEmail').value.trim();
  const birth  = $('#uBirth').value || null;
  const height = parseInt($('#uHeight').value) || null;
  const goal   = $('#uGoal').value.trim() || null;
  if(!name){ toast('Nome obrigatório', true); return; }
  try{
    const u = await apiRaw('POST','/api/users', { name, email: email || null, birth_date: birth, height_cm: height, goal });
    closeUserModal();
    toast('Perfil criado ✓');
    // já loga automaticamente no novo perfil
    pickUser(u.id, u.name, u.avatar_url);
  }catch(e){
    toast('Erro: '+e.message, true);
  }
}

// ===== HUB widgets =====
async function loadHub(){
  const [evol, supLog, dietaSum, wkSum] = await Promise.all([
    api('GET','/api/saude/evol').catch(()=>[]),
    api('GET','/api/saude/supplements/log?days=1').catch(()=>[]),
    api('GET','/api/dieta/meals/summary?days=30').catch(()=>[]),
    api('GET','/api/treinos/workouts/summary?days=7').catch(()=>null)
  ]);

  const last = (evol||[])[0];
  $('#hubSaudePeso').textContent = last && last.peso ? parseFloat(last.peso).toFixed(1) : '—';
  const t = todayStr();
  const supTaken = (supLog||[]).filter(l=>l.taken_on && l.taken_on.slice(0,10)===t && l.status==='taken').length;
  $('#hubSaudeSupps').textContent = String(supTaken);

  const todayRow = (dietaSum||[]).find(d=>d.day && d.day.slice(0,10)===t);
  $('#hubDietaPct').textContent = (todayRow ? todayRow.score : 0) + '%';
  let streak=0;
  const sortedDays = (dietaSum||[]).slice().sort((a,b)=>b.day.localeCompare(a.day));
  for(const d of sortedDays){ if(d.score>0) streak++; else break; }
  $('#hubDietaStreak').textContent = streak+'d';

  if(wkSum && typeof wkSum.sessions !== 'undefined'){
    $('#hubTreinosSessions').textContent = String(wkSum.sessions || 0);
    $('#hubTreinosMin').textContent = String(wkSum.minutes || wkSum.total_min || 0);
  }
}

document.addEventListener('DOMContentLoaded', initHome);
