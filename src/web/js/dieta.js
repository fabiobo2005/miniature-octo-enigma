// ===== dieta.js : Dieta standalone app (multiusuário) =====
const MEALS = [
  {id:'r1', emoji:'☕', name:'Café da manhã', time:'08:00', items:[
    'Café (1 xícara / 200ml)',
    'Pão de forma (2 fatias)',
    'Creme de ricota (1 csopa)',
    'Ovos mexidos (3 ovos)'
  ], subs:[
    ['Substituição oficial', 'Café 200ml + Crepioca (1) + Requeijão (1 csopa) + Atum cru (2 csopa / 60g)'],
    ['Pão por', 'francês (1) · torrada integral (4) · pão de leite (1) · cuscuz milho (120g) · pão sírio (1) · rap 10 (1)'],
    ['Recheios', 'creme ricota · cottage · creme queijo · requeijão light · queijo branco · ricota'],
    ['Acompanhamento', 'ovos mexidos (3) · patê frango (3 csopa) · carne desfiada (3 csopa) · atum (3 csopa)'],
    ['Crepioca por', 'panqueca de banana · pão de frigideira']
  ], tip:'Adoçar somente com stevia, xilitol ou eritritol.'},

  {id:'r2', emoji:'🥛', name:'Lanche da manhã', time:'10:30', items:[
    'Iogurte natural (170g)',
    'Whey protein (30g)',
    'Maçã (1 unidade)',
    'Castanha de caju (8 unidades)',
    'Farelo de aveia (1 csopa)'
  ], subs:[
    ['Iogurte+whey por', 'bebida láctea proteica 25g (250ml) — Piracanjuba ou YoPro'],
    ['Castanhas (8u)', 'caju · amêndoas · nozes · avelã · pistache'],
    ['Frutas', 'ameixa(1) · abacaxi(2 rodelas) · acerola(6) · banana nanica(1) · goiaba(1) · kiwi(1) · laranja(1) · mamão(1 fatia) · manga(1 fatia) · maçã(1) · melão(1 fatia) · melancia(1 fatia) · morango(5) · pera(1) · uva(12)']
  ], tip:'Variar as frutas diariamente.'},

  {id:'r3', emoji:'🍱', name:'Almoço', time:'12:00', items:[
    'Salada verde à vontade',
    'Tomate, cebola, pepino, cenoura, beterraba, pimentão (à vontade)',
    'Mix de legumes à vontade',
    'Arroz integral cozido (2 csv / 160g)',
    'Feijão carioca (1½ concha / 140g)',
    'Filé de frango com açafrão (2 filés / 160g)',
    'Limão (1) OU vinagre maçã/balsâmico (1 csopa)',
    'Azeite (1 col sobremesa)',
    'Laranja (1)'
  ], subs:[
    ['Carboidrato', 'Arroz vermelho/multigrãos · batata cozida/purê (240g) · batata doce (240g) · mandioquinha (240g) · quinoa (160g) · macarrão sem feijão (210g)'],
    ['Proteína vegetal', 'Feijão preto (140g) · ervilha · lentilha · grão de bico (140g)'],
    ['Proteína animal', 'Alcatra · Almôndega (140g) · Asa frango (160g) · Bisteca suína · Carne assada · Carne moída · Carne seca · Frango grelhado · Peixe branco · Filé suíno · Filé mignon · Lagarto · Lombo · Ovo 5un · Patinho'],
    ['Mix de legumes (2)', 'Abobrinha · cenoura · abóbora · quiabo · jiló · couve-de-bruxelas · berinjela · aspargos · vagem · maxixe · brócolis · couve-flor'],
    ['Frutas (sub laranja)', 'Ameixa · abacaxi · acerola · goiaba · kiwi · mamão · manga · maçã · melão · melancia · morango · pera · uva']
  ], tip:'Tempero por cima · variar diariamente · prato colorido · moderar sal · azeite no preparo.'},

  {id:'r4', emoji:'🥪', name:'Lanche da tarde', time:'16:30', items:[
    'Água de coco (250ml)',
    'Rap 10 (1 unidade)',
    'Creme de ricota (1 csopa)',
    'Atum (3 csopa / 90g)',
    'Maçã (1)'
  ], subs:[
    ['Substituição oficial', 'Água de coco (250ml) + Torta de frango (1 fatia / 250g) + Pera (1)'],
    ['Água de coco por', 'suco natural sem açúcar (maracujá/morango/abacaxi/goiaba/acerola/limão) — adoçar com adoçante'],
    ['Rap 10 por', 'pão de forma (2 fatias) · francês (1) · torrada integral (4) · pão de leite (1) · cuscuz milho (120g) · pão sírio (1)'],
    ['Recheios', 'creme ricota · cottage · creme queijo · requeijão light · queijo branco · ricota'],
    ['Acompanhamento', 'ovos mexidos (3) · patê frango (3 csopa) · carne desfiada (3 csopa) · atum (3 csopa)']
  ], tip:'Adoçar com stevia/xilitol/eritritol · variar frutas.'},

  {id:'r5', emoji:'🍽️', name:'Jantar', time:'20:30', items:[
    'Salada verde à vontade',
    'Tomate, cebola, pepino, cenoura, beterraba, pimentão (à vontade)',
    'Mix de legumes à vontade',
    'Purê de batata (3 csv / 220g)',
    'Filé de peixe ao molho de tomate (2 filés / 160g)',
    'Azeite (1 col sobremesa)',
    'Limão (1) OU vinagre (1 csopa)'
  ], subs:[
    ['Carboidrato', 'Arroz integral (160g) · batata cozida (220g) · batata doce (220g) · mandioquinha (220g) · quinoa (160g) · macarrão sem feijão (190g)'],
    ['Proteína animal', 'Mesmas opções do almoço (alcatra, almôndega, asa, bisteca, carne assada/moída/seca, frango, peixe branco, suíno, mignon, lagarto, lombo, ovo 5un, patinho)'],
    ['Mix de legumes (2)', 'Abobrinha · cenoura · abóbora · quiabo · jiló · couve-de-bruxelas · berinjela · aspargos · vagem · maxixe · brócolis · couve-flor']
  ], tip:'Mesmas orientações do almoço.'},

  {id:'r6', emoji:'🌙', name:'Lanche da noite', time:'21:30', items:[
    'Leite desnatado (250ml)',
    'Multi Collagen (1 medidor)',
    'Farelo de aveia (1 csopa)',
    'Banana (1)'
  ], subs:[
    ['Frutas (sub banana)', 'Ameixa · abacaxi · acerola · banana nanica · goiaba · kiwi · laranja · mamão · manga · maçã · melão · melancia · morango · pera · uva']
  ], tip:'Variar as frutas diariamente.'}
];

