(() => {
"use strict";

const cfg = window.BT_CONFIG || {};
const KEY = "bt_local_bets_v4";
const state = {
  page:"dashboard", bets:[], games:[], selectedGame:null,
  supabase:null, live:false, loading:false, lastRefresh:null
};

const SPORTS = [
  ["NFL","football","nfl"],["NBA","basketball","nba"],["MLB","baseball","mlb"],
  ["NHL","hockey","nhl"],["CFB","football","college-football"],["CBB","basketball","mens-college-basketball"],
  ["EPL","soccer","eng.1"],["Champions League","soccer","uefa.champions"]
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money = n => (Number(n)||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const pct = n => `${(Number(n)||0).toFixed(1)}%`;
const oddsToProb = o => { o=Number(o); if(!o) return 0; return o>0?100/(o+100):(-o)/(-o+100); };
const payout = (stake,odds) => { stake=Number(stake)||0; odds=Number(odds)||0; return odds>0?stake*odds/100:stake*100/Math.abs(odds); };
const pnl = b => b.result==="Win"?payout(b.stake,b.odds):b.result==="Loss"?-Number(b.stake):b.result==="Push"?0:null;
const fmtOdds = o => Number(o)>0?`+${o}`:String(o);
const uid = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function saveLocal(){ localStorage.setItem(KEY,JSON.stringify(state.bets)); }
function loadLocal(){ try{state.bets=JSON.parse(localStorage.getItem(KEY)||"[]")}catch{state.bets=[]} }

function render(){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.page===state.page));
  const views={dashboard,bets:betsPage,games:gamesPage,analytics:analyticsPage,model:modelPage,settings:settingsPage};
  $("#main").innerHTML=(views[state.page]||dashboard)();
  bindPage();
}

function metric(label,value,cl=""){return `<div class="card metric"><div class="label">${label}</div><div class="value ${cl}">${value}</div></div>`}

function dashboard(){
  const settled=state.bets.filter(b=>b.result!=="Pending"), wins=settled.filter(b=>b.result==="Win").length;
  const profit=settled.reduce((a,b)=>a+(pnl(b)||0),0), stake=settled.reduce((a,b)=>a+Number(b.stake||0),0);
  const roi=stake?profit/stake*100:0, pending=state.bets.filter(b=>b.result==="Pending").length;
  return `<div class="page-title"><div><h1>Command Center</h1><p>Live games on the left. Your betting process on the right.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
  <div class="grid stats">
    ${metric("Net P/L",money(profit),profit>=0?"pos":"neg")}
    ${metric("ROI",pct(roi),roi>=0?"pos":"neg")}
    ${metric("Record",`${wins}-${settled.length-wins}`)}
    ${metric("Win Rate",pct(settled.length?wins/settled.length*100:0))}
    ${metric("Wagered",money(stake))}
    ${metric("Pending",pending,"pending")}
  </div>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><div class="section-head"><h2>Today's / Live Games</h2><span>${state.games.length} loaded</span></div>${gameGrid(state.games.slice(0,8))}</section>
    <section class="card"><div class="section-head"><h2>Model Watchlist</h2><span>baseline only</span></div>${modelWatchlist()}</section>
  </div>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><div class="section-head"><h2>Recent Bets</h2><button class="ghost" data-go="bets">View all</button></div>${betTable(state.bets.slice().reverse().slice(0,8))}</section>
    <section class="card"><div class="section-head"><h2>System</h2></div>
      <div class="kpi"><span>Shared database</span><b>${state.live?"CONNECTED":"LOCAL ONLY"}</b></div>
      <div class="kpi"><span>Live games</span><b>${state.games.length}</b></div>
      <div class="kpi"><span>Last refresh</span><b>${state.lastRefresh?state.lastRefresh.toLocaleTimeString():"—"}</b></div>
      <div class="kpi"><span>Data source</span><b>ESPN scoreboard</b></div>
      <div class="notice" style="margin-top:12px">This first build intentionally uses real live game data and transparent baseline math instead of fake odds or fake model outputs.</div>
    </section>
  </div>`;
}

function gameGrid(games){
  if(!games.length)return `<div class="empty">No games returned. Click Refresh and check Settings if this persists.</div>`;
  return `<div class="grid two">${games.map(gameCard).join("")}</div>`;
}

function gameCard(g){
  const live=g.status==="in";
  const when=g.date?new Date(g.date).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
  return `<div class="game-card" data-game-id="${esc(g.id)}">
    <div class="game-top"><span class="pill">${esc(g.sport)}</span>${live?`<span class="live-badge">LIVE</span>`:`<span class="pill">${esc(when)}</span>`}</div>
    <div class="teams" style="margin-top:10px">${esc(g.away)} @ ${esc(g.home)}</div>
    <div class="score">${g.awayScore??"-"} — ${g.homeScore??"-"}</div>
    <div class="game-meta">${esc(g.statusText||"Scheduled")} · click for game page</div>
  </div>`;
}

function modelWatchlist(){
  const upcoming=state.games.slice(0,5);
  if(!upcoming.length)return `<div class="empty">Load games to generate baseline estimates.</div>`;
  return upcoming.map(g=>{
    const m=baselineModel(g);
    return `<div class="kpi"><span>${esc(g.away)} @ ${esc(g.home)}</span><b>${m.away}% / ${m.home}%</b></div>`;
  }).join("");
}

function baselineModel(g){
  // Transparent placeholder until the historical team-stat warehouse exists.
  // It does NOT claim to be a trained predictive model.
  if(g.status==="in" && g.awayScore!=null && g.homeScore!=null){
    const a=Number(g.awayScore), h=Number(g.homeScore);
    if(a>h)return {away:"60.0",home:"40.0"};
    if(h>a)return {away:"40.0",home:"60.0"};
  }
  return {away:"50.0",home:"50.0"};
}

function betTable(bs){
  if(!bs.length)return `<div class="empty">No bets yet. Add the first one.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Bettor</th><th>Sport</th><th>Game</th><th>Selection</th><th>Odds</th><th>Stake</th><th>To Win</th><th>Result</th><th>P/L</th></tr></thead><tbody>
  ${bs.map(b=>`<tr><td>${esc(b.bettor)}</td><td>${esc(b.sport)}</td><td>${esc(b.game)}</td><td>${esc(b.selection)}</td><td>${fmtOdds(b.odds)}</td><td>${money(b.stake)}</td><td>${money(payout(b.stake,b.odds))}</td><td class="${b.result==="Win"?"pos":b.result==="Loss"?"neg":"pending"}">${esc(b.result)}</td><td class="${(pnl(b)||0)>=0?"pos":"neg"}">${pnl(b)===null?"—":money(pnl(b))}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function betsPage(){
  return `<div class="page-title"><div><h1>Bet Ledger</h1><p>Enter your bets; the terminal handles the accounting.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
  <div class="filters"><select id="filterBettor"><option value="">All bettors</option><option>Mason</option><option>Friend 1</option><option>Friend 2</option></select>
  <select id="filterSport"><option value="">All sports</option>${SPORTS.map(x=>`<option>${x[0]}</option>`).join("")}</select>
  <select id="filterResult"><option value="">All results</option><option>Pending</option><option>Win</option><option>Loss</option><option>Push</option></select>
  <input id="filterSearch" placeholder="Search game or selection"></div>
  <section class="card"><div id="betTable">${betTable(state.bets.slice().reverse())}</div></section>`;
}

function gamesPage(){
  return `<div class="page-title"><div><h1>Games Center</h1><p>Real schedules and scores from the ESPN scoreboard feed.</p></div><button class="ghost" id="refreshGames">↻ Refresh</button></div>
  <div class="filters"><select id="gameSportFilter"><option value="">All sports</option>${SPORTS.map(x=>`<option>${x[0]}</option>`).join("")}</select><input id="gameSearch" placeholder="Search team"></div>
  <section class="card"><div id="gamesContainer">${gameGrid(filteredGames())}</div></section>`;
}

function gameDetailPage(g){
  const m=baselineModel(g);
  return `<div class="page-title"><div><button class="ghost" id="backGames">← Games</button><h1>${esc(g.away)} @ ${esc(g.home)}</h1><p>${esc(g.league)} · ${esc(g.statusText||"")}</p></div><button class="primary" id="betThisGame">Bet this game</button></div>
  <div class="game-detail">
    <section class="card">
      <div class="matchup"><div><div class="team-name">${esc(g.away)}</div><div class="team-score">${g.awayScore??"-"}</div></div><div class="versus">AT</div><div><div class="team-name">${esc(g.home)}</div><div class="team-score">${g.homeScore??"-"}</div></div></div>
      <hr style="border-color:var(--border);margin:22px 0">
      <div class="edge-box">
        <div class="model-factor"><span>Game status</span><b>${esc(g.statusText||"Scheduled")}</b></div>
        <div class="model-factor"><span>Data</span><b>Live scoreboard</b></div>
        <div class="model-factor"><span>Model stage</span><b>Baseline</b></div>
      </div>
      <div class="notice" style="margin-top:14px">This page is the foundation for the future DraftKings-style game tab: team stats, player stats, injuries, weather, odds, line movement and model factors will be added here. No fabricated values are shown.</div>
    </section>
    <section class="card">
      <div class="section-head"><h2>Solo Model</h2><span>transparent baseline</span></div>
      <div class="kpi"><span>${esc(g.away)}</span><b>${m.away}%</b></div>
      <div class="kpi"><span>${esc(g.home)}</span><b>${m.home}%</b></div>
      <div class="kpi"><span>Market odds</span><b>Not connected</b></div>
      <div class="kpi"><span>Model edge</span><b>Requires odds</b></div>
      <div class="notice" style="margin-top:12px">The model will only call an edge when it has both a model probability and a real market price.</div>
    </section>
  </div>`;
}

function analyticsPage(){
  const settled=state.bets.filter(b=>b.result!=="Pending");
  const bySport=[...new Set(state.bets.map(b=>b.sport))].filter(Boolean);
  return `<div class="page-title"><div><h1>Analytics</h1><p>Measure the betting process without hiding the math.</p></div></div>
  <div class="grid two"><section class="card"><div class="section-head"><h2>Performance by sport</h2></div>
  ${bySport.length?bySport.map(s=>analysisRow(s,state.bets.filter(b=>b.sport===s))).join(""):`<div class="empty">Settle bets to build the history.</div>`}</section>
  <section class="card"><div class="section-head"><h2>Exposure</h2></div>${riskSnapshot()}</section></div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Model learning status</h2><span>${settled.length} settled bets available</span></div>
  <div class="notice">The terminal is intentionally not changing model weights from a tiny sample. The next model stage will log every prediction, result and model version so changes can be backtested instead of silently “learning” from outcomes.</div></section>`;
}

function analysisRow(name,bs){
  const set=bs.filter(b=>b.result!=="Pending"), w=set.filter(b=>b.result==="Win").length;
  const pr=set.reduce((a,b)=>a+(pnl(b)||0),0), st=set.reduce((a,b)=>a+Number(b.stake||0),0);
  return `<div class="kpi"><span>${esc(name)} · ${w}-${set.length-w}</span><b class="${pr>=0?"pos":"neg"}">${money(pr)} · ${pct(st?pr/st*100:0)}</b></div>`;
}
function riskSnapshot(){
  const p=state.bets.filter(b=>b.result==="Pending"), ex=p.reduce((a,b)=>a+Number(b.stake||0),0);
  const set=state.bets.filter(b=>b.result!=="Pending"), pr=set.reduce((a,b)=>a+(pnl(b)||0),0);
  return `<div class="kpi"><span>Open exposure</span><b>${money(ex)}</b></div><div class="kpi"><span>Settled P/L</span><b class="${pr>=0?"pos":"neg"}">${money(pr)}</b></div><div class="kpi"><span>Pending bets</span><b>${p.length}</b></div><div class="kpi"><span>Largest open stake</span><b>${money(Math.max(0,...p.map(b=>Number(b.stake)||0)))}</b></div>`;
}

function modelPage(){
  return `<div class="page-title"><div><h1>Model Lab</h1><p>Build the predictive model in measured stages instead of inventing confidence.</p></div></div>
  <div class="model-grid">
    <section class="card">
      <div class="section-head"><h2>Market math</h2><span>works now</span></div>
      <label>American odds<input id="modelOdds" type="number" value="-110"></label>
      <label style="margin-top:12px">Estimated win probability (%)<input id="modelEdgeProb" type="number" min="0" max="100" step="0.1" value="50"></label>
      <div class="grid two" style="margin-top:16px"><div class="hero"><small>Implied probability</small><div class="model-number" id="modelProb">${pct(oddsToProb(-110))}</div></div><div class="hero"><small>Estimated edge</small><div class="model-number" id="modelEdge">${pct(50-oddsToProb(-110))}</div></div></div>
    </section>
    <section class="card">
      <div class="section-head"><h2>Model architecture</h2><span>next build stages</span></div>
      ${["Historical team strength","Recent form","Home/away splits","Injuries & availability","Weather / venue","Rest & travel","Market price","Calibration & uncertainty"].map((x,i)=>`<div class="kpi"><span>${x}</span><b>${i<1?"ACTIVE FOUNDATION":"NEXT"}</b></div>`).join("")}
    </section>
  </div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Important rule</h2></div><div class="notice">A model should learn from logged predictions and outcomes, not from whatever bets happened to win recently. Every future model change will have a version, sample size and backtest record.</div></section>`;
}

function settingsPage(){
  return `<div class="page-title"><div><h1>Settings</h1><p>Free deployment foundation.</p></div></div>
  <section class="card"><h2>Supabase</h2><div class="kpi"><span>URL configured</span><b>${cfg.SUPABASE_URL?"YES":"NO"}</b></div><div class="kpi"><span>Realtime</span><b>${state.live?"CONNECTED":"NOT CONNECTED"}</b></div><div class="kpi"><span>Room</span><b>${esc(cfg.ROOM_CODE||"FRIENDS-1")}</b></div>
  <div class="notice" style="margin-top:12px">Use the public anon key only. Never put a Supabase service-role key or sportsbook secret in this browser app.</div></section>
  <section class="card" style="margin-top:14px"><h2>Current free data plan</h2><div class="kpi"><span>Scores / schedules</span><b>ESPN public scoreboard</b></div><div class="kpi"><span>Weather</span><b>Open-Meteo — next stage</b></div><div class="kpi"><span>Odds</span><b>Replaceable adapter — next stage</b></div><div class="kpi"><span>Database</span><b>Supabase free tier</b></div><div class="kpi"><span>Hosting</span><b>GitHub Pages</b></div></section>`;
}

function filteredGames(){
  const sport=$("#gameSportFilter")?.value||"", q=($("#gameSearch")?.value||"").toLowerCase();
  return state.games.filter(g=>(!sport||g.sport===sport)&&(!q||`${g.away} ${g.home}`.toLowerCase().includes(q)));
}

function bindPage(){
  $("#addBetBtn")?.addEventListener("click",openBet);
  $("#refreshGames")?.addEventListener("click",loadGames);
  $("#backGames")?.addEventListener("click",()=>{state.selectedGame=null;state.page="games";render()});
  $("#betThisGame")?.addEventListener("click",()=>{
    const g=state.selectedGame;
    openBet();
    if(g)$("#betGame").value=`${g.away} @ ${g.home}`;
    if(g)$("#betSport").value=g.sport;
  });
  ["filterBettor","filterSport","filterResult","filterSearch"].forEach(id=>$("#"+id)?.addEventListener("input",filterBets));
  ["gameSportFilter","gameSearch"].forEach(id=>$("#"+id)?.addEventListener("input",()=>$("#gamesContainer").innerHTML=gameGrid(filteredGames())));
  document.querySelectorAll("[data-go]").forEach(x=>x.addEventListener("click",()=>{state.page=x.dataset.go;render()}));
  document.querySelectorAll(".game-card").forEach(x=>x.addEventListener("click",()=>{
    const g=state.games.find(g=>g.id===x.dataset.gameId); if(!g)return;
    state.selectedGame=g; state.page="game-detail"; renderGameDetail();
  }));
  $("#modelOdds")?.addEventListener("input",updateModelCalc);
  $("#modelEdgeProb")?.addEventListener("input",updateModelCalc);
}

function renderGameDetail(){
  $("#main").innerHTML=gameDetailPage(state.selectedGame);
  bindPage();
}
function updateModelCalc(){
  const odds=Number($("#modelOdds")?.value)||0, implied=oddsToProb(odds), user=Number($("#modelEdgeProb")?.value)||0;
  if($("#modelProb"))$("#modelProb").textContent=pct(implied);
  if($("#modelEdge"))$("#modelEdge").textContent=pct(user-implied);
}
function filterBets(){
  const a=$("#filterBettor").value,s=$("#filterSport").value,r=$("#filterResult").value,q=$("#filterSearch").value.toLowerCase();
  const bs=state.bets.filter(b=>(!a||b.bettor===a)&&(!s||b.sport===s)&&(!r||b.result===r)&&(!q||`${b.game} ${b.selection}`.toLowerCase().includes(q)));
  $("#betTable").innerHTML=betTable(bs.slice().reverse());
}
function openBet(){ $("#modal").classList.remove("hidden"); populateSports(); }
function closeBet(){ $("#modal").classList.add("hidden"); $("#betForm").reset(); }
function populateSports(){ $("#betSport").innerHTML=SPORTS.map(x=>`<option>${x[0]}</option>`).join(""); }

async function addBet(e){
  e.preventDefault();
  const b={id:uid(),room_code:cfg.ROOM_CODE||"FRIENDS-1",bettor:$("#betBettor").value,sport:$("#betSport").value,game:$("#betGame").value.trim(),bet_type:$("#betType").value,selection:$("#betSelection").value.trim(),odds:Number($("#betOdds").value),stake:Number($("#betStake").value),book:$("#betBook").value.trim(),result:$("#betResult").value,notes:$("#betNotes").value.trim(),created_at:new Date().toISOString()};
  state.bets.push(b);saveLocal();closeBet();render();
  if(state.supabase){const {error}=await state.supabase.from("bets").insert(b);if(error)console.warn("Supabase insert failed",error);}
}

async function initSupabase(){
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase)return;
  try{
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data,error}=await state.supabase.from("bets").select("*").eq("room_code",cfg.ROOM_CODE||"FRIENDS-1").order("created_at",{ascending:true});
    if(!error&&data){state.bets=data;saveLocal();render();}
    state.supabase.channel("bets-live").on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${cfg.ROOM_CODE||"FRIENDS-1"}`},payload=>{
      if(payload.eventType==="INSERT"&&!state.bets.some(x=>x.id===payload.new.id))state.bets.push(payload.new);
      if(payload.eventType==="UPDATE"){const i=state.bets.findIndex(x=>x.id===payload.new.id);if(i>=0)state.bets[i]=payload.new}
      if(payload.eventType==="DELETE")state.bets=state.bets.filter(x=>x.id!==payload.old.id);
      saveLocal();render();
    }).subscribe(s=>{state.live=s==="SUBSCRIBED";updateStatus();render();});
  }catch(e){console.warn("Supabase init failed",e)}
}

function updateStatus(){
  $("#connectionDot")?.classList.toggle("online",state.live);
  $("#connectionDot")?.classList.toggle("offline",!state.live);
  if($("#connectionText"))$("#connectionText").textContent=state.live?"Shared live":"Local mode";
}

async function loadGames(){
  if(state.loading)return;
  state.loading=true; updateStatus();
  const out=[];
  await Promise.all(SPORTS.map(async ([name,sport,league])=>{
    try{
      const u=`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
      const r=await fetch(u,{cache:"no-store"}); if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const d=await r.json();
      for(const ev of (d.events||[]).slice(0,30)){
        const c=ev.competitions?.[0], comps=c?.competitors||[];
        const away=comps.find(x=>x.homeAway==="away"), home=comps.find(x=>x.homeAway==="home");
        out.push({
          id:`${name}-${ev.id}`,league:d.leagues?.[0]?.name||name,sport:name,
          away:away?.team?.abbreviation||away?.team?.displayName||"Away",
          home:home?.team?.abbreviation||home?.team?.displayName||"Home",
          awayScore:away?.score??null,homeScore:home?.score??null,
          status:ev.status?.type?.state==="in"?"in":ev.status?.type?.state||"pre",
          statusText:ev.status?.type?.shortDetail||ev.status?.type?.description||"",
          date:ev.date
        });
      }
    }catch(e){console.warn(`Feed unavailable: ${name}`,e);}
  }));
  state.games=out.sort((a,b)=>{
    const ar=a.status==="in"?0:a.status==="pre"?1:2, br=b.status==="in"?0:b.status==="pre"?1:2;
    return ar-br || new Date(a.date||0)-new Date(b.date||0);
  });
  state.lastRefresh=new Date(); state.loading=false; render();
}

document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{state.page=t.dataset.page;state.selectedGame=null;render()}));
$("#refreshBtn").addEventListener("click",loadGames);
$("#addBetTop").addEventListener("click",openBet);
$("#closeModal").addEventListener("click",closeBet);
$("#cancelBet").addEventListener("click",closeBet);
$("#betForm").addEventListener("submit",addBet);

loadLocal();populateSports();render();initSupabase();loadGames();
setInterval(loadGames,Number(cfg.ESPN_REFRESH_MS)||60000);
})();