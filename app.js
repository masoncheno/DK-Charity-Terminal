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
  dbError: "",
  dbCheckedAt: null,
  live: false,
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


function modelVersion(){ return "V6-baseline-1"; }

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
  }catch(e){ console.warn("V6 history load failed",e); }
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
    </tbody></table></div>`:`<div class="empty">No predictions have been logged yet. V6 only learns from predictions explicitly logged against real game inputs.</div>`}
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
    <div><div class="eyebrow">V6 • LIVE TERMINAL</div><h1>Command Center</h1><p>Live games, real feed data, shared bets, market snapshots and transparent model factors.</p></div>
    <div class="title-actions"><button class="ghost" id="refreshDashboard">↻ Refresh All</button><button class="primary" id="addBetBtn">+ Add Bet</button></div>
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
      <div class="kpi"><span>Shared Supabase</span><b>${state.dbConnected?"CONNECTED":(state.live?"REALTIME ONLY":"NOT CONNECTED")}</b></div>
      <div class="kpi"><span>Score source</span><b>ESPN public feed</b></div>
      <div class="kpi"><span>Market source</span><b>ESPN event odds when supplied</b></div>
      <div class="kpi"><span>Weather</span><b>ESPN / Open-Meteo</b></div>
      <div class="notice">V6 never invents odds, injuries, stats or edges. Local storage is only a temporary browser cache; Supabase is the shared source of truth when connected. If a free source does not return a field, the terminal shows “not available” instead.</div>
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
  return `<div class="page-title"><div><div class="eyebrow">REAL SCOREBOARD FEED</div><h1>Games Center</h1><p>Schedules and scores from ESPN's public scoreboard endpoints. Click a game for the V6 game terminal.</p></div><button class="ghost" id="refreshGames">↻ Refresh</button></div>
  <div class="filters"><select id="gameSportFilter"><option value="">All sports</option>${SPORTS.map(x=>`<option ${state.filters.sport===x[0]?"selected":""}>${x[0]}</option>`).join("")}</select>
  <select id="gameStatusFilter"><option value="all">All statuses</option><option value="in">Live</option><option value="pre">Upcoming</option><option value="post">Final</option></select>
  <input id="gameSearch" value="${esc(state.filters.search)}" placeholder="Search team / matchup"></div>
  <section class="card"><div class="section-head"><h2>${filtered.length} games</h2><span>Auto-refresh ${Math.round(REFRESH/1000)}s</span></div><div id="gamesContainer">${gameGrid(filtered)}</div></section>`;
}

function gameDetailPage(g){
  if(!g) return `<div class="empty">No game selected.</div>`;
  const d=state.gameData[g.id]||{};
  const tab=state.detailTab||"overview";
  return `<div class="page-title">
    <div><button class="ghost" id="backGames">← Games</button><div class="eyebrow">${esc(g.sport)} · ${esc(g.league||"")}</div>
    <h1>${esc(g.away)} @ ${esc(g.home)}</h1><p>${esc(g.statusText||"Scheduled")} · ${formatDate(g.date)}</p></div>
    <button class="primary" id="betThisGame">Bet this game</button>
  </div>
  <section class="card game-hero">
    <div class="game-hero-status"><span class="pill">${g.status==="in"?"LIVE":esc(g.statusText||"UPCOMING")}</span><span>${formatDate(g.date)}</span><span>${esc(g.league||g.sport)}</span></div>
    <div class="hero-score"><div><small>${esc(g.away)}</small><strong>${g.awayScore??"—"}</strong></div><div class="hero-at">@</div><div><small>${esc(g.home)}</small><strong>${g.homeScore??"—"}</strong></div></div>
    <div class="hero-markets">${heroMarket(g)}</div>
  </section>
  <div class="terminal-tabs detail-tabs-wide">
    ${[["overview","Overview"],["comparison","Team Comparison"],["recent","Recent Games"],["standings","Standings"],["players","Players"],["scoring","Scoring"],["weather","Weather"],["bets","Bets"]].map(([id,label])=>`<button class="detail-tab ${tab===id?"active":""}" data-detail="${id}">${label}</button>`).join("")}
  </div>
  <div id="detailContent">${detailTabContent(g,d,tab)}</div>`;
}

function heroMarket(g){
  const m=bestMarket(g);
  return `<div class="hero-market"><span>Moneyline <b>${m?.awayMoneyline!=null?fmtOdds(m.awayMoneyline):"—"} / ${m?.homeMoneyline!=null?fmtOdds(m.homeMoneyline):"—"}</b></span><span>Spread <b>${m?.spread!=null?esc(m.spread):"—"}</b></span><span>Total <b>${m?.overUnder!=null?esc(m.overUnder):"—"}</b></span></div>`;
}

function detailTabContent(g,d,tab){
  if(tab==="overview") return detailOverview(g,d);
  if(tab==="comparison") return detailComparison(g,d);
  if(tab==="recent") return detailRecent(g,d);
  if(tab==="standings") return detailStandings(g,d);
  if(tab==="players") return detailPlayers(g,d);
  if(tab==="scoring") return detailScoring(g,d);
  if(tab==="weather") return detailWeather(g,d);
  if(tab==="bets") return detailBets(g);
  return detailOverview(g,d);
}

function detailOverview(g,d){
  const m=bestMarket(g), a=d.away||{}, h=d.home||{};
  return `<div class="grid two">
    <section class="card"><div class="section-head"><h2>Game Overview</h2><span>${d.updatedAt?"Updated "+formatDate(d.updatedAt):"Live source"}</span></div>
      ${infoRow("Status",g.status==="in"?`LIVE · ${g.statusText||"In progress"}`:(g.statusText||"Scheduled"))}
      ${infoRow("Game time",formatDate(g.date))}${infoRow("Venue",d.venue||g.venue||"Not available")}
      ${infoRow("Away",`${g.away} · ${g.awayScore??"—"}`)}${infoRow("Home",`${g.home} · ${g.homeScore??"—"}`)}
      ${infoRow("Moneyline",`${m?.awayMoneyline!=null?fmtOdds(m.awayMoneyline):"—"} / ${m?.homeMoneyline!=null?fmtOdds(m.homeMoneyline):"—"}`)}
      ${infoRow("Spread",m?.spread!=null?m.spread:"Not available")}${infoRow("Total",m?.overUnder!=null?m.overUnder:"Not available")}
    </section>
    <section class="card"><div class="section-head"><h2>Quick Team Snapshot</h2><span>Free source data only</span></div>
      ${comparisonMini("Record",a.record,h.record)}${comparisonMini("PPG",a.ppg,h.ppg)}${comparisonMini("Opp PPG",a.oppPpg,h.oppPpg)}${comparisonMini("Recent 5",a.recent5,h.recent5)}${comparisonMini("Home/Away",a.location,h.location)}
      <div class="notice" style="margin-top:12px">Stats, player information and injuries are shown only when ESPN returns them for this event/team. Missing fields stay unavailable rather than being estimated.</div>
    </section>
  </div>`;
}
function comparisonMini(label,a,b){return `<div class="compare-row"><span>${esc(label)}</span><b>${esc(a??"—")}</b><b>${esc(b??"—")}</b></div>`;}

function detailComparison(g,d){
  const a=d.away||{},h=d.home||{};
  const rows=[
    ["Record",a.record,h.record],["PPG",a.ppg,h.ppg],["Opp PPG",a.oppPpg,h.oppPpg],["FG%",a.fg,h.fg],["3P%",a.three,h.three],["RPG",a.rpg,h.rpg],["APG",a.apg,h.apg],["Recent 5",a.recent5,h.recent5],["Home/Away",a.location,h.location]
  ];
  return `<section class="card"><div class="section-head"><h2>Team Comparison</h2><span>${esc(g.away)} vs ${esc(g.home)}</span></div>
    <div class="comparison-table"><div class="compare-head"><span></span><b>${esc(g.away)}</b><b>${esc(g.home)}</b></div>${rows.map(r=>comparisonMini(r[0],r[1],r[2])).join("")}</div>
    <div class="notice" style="margin-top:14px">Comparison values come from the event summary/team data returned by ESPN. A dash means the free source did not provide that metric.</div>
  </section>`;
}

function detailRecent(g,d){
  return `<div class="grid two">${teamRecentCard(g.away,d.awayRecent||[],"Away")}${teamRecentCard(g.home,d.homeRecent||[],"Home")}</div>`;
}
function teamRecentCard(name,games,label){
  return `<section class="card"><div class="section-head"><h2>${esc(name)}</h2><span>${label} · last ${Math.min(games.length,10)}</span></div>${games.length?`<div class="recent-list">${games.slice(0,10).map(x=>`<div class="recent-row"><span class="result-dot ${x.result==="W"?"win":x.result==="L"?"loss":"push"}">${esc(x.result||"—")}</span><div><b>${esc(x.opponent||"Opponent")}</b><small>${esc(x.homeAway||"")} · ${esc(x.date||"")}</small></div><strong>${esc(x.score||"—")}</strong><span>${x.margin!=null?(Number(x.margin)>0?`+${x.margin}`:x.margin):"—"}</span></div>`).join("")}</div>`:`<div class="empty">Recent-game data is not available from the free team schedule endpoint.</div>`}</section>`;
}

function detailStandings(g,d){
  const a=d.standings?.away||{},h=d.standings?.home||{};
  return `<section class="card"><div class="section-head"><h2>Standings</h2><span>${esc(g.league||g.sport)}</span></div><div class="comparison-table"><div class="compare-head"><span>Field</span><b>${esc(g.away)}</b><b>${esc(g.home)}</b></div>
    ${comparisonMini("Division / Conference",a.group,h.group)}${comparisonMini("Rank",a.rank,h.rank)}${comparisonMini("Record",a.record,h.record)}${comparisonMini("Games Behind",a.gamesBehind,h.gamesBehind)}${comparisonMini("Streak",a.streak,h.streak)}</div>
    <div class="notice" style="margin-top:14px">Standings are displayed only when the league/team feed returns them.</div>
  </section>`;
}

function detailPlayers(g,d){
  return `<div class="grid two">${playerCard(g.away,d.awayPlayers||[],d.awayInjuries||[])}${playerCard(g.home,d.homePlayers||[],d.homeInjuries||[])}</div>`;
}
function playerCard(team,players,injuries){
  return `<section class="card"><div class="section-head"><h2>${esc(team)}</h2><span>Players</span></div>${players.length?`<div class="player-list">${players.slice(0,12).map(p=>`<div class="player-row"><div><b>${esc(p.name)}</b><small>${esc(p.position||"")} ${p.status?`· ${esc(p.status)}`:""}</small></div><div class="player-stats">${(p.stats||[]).map(s=>`<span>${esc(s.label)} <b>${esc(s.value)}</b></span>`).join("")}</div></div>`).join("")}`:`<div class="empty">No player stats were returned by the free event feed.</div>`}${injuries.length?`<div class="injury-block"><h3>Available status / injuries</h3>${injuries.map(i=>`<div class="kpi"><span>${esc(i.name)}</span><b>${esc(i.status||i.detail||"Status available")}</b></div>`).join("")}</div>`:""}</section>`;
}

function detailScoring(g,d){
  const a=d.away||{},h=d.home||{};
  return `<section class="card"><div class="section-head"><h2>Scoring Profile</h2><span>Available team metrics</span></div><div class="comparison-table"><div class="compare-head"><span>Metric</span><b>${esc(g.away)}</b><b>${esc(g.home)}</b></div>${comparisonMini("Season average",a.ppg,h.ppg)}${comparisonMini("Recent average",a.recentPpg,h.recentPpg)}${comparisonMini("Home average",a.homePpg,h.homePpg)}${comparisonMini("Away average",a.awayPpg,h.awayPpg)}${comparisonMini("Opponent average",a.oppPpg,h.oppPpg)}</div><div class="notice" style="margin-top:14px">The terminal does not manufacture season/recent splits. If ESPN does not provide a split, it remains unavailable.</div></section>`;
}

function detailWeather(g,d){
  const w=d.weather||g.weather;
  if(w) return `<section class="card"><div class="section-head"><h2>Weather</h2><span>event feed</span></div><div class="weather-grid">${infoRow("Condition",w.displayValue||w.condition||"—")}${infoRow("Temperature",w.temperature!=null?`${w.temperature}°`:"—")}${infoRow("Wind",w.windSpeed?`${w.windSpeed} mph`:"—")}${infoRow("Source","ESPN event data")}</div></section>`;
  return `<section class="card"><div class="empty">No weather data was returned for this event. Weather is only shown when a real source provides it.</div></section>`;
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
  return `<div class="page-title"><div><div class="eyebrow">MODEL LAB • V6</div><h1>Solo Modeler</h1><p>V6 logs transparent predictions, game snapshots, market inputs and outcomes so the model can be evaluated over time.</p></div></div>
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
  <section class="card"><h2>Shared database</h2>${infoRow("Supabase URL configured",cfg.SUPABASE_URL?"YES":"NO")}${infoRow("Database read/write",state.dbConnected?"CONNECTED":"NOT CONNECTED")}${infoRow("Realtime",state.live?"CONNECTED":"NOT CONNECTED")}${infoRow("Room",cfg.ROOM_CODE||"FRIENDS-1")}${infoRow("Database check",state.dbCheckedAt?state.dbCheckedAt.toLocaleTimeString():"NOT CHECKED")}
  <div class="notice">Keep your existing working <b>config.js</b>. V7 does not change it. Realtime and database permissions are checked separately.</div></section>
  <section class="card" style="margin-top:14px"><h2>Database permission diagnostic</h2>${state.dbError?`<div class="notice neg-text">${esc(state.dbError)}</div>`:`<div class="notice">Database access is currently allowed for this browser.</div>`}<button class="ghost" id="testDatabase">↻ Test database read</button></section>
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
  $("#refreshGames")?.addEventListener("click",loadGames);
  $("#refreshSnapshots")?.addEventListener("click",async()=>{await loadModelHistory();render();});
  $("#testDatabase")?.addEventListener("click",testDatabase);
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
  state.detailTab=tab;
  const g=state.selectedGame;
  if(!g) return;
  const d=state.gameData[g.id]||{};
  document.querySelectorAll(".detail-tab").forEach(x=>x.classList.toggle("active",x.dataset.detail===tab));
  $("#detailContent").innerHTML=detailTabContent(g,d,tab);
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
  if(!state.supabase || !state.dbConnected){
    alert(`Shared database is not writable.\n\n${state.dbError || "Supabase database access is unavailable."}\n\nNo local-only bet was created.`);
    return;
  }
  const b={id:uid(),room_code:cfg.ROOM_CODE||"FRIENDS-1",bettor:$("#betBettor").value,sport:$("#betSport").value,game:$("#betGame").value.trim(),bet_type:$("#betType").value,selection:$("#betSelection").value.trim(),odds:Number($("#betOdds").value),stake:Number($("#betStake").value),book:$("#betBook").value.trim(),result:$("#betResult").value,notes:$("#betNotes").value.trim(),created_at:new Date().toISOString()};
  const {data,error}=await state.supabase.from("bets").insert(b).select().single();
  if(error){
    state.dbConnected=false; state.dbError=databaseErrorText(error); state.dbCheckedAt=new Date(); updateStatus(); render();
    alert(`Bet was NOT saved.\n\n${state.dbError}`);
    return;
  }
  if(data && !state.bets.some(x=>x.id===data.id)) state.bets.push(data);
  saveLocal(); closeBet(); render();
}

