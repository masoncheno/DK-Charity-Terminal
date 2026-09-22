(() => {
  'use strict';

  const SPORTS = {
    nfl:['NFL','football','nfl'], nba:['NBA','basketball','nba'], mlb:['MLB','baseball','mlb'], nhl:['NHL','hockey','nhl'],
    cfb:['College Football','football','college-football'], cbb:['College Basketball','basketball','mens-college-basketball'],
    epl:['EPL','soccer','eng.1'], ucl:['Champions League','soccer','uefa.champions']
  };
  const state = { sport:'nfl', date:new Date(), games:[], bets:[], supabase:null, room:'FRIENDS-1' };
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct = p => p == null ? '—' : (p*100).toFixed(1)+'%';
  const implied = o => { const n=Number(o); if(!Number.isFinite(n)||n===0)return null; return n>0?100/(n+100):Math.abs(n)/(Math.abs(n)+100); };
  const dateKey = d => { d=new Date(d); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); };

  function getConfig(){
    const c=window.APP_CONFIG||window.CONFIG||window.config||{};
    return {
      url:c.SUPABASE_URL||c.supabaseUrl||c.url||window.SUPABASE_URL||'',
      key:c.SUPABASE_ANON_KEY||c.SUPABASE_PUBLISHABLE_KEY||c.supabaseAnonKey||c.supabaseKey||window.SUPABASE_ANON_KEY||window.SUPABASE_PUBLISHABLE_KEY||'',
      room:c.ROOM_CODE||c.roomCode||window.ROOM_CODE||'FRIENDS-1'
    };
  }

  async function initSupabase(){
    const c=getConfig();
    if(!c.url||!c.key){ $('#db').textContent='● DATABASE CONFIG ERROR'; $('#db').style.color='#ff9090'; return; }
    if(!window.supabase?.createClient){ $('#db').textContent='● SUPABASE SDK ERROR'; return; }
    try{
      state.supabase=window.supabase.createClient(c.url.replace(/\/+$/,''),c.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      state.room=c.room;
      const test=await state.supabase.from('bets').select('*').limit(1);
      if(test.error) throw test.error;
      $('#db').textContent='● SHARED DB CONNECTED'; $('#db').style.color='#69edaa';
      state.supabase.channel('v6-bets').on('postgres_changes',{event:'*',schema:'public',table:'bets'},loadBets).subscribe();
      await loadBets();
    }catch(e){ console.error(e); $('#db').textContent='● DATABASE ERROR'; $('#db').style.color='#ff9090'; }
  }

  async function loadBets(){
    if(!state.supabase)return;
    const q=await state.supabase.from('bets').select('*').order('created_at',{ascending:false}).limit(100);
    if(!q.error)state.bets=q.data||[];
    renderBets(); renderModel();
  }

  async function getJson(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error('HTTP '+r.status); return r.json(); }

  function normalize(e){
    const comp=e.competitions?.[0]||{};
    const cs=comp.competitors||[];
    const home=cs.find(x=>x.homeAway==='home')||cs[0]||{};
    const away=cs.find(x=>x.homeAway==='away')||cs[1]||{};
    const odds=comp.odds?.[0]||{};
    const homeML=Number(odds.homeTeamOdds?.moneyLine ?? odds.homeTeamOdds?.moneyline);
    const awayML=Number(odds.awayTeamOdds?.moneyLine ?? odds.awayTeamOdds?.moneyline);
    const hProb=Number.isFinite(homeML)?implied(homeML):null;
    const model=.57;
    return {id:e.id,date:e.date,status:e.status?.type?.shortDetail||e.status?.type?.detail||'',home,away,venue:comp.venue?.fullName||'',
      broadcast:(comp.broadcasts||[]).flatMap(x=>x.names||[]).join(', '),money:[Number.isFinite(awayML)?awayML:null,Number.isFinite(homeML)?homeML:null],
      total:Number.isFinite(Number(odds.overUnder))?Number(odds.overUnder):null,model,edge:hProb==null?null:model-hProb,completed:!!e.status?.type?.completed};
  }

  async function loadGames(){
    const [label,sport,league]=SPORTS[state.sport];
    try{
      const d=await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateKey(state.date)}`);
      state.games=(d.events||[]).map(normalize);
      $('#feed').textContent=`● ${state.games.length} GAMES LIVE`; $('#feed').style.color='#69edaa';
    }catch(e){ state.games=[]; $('#feed').textContent='● FEED ERROR'; $('#feed').style.color='#ff9090'; console.error(e); }
    renderGames(); renderModel();
    $('#updated').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
  }

  function renderSports(){
    const html=Object.entries(SPORTS).map(([k,v])=>`<button class="sport ${k===state.sport?'on':''}" data-sport="${k}">${esc(v[0])}</button>`).join('');
    $('#sports').innerHTML=html; $('#standingSports').innerHTML=html;
    document.querySelectorAll('[data-sport]').forEach(b=>b.onclick=()=>{state.sport=b.dataset.sport;renderSports();loadGames();});
  }

  function renderGames(){
    const host=$('#games');
    if(!state.games.length){host.className='';host.innerHTML=`<div class="empty">No ${esc(SPORTS[state.sport][0])} games returned for ${esc(state.date.toLocaleDateString())}. No fake games are added.</div>`;return;}
    host.className='games';
    host.innerHTML=state.games.map(g=>{
      const away=g.away.team?.displayName||'Away'; const home=g.home.team?.displayName||'Home';
      const edge=g.edge==null?'—':(g.edge*100).toFixed(1)+'%';
      return `<article class="game" data-event="${esc(g.id)}"><div class="gamehead"><span>${esc(g.status||new Date(g.date).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</span><span>${g.completed?'FINAL':''}</span></div><div class="gamebody"><div class="team"><span>${esc(away)}</span><b class="score">${esc(g.away.score??'—')}</b></div><div class="team"><span>${esc(home)}</span><b class="score">${esc(g.home.score??'—')}</b></div><div class="markets"><div class="market"><small>Moneyline</small>${g.money[0]??'—'} / ${g.money[1]??'—'}</div><div class="market"><small>Total</small>${g.total??'—'}</div><div class="market"><small>Home Edge</small><span class="${g.edge==null?'':g.edge>=0?'pos':'neg'}">${edge}</span></div></div></div></article>`;
    }).join('');
    document.querySelectorAll('[data-event]').forEach(x=>x.onclick=()=>openGame(x.dataset.event));
  }

  async function openGame(id){
    const g=state.games.find(x=>x.id===id); if(!g)return;
    const [label,sport,league]=SPORTS[state.sport]; let data=null;
    try{data=await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${id}`);}catch(e){console.warn(e);}
    const away=g.away.team?.displayName||'Away', home=g.home.team?.displayName||'Home';
    const leaders=(data?.leaders||[]).flatMap(group=>(group.leaders||[]).slice(0,3).map(x=>`<tr><td>${esc(group.displayName||group.name||'')}</td><td>${esc(x.athlete?.displayName||'')}</td><td>${esc(x.displayValue||x.value||'—')}</td></tr>`)).join('');
    $('#modal').innerHTML=`<div class="modal"><aside class="drawer"><div class="drawerhead"><b>${esc(label)} · GAME INTELLIGENCE</b><button id="close">Close</button></div><div class="drawerbody"><h2>${esc(away)} ${esc(g.away.score??'—')} · ${esc(g.home.score??'—')} ${esc(home)}</h2><p>${esc(g.status)} · ${esc(g.venue||'Venue unavailable')}</p><div class="grid"><div class="card"><small>Moneyline</small><b>${g.money[0]??'—'} / ${g.money[1]??'—'}</b></div><div class="card"><small>Total</small><b>${g.total??'—'}</b></div><div class="card"><small>Home implied</small><b>${pct(implied(g.money[1]))}</b></div><div class="card"><small>Model home probability</small><b>${pct(g.model)}</b></div></div><div class="notice">${g.edge==null?'No usable home moneyline was returned, so no market edge is calculated.':'Baseline home edge: '+(g.edge*100).toFixed(1)+' percentage points. This is an estimate, not a guarantee.'}</div><div class="panel" style="margin-top:12px"><h3>Available player leaders</h3>${leaders?`<table class="table"><tr><th>Category</th><th>Player</th><th>Value</th></tr>${leaders}</table>`:'<div class="empty">No player leader data returned.</div>'}</div></div></aside></div>`;
    $('#close').onclick=()=>$('#modal').innerHTML='';
  }

  function renderBets(){
    const b=state.bets, risk=b.reduce((n,x)=>n+(Number(x.stake??x.amount??0)||0),0);
    $('#betStats').innerHTML=[['Tracked',b.length],['Risk','$'+risk.toFixed(2)],['Wins',b.filter(x=>String(x.result??x.status??'').toLowerCase().includes('win')).length],['Pending',b.filter(x=>!String(x.result??x.status??'').toLowerCase().match(/win|loss|push/)).length]].map(x=>`<div><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('');
    $('#mb').textContent=b.length;
    if(!b.length){$('#betTable').innerHTML='<div class="empty">No bets returned from the shared database.</div>';return;}
    const cols=Object.keys(b[0]).slice(0,10);
    $('#betTable').innerHTML=`<table class="table"><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>${b.map(row=>`<tr>${cols.map(c=>`<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  function renderModel(){
    const rows=state.games; $('#mg').textContent=rows.length; $('#mm').textContent=rows.filter(g=>g.money[1]!=null).length; $('#mo').textContent=rows.length;
    if(!rows.length){$('#modelTable').innerHTML='<div class="empty">No current model rows.</div>';return;}
    $('#modelTable').innerHTML=`<table class="table"><tr><th>Game</th><th>Model Home %</th><th>Market Implied %</th><th>Edge</th></tr>${rows.map(g=>`<tr><td>${esc((g.away.team?.displayName||'Away')+' @ '+(g.home.team?.displayName||'Home'))}</td><td>${pct(g.model)}</td><td>${pct(implied(g.money[1]))}</td><td class="${g.edge==null?'':g.edge>=0?'pos':'neg'}">${g.edge==null?'—':(g.edge*100).toFixed(1)+'%'}</td></tr>`).join('')}</table>`;
  }

  async function loadStandings(k=state.sport){
    const [label,sport,league]=SPORTS[k]; $('#standingBoard').innerHTML='<div class="empty">Loading…</div>';
    try{
      const d=await getJson(`https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`);
      const entries=d?.children?.flatMap(x=>x.standings?.entries||[])||[];
      if(!entries.length){$('#standingBoard').innerHTML='<div class="empty">No standings returned.</div>';return;}
      $('#standingBoard').innerHTML=`<h3>${esc(label)} standings</h3><table class="table"><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th></tr>${entries.map(e=>{const stats=e.stats||[];const val=n=>stats.find(x=>x.name===n||x.abbreviation===n)?.displayValue||'—';return `<tr><td>${esc(e.team?.displayName||'')}</td><td>${val('wins')}</td><td>${val('losses')}</td><td>${val('winPercent')}</td></tr>`;}).join('')}</table>`;
    }catch(e){$('#standingBoard').innerHTML='<div class="empty">Standings feed unavailable.</div>';}
  }

  function bind(){
    document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#'+b.dataset.view).classList.add('active');if(b.dataset.view==='standings')loadStandings();});
    $('#refresh').onclick=()=>{loadGames();loadBets();};
    $('#date').onchange=()=>{state.date=new Date($('#date').value+'T12:00:00');loadGames();};
    document.addEventListener('click',e=>{if(e.target.matches('#modal'))$('#modal').innerHTML='';});
    $('#standingSports').addEventListener('click',e=>{if(e.target.dataset.sport)loadStandings(e.target.dataset.sport);});
  }

  function boot(){
    $('#date').value=new Date().toISOString().slice(0,10);
    renderSports(); bind(); initSupabase(); loadGames();
  }
  document.addEventListener('DOMContentLoaded',boot);
})();