let state = { meals:[], discSummary:[] };

async function loadMeals(){
  try{
    state.meals = await api('GET','/api/dieta/meals?days=60');
    state.discSummary = await api('GET','/api/dieta/meals/summary?days=30');
    renderDieta();
  }catch(e){console.error(e)}
}

function mealStatusToday(mealId){
  const t=todayStr();
  return (state.meals.find(m => m.logged_on.slice(0,10)===t && m.meal_id===mealId) || {}).status || null;
}

async function setMealStatusQuick(mealId, status){
  try{
    if(mealStatusToday(mealId)===status){
      await api('DELETE',`/api/dieta/meals/${todayStr()}/${mealId}`);
    } else {
      await api('PUT','/api/dieta/meals',{date:todayStr(), meal_id:mealId, status});
    }
    await loadMeals();
    toast('Atualizado ✓');
  }catch(e){toast('Erro: '+e.message,true)}
}

function renderMealCheckList(containerId){
  const c=$(containerId); if(!c)return;
  c.innerHTML = MEALS.map(m=>{
    const st = mealStatusToday(m.id);
    return `<div class="mealRow">
      <div class="ico">${m.emoji}</div>
      <div class="info"><b>${m.name}</b><span>${m.time} · ${m.items[0]}</span></div>
      <div class="statusBtns">
        <button class="sbtn ${st==='done'?'on done':''}" onclick="setMealStatusQuick('${m.id}','done')" title="Feita">✅</button>
        <button class="sbtn ${st==='partial'?'on partial':''}" onclick="setMealStatusQuick('${m.id}','partial')" title="Parcial">🟡</button>
        <button class="sbtn ${st==='skipped'?'on skipped':''}" onclick="setMealStatusQuick('${m.id}','skipped')" title="Pulada">❌</button>
      </div>
    </div>`;
  }).join('');
}