function databaseErrorText(error){
  const msg=String(error?.message||error||"Unknown database error");
  const lower=msg.toLowerCase();
  if(lower.includes("permission denied") || lower.includes("row-level security") || lower.includes("rls")) return `Supabase reached the bets table, but the current anon key is blocked by Row Level Security on public.bets. Realtime can still be connected separately. The database policy must allow the current role to read/write this room.`;
  if(lower.includes("relation") && lower.includes("does not exist")) return `Supabase is reachable, but public.bets does not exist in this database.`;
  return msg;
}

async function testDatabase(){
  if(!state.supabase){ state.dbConnected=false; state.dbError="Supabase client is not configured."; render(); return false; }
  state.dbCheckedAt=new Date();
  const room=cfg.ROOM_CODE||"FRIENDS-1";
  const {data,error}=await state.supabase.from("bets").select("id,room_code,created_at").eq("room_code",room).limit(1);
  if(error){
    state.dbConnected=false; state.dbError=databaseErrorText(error);
    updateStatus(); render(); return false;
  }
  state.dbConnected=true; state.dbError="";
  if(Array.isArray(data)){ state.bets=state.bets.length?state.bets:data; }
  updateStatus(); render();
  return true;
}


async function initSupabase(){
  state.dbConnected=false; state.dbError="";
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){
    state.dbError="Supabase URL, public key, or Supabase JS client is missing.";
    updateStatus(); return;
  }
  try{
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const room=cfg.ROOM_CODE||"FRIENDS-1";
    const {data,error}=await state.supabase.from("bets").select("*").eq("room_code",room).order("created_at",{ascending:true});
    state.dbCheckedAt=new Date();
    if(error){
      state.dbConnected=false; state.dbError=databaseErrorText(error);
      console.warn("Supabase bets read failed",error);
    } else {
      state.dbConnected=true; state.dbError="";
      state.bets=data||[]; saveLocal();
    }
    await loadModelHistory();
    const channel=state.supabase.channel("bets-live-v7")
      .on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${room}`},payload=>{
        if(payload.eventType==="INSERT"&&!state.bets.some(x=>x.id===payload.new.id))state.bets.push(payload.new);
        if(payload.eventType==="UPDATE"){const i=state.bets.findIndex(x=>x.id===payload.new.id);if(i>=0)state.bets[i]=payload.new;}
        if(payload.eventType==="DELETE")state.bets=state.bets.filter(x=>x.id!==payload.old.id);
        saveLocal(); render();
      });
    channel.subscribe(s=>{state.live=s==="SUBSCRIBED";updateStatus();});
    render();
  }catch(e){
    console.warn("Supabase init failed",e); state.dbConnected=false; state.dbError=databaseErrorText(e); state.live=false; updateStatus(); render();
  }
}

function updateStatus(){
  const connected=state.dbConnected;
  $("#connectionDot")?.classList.toggle("online",connected);
  $("#connectionDot")?.classList.toggle("offline",!connected);
  if($("#connectionText"))$("#connectionText").textContent=connected?"Database live":(state.live?"Realtime only":"Not connected");
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
  if(!g)return;
  const d=state.gameData[g.id]||{loaded:false};
  if(d.loading)return;
  d.loading=true; d.updatedAt=new Date(); state.gameData[g.id]=d;
  try{
    const cfgSport=SPORTS.find(x=>x[0]===g.sport)||[g.sport,"football","nfl"];
    const base=`https://site.api.espn.com/apis/site/v2/sports/${cfgSport[1]}/${cfgSport[2]}`;
    const summary=await espn(`${base}/summary?event=${encodeURIComponent(g.sourceId)}`);
    d.raw=summary;
    const c=summary.header?.competitions?.[0]||summary.competitions?.[0];
    d.venue=c?.venue?.fullName||c?.venue?.displayName||g.venue;
    d.attendance=c?.attendance;
    d.broadcasts=(c?.broadcasts||[]).map(x=>x.names?.[0]||x.shortName).filter(Boolean);
    d.weather=c?.weather||summary.weather||g.weather;
    const comps=summary.boxscore?.teams||summary.competitions?.[0]?.competitors||[];
    d.competitors=comps;
    const findComp=id=>comps.find(x=>String(x.team?.id||x.id)===String(id));
    const awayC=findComp(g.awayId)||comps.find(x=>x.homeAway==="away");
    const homeC=findComp(g.homeId)||comps.find(x=>x.homeAway==="home");
    d.away=extractTeamMetrics(awayC,g.away,"away");
    d.home=extractTeamMetrics(homeC,g.home,"home");
    const leaders=summary.leaders||[];
    d.awayPlayers=extractPlayers(summary, g.awayId, awayC);
    d.homePlayers=extractPlayers(summary, g.homeId, homeC);
    d.awayInjuries=extractInjuries(summary,g.awayId);
    d.homeInjuries=extractInjuries(summary,g.homeId);
    const teamIds=[g.awayId,g.homeId].filter(Boolean);
    const schedules=await Promise.all(teamIds.map(id=>loadTeamSchedule(base,id)));
    d.awayRecent=recentFromSchedule(schedules[0],g.awayId).slice(0,10);
    d.homeRecent=recentFromSchedule(schedules[teamIds.indexOf(g.homeId)]||[],g.homeId).slice(0,10);
    const standings=await loadStandings(base);
    d.standings={away:standingForTeam(standings,g.awayId),home:standingForTeam(standings,g.homeId)};
    d.loaded=true; d.loading=false; d.updatedAt=new Date(); state.gameData[g.id]=d;
  }catch(e){d.error=e.message;d.loading=false;d.loaded=true;state.gameData[g.id]=d;console.warn("Game detail load failed",e);}
  if(state.page==="game-detail")render();
}

