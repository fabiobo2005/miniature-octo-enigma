// ===== core.js : utilitários compartilhados =====
// Globals: $, $$, api, toast, todayStr, fmtDate, USER (helpers de usuário)

function $(s){ return document.querySelector(s); }
function $$(s){ return [...document.querySelectorAll(s)]; }
function todayStr(){ const d=new Date(); return d.toISOString().slice(0,10); }
function fmtDate(d){ return new Date(d).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}); }

function toast(msg, isErr){
  const t = $('#toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=>t.className='toast', 2200);
}

// ===== USER context =====
// Preparado para futura auth: hoje guarda apenas { id, name } em localStorage.
// Quando auth chegar, basta substituir leitor/escritor por token + /me.
const USER = {
  KEY: 'apex.user',  // {id, name}
  get(){
    try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch { return null; }
  },
  id(){ const u=this.get(); return u && u.id; },
  set(user){ localStorage.setItem(this.KEY, JSON.stringify({id:user.id, name:user.name, avatar_url:user.avatar_url||null})); },
  clear(){ localStorage.removeItem(this.KEY); },
  // Garante usuário selecionado; redireciona para / caso contrário.
  require(){
    const u = this.get();
    if(!u || !u.id){
      // evita loop quando já estamos na home
      if(location.pathname !== '/' && location.pathname !== '/index.html'){
        location.href = '/';
      }
      return null;
    }
    return u;
  }
};

// ===== API =====
// Toda chamada injeta user_id automaticamente (query ou body), se houver usuário selecionado.
async function api(method, path, body){
  const uid = USER.id();
  let url = path;
  if (uid) {
    // anexa user_id à query se método não tiver body
    if (method === 'GET' || method === 'DELETE' || !body) {
      url += (url.includes('?') ? '&' : '?') + 'user_id=' + encodeURIComponent(uid);
    } else {
      body = { ...body, user_id: uid };
    }
  }
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (uid)  headers['X-User-Id'] = uid;
  const r = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if(!r.ok){
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch {}
    throw new Error(`${method} ${path}: ${r.status}${detail?' — '+detail:''}`);
  }
  return r.status===204 ? null : r.json();
}

// API call sem injetar user_id (para /api/users, /health, etc.)
async function apiRaw(method, path, body){
  const r = await fetch(path, {
    method,
    headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if(!r.ok){
    let detail=''; try { detail = (await r.json()).error || ''; } catch {}
    throw new Error(`${method} ${path}: ${r.status}${detail?' — '+detail:''}`);
  }
  return r.status===204 ? null : r.json();
}

// ===== theme =====
function toggleTheme(){
  const cur = document.body.dataset.theme || 'light';
  const nxt = cur==='light' ? 'dark' : 'light';
  document.body.dataset.theme = nxt;
  localStorage.setItem('theme', nxt);
}
(function initTheme(){
  document.body.dataset.theme = localStorage.getItem('theme') || 'light';
})();

// ===== greeting + avatar =====
function setGreeting(){
  const el = $('#greet');
  if(!el) return;
  const h = new Date().getHours();
  el.textContent = h<12 ? 'Bom dia' : (h<18 ? 'Boa tarde' : 'Boa noite');
}

function applyUserChip(){
  // Mostra nome do usuário selecionado no topo (em saude/dieta/treinos)
  const u = USER.get();
  const nm = $('#userChip');
  if(nm && u) nm.textContent = u.name;
  // Inicial no avatar
  const init = $('#avInit');
  if(init && u){ init.textContent = (u.name||'?').trim().charAt(0).toUpperCase(); }
  const av = document.querySelector('.avatar');
  if(av && u && u.avatar_url){
    av.style.backgroundImage = `url(${u.avatar_url})`;
    if(init) init.style.display='none';
  }
}

async function logoutUser(){
  USER.clear();
  // limpa estado em memória que pode vazar entre perfis (notificações, timers)
  try { if (window._notifTimer) { clearInterval(window._notifTimer); window._notifTimer = null; } } catch {}
  try { window.notifFired?.clear?.(); } catch {}
  // invalida caches do service worker para evitar servir bundles antigos após troca
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage('clearCache');
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { console.warn('cache clear failed', e); }
  if (window.apexAuth?.logout) {
    await window.apexAuth.logout();
    return;
  }
  // navega para home — replace evita botão "voltar" reabrir sessão antiga
  location.replace('/');
}

// ===== OVERLAY: cadastro obrigatório de dados iniciais por área =====
// Exibe uma camada modal travando o uso da página até primeiro registro.
function showRequiredOverlay(opts){
  // opts: { title, html, onSubmit }
  let scrim = document.getElementById('reqScrim');
  let modal = document.getElementById('reqModal');
  if(!scrim){
    scrim = document.createElement('div'); scrim.id='reqScrim'; scrim.className='scrim open';
    scrim.style.background='rgba(20,40,30,.7)';
    document.body.appendChild(scrim);
  } else { scrim.classList.add('open'); }
  if(!modal){
    modal = document.createElement('div'); modal.id='reqModal'; modal.className='modal open';
    document.body.appendChild(modal);
  } else { modal.classList.add('open'); }
  modal.innerHTML = `
    <div class="modalH">
      <b>${opts.title}</b>
    </div>
    <p class="small" style="color:var(--mut);margin:0 0 14px">Para começar a usar esta área, registre os dados iniciais abaixo. Campos com <span style="color:var(--err)">*</span> são obrigatórios.</p>
    ${opts.html}
    <button class="btn full" id="reqSubmit" style="margin-top:8px">Salvar e continuar</button>
    <button class="btn ghost full" onclick="location.href='/'" style="margin-top:8px">← Voltar ao início</button>
  `;
  document.getElementById('reqSubmit').onclick = async ()=>{
    try {
      await opts.onSubmit();
      scrim.classList.remove('open');
      modal.classList.remove('open');
    } catch(e){ toast('Erro: '+e.message, true); }
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  setGreeting();
  applyUserChip();
});