function todayDisciplineScore(){
  let score=0;
  for(const m of MEALS){
    const st=mealStatusToday(m.id);
    if(st==='done')score+=1; else if(st==='partial')score+=0.5;
  }
  return Math.round(score/MEALS.length*100);
}

let chDisc=null;
function renderDieta(){
  renderMealCheckList('#mealCheckDieta');
  $('#discTodayDieta').textContent = todayDisciplineScore()+'%';

  const sum=state.discSummary||[];
  const valid = sum.filter(d=>d.score>0);
  const avg = valid.length ? Math.round(valid.reduce((a,b)=>a+b.score,0)/valid.length) : 0;
  $('#discAvg').textContent = avg+'%';
  $('#discSubtitle').textContent = valid.length ? `${valid.length} dias com registro` : 'aguardando dados';
  const ring=$('#ringDisc'); const C=2*Math.PI*34;
  ring.setAttribute('stroke-dashoffset', String(C - C*avg/100));

  $('#discBar').innerHTML = sum.map(d=>{
    return `<div class="bar" title="${fmtDate(d.day)}: ${d.score}%"><div class="fill" style="height:${d.score}%"></div></div>`;
  }).join('');

  const ctx=$('#chDisc'); if(chDisc) chDisc.destroy();
  chDisc = new Chart(ctx,{
    type:'bar',
    data:{
      labels:sum.map(d=>fmtDate(d.day)),
      datasets:[{
        label:'Aderência (%)', data:sum.map(d=>d.score),
        backgroundColor:sum.map(d=>d.score>=80?'#5fb594':d.score>=50?'#e6a55a':d.score>0?'#d96b7a':'#dde7e1'),
        borderRadius:6
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,grid:{color:'rgba(0,0,0,.05)'}},x:{ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:10},grid:{display:false}}}}
  });

  $('#mealMenu').innerHTML = MEALS.map(m=>`
    <div class="dietMeal">
      <div class="hdr"><span class="em">${m.emoji}</span><b>${m.name}</b><span class="tm">${m.time}</span></div>
      <ul>${m.items.map(i=>`<li>${i}</li>`).join('')}</ul>
      ${m.subs.map(s=>`<details><summary>🔁 ${s[0]}</summary><ul><li>${s[1]}</li></ul></details>`).join('')}
      ${m.tip ? `<div class="tip">⚠ ${m.tip}</div>` : ''}
    </div>
  `).join('');
}

async function checkDietaReq(){
  try{
    const st = await apiRaw('GET', `/api/users/${USER.id()}/status`);
    if (!st.dieta.has_data){
      showRequiredOverlay({
        title: '🍽️ Comece sua dieta',
        html: `
          <p class="small" style="margin:0 0 10px">Marque o status da primeira refeição de hoje para iniciar o acompanhamento.</p>
          <div class="field"><label>Refeição <span style="color:var(--err)">*</span></label>
            <select id="rqMeal">
              ${MEALS.map(m=>`<option value="${m.id}">${m.emoji} ${m.name} (${m.time})</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Status <span style="color:var(--err)">*</span></label>
            <select id="rqStatus">
              <option value="done">✅ Feita</option>
              <option value="partial">🟡 Parcial</option>
              <option value="skipped">❌ Pulada</option>
            </select>
          </div>`,
        onSubmit: async ()=>{
          const meal_id = $('#rqMeal').value;
          const status  = $('#rqStatus').value;
          if(!meal_id || !status) throw new Error('Selecione refeição e status');
          await api('PUT','/api/dieta/meals', { date: todayStr(), meal_id, status });
          toast('Primeiro registro salvo ✓');
          await loadMeals();
        }
      });
    }
  }catch(e){ console.warn('status check failed', e); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  if(!USER.require()) return;
  await checkDietaReq();
  loadMeals();
});
