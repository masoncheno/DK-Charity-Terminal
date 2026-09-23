(() => {
"use strict";

const cfg = window.BT_CONFIG || {};
const KEY = "bt_local_bets_v6";
const REFRESH = Number(cfg.ESPN_REFRESH_MS) || 60000;

const state = {
  page: "dashboard",
  bets: [],
  games: [],
  selectedGame: null,
  gameData: {},
  supabase: null,
  live: false,
  loading: false,
  lastRefresh: null,
  errors: [],
  filters: { sport:"", search:"", status:"all" }
};

const SPORTS = [
  ["NFL","football","nfl"], ["NBA","basketball","nba"], ["MLB","baseball","mlb"],
  ["NHL","hockey","nhl"], ["CFB","football","college-football"],
  ["CBB","basketball","mens-college-basketball"], ["EPL","soccer","eng.1"],
  ["Champions League","soccer","uefa.champions"]
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money = n => (Number(n)||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const pct = n => `${(Number(n)||0).toFixed(1)}%`;
const uid = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const fmtOdds = o => Number(o) > 0 ? `+${o}` : String(o);
const oddsToProb = o => {
  o = Number(o);
  if (!o) return 0;
  return o > 0 ? 100/(o+100) : (-o)/(-o+100);
};
const payout = (stake,odds) => {
  stake=Number(stake)||0; odds=Number(odds)||0;
  return odds>0 ? stake*odds/100 : stake*100/Math.abs(odds);
};
const pnl = b => b.result==="Win" ? payout(b.stake,b.odds) : b.result==="Loss" ? -Number(b.stake) : b.result==="Push" ? 0 : null;

function saveLocal(){ localStorage.setItem(KEY, JSON.stringify(state.bets)); }
function loadLocal(){ try{ state.bets=JSON.parse(localStorage.getItem(KEY)||"[]"); }catch{state.bets=[];} }

function metric(label,value,cl=""){
  return `<div class="card metric"><div class="label">${label}</div><div class="value ${cl}">${value}</div></div>`;
}

function render(){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.page===state.page));
  const views = {
    dashboard, bets:betsPage, games:gamesPage, analytics:analyticsPage,
    model:modelPage, settings:settingsPage, "game-detail":()=>gameDetailPage(state.selectedGame)
  };
  $("#main").innerHTML = (views[state.page] || dashboard)();
  bindPage();
  updateStatus();
}

function dashboard(){
  const settled=state.bets.filter(b=>b.result!=="Pending");
  const wins=settled.filter(b=>b.result==="Win").length;
  const profit=settled.reduce((a,b)=>a+(pnl(b)||0),0);
  const stake=settled.reduce((a,b)=>a+Number(b.stake||0),0);
  const roi=stake?profit/stake*100:0;
  const pending=state.bets.filter(b=>b.result==="Pending").length;
  const live=state.games.filter(g=>g.status==="in").length;

  return `<div class="page-title">
    <div><div class="eyebrow">V6 • LIVE TERMINAL</div><h1>Command Center</h1><p>Live games, real feed data, database-backed shared bets, market snapshots and transparent model factors.</p></div>
    <div class="title-actions"><button class="ghost" id="refreshDashboard">↻ Refresh All</button><span class="sync-pill">DB-first · ESPN live</span><button class="primary" id="addBetBtn">+ Add Bet</button></div>
  </div>
  <div class="grid stats">
    ${metric("Net P/L",money(profit),profit>=0?"pos":"neg")}
    ${metric("ROI",pct(roi),roi>=0?"pos":"neg")}
    ${metric("Record",`${wins}-${settled.length-wins}`)}
    ${metric("Win Rate",pct(settled.length?wins/settled.length*100:0))}
    ${metric("Open Exposure",money(state.bets.filter(b=>b.result==="Pending").reduce((a,b)=>a+Number(b.stake||0),0)),"pending")}
    ${metric("Live Now",live,"live-text")}
  </div>
  <div class="grid dashboard-grid">
    <section class="card">
      <div class="section-head"><div><h2>Live / Upcoming</h2><span>${state.games.length} games loaded</span></div><button class="ghost" data-go="games">Games Center →</button></div>
      ${gameGrid(state.games.slice(0,10))}
    </section>
    <section class="card">
      <div class="section-head"><div><h2>Model Watch</h2><span>data-backed when inputs exist</span></div><button class="ghost" data-go="model">Model Lab →</button></div>
      ${modelWatchlist()}
    </section>
  </div>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><div class="section-head"><h2>Recent Bets</h2><button class="ghost" data-go="bets">View all</button></div>${betTable(state.bets.slice().reverse().slice(0,8))}</section>
    <section class="card">
      <div class="section-head"><h2>Terminal Status</h2><span>${state.lastRefresh?state.lastRefresh.toLocaleTimeString():"—"}</span></div>
      <div class="kpi"><span>Shared Supabase</span><b>${state.live?"CONNECTED":"LOCAL FALLBACK"}</b></div>
      <div class="kpi"><span>Score source</span><b>ESPN public feed</b></div>
      <div class="kpi"><span>Market source</span><b>ESPN event odds when supplied</b></div>
      <div class="kpi"><span>Weather</span><b>ESPN / Open-Meteo</b></div>
      <div class="notice">V5 never invents odds, injuries, stats or edges. If a free source does not return a field, the terminal shows “not available” instead.</div>
    </section>
  </div>`;
}

function gameGrid(games){
  if(!games.length) return `<div class="empty">No games match the current filters. Try Refresh All or change the sport filter.</div>`;
  return `<div class="grid game-list">${games.map(gameCard).join("")}</div>`;
}

function gameCard(g){
  const live=g.status==="in";
  const odds=g.odds?.[0];
  return `<div class="game-card" data-game-id="${esc(g.id)}">
    <div class="game-top"><span class="pill">${esc(g.sport)}</span>${live?`<span class="live-badge">LIVE</span>`:`<span class="pill">${esc(formatDate(g.date))}</span>`}</div>
    <div class="teams-row"><div><div class="team-line">${esc(g.away)}</div><div class="team-line">${esc(g.home)}</div></div>
      <div class="scores"><b>${g.awayScore??"—"}</b><b>${g.homeScore??"—"}</b></div>
    </div>
    <div class="game-meta">${esc(g.statusText||"Scheduled")}${odds?.details?` · ${esc(odds.details)}`:""}</div>
    ${odds?`<div class="mini-market"><span>Market</span><b>${esc(odds.provider||"ESPN")} ${odds.overUnder!=null?`· O/U ${odds.overUnder}`:""}</b></div>`:""}
  </div>`;
}

function modelWatchlist(){
  if(!state.games.length) return `<div class="empty">Load games to calculate available baseline factors.</div>`;
  return state.games.slice(0,7).map(g=>{
    const m=modelForGame(g);
    return `<div class="model-row"><div><b>${esc(g.away)} @ ${esc(g.home)}</b><small>${esc(m.label)}</small></div><strong>${m.awayProb}% / ${m.homeProb}%</strong></div>`;
  }).join("");
}

function modelForGame(g){
  const ar=recordFromTeam(g.awayData), hr=recordFromTeam(g.homeData);
  let a=50,h=50, label="50/50: no usable pregame team record";
  if(ar && hr){
    const aw=ar.wins/(ar.wins+ar.losses||1), hw=hr.wins/(hr.wins+hr.losses||1);
    const diff=hw-aw;
    h=Math.max(35,Math.min(65,50+diff*35+4));
    a=100-h;
    label=`record factor • ${ar.wins}-${ar.losses} vs ${hr.wins}-${hr.losses}`;
  } else if(g.status==="in" && g.awayScore!=null && g.homeScore!=null){
    a=Number(g.awayScore)>Number(g.homeScore)?60:40; h=100-a;
    label="live score state • not a pregame prediction";
  }
  return {awayProb:a.toFixed(1),homeProb:h.toFixed(1),label};
}

function recordFromTeam(t){
  if(!t) return null;
  const rec=t.record || t.records?.find?.(x=>x.type==="total")?.summary || t.summary;
  if(!rec) return null;
  const m=String(rec).match(/(\d+)-(\d+)/);
  return m ? {wins:Number(m[1]),losses:Number(m[2])} : null;
}

function betTable(bs){
  if(!bs.length) return `<div class="empty">No bets yet. Add the first one.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Bettor</th><th>Sport</th><th>Game</th><th>Selection</th><th>Odds</th><th>Stake</th><th>To Win</th><th>Result</th><th>P/L</th></tr></thead><tbody>
  ${bs.map(b=>`<tr><td>${esc(b.bettor)}</td><td>${esc(b.sport)}</td><td>${esc(b.game)}</td><td>${esc(b.selection)}</td><td>${fmtOdds(b.odds)}</td><td>${money(b.stake)}</td><td>${money(payout(b.stake,b.odds))}</td><td class="${b.result==="Win"?"pos":b.result==="Loss"?"neg":"pending"}">${esc(b.result)}</td><td class="${(pnl(b)||0)>=0?"pos":"neg"}">${pnl(b)===null?"—":money(pnl(b))}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function betsPage(){
  return `<div class="page-title"><div><div class="eyebrow">SHARED LEDGER</div><h1>Bet Ledger</h1><p>Three bettors, one shared record. Enter the bet once and Supabase syncs it.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
  <div class="filters"><select id="filterBettor"><option value="">All bettors</option><option>Mason</option><option>Friend 1</option><option>Friend 2</option></select>
  <select id="filterSport"><option value="">All sports</option>${SPORTS.map(x=>`<option>${x[0]}</option>`).join("")}</select>
  <select id="filterResult"><option value="">All results</option><option>Pending</option><option>Win</option><option>Loss</option><option>Push</option></select>
  <input id="filterSearch" placeholder="Search game or selection"></div>
  <section class="card"><div id="betTable">${betTable(state.bets.slice().reverse())}</div></section>`;
}

function gamesPage(){
  const filtered=filteredGames();
  return `<div class="page-title"><div><div class="eyebrow">REAL SCOREBOARD FEED</div><h1>Games Center</h1><p>Schedules and scores from ESPN's public scoreboard endpoints. Click a game for the V5 game terminal.</p></div><button class="ghost" id="refreshGames">↻ Refresh</button></div>
  <div class="filters"><select id="gameSportFilter"><option value="">All sports</option>${SPORTS.map(x=>`<option ${state.filters.sport===x[0]?"selected":""}>${x[0]}</option>`).join("")}</select>
  <select id="gameStatusFilter"><option value="all">All statuses</option><option value="in">Live</option><option value="pre">Upcoming</option><option value="post">Final</option></select>
  <input id="gameSearch" value="${esc(state.filters.search)}" placeholder="Search team / matchup"></div>
  <section class="card"><div class="section-head"><h2>${filtered.length} games</h2><span>Auto-refresh ${Math.round(REFRESH/1000)}s</span></div><div id="gamesContainer">${gameGrid(filtered)}</div></section>`;
}

function gameDetailPage(g){
  if(!g) return `<div class="empty">No game selected.</div>`;
  const d=state.gameData[g.id]||{};
  const m=modelForGame(g);
  const market=bestMarket(g);
  return `<div class="page-title"><div><button class="ghost" id="backGames">← Games</button><div class="eyebrow">${esc(g.sport)} • ${esc(g.league||"")}</div><h1>${esc(g.away)} @ ${esc(g.home)}</h1><p>${esc(g.statusText||"Scheduled")} · ${formatDate(g.date)}</p></div><button class="primary" id="betThisGame">Bet this game</button></div>
  <div class="terminal-tabs">
    <button class="detail-tab active" data-detail="overview">Overview</button>
    <button class="detail-tab" data-detail="market">Market</button>
    <button class="detail-tab" data-detail="stats">Stats</button>
    <button class="detail-tab" data-detail="weather">Weather</button>
    <button class="detail-tab" data-detail="bets">Bets</button>
  </div>
  <div id="detailContent">${detailOverview(g,m,market,d)}</div>`;
}

function detailOverview(g,m,market,d){
  return `<div class="grid two">
    <section class="card">
      <div class="matchup"><div><div class="team-name">${esc(g.away)}</div><div class="team-score">${g.awayScore??"—"}</div></div><div class="versus">AT</div><div><div class="team-name">${esc(g.home)}</div><div class="team-score">${g.homeScore??"—"}</div></div></div>
      <div class="edge-box">
        <div class="model-factor"><span>Model state</span><b>${esc(m.label)}</b></div>
        <div class="model-factor"><span>${esc(g.away)}</span><b>${m.awayProb}%</b></div>
        <div class="model-factor"><span>${esc(g.home)}</span><b>${m.homeProb}%</b></div>
        <div class="model-factor"><span>Market edge</span><b>${market?calculateEdge(market,m,g):"No market price"}</b></div>
      </div>
    </section>
    <section class="card">
      <div class="section-head"><h2>Event information</h2><span>live source</span></div>
      ${infoRow("Venue",d.venue||g.venue||"Not available")}
      ${infoRow("Broadcast",d.broadcasts?.join(", ")||"Not available")}
      ${infoRow("Attendance",d.attendance??"Not available")}
      ${infoRow("Source event ID",g.sourceId||"—")}
      <div class="notice">Model probabilities are transparent baseline estimates, not guaranteed forecasts. V5 only displays an edge when a real market price and a model probability are both available.</div>
    </section>
  </div>`;
}

function infoRow(a,b){return `<div class="kpi"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;}

function detailMarket(g){
  const markets=g.odds||[];
  return `<section class="card"><div class="section-head"><h2>Available market data</h2><span>${markets.length} market record${markets.length===1?"":"s"}</span></div>
  ${markets.length?markets.map(o=>`<div class="market-card"><div><b>${esc(o.provider||"ESPN feed")}</b><small>${esc(o.details||"")}</small></div><div class="market-values">${o.spread!=null?`<span>Spread <b>${esc(o.spread)}</b></span>`:""}${o.overUnder!=null?`<span>Total <b>${esc(o.overUnder)}</b></span>`:""}${o.homeMoneyline!=null?`<span>Home ML <b>${fmtOdds(o.homeMoneyline)}</b></span>`:""}${o.awayMoneyline!=null?`<span>Away ML <b>${fmtOdds(o.awayMoneyline)}</b></span>`:""}</div></div>`).join(""):`<div class="empty">The ESPN event did not provide a market price for this game. No odds are being invented.</div>`}
  </section>`;
}

function detailStats(g,d){
  const comps=d.competitors||[];
  if(!d.stats?.length && !comps.length) return `<section class="card"><div class="empty">Detailed box-score/team stats are not available from the event endpoint yet.</div></section>`;
  return `<div class="grid two">${comps.map(c=>`<section class="card"><div class="section-head"><h2>${esc(c.team?.displayName||"Team")}</h2><span>${esc(c.score??"")}</span></div>${(c.statistics||[]).map(s=>infoRow(s.name||s.label,s.displayValue??s.value)).join("")||`<div class="empty">No statistics returned.</div>`}</section>`).join("")}</div>`;
}

function detailWeather(g,d){
  const w=d.weather||g.weather;
  if(w) return `<section class="card"><div class="section-head"><h2>Weather</h2><span>event feed</span></div><div class="weather-grid">${infoRow("Condition",w.displayValue||w.condition||"—")}${infoRow("Temperature",w.temperature!=null?`${w.temperature}°`:"—")}${infoRow("Wind",w.windSpeed?`${w.windSpeed} mph`:"—")}${infoRow("Source","ESPN event data")}</div></section>`;
  return `<section class="card"><div class="empty">No weather object was returned for this event. V5 does not fabricate conditions. Open-Meteo fallback is available when a venue city can be resolved.</div></section>`;
}

function detailBets(g){
  const bs=state.bets.filter(b=>b.game===`${g.away} @ ${g.home}` || b.game===g.name);
  return `<section class="card"><div class="section-head"><h2>Group bets on this game</h2><button class="primary" id="betThisGame">+ Bet</button></div>${betTable(bs.slice().reverse())}</section>`;
}

function bestMarket(g){ return g.odds?.find(x=>x.homeMoneyline!=null||x.awayMoneyline!=null)||g.odds?.[0]||null; }
function calculateEdge(o,m,g){
  if(o.homeMoneyline!=null){
    const p=Number(m.homeProb)/100, imp=oddsToProb(o.homeMoneyline);
    return `${(p-imp)*100>=0?"+":""}${((p-imp)*100).toFixed(1)}% home ML`;
  }
  return "Price available; exact edge needs matching selection";
}

function analyticsPage(){
  const settled=state.bets.filter(b=>b.result!=="Pending");
  const bySport=[...new Set(state.bets.map(b=>b.sport))].filter(Boolean);
  const byBettor=["Mason","Friend 1","Friend 2"].map(n=>[n,state.bets.filter(b=>b.bettor===n)]);
  return `<div class="page-title"><div><div class="eyebrow">HISTORY</div><h1>Analytics</h1><p>Track what the group actually did. No hidden weighting or fake sample sizes.</p></div></div>
  <div class="grid two"><section class="card"><div class="section-head"><h2>Performance by sport</h2></div>${bySport.length?bySport.map(s=>analysisRow(s,state.bets.filter(b=>b.sport===s))).join(""):`<div class="empty">No bets yet.</div>`}</section>
  <section class="card"><div class="section-head"><h2>Performance by bettor</h2></div>${byBettor.map(([n,bs])=>analysisRow(n,bs)).join("")}</section></div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Risk snapshot</h2><span>${settled.length} settled</span></div>${riskSnapshot()}</section>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Model data quality</h2></div><div class="notice">Prediction learning is separated from the bet ledger. V5 stores model version, inputs, price and outcome so later versions can be compared by sample size and backtest results.</div></section>`;
}

function analysisRow(name,bs){
  const set=bs.filter(b=>b.result!=="Pending"), w=set.filter(b=>b.result==="Win").length;
  const pr=set.reduce((a,b)=>a+(pnl(b)||0),0), st=set.reduce((a,b)=>a+Number(b.stake||0),0);
  return `<div class="kpi"><span>${esc(name)} · ${w}-${set.length-w}</span><b class="${pr>=0?"pos":"neg"}">${money(pr)} · ${pct(st?pr/st*100:0)}</b></div>`;
}
function riskSnapshot(){
  const p=state.bets.filter(b=>b.result==="Pending"), ex=p.reduce((a,b)=>a+Number(b.stake||0),0);
  const set=state.bets.filter(b=>b.result!=="Pending"), pr=set.reduce((a,b)=>a+(pnl(b)||0),0);
  return `<div class="grid four">${metric("Open exposure",money(ex),"pending")}${metric("Settled P/L",money(pr),pr>=0?"pos":"neg")}${metric("Pending bets",p.length)}${metric("Largest open",money(Math.max(0,...p.map(b=>Number(b.stake)||0))))}</div>`;
}

function modelPage(){
  return `<div class="page-title"><div><div class="eyebrow">MODEL LAB</div><h1>Solo Modeler</h1><p>V5 combines real event inputs with transparent probability math. Training comes only after enough logged outcomes exist.</p></div></div>
  <div class="grid two">
    <section class="card"><div class="section-head"><h2>Market calculator</h2><span>live math</span></div>
      <label>American odds<input id="modelOdds" type="number" value="-110"></label>
      <label style="margin-top:12px">Your model probability (%)<input id="modelEdgeProb" type="number" min="0" max="100" step="0.1" value="50"></label>
      <div class="grid two" style="margin-top:16px">${metric("Implied probability",pct(oddsToProb(-110)))}${metric("Edge",pct(50-oddsToProb(-110)))}</div>
      <div id="modelCalcNote" class="notice">Positive edge means the entered probability is above the market's implied probability. It is not proof that a bet will win.</div>
    </section>
    <section class="card"><div class="section-head"><h2>Model pipeline</h2><span>V5</span></div>
      ${["ESPN game state","Team record factor","Market price when supplied","Prediction logging","Outcome settlement","Backtest / calibration","Sport-specific features"].map((x,i)=>`<div class="kpi"><span>${x}</span><b class="${i<4?"pos":""}">${i<4?"ACTIVE":"NEXT"}</b></div>`).join("")}
    </section>
  </div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Current game model board</h2><span>${state.games.length} games</span></div>${modelBoard()}</section>`;
}

function modelBoard(){
  if(!state.games.length) return `<div class="empty">Refresh games to populate the model board.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Game</th><th>State</th><th>Away</th><th>Home</th><th>Inputs</th></tr></thead><tbody>${state.games.slice(0,20).map(g=>{
    const m=modelForGame(g);
    return `<tr><td>${esc(g.away)} @ ${esc(g.home)}</td><td>${esc(g.statusText||"Scheduled")}</td><td>${m.awayProb}%</td><td>${m.homeProb}%</td><td>${esc(m.label)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function settingsPage(){
  return `<div class="page-title"><div><div class="eyebrow">SYSTEM</div><h1>Settings</h1><p>Free deployment and data-source status.</p></div></div>
  <section class="card"><h2>Shared database</h2>${infoRow("Supabase URL configured",cfg.SUPABASE_URL?"YES":"NO")}${infoRow("Realtime",state.live?"CONNECTED":"NOT CONNECTED")}${infoRow("Room",cfg.ROOM_CODE||"FRIENDS-1")}
  <div class="notice">Keep your existing working <b>config.js</b>. V5 does not require replacing it. Only the public Supabase anon key belongs in the browser.</div></section>
  <section class="card" style="margin-top:14px"><h2>Free data stack</h2>${infoRow("Scores / schedules","ESPN public scoreboard")}${infoRow("Event details","ESPN summary endpoint")}${infoRow("Weather","ESPN event weather when supplied")}${infoRow("Fallback weather","Open-Meteo")}${infoRow("Database","Supabase free tier")}${infoRow("Hosting","GitHub Pages")}</section>
  <section class="card" style="margin-top:14px"><h2>Data limitations</h2><div class="notice">There is no honest promise of unlimited free sportsbook odds. V5 uses market data only when the free event feed actually returns it. Missing odds are shown as missing instead of being guessed.</div></section>`;
}

function filteredGames(){
  const sport=state.filters.sport, q=state.filters.search.toLowerCase(), status=state.filters.status;
  return state.games.filter(g=>(!sport||g.sport===sport)&&(!q||`${g.away} ${g.home} ${g.league}`.toLowerCase().includes(q))&&(status==="all"||g.status===status));
}

function bindPage(){
  $("#addBetBtn")?.addEventListener("click",openBet);
  $("#addBetTop")?.addEventListener("click",openBet);
  $("#refreshDashboard")?.addEventListener("click",refreshAll);
  $("#refreshGames")?.addEventListener("click",loadGames);
  $("#backGames")?.addEventListener("click",()=>{state.selectedGame=null;state.page="games";render();});
  $("#betThisGame")?.addEventListener("click",()=>{
    const g=state.selectedGame; openBet();
    if(g){$("#betGame").value=`${g.away} @ ${g.home}`;$("#betSport").value=g.sport;}
  });
  ["filterBettor","filterSport","filterResult","filterSearch"].forEach(id=>$("#"+id)?.addEventListener("input",filterBets));
  $("#gameSportFilter")?.addEventListener("change",()=>{state.filters.sport=$("#gameSportFilter").value;render();});
  $("#gameStatusFilter")?.addEventListener("change",()=>{state.filters.status=$("#gameStatusFilter").value;render();});
  $("#gameSearch")?.addEventListener("input",e=>{state.filters.search=e.target.value;$("#gamesContainer").innerHTML=gameGrid(filteredGames());});
  document.querySelectorAll("[data-go]").forEach(x=>x.addEventListener("click",()=>{state.page=x.dataset.go;render();}));
  document.querySelectorAll(".game-card").forEach(x=>x.addEventListener("click",async()=>{
    const g=state.games.find(g=>g.id===x.dataset.gameId); if(!g)return;
    state.selectedGame=g; state.page="game-detail"; render(); await loadGameDetails(g);
  }));
  document.querySelectorAll(".detail-tab").forEach(x=>x.addEventListener("click",()=>switchDetail(x.dataset.detail)));
  $("#modelOdds")?.addEventListener("input",updateModelCalc);
  $("#modelEdgeProb")?.addEventListener("input",updateModelCalc);
}

async function switchDetail(tab){
  const g=state.selectedGame, d=state.gameData[g.id]||{};
  document.querySelectorAll(".detail-tab").forEach(x=>x.classList.toggle("active",x.dataset.detail===tab));
  if(tab==="overview") $("#detailContent").innerHTML=detailOverview(g,modelForGame(g),bestMarket(g),d);
  if(tab==="market") $("#detailContent").innerHTML=detailMarket(g);
  if(tab==="stats") $("#detailContent").innerHTML=detailStats(g,d);
  if(tab==="weather") $("#detailContent").innerHTML=detailWeather(g,d);
  if(tab==="bets") $("#detailContent").innerHTML=detailBets(g);
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
  if(!state.supabase || !state.live){
    alert("Shared database is not connected. Connect to Supabase before saving a bet.");
    return;
  }
  const b={id:uid(),room_code:cfg.ROOM_CODE||"FRIENDS-1",bettor:$("#betBettor").value,sport:$("#betSport").value,game:$("#betGame").value.trim(),bet_type:$("#betType").value,selection:$("#betSelection").value.trim(),odds:Number($("#betOdds").value),stake:Number($("#betStake").value),book:$("#betBook").value.trim(),result:$("#betResult").value,notes:$("#betNotes").value.trim(),created_at:new Date().toISOString()};
  const {data,error}=await state.supabase.from("bets").upsert(b).select().single();
  if(error){
    console.error("Supabase insert failed",error);
    alert("Bet was not saved. Supabase returned: " + error.message);
    return;
  }
  if(data){
    state.bets=state.bets.filter(x=>x.id!==data.id);
    state.bets.push(data);
  } else state.bets.push(b);
  closeBet(); render();
}

async function initSupabase(){
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){
    state.live=false;
    state.errors=["Supabase configuration is missing."];
    updateStatus();
    return;
  }
  try{
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data,error}=await state.supabase.from("bets")
      .select("*")
      .eq("room_code",cfg.ROOM_CODE||"FRIENDS-1")
      .order("created_at",{ascending:true});
    if(error) throw error;

    // Supabase is authoritative in V6. Local storage is only a last-resort
    // display cache and is never written as a successful database save.
    state.bets=data||[];
    try{localStorage.setItem(KEY,JSON.stringify(state.bets));}catch{}
    render();

    const channel=state.supabase.channel("bets-live-v6")
      .on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${cfg.ROOM_CODE||"FRIENDS-1"}`},payload=>{
        if(payload.eventType==="INSERT"){
          state.bets=state.bets.filter(x=>x.id!==payload.new.id);
          state.bets.push(payload.new);
        }
        if(payload.eventType==="UPDATE"){
          const i=state.bets.findIndex(x=>x.id===payload.new.id);
          if(i>=0)state.bets[i]=payload.new; else state.bets.push(payload.new);
        }
        if(payload.eventType==="DELETE")state.bets=state.bets.filter(x=>x.id!==payload.old.id);
        try{localStorage.setItem(KEY,JSON.stringify(state.bets));}catch{}
        render();
      });
    channel.subscribe(s=>{
      state.live=s==="SUBSCRIBED";
      updateStatus();
    });
  }catch(e){
    console.error("Supabase init failed",e);
    state.live=false;
    state.supabase=null;
    state.errors=[`Supabase: ${e.message||"connection failed"}`];
    updateStatus();
  }
}

function updateStatus(){
  $("#connectionDot")?.classList.toggle("online",state.live);
  $("#connectionDot")?.classList.toggle("offline",!state.live);
  if($("#connectionText"))$("#connectionText").textContent=state.live?"Database live":"Database offline";
}

async function espn(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function parseOdds(c){
  return (c?.odds||[]).map(o=>{
    const details=o.details || "";
    const provider=o.provider?.name || o.provider?.displayName || "ESPN feed";
    const home=c.competitors?.find(x=>x.homeAway==="home");
    const away=c.competitors?.find(x=>x.homeAway==="away");
    const ml=o.moneyline;
    return {
      provider,details,
      spread:o.spread ?? null,
      overUnder:o.overUnder ?? null,
      homeMoneyline: ml?.home?.close?.odds ?? ml?.home?.odds ?? o.homeTeamOdds?.moneyLine ?? null,
      awayMoneyline: ml?.away?.close?.odds ?? ml?.away?.odds ?? o.awayTeamOdds?.moneyLine ?? null,
      homeName:home?.team?.displayName,awayName:away?.team?.displayName
    };
  });
}

async function loadGames(){
  if(state.loading)return;
  state.loading=true;
  const out=[], errors=[];
  await Promise.all(SPORTS.map(async ([name,sport,league])=>{
    try{
      const d=await espn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
      for(const ev of (d.events||[]).slice(0,50)){
        const c=ev.competitions?.[0], comps=c?.competitors||[];
        const away=comps.find(x=>x.homeAway==="away"), home=comps.find(x=>x.homeAway==="home");
        const venue=c?.venue;
        out.push({
          id:`${name}-${ev.id}`,sourceId:ev.id,league:d.leagues?.[0]?.name||name,sport:name,
          away:away?.team?.abbreviation||away?.team?.displayName||"Away",
          home:home?.team?.abbreviation||home?.team?.displayName||"Home",
          awayId:away?.team?.id,homeId:home?.team?.id,
          awayScore:away?.score??null,homeScore:home?.score??null,
          awayData:away?.team||null,homeData:home?.team||null,
          status:ev.status?.type?.state==="in"?"in":ev.status?.type?.state||"pre",
          statusText:ev.status?.type?.shortDetail||ev.status?.type?.description||"",
          date:ev.date,venue:venue?.fullName||venue?.displayName||"",
          weather:c?.weather||ev.weather||null,odds:parseOdds(c),
          name:`${away?.team?.displayName||"Away"} @ ${home?.team?.displayName||"Home"}`
        });
      }
    }catch(e){errors.push(`${name}: ${e.message}`);}
  }));
  state.games=out.sort((a,b)=>{
    const rank=x=>x.status==="in"?0:x.status==="pre"?1:2;
    return rank(a)-rank(b)||new Date(a.date||0)-new Date(b.date||0);
  });
  state.errors=errors; state.lastRefresh=new Date(); state.loading=false; render();
}

async function loadGameDetails(g){
  if(!g||state.gameData[g.id]?.loaded)return;
  const d={loaded:true};
  try{
    const summary=await espn(`https://site.api.espn.com/apis/site/v2/sports/${SPORTS.find(x=>x[0]===g.sport)?.[1]||"football"}/${SPORTS.find(x=>x[0]===g.sport)?.[2]||"nfl"}/summary?event=${encodeURIComponent(g.sourceId)}`);
    d.raw=summary; d.competitors=summary.boxscore?.teams||summary.competitions?.[0]?.competitors||[];
    const c=summary.header?.competitions?.[0]||summary.competitions?.[0];
    d.venue=c?.venue?.fullName||c?.venue?.displayName||g.venue;
    d.attendance=c?.attendance;
    d.broadcasts=(c?.broadcasts||[]).map(x=>x.names?.[0]||x.shortName).filter(Boolean);
    d.weather=c?.weather||summary.weather||g.weather;
    state.gameData[g.id]=d;
  }catch(e){d.error=e.message;state.gameData[g.id]=d;}
  if(state.page==="game-detail")render();
}

async function refreshAll(){ await loadGames(); }

function updateModelCalc(){
  const odds=Number($("#modelOdds")?.value)||0,user=Number($("#modelEdgeProb")?.value)||0;
  const implied=oddsToProb(odds), edge=user-implied;
  const boxes=document.querySelectorAll(".metric .value");
  if(boxes[0])boxes[0].textContent=pct(implied);
  if(boxes[1])boxes[1].textContent=pct(edge);
}

function formatDate(d){
  if(!d)return "TBD";
  return new Date(d).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}

document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
  state.page=t.dataset.page;state.selectedGame=null;render();
}));
$("#refreshBtn")?.addEventListener("click",loadGames);
$("#addBetTop")?.addEventListener("click",openBet);
$("#closeModal")?.addEventListener("click",closeBet);
$("#cancelBet")?.addEventListener("click",closeBet);
$("#betForm")?.addEventListener("submit",addBet);

populateSports(); render(); initSupabase(); loadGames();
setInterval(loadGames,REFRESH);
})();