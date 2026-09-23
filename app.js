(() => {
"use strict";

const cfg = window.BT_CONFIG || {};
const KEY = "bt_local_bets_v7";
const REFRESH = Number(cfg.ESPN_REFRESH_MS) || 60000;

const state = {
  page: "dashboard",
  bets: [],
  games: [],
  selectedGame: null,
  gameData: {},
  snapshots: [],
  predictions: [],
  supabase: null,
  dbConnected: false,
  live: false,
  realtime: false,
  loading: false,
  lastRefresh: null,
  errors: [],
  filters: { sport:"", search:"", status:"all" },
  detailTab: "overview"
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


function modelVersion(){ return "V8-baseline-1"; }

function snapshotId(g){
  return `${cfg.ROOM_CODE||"FRIENDS-1"}:${g.sourceId}:${Date.now()}`;
}

function predictionId(g, selection){
  return `${cfg.ROOM_CODE||"FRIENDS-1"}:${g.sourceId}:${selection}:${Date.now()}`;
}

function latestPredictionForGame(g){
  return state.predictions.find(p=>p.source_game_id===g.sourceId) || null;
}

function predictionAccuracy(){
  const settled=state.predictions.filter(p=>p.outcome==="Win"||p.outcome==="Loss"||p.outcome==="Push");
  if(!settled.length) return {n:0, wins:0, rate:0};
  const wins=settled.filter(p=>p.outcome==="Win").length;
  return {n:settled.length,wins,rate:wins/settled.length*100};
}

async function saveSnapshot(g){
  if(!state.supabase || !g?.sourceId) return;
  const row={
    id:snapshotId(g), room_code:cfg.ROOM_CODE||"FRIENDS-1", source:"ESPN",
    source_game_id:g.sourceId, sport:g.sport, matchup:`${g.away} @ ${g.home}`,
    game_date:g.date||null,status:g.status,away_score:g.awayScore==null?null:String(g.awayScore),
    home_score:g.homeScore==null?null:String(g.homeScore),
    odds_json:g.odds||[],weather_json:g.weather||null
  };
  const {error}=await state.supabase.from("game_snapshots").upsert(row);
  if(error && !String(error.message||"").includes("relation")) console.warn("Snapshot save failed",error);
}

async function saveSnapshots(){
  if(!state.supabase || !state.games.length) return;
  await Promise.all(state.games.slice(0,100).map(saveSnapshot));
}

async function loadModelHistory(){
  if(!state.supabase) return;
  try{
    const [p,s]=await Promise.all([
      state.supabase.from("prediction_results").select("*").eq("room_code",cfg.ROOM_CODE||"FRIENDS-1").order("predicted_at",{ascending:false}).limit(500),
      state.supabase.from("game_snapshots").select("*").eq("room_code",cfg.ROOM_CODE||"FRIENDS-1").order("snapshot_at",{ascending:false}).limit(500)
    ]);
    if(!p.error && p.data) state.predictions=p.data;
    if(!s.error && s.data) state.snapshots=s.data;
  }catch(e){ console.warn("V8 history load failed",e); }
}

async function logPrediction(g, selection, probability, odds){
  if(!state.supabase || !g?.sourceId) return false;
  const p=Number(probability), o=Number(odds);
  const implied=o?oddsToProb(o):null;
  const edge=implied==null?null:p-implied;
  const row={
    id:predictionId(g,selection), room_code:cfg.ROOM_CODE||"FRIENDS-1",
    prediction_id:uid(), source_game_id:g.sourceId, sport:g.sport,
    model_version:modelVersion(), selection, probability:p,
    market_odds:Number.isFinite(o)?o:null, implied_probability:implied,
    edge, outcome:null, predicted_at:new Date().toISOString(), settled_at:null
  };
  const {data,error}=await state.supabase.from("prediction_results").insert(row).select().single();
  if(!error && data){state.predictions.unshift(data);return true;}
  if(error) console.warn("Prediction log failed",error);
  return false;
}

function renderPredictionHistory(){
  const a=predictionAccuracy();
  const recent=state.predictions.slice(0,12);
  return `<div class="grid four">
    ${metric("Logged predictions",a.n)}
    ${metric("Prediction wins",a.wins)}
    ${metric("Win rate",pct(a.rate))}
    ${metric("Snapshots",state.snapshots.length)}
  </div>
  <section class="card" style="margin-top:14px">
    <div class="section-head"><h2>Prediction history</h2><span>${modelVersion()}</span></div>
    ${recent.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Sport</th><th>Selection</th><th>Prob.</th><th>Odds</th><th>Edge</th><th>Outcome</th></tr></thead><tbody>
    ${recent.map(p=>`<tr><td>${formatDate(p.predicted_at)}</td><td>${esc(p.sport)}</td><td>${esc(p.selection)}</td><td>${p.probability==null?"—":pct(Number(p.probability))}</td><td>${p.market_odds==null?"—":fmtOdds(p.market_odds)}</td><td>${p.edge==null?"—":pct(Number(p.edge))}</td><td>${esc(p.outcome||"Pending")}</td></tr>`).join("")}
    </tbody></table></div>`:`<div class="empty">No predictions have been logged yet. V7 only learns from predictions explicitly logged against real game inputs.</div>`}
  </section>`;
}

function render(){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.page===state.page));
  const views = {
    dashboard, bets:betsPage, games:gamesPage, analytics:analyticsPage,
    model:modelPage, settings:settingsPage, snapshots:snapshotsPage, "game-detail":()=>gameDetailPage(state.selectedGame)
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
    <div><div class="eyebrow">V7 • LIVE TERMINAL</div><h1>Command Center</h1><p>Live games, real feed data, shared bets, market snapshots and transparent model factors.</p></div>
    <div class="title-actions"><button class="ghost" id="refreshDashboard">↻ Refresh All</button><button class="primary" id="addBetBtn">+ Add Bet</button></div>
  </div>
  <div class="terminal-strip">
    <div class="connection-badge ${state.dbConnected?"connected":"offline"}" id="connectionBadge">${state.dbConnected?(state.realtime?"LIVE SYNC":"DATABASE CONNECTED"):"OFFLINE"}</div>
    <button class="chip ${!state.filters.sport?"active":""}" data-sport="">All Sports</button>
    ${SPORTS.map(x=>`<button class="chip ${state.filters.sport===x[0]?"active":""}" data-sport="${esc(x[0])}">${esc(x[0])}</button>`).join("")}
    <span class="strip-spacer"></span><span class="last-sync">${state.lastRefresh?`Updated ${state.lastRefresh.toLocaleTimeString()}`:"Waiting for feed…"}</span>
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
      ${gameGrid(filteredGames().slice(0,10))}
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
      <div class="kpi"><span>Shared Supabase</span><b>${state.live?"CONNECTED":"NOT CONNECTED"}</b></div>
      <div class="kpi"><span>Score source</span><b>ESPN public feed</b></div>
      <div class="kpi"><span>Market source</span><b>ESPN event odds when supplied</b></div>
      <div class="kpi"><span>Weather</span><b>ESPN / Open-Meteo</b></div>
      <div class="notice">V7 never invents odds, injuries, stats or edges. Local storage is only a temporary browser cache; Supabase is the shared source of truth when connected. If a free source does not return a field, the terminal shows “not available” instead.</div>
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
    <div class="game-top"><span class="pill">${esc(g.sport)}</span><span class="game-state ${live?"live":""}">${live?"LIVE":esc(g.statusText||formatDate(g.date)||"Scheduled")}</span></div>
    <div class="teams-row"><div><div class="team-line">${esc(g.away)}</div><div class="team-line">${esc(g.home)}</div></div>
      <div class="scores"><b>${g.awayScore??"—"}</b><b>${g.homeScore??"—"}</b></div>
    </div>
    <div class="game-meta">${live?esc(g.statusText||"Live"):esc(formatDate(g.date))}${g.venue?` · ${esc(g.venue)}`:""}</div>
    <div class="card-market-row">${odds?`<span>ML ${odds.awayMoneyline!=null?fmtOdds(odds.awayMoneyline):"—"} / ${odds.homeMoneyline!=null?fmtOdds(odds.homeMoneyline):"—"}</span><span>${odds.overUnder!=null?`O/U ${esc(odds.overUnder)}`:"Market data"}</span>`:`<span class="muted">No market price returned</span>`}<span class="open-arrow">Open →</span></div>
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
  return `<div class="page-title"><div><div class="eyebrow">REAL SCOREBOARD FEED</div><h1>Games Center</h1><p>Schedules and scores from ESPN's public scoreboard endpoints. Click a game for the V8 game terminal.</p></div><button class="ghost" id="refreshGames">↻ Refresh</button></div>
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
  const status=g.status==="in"?"LIVE":(g.statusText||"Scheduled");
  const date=formatDate(g.date);
  const score=(g.awayScore!=null&&g.homeScore!=null)?`${g.awayScore} — ${g.homeScore}`:"—";
  return `<div class="game-terminal">
    <div class="terminal-hero">
      <div class="hero-top"><button class="ghost" id="backGames">← Games</button><span class="eyebrow">${esc(g.sport)} · ${esc(g.league||"")}</span><span class="terminal-live ${g.status==="in"?"is-live":""}">${g.status==="in"?"● LIVE":esc(status)}</span></div>
      <div class="hero-matchup">
        <div class="hero-team"><span>${esc(g.away)}</span><strong>${g.awayScore??"—"}</strong></div>
        <div class="hero-center"><small>${esc(status)}</small><b>${esc(date)}</b><em>${esc(score)}</em></div>
        <div class="hero-team home"><span>${esc(g.home)}</span><strong>${g.homeScore??"—"}</strong></div>
      </div>
      <div class="hero-meta"><span>Venue: ${esc(d.venue||g.venue||"Not available")}</span><span>Broadcast: ${esc(d.broadcasts?.join(", ")||"Not available")}</span><span>Weather: ${d.weather?"Available":"Not available"}</span><button class="primary" id="betThisGame">+ Bet this game</button></div>
    </div>
    <div class="terminal-tabs v8-tabs">
      ${[["overview","Overview"],["market","Market"],["stats","Stats"],["news","Injuries / News"],["weather","Weather"],["model","Model"],["bets","Bets"]].map(([id,label])=>`<button class="detail-tab ${state.detailTab===id?"active":""}" data-detail="${id}">${label}</button>`).join("")}
    </div>
    <div id="detailContent">${detailTabContent(g,state.detailTab,d,m,market)}</div>
  </div>`;
}

function detailTabContent(g,tab,d,m,market){
  if(tab==="market") return detailMarket(g);
  if(tab==="stats") return detailStats(g,d);
  if(tab==="news") return detailNews(g,d);
  if(tab==="weather") return detailWeather(g,d);
  if(tab==="model") return detailModel(g,m,market);
  if(tab==="bets") return detailBets(g);
  return detailOverview(g,m,market,d);
}

function detailOverview(g,m,market,d){
  const homeImp=market?.homeMoneyline!=null?oddsToProb(market.homeMoneyline)*100:null;
  const awayImp=market?.awayMoneyline!=null?oddsToProb(market.awayMoneyline)*100:null;
  return `<div class="detail-market-strip v8-metrics">
    ${metric("Game status",g.status==="in"?"LIVE":(g.statusText||"Scheduled"),g.status==="in"?"live-text":"")}
    ${metric("Moneyline",market?`${g.away} ${market.awayMoneyline!=null?fmtOdds(market.awayMoneyline):"—"} · ${g.home} ${market.homeMoneyline!=null?fmtOdds(market.homeMoneyline):"—"}`:"Not available")}
    ${metric("Spread",market?.spread!=null?market.spread:"Not available")}
    ${metric("Total",market?.overUnder!=null?market.overUnder:"Not available")}
  </div>
  <div class="grid two v8-detail-grid">
    <section class="card terminal-score-card">
      <div class="section-head"><h2>Scoreboard</h2><span>${g.status==="in"?"Live feed":"Event feed"}</span></div>
      <div class="big-score-row"><div><small>${esc(g.away)}</small><strong>${g.awayScore??"—"}</strong></div><span>@</span><div><small>${esc(g.home)}</small><strong>${g.homeScore??"—"}</strong></div></div>
      <div class="terminal-subgrid">${infoRow("Game status",g.statusText||statusText(g))}${infoRow("Start",formatDate(g.date))}${infoRow("Venue",d.venue||g.venue||"Not available")}${infoRow("Broadcast",d.broadcasts?.join(", ")||"Not available")}</div>
    </section>
    <section class="card">
      <div class="section-head"><h2>Market snapshot</h2><span>Only returned prices</span></div>
      ${market?marketSnapshot(g,market):`<div class="empty">No sportsbook market was returned for this event. No prices are being invented.</div>`}
    </section>
  </div>
  <div class="grid two v8-detail-grid">
    <section class="card"><div class="section-head"><h2>Game information</h2><span>Source fields</span></div>${infoRow("League",g.league||g.sport)}${infoRow("Venue",d.venue||g.venue||"Not available")}${infoRow("Attendance",d.attendance??"Not available")}${infoRow("Event ID",g.sourceId||"—")}</section>
    <section class="card"><div class="section-head"><h2>Model at a glance</h2><span>Baseline</span></div>${modelFactor("Model state",m.label)}${modelFactor(g.away,m.awayProb+"%")}${modelFactor(g.home,m.homeProb+"%")}${modelFactor("Market edge",market?calculateEdge(market,m,g):"No market price")}<button class="primary full-width" id="openModelTab">View full model</button></section>
  </div>`;
}
function statusText(g){return g.status==="post"?"Final":g.status==="in"?"In progress":"Scheduled";}
function marketSnapshot(g,o){return `<div class="market-snapshot"><div><span>${esc(g.away)} ML</span><b>${o.awayMoneyline!=null?fmtOdds(o.awayMoneyline):"—"}</b></div><div><span>Spread</span><b>${o.spread??"—"}</b></div><div><span>Total</span><b>${o.overUnder??"—"}</b></div><div><span>${esc(g.home)} ML</span><b>${o.homeMoneyline!=null?fmtOdds(o.homeMoneyline):"—"}</b></div></div><div class="source-note">${esc(o.provider||"ESPN feed")}${o.details?` · ${esc(o.details)}`:""}</div>`;}
function modelFactor(a,b){return `<div class="model-factor"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;}

function detailMarket(g){
  const markets=g.odds||[];
  return `<div class="grid two v8-detail-grid"><section class="card"><div class="section-head"><h2>Available market</h2><span>${markets.length} record${markets.length===1?"":"s"}</span></div>${markets.length?markets.map(o=>`<div class="market-terminal-card"><div class="market-source"><b>${esc(o.provider||"ESPN feed")}</b><small>${esc(o.details||"No line description returned")}</small></div><div class="market-line"><div><span>${esc(g.away)}</span><b>${o.awayMoneyline!=null?fmtOdds(o.awayMoneyline):"—"}</b></div><div><span>Spread</span><b>${o.spread??"—"}</b></div><div><span>Total</span><b>${o.overUnder??"—"}</b></div><div><span>${esc(g.home)}</span><b>${o.homeMoneyline!=null?fmtOdds(o.homeMoneyline):"—"}</b></div></div></div>`).join(""):`<div class="empty">No market prices were returned by the current event feed. Missing odds stay missing.</div>`}</section><section class="card"><div class="section-head"><h2>Market interpretation</h2><span>Descriptive</span></div>${markets.length?marketInterpretation(g,markets[0]):`<div class="empty">Market comparison will appear when prices are supplied.</div>`}</section></div>`;
}
function marketInterpretation(g,o){const h=o.homeMoneyline!=null?oddsToProb(o.homeMoneyline)*100:null,a=o.awayMoneyline!=null?oddsToProb(o.awayMoneyline)*100:null;return `<div class="terminal-subgrid">${infoRow("Home implied",h!=null?pct(h):"Not available")}${infoRow("Away implied",a!=null?pct(a):"Not available")}${infoRow("Spread",o.spread??"Not available")}${infoRow("Total",o.overUnder??"Not available")}</div><div class="notice">Implied probability is calculated from the returned American price. It does not account for sportsbook margin and is not a prediction.</div>`;}

function detailStats(g,d){
  const comps=d.competitors||[];
  if(!comps.length) return `<section class="card"><div class="empty">Detailed box-score/team stats are not available from the event endpoint yet.</div></section>`;
  return `<div class="grid two v8-detail-grid">${comps.map(c=>`<section class="card"><div class="section-head"><h2>${esc(c.team?.displayName||"Team")}</h2><span>${esc(c.score??"")}</span></div>${(c.statistics||[]).map(s=>infoRow(s.name||s.label,s.displayValue??s.value)).join("")||`<div class="empty">No statistics returned for this team.</div>`}</section>`).join("")}</div>`;
}

function detailNews(g,d){
  const injuries=d.injuries||[],news=d.news||[];
  return `<div class="grid two v8-detail-grid"><section class="card"><div class="section-head"><h2>Injuries</h2><span>${injuries.length} returned</span></div>${injuries.length?injuries.map(x=>`<div class="news-item"><b>${esc(x.athlete?.displayName||x.name||"Player")}</b><span>${esc(x.status||x.type||"Status unavailable")}</span><small>${esc(x.details||x.description||"")}</small></div>`).join(""):`<div class="empty">No injury information was returned for this event. This does not mean there are no injuries.</div>`}</section><section class="card"><div class="section-head"><h2>News</h2><span>${news.length} returned</span></div>${news.length?news.slice(0,12).map(x=>`<div class="news-item"><b>${esc(x.headline||x.title||"News item")}</b><small>${esc(x.description||x.story||"")}</small><span>${esc(x.published||x.publishedAt||"")}</span></div>`).join(""):`<div class="empty">No event news was returned by the current source.</div>`}</section></div><div class="notice">Injuries and news are displayed only when the event feed returns them. Nothing is inferred or fabricated.</div>`;
}

function detailWeather(g,d){
  const w=d.weather||g.weather;
  if(w) return `<section class="card"><div class="section-head"><h2>Weather</h2><span>Event feed</span></div><div class="weather-grid">${infoRow("Condition",w.displayValue||w.condition||"—")}${infoRow("Temperature",w.temperature!=null?`${w.temperature}°`:"—")}${infoRow("Wind",w.windSpeed?`${w.windSpeed} mph`:"—")}${infoRow("Source","ESPN event data")}</div></section>`;
  return `<section class="card"><div class="empty">No weather object was returned for this event. Weather is not guessed.</div></section>`;
}

function detailModel(g,m,market){
  const homeOdds=market?.homeMoneyline,awayOdds=market?.awayMoneyline;
  const hi=homeOdds!=null?oddsToProb(homeOdds)*100:null, ai=awayOdds!=null?oddsToProb(awayOdds)*100:null;
  return `<div class="grid two v8-detail-grid"><section class="card"><div class="section-head"><h2>Model probability</h2><span>V8 baseline</span></div><div class="probability-board"><div><small>${esc(g.away)}</small><strong>${m.awayProb}%</strong>${ai!=null?`<span>Market implied ${ai.toFixed(1)}%</span>`:"<span>Market implied —</span>"}</div><div><small>${esc(g.home)}</small><strong>${m.homeProb}%</strong>${hi!=null?`<span>Market implied ${hi.toFixed(1)}%</span>`:"<span>Market implied —</span>"}</div></div>${modelFactor("Model state",m.label)}${modelFactor("Data quality",m.label.includes("record")?"Team records available":"Limited inputs")}</section><section class="card"><div class="section-head"><h2>Factors used</h2><span>Transparent</span></div>${modelFactor("Team record",m.label.includes("record")?"Included":"Unavailable")}${modelFactor("Live score",g.status==="in"?"Included as live state":"Not used")}${modelFactor("Market price",market?"Available":"Unavailable")}${modelFactor("Recent form","Not currently returned by baseline")}</section></div><section class="card"><div class="section-head"><h2>Edge & interpretation</h2><span>No guarantee</span></div>${market?`<div class="grid four">${metric("Away model",m.awayProb+"%")}${metric("Away implied",ai!=null?pct(ai):"—")}${metric("Home model",m.homeProb+"%")}${metric("Home implied",hi!=null?pct(hi):"—")}</div><div class="notice">${calculateEdge(market,m,g)}. This is a transparent baseline calculation, not a guarantee or a claim of predictive accuracy.</div>`:`<div class="empty">An edge cannot be calculated until a matching market price is returned.</div>`}</section><section class="card"><div class="section-head"><h2>Prediction history</h2><span>${state.predictions.filter(p=>p.source_game_id===g.sourceId).length} records</span></div>${predictionHistoryForGame(g)}</section>`;
}
function predictionHistoryForGame(g){const ps=state.predictions.filter(p=>p.source_game_id===g.sourceId).slice(0,10);if(!ps.length)return `<div class="empty">No stored predictions for this game.</div>`;return `<div class="table-wrap"><table class="table"><thead><tr><th>Selection</th><th>Probability</th><th>Odds</th><th>Edge</th><th>Outcome</th></tr></thead><tbody>${ps.map(p=>`<tr><td>${esc(p.selection)}</td><td>${pct(p.probability)}</td><td>${p.market_odds!=null?fmtOdds(p.market_odds):"—"}</td><td>${p.edge!=null?pct(p.edge):"—"}</td><td>${esc(p.outcome||"Pending")}</td></tr>`).join("")}</tbody></table></div>`;}

function detailBets(g){
  const bs=state.bets.filter(b=>b.game===`${g.away} @ ${g.home}` || b.game===g.name);
  return `<section class="card"><div class="section-head"><div><h2>Group bets on this game</h2><span>${bs.length} recorded</span></div><button class="primary" id="betThisGame">+ Bet</button></div>${bs.length?betTable(bs.slice().reverse()):`<div class="empty">No group bets are attached to this game yet.</div>`}</section>`;
}

function bestMarket(g){ return g.odds?.find(x=>x.homeMoneyline!=null||x.awayMoneyline!=null)||g.odds?.[0]||null; }
function calculateEdge(o,m,g){
  if(o.homeMoneyline!=null){const p=Number(m.homeProb)/100,imp=oddsToProb(o.homeMoneyline);return `${(p-imp)*100>=0?"+":""}${((p-imp)*100).toFixed(1)}% home ML`;}
  if(o.awayMoneyline!=null){const p=Number(m.awayProb)/100,imp=oddsToProb(o.awayMoneyline);return `${(p-imp)*100>=0?"+":""}${((p-imp)*100).toFixed(1)}% away ML`;}
  return "Price available; exact edge needs a matching moneyline";
}

function analyticsPage(){
  const settled=state.bets.filter(b=>b.result!=="Pending");
  const bySport=[...new Set(state.bets.map(b=>b.sport))].filter(Boolean);
  const byBettor=["Mason","Friend 1","Friend 2"].map(n=>[n,state.bets.filter(b=>b.bettor===n)]);
  return `<div class="page-title"><div><div class="eyebrow">HISTORY</div><h1>Analytics</h1><p>Track what the group actually did. No hidden weighting or fake sample sizes.</p></div></div>
  <div class="grid two"><section class="card"><div class="section-head"><h2>Performance by sport</h2></div>${bySport.length?bySport.map(s=>analysisRow(s,state.bets.filter(b=>b.sport===s))).join(""):`<div class="empty">No bets yet.</div>`}</section>
  <section class="card"><div class="section-head"><h2>Performance by bettor</h2></div>${byBettor.map(([n,bs])=>analysisRow(n,bs)).join("")}</section></div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Risk snapshot</h2><span>${settled.length} settled</span></div>${riskSnapshot()}</section>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Model data quality</h2></div><div class="notice">Prediction learning is separated from the bet ledger. V6 stores model version, inputs, price and outcome so later versions can be compared by sample size and backtest results.</div></section>`;
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
  return `<div class="page-title"><div><div class="eyebrow">MODEL LAB • V8</div><h1>Solo Modeler</h1><p>V7 logs transparent predictions, game snapshots, market inputs and outcomes so the model can be evaluated over time.</p></div></div>
  <div class="grid two">
    <section class="card"><div class="section-head"><h2>Market calculator</h2><span>live math</span></div>
      <label>American odds<input id="modelOdds" type="number" value="-110"></label>
      <label style="margin-top:12px">Your model probability (%)<input id="modelEdgeProb" type="number" min="0" max="100" step="0.1" value="50"></label>
      <div class="grid two" style="margin-top:16px">${metric("Implied probability",pct(oddsToProb(-110)))}${metric("Edge",pct(50-oddsToProb(-110)))}</div>
      <div id="modelCalcNote" class="notice">Positive edge means the entered probability is above the market's implied probability. It is not proof that a bet will win.</div>
    </section>
    <section class="card"><div class="section-head"><h2>Model pipeline</h2><span>V6</span></div>
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


function snapshotsPage(){
  return `<div class="page-title"><div><div class="eyebrow">DATA HISTORY • V6</div><h1>Snapshots</h1><p>Real ESPN game-state snapshots stored in the shared database for later model evaluation.</p></div><button class="ghost" id="refreshSnapshots">↻ Refresh</button></div>
  <div class="grid four">${metric("Stored snapshots",state.snapshots.length)}${metric("Predictions",state.predictions.length)}${metric("Model version",modelVersion())}${metric("Database",state.live?"CONNECTED":"NOT CONNECTED")}</div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Recent snapshots</h2><span>Newest first</span></div>
  ${state.snapshots.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Sport</th><th>Matchup</th><th>Status</th><th>Score</th><th>Markets</th></tr></thead><tbody>
  ${state.snapshots.slice(0,50).map(s=>`<tr><td>${formatDate(s.snapshot_at)}</td><td>${esc(s.sport)}</td><td>${esc(s.matchup)}</td><td>${esc(s.status||"")}</td><td>${esc(s.away_score??"—")} - ${esc(s.home_score??"—")}</td><td>${Array.isArray(s.odds_json)?s.odds_json.length:"—"}</td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty">No snapshots loaded. Connect Supabase and refresh games.</div>`}
  </section>`;
}

function settingsPage(){
  return `<div class="page-title"><div><div class="eyebrow">SYSTEM</div><h1>Settings</h1><p>Free deployment and data-source status.</p></div></div>
  <section class="card"><h2>Shared database</h2>${infoRow("Supabase URL configured",cfg.SUPABASE_URL?"YES":"NO")}${infoRow("Database",state.dbConnected?"CONNECTED":"NOT CONNECTED")}${infoRow("Realtime",state.realtime?"LIVE SYNC":"NOT ACTIVE")}${infoRow("Room",cfg.ROOM_CODE||"FRIENDS-1")}
  <div class="notice">Keep your existing working <b>config.js</b>. V7 does not require replacing it. Only the public Supabase anon key belongs in the browser.</div></section>
  <section class="card" style="margin-top:14px"><h2>Free data stack</h2>${infoRow("Scores / schedules","ESPN public scoreboard")}${infoRow("Event details","ESPN summary endpoint")}${infoRow("Weather","ESPN event weather when supplied")}${infoRow("Fallback weather","Open-Meteo")}${infoRow("Database","Supabase free tier")}${infoRow("Hosting","GitHub Pages")}</section>
  <section class="card" style="margin-top:14px"><h2>Data limitations</h2><div class="notice">There is no honest promise of unlimited free sportsbook odds. V6 uses market data only when the free event feed actually returns it. Missing odds are shown as missing instead of being guessed.</div></section>`;
}

function filteredGames(){
  const sport=state.filters.sport, q=state.filters.search.toLowerCase(), status=state.filters.status;
  return state.games.filter(g=>(!sport||g.sport===sport)&&(!q||`${g.away} ${g.home} ${g.league}`.toLowerCase().includes(q))&&(status==="all"||g.status===status));
}

function bindPage(){
  $("#addBetBtn")?.addEventListener("click",openBet);
  $("#addBetTop")?.addEventListener("click",openBet);
  $("#refreshDashboard")?.addEventListener("click",refreshAll);
  document.querySelectorAll("[data-sport]").forEach(x=>x.addEventListener("click",()=>{state.filters.sport=x.dataset.sport||"";state.filters.status="all";render();}));
  $("#refreshGames")?.addEventListener("click",loadGames);
  $("#refreshSnapshots")?.addEventListener("click",async()=>{await loadModelHistory();render();});
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
  $("#openModelTab")?.addEventListener("click",()=>switchDetail("model"));
  $("#logGamePrediction")?.addEventListener("click", async ()=>{
    const g=state.selectedGame, m=modelForGame(g), market=bestMarket(g);
    const odds=market?.homeMoneyline;
    if(!state.supabase){ alert("Supabase is not connected. V6 will not log a prediction locally."); return; }
    const ok=await logPrediction(g,g.home,m.homeProb,odds);
    alert(ok?"Prediction logged to Supabase.":"Prediction could not be logged.");
    if(ok) render();
  });
  $("#modelOdds")?.addEventListener("input",updateModelCalc);
  $("#modelEdgeProb")?.addEventListener("input",updateModelCalc);
}

async function switchDetail(tab){
  const g=state.selectedGame; if(!g)return;
  const d=state.gameData[g.id]||{}; state.detailTab=tab;
  document.querySelectorAll(".detail-tab").forEach(x=>x.classList.toggle("active",x.dataset.detail===tab));
  $("#detailContent").innerHTML=detailTabContent(g,tab,d,modelForGame(g),bestMarket(g));
  $("#openModelTab")?.addEventListener("click",()=>switchDetail("model"));
  $("#betThisGame")?.addEventListener("click",()=>{ const gg=state.selectedGame; openBet(); if(gg){$("#betGame").value=`${gg.away} @ ${gg.home}`;$("#betSport").value=gg.sport;} });
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
  state.bets.push(b); saveLocal(); closeBet(); render();
  if(state.supabase){
    const {error}=await state.supabase.from("bets").upsert(b);
    if(error) console.warn("Supabase insert failed",error);
  }
}

async function initSupabase(){
  state.dbConnected=false;
  state.realtime=false;
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){ updateStatus(); return; }
  try{
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data,error}=await state.supabase.from("bets").select("*").eq("room_code",cfg.ROOM_CODE||"FRIENDS-1").order("created_at",{ascending:true});
    if(error) throw error;
    state.dbConnected=true;
    if(data){state.bets=data;saveLocal();render();}
    await loadModelHistory();
    updateStatus();
    const channel=state.supabase.channel("bets-live-v7")
      .on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${cfg.ROOM_CODE||"FRIENDS-1"}`},payload=>{
        if(payload.eventType==="INSERT"&&!state.bets.some(x=>x.id===payload.new.id))state.bets.push(payload.new);
        if(payload.eventType==="UPDATE"){const i=state.bets.findIndex(x=>x.id===payload.new.id);if(i>=0)state.bets[i]=payload.new;}
        if(payload.eventType==="DELETE")state.bets=state.bets.filter(x=>x.id!==payload.old.id);
        saveLocal();render();
      });
    channel.subscribe(s=>{state.realtime=s==="SUBSCRIBED";state.live=state.realtime;updateStatus();});
  }catch(e){console.warn("Supabase init failed",e);state.supabase=null;state.dbConnected=false;state.realtime=false;state.live=false;updateStatus();}
}

function updateStatus(){
  const connected=!!state.dbConnected;
  $("#connectionDot")?.classList.toggle("online",connected);
  $("#connectionDot")?.classList.toggle("offline",!connected);
  if($("#connectionText"))$("#connectionText").textContent=connected?(state.realtime?"Shared live":"Shared connected"):"Not connected";
  const badge=$("#connectionBadge");
  if(badge){badge.textContent=connected?(state.realtime?"LIVE SYNC":"DATABASE CONNECTED"):"OFFLINE";badge.className=`connection-badge ${connected?"connected":"offline"}`;}
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
  if(state.supabase) saveSnapshots();
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
    d.injuries=summary.injuries||summary.injury||[];
    d.news=summary.news?.articles||summary.news||[];
    d.loaded=true;
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

loadLocal(); populateSports(); render(); initSupabase(); loadGames();
setInterval(loadGames,REFRESH);
})();