(() => {
"use strict";

const cfg = window.BT_CONFIG || {};
const KEY = "bt_local_bets_v5";
const state = {
  page:"dashboard", bets:[], games:[], selectedGame:null,
  supabase:null, live:false, loading:false, lastRefresh:null,
  detailCache:{}, detailLoading:false, detailTab:"overview"
};

const SPORTS = [
  ["NFL","football","nfl"],["NBA","basketball","nba"],["MLB","baseball","mlb"],
  ["NHL","hockey","nhl"],["CFB","football","college-football"],
  ["CBB","basketball","mens-college-basketball"],["EPL","soccer","eng.1"],
  ["Champions League","soccer","uefa.champions"]
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
  return `<div class="page-title"><div><h1>Command Center</h1><p>Live games, game intelligence, and your betting ledger.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
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
    <section class="card"><div class="section-head"><h2>Game Intelligence</h2><span>V5</span></div>
      <div class="notice">Open any game to see team stats, recent games, home/away context, scoring averages, standings, and player information when ESPN provides it.</div>
      <div class="kpi"><span>Games feed</span><b>ESPN scoreboard</b></div>
      <div class="kpi"><span>Refresh</span><b>${state.lastRefresh?state.lastRefresh.toLocaleTimeString():"—"}</b></div>
      <div class="kpi"><span>Game detail cache</span><b>${Object.keys(state.detailCache).length} games</b></div>
    </section>
  </div>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><div class="section-head"><h2>Recent Bets</h2><button class="ghost" data-go="bets">View all</button></div>${betTable(state.bets.slice().reverse().slice(0,8))}</section>
    <section class="card"><div class="section-head"><h2>System</h2></div>
      <div class="kpi"><span>Shared database</span><b>${state.live?"CONNECTED":"LOCAL ONLY"}</b></div>
      <div class="kpi"><span>Live games</span><b>${state.games.length}</b></div>
      <div class="kpi"><span>Data source</span><b>ESPN public feeds</b></div>
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
    <div class="game-meta">${esc(g.statusText||"Scheduled")} · open intelligence</div>
  </div>`;
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
  return `<div class="page-title"><div><h1>Games Center</h1><p>Open a matchup for a full DraftKings-style intelligence page.</p></div><button class="ghost" id="refreshGames">↻ Refresh</button></div>
  <div class="filters"><select id="gameSportFilter"><option value="">All sports</option>${SPORTS.map(x=>`<option>${x[0]}</option>`).join("")}</select><input id="gameSearch" placeholder="Search team"></div>
  <section class="card"><div id="gamesContainer">${gameGrid(filteredGames())}</div></section>`;
}

/* ---------- V5 GAME INTELLIGENCE ---------- */

function gameDetailPage(g){
  const d=state.detailCache[g.id]||{};
  const loading=state.detailLoading;
  const tabs=["overview","teams","recent","standings","players"];
  return `<div class="page-title">
    <div><button class="ghost" id="backGames">← Games</button><h1>${esc(g.away)} @ ${esc(g.home)}</h1><p>${esc(g.league)} · ${esc(g.statusText||"Scheduled")} · ${formatDate(g.date)}</p></div>
    <div class="detail-actions"><button class="ghost" id="refreshDetail">↻ Refresh game</button><button class="primary" id="betThisGame">Bet this game</button></div>
  </div>
  <section class="match-hero card">
    <div class="hero-team"><span class="hero-away">AWAY</span><strong>${esc(g.away)}</strong><b>${g.awayScore??"—"}</b><small>${teamRecord(d.awayTeam)}</small></div>
    <div class="hero-center"><span>${g.status==="in"?"LIVE":"VS"}</span><small>${esc(g.statusText||"Scheduled")}</small></div>
    <div class="hero-team right"><span>HOME</span><strong>${esc(g.home)}</strong><b>${g.homeScore??"—"}</b><small>${teamRecord(d.homeTeam)}</small></div>
  </section>
  <nav class="detail-tabs">${tabs.map(t=>`<button class="${state.detailTab===t?"active":""}" data-detail-tab="${t}">${detailTabLabel(t)}</button>`).join("")}</nav>
  ${loading?`<section class="card loading-box">Loading live game intelligence…</section>`:detailTabContent(g,d)}
  <div class="source-note">Data shown here comes from public ESPN feeds when available. Missing fields are left blank rather than fabricated.</div>`;
}

function detailTabLabel(t){return ({overview:"Overview",teams:"Team Stats",recent:"Recent Games",standings:"Standings",players:"Players"})[t]||t;}

function detailTabContent(g,d){
  if(state.detailTab==="teams")return teamStatsTab(g,d);
  if(state.detailTab==="recent")return recentGamesTab(g,d);
  if(state.detailTab==="standings")return standingsTab(g,d);
  if(state.detailTab==="players")return playersTab(g,d);
  return overviewTab(g,d);
}

function overviewTab(g,d){
  const a=d.awayTeam||{}, h=d.homeTeam||{};
  return `<div class="detail-grid">
    <section class="card"><div class="section-head"><h2>Game Snapshot</h2><span>${d.fetchedAt?`Updated ${new Date(d.fetchedAt).toLocaleTimeString()}`:"Live feed"}</span></div>
      <div class="stat-grid">
        ${statBox("Away record",teamRecord(a))}
        ${statBox("Home record",teamRecord(h))}
        ${statBox("Away scoring",avgLabel(a,"pointsFor"))}
        ${statBox("Home scoring",avgLabel(h,"pointsFor"))}
        ${statBox("Away allowed",avgLabel(a,"pointsAgainst"))}
        ${statBox("Home allowed",avgLabel(h,"pointsAgainst"))}
      </div>
    </section>
    <section class="card"><div class="section-head"><h2>Game Information</h2><span>ESPN</span></div>
      ${infoRow("Venue",g.venue||d.venue||"—")}
      ${infoRow("Status",g.statusText||"Scheduled")}
      ${infoRow("Start",formatDate(g.date))}
      ${infoRow("Competition",g.league||"—")}
      ${infoRow("Officials",d.officials?.length?d.officials.join(", "):"—")}
    </section>
  </div>
  <div class="detail-grid" style="margin-top:14px">
    ${scoringCard("Away scoring profile",a)}
    ${scoringCard("Home scoring profile",h)}
  </div>
  ${leadersStrip(d)}`;
}

function teamStatsTab(g,d){
  const a=d.awayTeam||{}, h=d.homeTeam||{};
  const keys=mergeStatKeys(a.stats,h.stats);
  return `<section class="card"><div class="section-head"><h2>Team Comparison</h2><span>Season / available team data</span></div>
    ${keys.length?`<div class="compare-table"><div class="compare-head"><span>${esc(g.away)}</span><b>STAT</b><span>${esc(g.home)}</span></div>${keys.map(k=>compareRow(k,a.stats?.[k],h.stats?.[k])).join("")}</div>`:`<div class="empty">Team statistics are not available from the current public feed for this matchup.</div>`}
  </section>
  <div class="detail-grid" style="margin-top:14px">
    ${scoringCard(`${esc(g.away)} scoring`,a)}
    ${scoringCard(`${esc(g.home)} scoring`,h)}
  </div>`;
}

function recentGamesTab(g,d){
  return `<div class="detail-grid">
    ${recentTeamCard(g.away,d.awayTeam?.recentGames||[])}
    ${recentTeamCard(g.home,d.homeTeam?.recentGames||[])}
  </div>`;
}

function recentTeamCard(name,games){
  if(!games.length)return `<section class="card"><div class="section-head"><h2>${esc(name)}</h2><span>Recent games</span></div><div class="empty">No recent-game history returned.</div></section>`;
  return `<section class="card"><div class="section-head"><h2>${esc(name)}</h2><span>Recent games</span></div>
    <div class="recent-list">${games.slice(0,10).map(x=>`<div class="recent-row"><span>${formatDate(x.date,{month:"short",day:"numeric"})}</span><b>${esc(x.opponent||"Opponent")}</b><span class="${x.result==="W"?"pos":x.result==="L"?"neg":"pending"}">${esc(x.result||"—")}</span><strong>${x.score||"—"}</strong><small>${x.homeAway==="home"?"HOME":"AWAY"}</small></div>`).join("")}</div>
  </section>`;
}

function standingsTab(g,d){
  if(!d.standings?.length)return `<section class="card"><div class="section-head"><h2>Standings</h2></div><div class="empty">Standings are not available from the current public feed for this league.</div></section>`;
  return `<section class="card"><div class="section-head"><h2>${esc(g.league)} Standings</h2><span>Current feed</span></div>
    <div class="table-wrap"><table class="table standings-table"><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Win %</th><th>GB</th><th>Streak</th></tr></thead><tbody>
    ${d.standings.slice(0,30).map((x,i)=>`<tr class="${x.team?.id===d.awayTeam?.id||x.team?.id===d.homeTeam?.id?"highlight":""}"><td>${i+1}</td><td><b>${esc(x.team?.displayName||x.team?.abbreviation||"Team")}</b></td><td>${esc(x.record||"—")}</td><td>${esc(x.winPct||"—")}</td><td>${esc(x.gamesBehind||"—")}</td><td>${esc(x.streak||"—")}</td></tr>`).join("")}
    </tbody></table></div>
  </section>`;
}

function playersTab(g,d){
  const players=[...(d.awayTeam?.players||[]).map(x=>({...x,side:g.away})),...(d.homeTeam?.players||[]).map(x=>({...x,side:g.home}))];
  const leaders=d.leaders||[];
  return `<div class="detail-grid">
    <section class="card"><div class="section-head"><h2>Game Leaders</h2><span>When available</span></div>${leaders.length?leaders.map(x=>`<div class="leader-row"><span>${esc(x.category||"Leader")}</span><b>${esc(x.name||"—")}</b><strong>${esc(x.value||"—")}</strong></div>`).join(""):`<div class="empty">No player leaders are available yet.</div>`}</section>
    <section class="card"><div class="section-head"><h2>Player Information</h2><span>${players.length} shown</span></div>${players.length?`<div class="player-list">${players.slice(0,30).map(p=>`<div class="player-row"><div><b>${esc(p.name||"Player")}</b><small>${esc(p.side)} · ${esc(p.position||"")}</small></div><span>${esc(p.status||"Active")}</span></div>`).join("")}</div>`:`<div class="empty">Roster/player data is not exposed by the current feed for this game.</div>`}</section>
  </div>`;
}

function leadersStrip(d){
  const l=d.leaders||[];
  if(!l.length)return "";
  return `<section class="card" style="margin-top:14px"><div class="section-head"><h2>Player Leaders</h2><span>Game data</span></div><div class="leader-strip">${l.slice(0,6).map(x=>`<div><small>${esc(x.category||"Leader")}</small><b>${esc(x.name||"—")}</b><span>${esc(x.value||"—")}</span></div>`).join("")}</div></section>`;
}

function scoringCard(title,t){
  return `<section class="card"><div class="section-head"><h2>${title}</h2><span>Available averages</span></div>
    ${infoRow("Scoring average",avgLabel(t,"pointsFor"))}
    ${infoRow("Points allowed",avgLabel(t,"pointsAgainst"))}
    ${infoRow("Home/Away split",homeAwayLabel(t))}
    ${infoRow("Record",teamRecord(t))}
  </section>`;
}

function statBox(label,value){return `<div class="stat-box"><small>${esc(label)}</small><b>${esc(value||"—")}</b></div>`}
function infoRow(k,v){return `<div class="info-row"><span>${esc(k)}</span><b>${esc(v||"—")}</b></div>`}
function compareRow(k,a,b){return `<div class="compare-row"><span>${esc(displayStat(a))}</span><b>${esc(prettyStatName(k))}</b><span>${esc(displayStat(b))}</span></div>`}
function displayStat(v){return v==null||v===""?"—":typeof v==="number"?Number(v).toLocaleString(undefined,{maximumFractionDigits:2}):String(v)}
function prettyStatName(k){return String(k).replace(/([A-Z])/g," $1").replace(/[_-]/g," ").replace(/\b\w/g,m=>m.toUpperCase()).trim()}
function statKeys(stats){return stats?Object.keys(stats):[]}
function mergeStatKeys(a,b){return [...new Set([...statKeys(a),...statKeys(b)])].slice(0,24)}
function avgLabel(t,key){return t?.stats?.[key] ?? t?.averages?.[key] ?? "—"}
function homeAwayLabel(t){return t?.homeAway?.label||t?.homeAway?.record||"—"}
function teamRecord(t){return t?.record||t?.overallRecord||"—"}
function formatDate(v,opts){if(!v)return "—";try{return new Date(v).toLocaleString([],opts||{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}catch{return String(v)}}

/* ---------- ESPN DATA ADAPTERS ---------- */

function sportConfig(name){return SPORTS.find(x=>x[0]===name)||SPORTS[0];}
async function fetchJSON(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function normalizeTeamStats(obj){
  const out={id:obj?.id,displayName:obj?.displayName||obj?.name||"",abbreviation:obj?.abbreviation||""};
  out.record=extractRecord(obj);
  out.stats=extractStatistics(obj);
  out.averages={};
  const all=out.stats;
  for(const [k,v] of Object.entries(all)){
    if(/points|runs|goals|score/i.test(k))out.averages[k]=v;
  }
  out.homeAway=extractHomeAway(obj);
  return out;
}

function extractRecord(obj){
  const items=obj?.record?.items||obj?.records||[];
  const overall=items.find(x=>/overall|total/i.test(x?.type||x?.description||""))||items[0];
  return overall?.summary||overall?.displayValue||obj?.record?.summary||obj?.record?.displayValue||"—";
}
function extractStatistics(obj){
  const out={};
  const groups=[obj?.statistics,obj?.team?.statistics,obj?.stats,obj?.leaders];
  for(const g of groups){
    if(Array.isArray(g))for(const s of g){
      const k=s?.name||s?.abbreviation||s?.label;
      if(k && s?.displayValue!=null)out[k]=s.displayValue;
    }
    else if(g&&typeof g==="object")for(const [k,v] of Object.entries(g)){
      if(v!=null && typeof v!=="object")out[k]=v;
    }
  }
  return out;
}
function extractHomeAway(obj){
  const h=obj?.homeAway||obj?.splits||{};
  return {label:h?.displayValue||h?.summary||h?.record||"—",record:h?.summary||h?.record||""};
}

function normalizeRecent(events,teamId){
  return (events||[]).map(ev=>{
    const c=ev?.competitions?.[0], comps=c?.competitors||[];
    const me=comps.find(x=>String(x.team?.id)===String(teamId));
    const opp=comps.find(x=>String(x.team?.id)!==String(teamId));
    const state=ev?.status?.type?.state||"";
    let result="";
    if(me?.winner===true)result="W";
    else if(me?.winner===false && state==="post")result="L";
    else if(state==="post")result="T";
    return {
      date:ev.date,result,opponent:opp?.team?.displayName||opp?.team?.abbreviation,
      score:me?.score!=null&&opp?.score!=null?`${me.score}-${opp.score}`:"",
      homeAway:me?.homeAway
    };
  }).filter(x=>x.date).sort((a,b)=>new Date(b.date)-new Date(a.date));
}

function extractSummaryTeam(summary,teamId,side){
  const box=summary?.boxscore?.teams||[];
  const hit=box.find(x=>String(x.team?.id)===String(teamId))||box.find(x=>x.homeAway===side);
  const team=hit?.team||summary?.header?.competitions?.[0]?.competitors?.find(x=>String(x.team?.id)===String(teamId))?.team||{};
  const base=normalizeTeamStats({...team,...hit});
  base.id=String(teamId);
  base.players=[];
  const roster=summary?.roster?.filter(x=>String(x.team?.id)===String(teamId))||[];
  base.players=roster.map(p=>({name:p?.athlete?.displayName||p?.displayName,position:p?.position?.abbreviation||p?.position?.name,status:p?.status?.type||p?.status}));
  return base;
}

function extractLeaders(summary){
  const out=[];
  for(const group of summary?.leaders||[]){
    const cat=group?.name||group?.shortDisplayName;
    const leaders=group?.leaders||[];
    const x=leaders[0];
    if(x)out.push({category:cat,name:x?.athlete?.displayName||x?.athlete?.shortName,value:x?.displayValue||x?.value});
  }
  return out;
}

async function loadGameDetail(g,force=false){
  if(!force && state.detailCache[g.id])return state.detailCache[g.id];
  state.detailLoading=true; renderGameDetail();
  const [sport,league]=[g.sport,g.leagueCode];
  const d={fetchedAt:new Date().toISOString(),awayTeam:{id:g.awayId,displayName:g.away},homeTeam:{id:g.homeId,displayName:g.home},standings:[],leaders:[]};
  try{
    if(g.espnId){
      const sum=await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${sportConfig(sport)[1]}/${league}/summary?event=${encodeURIComponent(g.espnId)}`);
      d.awayTeam=extractSummaryTeam(sum,g.awayId,"away");
      d.homeTeam=extractSummaryTeam(sum,g.homeId,"home");
      d.leaders=extractLeaders(sum);
      d.venue=sum?.header?.competitions?.[0]?.venue?.fullName||"";
      d.officials=(sum?.gameInfo?.officials||[]).map(x=>x?.fullName||x?.displayName).filter(Boolean);
      if(sum?.boxscore?.teams?.length){
        for(const x of sum.boxscore.teams){
          const t=x.team?.id===g.awayId?d.awayTeam:x.team?.id===g.homeId?d.homeTeam:null;
          if(t)t.stats=extractStatistics(x);
        }
      }
    }
  }catch(e){console.warn("Game summary unavailable",e)}

  await Promise.all([
    loadTeamExtras(g,d,"away"),
    loadTeamExtras(g,d,"home"),
    loadStandings(g,d)
  ]);

  state.detailCache[g.id]=d;
  state.detailLoading=false;
  renderGameDetail();
}

async function loadTeamExtras(g,d,side){
  const id=side==="away"?g.awayId:g.homeId;
  if(!id)return;
  const key=side+"Team";
  const team=d[key]||{};
  const [sport,league]=[sportConfig(g.sport)[1],g.leagueCode];
  try{
    const data=await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${id}/schedule?limit=12`);
    team.recentGames=normalizeRecent(data?.events||[],id).slice(0,10);
    if(data?.team)Object.assign(team,{displayName:data.team.displayName||team.displayName,abbreviation:data.team.abbreviation||team.abbreviation});
  }catch(e){console.warn("Recent games unavailable",side,e)}
  try{
    const data=await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${id}`);
    const norm=normalizeTeamStats(data?.team||data);
    Object.assign(team,{
      record:norm.record||team.record,
      stats:{...(team.stats||{}),...(norm.stats||{})},
      homeAway:norm.homeAway||team.homeAway
    });
  }catch(e){console.warn("Team profile unavailable",side,e)}
  d[key]=team;
}

async function loadStandings(g,d){
  try{
    const sport=sportConfig(g.sport)[1], league=g.leagueCode;
    const data=await fetchJSON(`https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`);
    const entries=data?.standings?.entries||[];
    d.standings=entries.map(x=>{
      const team=x?.team||{};
      const stats=x?.stats||[];
      const get=(...names)=>{const s=stats.find(y=>names.includes(String(y?.name||"").toLowerCase()));return s?.displayValue??s?.value??""};
      return {
        team,record:get("wins","losses")||x?.records?.[0]?.summary||"",
        winPct:get("winpercent","win pct","winpercentage"),gamesBehind:get("gamesbehind","games behind"),
        streak:get("streak","streakdisplayvalue")
      };
    });
  }catch(e){console.warn("Standings unavailable",e)}
}

/* ---------- Existing pages / betting ---------- */

function analyticsPage(){
  const settled=state.bets.filter(b=>b.result!=="Pending");
  const bySport=[...new Set(state.bets.map(b=>b.sport))].filter(Boolean);
  return `<div class="page-title"><div><h1>Analytics</h1><p>Measure the betting process without hiding the math.</p></div></div>
  <div class="grid two"><section class="card"><div class="section-head"><h2>Performance by sport</h2></div>
  ${bySport.length?bySport.map(s=>analysisRow(s,state.bets.filter(b=>b.sport===s))).join(""):`<div class="empty">Settle bets to build the history.</div>`}</section>
  <section class="card"><div class="section-head"><h2>Exposure</h2></div>${riskSnapshot()}</section></div>
  <section class="card" style="margin-top:14px"><div class="section-head"><h2>Model learning status</h2><span>${settled.length} settled bets available</span></div>
  <div class="notice">V5 focuses on real game intelligence first. Prediction logging/backtesting can use these same team and player features in the next model stage.</div></section>`;
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
  return `<div class="page-title"><div><h1>Model Lab</h1><p>Game intelligence features are now available for the next model layer.</p></div></div>
  <div class="model-grid">
    <section class="card">
      <div class="section-head"><h2>Market math</h2><span>works now</span></div>
      <label>American odds<input id="modelOdds" type="number" value="-110"></label>
      <label style="margin-top:12px">Estimated win probability (%)<input id="modelEdgeProb" type="number" min="0" max="100" step="0.1" value="50"></label>
      <div class="grid two" style="margin-top:16px"><div class="hero"><small>Implied probability</small><div class="model-number" id="modelProb">${pct(oddsToProb(-110))}</div></div><div class="hero"><small>Estimated edge</small><div class="model-number" id="modelEdge">${pct(50-oddsToProb(-110))}</div></div></div>
    </section>
    <section class="card">
      <div class="section-head"><h2>V5 feature warehouse</h2><span>available on game pages</span></div>
      ${["Team record","Scoring averages","Points/runs/goals allowed","Recent games","Home/away context","Standings","Player leaders","Player information"].map(x=>`<div class="kpi"><span>${x}</span><b class="pos">LIVE WHEN AVAILABLE</b></div>`).join("")}
    </section>
  </div>`;
}
function settingsPage(){
  return `<div class="page-title"><div><h1>Settings</h1><p>Free deployment foundation.</p></div></div>
  <section class="card"><h2>Supabase</h2><div class="kpi"><span>URL configured</span><b>${cfg.SUPABASE_URL?"YES":"NO"}</b></div><div class="kpi"><span>Realtime</span><b>${state.live?"CONNECTED":"NOT CONNECTED"}</b></div><div class="kpi"><span>Room</span><b>${esc(cfg.ROOM_CODE||"FRIENDS-1")}</b></div>
  <div class="notice" style="margin-top:12px">Use the public anon key only. Never put a Supabase service-role key or sportsbook secret in this browser app.</div></section>
  <section class="card" style="margin-top:14px"><h2>V5 free data plan</h2><div class="kpi"><span>Scores / schedules</span><b>ESPN public feeds</b></div><div class="kpi"><span>Game intelligence</span><b>ESPN summary/team/standings</b></div><div class="kpi"><span>Weather</span><b>Next adapter</b></div><div class="kpi"><span>Odds</span><b>Separate adapter</b></div><div class="kpi"><span>Database</span><b>Supabase free tier</b></div><div class="kpi"><span>Hosting</span><b>GitHub Pages</b></div></section>`;
}

function filteredGames(){
  const sport=$("#gameSportFilter")?.value||"", q=($("#gameSearch")?.value||"").toLowerCase();
  return state.games.filter(g=>(!sport||g.sport===sport)&&(!q||`${g.away} ${g.home}`.toLowerCase().includes(q)));
}

/* ---------- Events ---------- */

function bindPage(){
  $("#addBetBtn")?.addEventListener("click",openBet);
  $("#refreshGames")?.addEventListener("click",loadGames);
  $("#backGames")?.addEventListener("click",()=>{state.selectedGame=null;state.page="games";render()});
  $("#refreshDetail")?.addEventListener("click",()=>state.selectedGame&&loadGameDetail(state.selectedGame,true));
  $("#betThisGame")?.addEventListener("click",()=>{
    const g=state.selectedGame; openBet();
    if(g)$("#betGame").value=`${g.away} @ ${g.home}`;
    if(g)$("#betSport").value=g.sport;
  });
  document.querySelectorAll("[data-detail-tab]").forEach(x=>x.addEventListener("click",()=>{state.detailTab=x.dataset.detailTab;renderGameDetail()}));
  ["filterBettor","filterSport","filterResult","filterSearch"].forEach(id=>$("#"+id)?.addEventListener("input",filterBets));
  ["gameSportFilter","gameSearch"].forEach(id=>$("#"+id)?.addEventListener("input",()=>$("#gamesContainer").innerHTML=gameGrid(filteredGames())));
  document.querySelectorAll("[data-go]").forEach(x=>x.addEventListener("click",()=>{state.page=x.dataset.go;render()}));
  document.querySelectorAll(".game-card").forEach(x=>x.addEventListener("click",()=>{
    const g=state.games.find(g=>g.id===x.dataset.gameId); if(!g)return;
    state.selectedGame=g; state.page="game-detail"; state.detailTab="overview"; renderGameDetail(); loadGameDetail(g);
  }));
  $("#modelOdds")?.addEventListener("input",updateModelCalc);
  $("#modelEdgeProb")?.addEventListener("input",updateModelCalc);
}
function renderGameDetail(){
  if(!state.selectedGame){state.page="games";render();return}
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
      const d=await fetchJSON(u);
      for(const ev of (d.events||[]).slice(0,50)){
        const c=ev.competitions?.[0], comps=c?.competitors||[];
        const away=comps.find(x=>x.homeAway==="away"), home=comps.find(x=>x.homeAway==="home");
        out.push({
          id:`${name}-${ev.id}`,espnId:ev.id,leagueCode:league,
          league:d.leagues?.[0]?.name||name,sport:name,
          away:away?.team?.abbreviation||away?.team?.displayName||"Away",
          home:home?.team?.abbreviation||home?.team?.displayName||"Home",
          awayId:away?.team?.id,homeId:home?.team?.id,
          awayScore:away?.score??null,homeScore:home?.score??null,
          status:ev.status?.type?.state==="in"?"in":ev.status?.type?.state||"pre",
          statusText:ev.status?.type?.shortDetail||ev.status?.type?.description||"",
          date:ev.date,venue:c?.venue?.fullName||""
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