function extractTeamMetrics(comp,name,location){
  const out={record:null,ppg:null,oppPpg:null,fg:null,three:null,rpg:null,apg:null,recent5:null,location:location==="home"?"Home":"Away",recentPpg:null,homePpg:null,awayPpg:null};
  if(!comp)return out;
  const team=comp.team||{};
  const rec=team.record?.summary||team.record?.items?.[0]?.summary||comp.record?.summary||comp.records?.[0]?.summary;
  out.record=rec||null;
  const stats=[...(comp.statistics||[]),...(team.statistics||[])];
  const val=(names)=>{const x=stats.find(s=>names.includes(String(s.name||s.label||s.abbreviation).toLowerCase()));return x?.displayValue??x?.value??null;};
  out.ppg=val(["points per game","ppg"]); out.fg=val(["field goal percentage","fg%","fg pct"]); out.three=val(["three point field goal percentage","3p%","3pt%","3p pct"]); out.rpg=val(["rebounds per game","rpg"]); out.apg=val(["assists per game","apg"]);
  out.oppPpg=val(["opponent points per game","opp ppg"]);
  out.recent5=team.recentForm||comp.recentForm||null;
  out.recentPpg=val(["recent points per game","last 5 ppg"]);
  out.homePpg=val(["home points per game","home ppg"]); out.awayPpg=val(["away points per game","away ppg"]);
  return out;
}

function extractPlayers(summary,teamId,comp){
  const out=[];
  const add=(x)=>{if(!x)return;const team=x.team||x.athlete?.team;if(teamId&&team?.id&&String(team.id)!==String(teamId))return;const athlete=x.athlete||x.player||x;const name=athlete.displayName||athlete.fullName||x.name;if(!name)return;const stats=(x.statistics||x.stats||[]).slice(0,5).map(s=>({label:s.label||s.name||s.abbreviation||"Stat",value:s.displayValue??s.value}));out.push({name,position:athlete.position?.abbreviation||athlete.position?.displayName||x.position?.abbreviation||"",status:x.status?.type?.description||x.status,stats});};
  (summary.leaders||[]).forEach(group=>(group.leaders||[]).forEach(add));
  (comp?.leaders||[]).forEach(add); (summary.boxscore?.players||[]).forEach(group=>{if(!teamId||String(group.team?.id)===String(teamId))(group.statistics||[]).forEach(add)});
  const seen=new Set(); return out.filter(p=>!seen.has(p.name)&&seen.add(p.name));
}
function extractInjuries(summary,teamId){
  const out=[]; const arr=summary.injuries||summary.rosters?.injuries||[];
  for(const x of arr){const team=x.team||x.athlete?.team;if(teamId&&team?.id&&String(team.id)!==String(teamId))continue;const a=x.athlete||x.player||{};out.push({name:a.displayName||a.fullName||x.name||"Player",status:x.status||x.type?.description,detail:x.details||x.longComment});} return out;
}
async function loadTeamSchedule(base,teamId){
  try{const d=await espn(`${base}/teams/${encodeURIComponent(teamId)}/schedule?limit=10`);return d.events||d.items||[];}catch(e){return [];}
}
function recentFromSchedule(events,teamId){
  return (events||[]).filter(e=>{const st=e.status?.type?.state||e.competitions?.[0]?.status?.type?.state;return st==="post"||e.status?.type?.completed||e.competitions?.[0]?.status?.type?.completed}).map(e=>{
    const c=e.competitions?.[0], comps=c?.competitors||[];const me=comps.find(x=>String(x.team?.id)===String(teamId));const opp=comps.find(x=>String(x.team?.id)!==String(teamId));if(!me||!opp)return null;const ms=Number(me.score),os=Number(opp.score);return {result:ms>os?"W":ms<os?"L":"P",opponent:opp.team?.displayName||opp.team?.abbreviation||"Opponent",homeAway:me.homeAway==="home"?"Home":"Away",date:formatDate(e.date),score:`${me.score}-${opp.score}`,margin:ms-os};}).filter(Boolean);
}
async function loadStandings(base){try{const d=await espn(`${base}/standings`);return d.standings||d.children?.flatMap(x=>x.standings||[])||[];}catch(e){return [];}}
function standingForTeam(groups,teamId){
  for(const g of groups||[]){for(const e of (g.entries||g.team?.entries||[])){const id=e.team?.id||e.id;if(String(id)!==String(teamId))continue;const stats=e.stats||[];const get=(names)=>{const x=stats.find(s=>names.includes(String(s.name||s.abbreviation).toLowerCase()));return x?.displayValue??x?.value??null;};return {group:e.team?.conference?.displayName||e.team?.division?.displayName||g.name||null,rank:get(["rank","playoffseed"]),record:get(["overall","wins-losses","record"]),gamesBehind:get(["gamesbehind","games behind"]),streak:get(["streak"])}}}return {};
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