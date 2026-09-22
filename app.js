(() => {
"use strict";
const cfg = window.BT_CONFIG || {};
const KEY = "bt_local_bets_v1";
const state = {page:"dashboard", bets:[], games:[], weather:{}, supabase:null, live:false};

const SPORTS = [
  ["NFL", "football", "nfl"],
  ["NBA", "basketball", "nba"],
  ["MLB", "baseball", "mlb"],
  ["NHL", "hockey", "nhl"],
  ["CFB", "football", "college-football"],
  ["CBB", "basketball", "mens-college-basketball"],
  ["EPL", "soccer", "eng.1"],
  ["Champions League", "soccer", "uefa.champions"],
  ["UFC", "mma", "ufc"],
  ["PGA Golf", "golf", "pga"],
  ["LPGA Golf", "golf", "lpga"],
  ["ATP Tennis", "tennis", "atp"],
  ["WTA Tennis", "tennis", "wta"],
  ["F1", "racing", "f1"],
  ["NASCAR", "racing", "nascar-premier"],
  ["IndyCar", "racing", "irl"],
  ["Rugby", "rugby", "rugby-union"],
  ["Boxing", "boxing", "boxing"],
  ["Lacrosse", "lacrosse", "pll"]
];

const $ = s => document.querySelector(s);
const money = n => (Number(n)||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const pct = n => `${(Number(n)||0).toFixed(1)}%`;
const esc = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function oddsToProb(o){o=Number(o); if(!o)return 0; return o>0?100/(o+100):(-o)/(-o+100)}
function potentialProfit(stake,odds){return payout(stake,odds)}
function potentialReturn(stake,odds){return (Number(stake)||0)+potentialProfit(stake,odds)}
function formatOdds(o){o=Number(o);return o>0?`+${o}`:String(o)}
function payout(stake,odds){stake=Number(stake)||0;odds=Number(odds)||0;return odds>0?stake*(odds/100):stake*(100/Math.abs(odds))}
function pnl(b){if(b.result==="Win")return payout(b.stake,b.odds);if(b.result==="Loss")return -Number(b.stake);return b.result==="Push"?0:null}
function saveLocal(){localStorage.setItem(KEY,JSON.stringify(state.bets))}
function loadLocal(){try{state.bets=JSON.parse(localStorage.getItem(KEY)||"[]")}catch{state.bets=[]}}
function uid(){return crypto?.randomUUID?.()||Date.now()+"-"+Math.random()}

function render(){
 document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.page===state.page));
 const views={dashboard:dashboard,live:livePage,bets:betsPage,games:gamesPage,analytics:analyticsPage,model:modelPage,settings:settingsPage};
 $("#main").innerHTML=(views[state.page]||dashboard)();
 bindPage();
}
function dashboard(){
 const settled=state.bets.filter(b=>b.result!=="Pending"), wins=settled.filter(b=>b.result==="Win").length;
 const profit=settled.reduce((a,b)=>a+(pnl(b)||0),0), stake=settled.reduce((a,b)=>a+Number(b.stake||0),0);
 const roi=stake?profit/stake*100:0, pending=state.bets.filter(b=>b.result==="Pending").length;
 return `<div class="page-title"><div><h1>Command Center</h1><p>Shared betting ledger, live data and model workspace.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
 <div class="grid stats">
 ${metric("Net P/L",money(profit),profit>=0?"pos":"neg")}${metric("ROI",pct(roi),roi>=0?"pos":"neg")}${metric("Record",`${wins}-${settled.length-wins}`,"")}${metric("Win Rate",pct(settled.length?wins/settled.length*100:0),"")}${metric("Wagered",money(stake),"")}${metric("Pending",pending,"pending")}
 </div>
 <div class="grid two" style="margin-top:14px">
  <section class="card"><div class="section-head"><h2>Live / Upcoming</h2><span>Auto-refreshes from public sports feeds</span></div>${gamesList(6)}</section>
  <section class="card"><div class="section-head"><h2>Group leaderboard</h2><span>settled bets</span></div>${leaderboard()}</section>
 </div>
 <div class="grid two" style="margin-top:14px">
  <section class="card"><div class="section-head"><h2>Recent bets</h2><button class="ghost" data-go="bets">View all</button></div>${betTable(state.bets.slice().reverse().slice(0,8))}</section>
  <section class="card"><div class="section-head"><h2>Terminal status</h2></div>
   <div class="kpi"><span>Shared database</span><b>${state.live?"CONNECTED":"LOCAL ONLY"}</b></div>
   <div class="kpi"><span>Sports feed</span><b>${state.games.length?"LIVE":"Waiting"}</b></div>
   <div class="kpi"><span>Sports supported</span><b>${SPORTS.length}</b></div>
   <div class="kpi"><span>Last refresh</span><b>${new Date().toLocaleTimeString()}</b></div><div class="kpi"><span>Tracked sports</span><b>${SPORTS.length}</b></div>
   <div class="notice" style="margin-top:12px">Model outputs are estimates, not guarantees. Use the terminal to measure your process rather than assuming a prediction is certain.</div>
  </section>
 </div>`;
}
function metric(label,value,cl){return `<div class="card metric"><div class="label">${label}</div><div class="value ${cl||""}">${value}</div></div>`}
function gamesList(n){
 if(!state.games.length)return `<div class="empty">No live feed loaded yet. Configure the data sources in Settings, or use the included demo mode.</div>`;
 return state.games.slice(0,n).map(g=>{
 const when=g.date?new Date(g.date).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
 return `<div class="game"><div><div><span class="pill">${esc(g.sport||g.league||"SPORT")}</span>${g.status==="in"?" <span class='live-badge'>LIVE</span>":""}</div><div class="teams">${esc(g.away)} @ ${esc(g.home)}</div><small>${esc(g.statusText||when||"")}</small></div><div class="score">${g.awayScore??"-"} — ${g.homeScore??"-"}</div></div>`;
}).join("");
}
function leaderboard(){
 const people=["Mason","Friend 1","Friend 2"];
 return people.map(p=>{const bs=state.bets.filter(b=>b.bettor===p&&b.result!=="Pending"), pr=bs.reduce((a,b)=>a+(pnl(b)||0),0), st=bs.reduce((a,b)=>a+Number(b.stake||0),0),w=bs.filter(b=>b.result==="Win").length;return `<div class="kpi"><span>${p}</span><b class="${pr>=0?"pos":"neg"}">${money(pr)} · ${w}-${bs.length-w}</b></div>`}).join("");
}
function betTable(bs){
 if(!bs.length)return `<div class="empty">No bets yet. Hit <b>+ Add Bet</b> to start the shared ledger.</div>`;
 return `<div class="table-wrap"><table class="table"><thead><tr><th>Bettor</th><th>Sport</th><th>Game</th><th>Selection</th><th>Odds</th><th>Stake</th><th>To Win</th><th>Result</th><th>P/L</th></tr></thead><tbody>${bs.map(b=>`<tr><td>${esc(b.bettor)}</td><td>${esc(b.sport)}</td><td>${esc(b.game)}</td><td>${esc(b.selection)}</td><td>${formatOdds(b.odds)}</td><td>${money(b.stake)}</td><td>${money(potentialProfit(b.stake,b.odds))}</td><td class="${b.result==="Win"?"pos":b.result==="Loss"?"neg":"pending"}">${esc(b.result)}</td><td class="${(pnl(b)||0)>=0?"pos":"neg"}">${pnl(b)===null?"—":money(pnl(b))}</td></tr>`).join("")}</tbody></table></div>`;
}
function betsPage(){
 return `<div class="page-title"><div><h1>Bet Ledger</h1><p>Everything you and your friends enter is tracked here.</p></div><button class="primary" id="addBetBtn">+ Add Bet</button></div>
 <div class="filters"><select id="filterBettor"><option value="">All bettors</option><option>Mason</option><option>Friend 1</option><option>Friend 2</option></select><select id="filterSport"><option value="">All sports</option>${SPORTS.map(x=>x[0]).concat(["Soccer","Other"]).map(x=>`<option>${x}</option>`).join("")}</select><select id="filterResult"><option value="">All results</option><option>Pending</option><option>Win</option><option>Loss</option><option>Push</option></select><input id="filterSearch" placeholder="Search game or selection"></div>
 <section class="card"><div id="betTable">${betTable(state.bets.slice().reverse())}</div></section>`;
}
function gamesPage(){return `<div class="page-title"><div><h1>Games</h1><p>Live and scheduled games from the connected sports feed.</p></div><button class="ghost" id="refreshGames">↻ Refresh games</button></div><section class="card">${gamesList(100)}</section>`}
function livePage(){const live=state.games.filter(g=>g.status==="in");return `<div class="page-title"><div><h1>Live Terminal</h1><p>Live scores and market workspace.</p></div><span class="pill">${live.length} LIVE</span></div><div class="grid three">${(live.length?live:state.games.slice(0,3)).map(g=>`<div class="hero"><small>${esc(g.league||"SPORT")} · ${esc(g.statusText||"")}</small><div class="big">${esc(g.awayScore??"-")} — ${esc(g.homeScore??"-")}</div><div>${esc(g.away)} @ ${esc(g.home)}</div><hr style="border-color:var(--border)"><div class="kpi"><span>Moneyline</span><b>${esc(g.awayOdds||"—")} / ${esc(g.homeOdds||"—")}</b></div><div class="kpi"><span>Spread</span><b>${esc(g.spread||"—")}</b></div><div class="kpi"><span>Total</span><b>${esc(g.total||"—")}</b></div></div>`).join("")||`<div class="empty">No live games currently available.</div>`}</div>`}
function analyticsPage(){
 const sports=[...new Set(state.bets.map(b=>b.sport))].filter(Boolean);
 return `<div class="page-title"><div><h1>Analytics</h1><p>Find where your process is actually working.</p></div></div>
 <div class="grid two"><section class="card"><div class="section-head"><h2>By sport</h2></div>${sports.length?sports.map(s=>analysisRow(s,state.bets.filter(b=>b.sport===s))).join(""):`<div class="empty">Add settled bets to unlock analytics.</div>`}</section>
 <section class="card"><div class="section-head"><h2>Risk snapshot</h2></div>${riskSnapshot()}</section></div>`;
}
function analysisRow(name,bs){const set=bs.filter(b=>b.result!=="Pending"),w=set.filter(b=>b.result==="Win").length,pr=set.reduce((a,b)=>a+(pnl(b)||0),0),st=set.reduce((a,b)=>a+Number(b.stake||0),0);return `<div class="kpi"><span>${esc(name)} · ${w}-${set.length-w}</span><b class="${pr>=0?"pos":"neg"}">${money(pr)} · ${pct(st?pr/st*100:0)}</b></div>`}
function riskSnapshot(){const pending=state.bets.filter(b=>b.result==="Pending"),ex=pending.reduce((a,b)=>a+Number(b.stake||0),0),set=state.bets.filter(b=>b.result!=="Pending"),pr=set.reduce((a,b)=>a+(pnl(b)||0),0);return `<div class="kpi"><span>Open exposure</span><b>${money(ex)}</b></div><div class="kpi"><span>Settled P/L</span><b class="${pr>=0?"pos":"neg"}">${money(pr)}</b></div><div class="kpi"><span>Pending bets</span><b>${pending.length}</b></div><div class="kpi"><span>Largest open stake</span><b>${money(Math.max(0,...pending.map(b=>Number(b.stake)||0)))}</b></div>`}
function modelPage(){return `<div class="page-title"><div><h1>Model Lab</h1><p>Transparent probability estimates. No black-box “lock” claims.</p></div></div><div class="grid two"><section class="card"><div class="section-head"><h2>Market probability calculator</h2></div><label>American odds<input id="modelOdds" type="number" value="-110"></label>
 <label style="margin-top:12px">Your estimated win probability (%)<input id="modelEdgeProb" type="number" min="0" max="100" step="0.1" value="50"></label>
 <div style="margin-top:16px" class="grid two">
  <div class="hero"><small>Implied probability</small><div class="big" id="modelProb">${pct(oddsToProb(-110))}</div></div>
  <div class="hero"><small>Estimated edge</small><div class="big" id="modelEdge">${pct(50-oddsToProb(-110))}</div></div>
 </div></section><section class="card"><h2 style="margin-top:0">How the model will grow</h2><div class="progress-row"><span>Team strength</span><div class="bar"><i style="width:85%"></i></div><b>Core</b></div><div class="progress-row"><span>Recent form</span><div class="bar"><i style="width:70%"></i></div><b>Core</b></div><div class="progress-row"><span>Market movement</span><div class="bar"><i style="width:65%"></i></div><b>Core</b></div><div class="progress-row"><span>Weather</span><div class="bar"><i style="width:45%"></i></div><b>Sport-specific</b></div><div class="notice">The model should be backtested against historical results before you trust any edge number.</div></section></div>`}
function settingsPage(){return `<div class="page-title"><div><h1>Settings</h1><p>Connect the free shared backend and live feeds.</p></div></div>
<section class="card"><h2>Shared database</h2><p style="color:var(--muted)">For true real-time three-person syncing, create a free Supabase project and paste its public URL + anon key into <b>config.js</b>. Never use a service-role key in the browser.</p>
<div class="notice">The included SQL file creates the shared bets table. Because this is a free static app, the site itself contains no private server secrets.</div>
<div style="margin-top:14px"><div class="kpi"><span>Supabase URL configured</span><b>${cfg.SUPABASE_URL?"YES":"NO"}</b></div><div class="kpi"><span>Realtime connection</span><b>${state.live?"CONNECTED":"NOT CONNECTED"}</b></div><div class="kpi"><span>Room</span><b>${esc(cfg.ROOM_CODE||"FRIENDS-1")}</b></div></div></section>
<section class="card" style="margin-top:14px"><h2>Data sources</h2><div class="kpi"><span>Scores / schedules</span><b>ESPN public endpoints</b></div><div class="kpi"><span>Weather</span><b>Open-Meteo</b></div><div class="kpi"><span>Odds</span><b>Optional API adapter</b></div><div class="notice" style="margin-top:12px">Free public feeds can change or rate-limit. The terminal is designed so one source can be swapped without rebuilding the whole app.</div></section>`}
function bindPage(){
 $("#addBetBtn")?.addEventListener("click",openBet);
 $("#refreshGames")?.addEventListener("click",loadGames);
 function updateModelCalc(){
 const odds=Number($("#modelOdds")?.value)||0;
 const implied=oddsToProb(odds);
 const userProb=Number($("#modelEdgeProb")?.value)||0;
 if($("#modelProb"))$("#modelProb").textContent=pct(implied);
 if($("#modelEdge"))$("#modelEdge").textContent=pct(userProb-implied);
}
$("#modelOdds")?.addEventListener("input",updateModelCalc);
$("#modelEdgeProb")?.addEventListener("input",updateModelCalc);
 document.querySelectorAll("[data-go]").forEach(x=>x.addEventListener("click",()=>{state.page=x.dataset.go;render()}));
 ["filterBettor","filterSport","filterResult","filterSearch"].forEach(id=>$("#"+id)?.addEventListener("input",filterBets));
}
function filterBets(){
 const a=$("#filterBettor").value,s=$("#filterSport").value,r=$("#filterResult").value,q=$("#filterSearch").value.toLowerCase();
 const bs=state.bets.filter(b=>(!a||b.bettor===a)&&(!s||b.sport===s)&&(!r||b.result===r)&&(!q||`${b.game} ${b.selection}`.toLowerCase().includes(q)));
 $("#betTable").innerHTML=betTable(bs.slice().reverse());
}
function openBet(){$("#modal").classList.remove("hidden")}
function closeBet(){$("#modal").classList.add("hidden");$("#betForm").reset()}
async function addBet(e){
 e.preventDefault();
 const b={id:uid(),room_code:cfg.ROOM_CODE||"FRIENDS-1",bettor:$("#betBettor").value,sport:$("#betSport").value,game:$("#betGame").value.trim(),bet_type:$("#betType").value,selection:$("#betSelection").value.trim(),odds:Number($("#betOdds").value),stake:Number($("#betStake").value),book:$("#betBook").value.trim(),result:$("#betResult").value,notes:$("#betNotes").value.trim(),created_at:new Date().toISOString()};
 state.bets.push(b);saveLocal();closeBet();render();
 if(state.supabase){const {error}=await state.supabase.from("bets").insert(b);if(error)console.warn(error)}
}
async function initSupabase(){
 if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase)return;
 try{
  state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  const {data,error}=await state.supabase.from("bets").select("*").eq("room_code",cfg.ROOM_CODE||"FRIENDS-1").order("created_at",{ascending:true});
  if(!error&&data){state.bets=data;saveLocal()}
  state.supabase.channel("bets-live").on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${cfg.ROOM_CODE||"FRIENDS-1"}`},payload=>{
    if(payload.eventType==="INSERT"&&!state.bets.some(x=>x.id===payload.new.id))state.bets.push(payload.new);
    if(payload.eventType==="UPDATE"){const i=state.bets.findIndex(x=>x.id===payload.new.id);if(i>=0)state.bets[i]=payload.new}
    if(payload.eventType==="DELETE")state.bets=state.bets.filter(x=>x.id!==payload.old.id);
    saveLocal();render();
  }).subscribe(s=>{state.live=s==="SUBSCRIBED";updateStatus();render()});
 }catch(e){console.warn(e)}
}
function updateStatus(){$("#connectionDot")?.classList.toggle("online",state.live);$("#connectionDot")?.classList.toggle("offline",!state.live);$("#connectionText").textContent=state.live?"Shared live":"Local mode"}
async function loadGames(){
 try{
  const out=[];

  await Promise.all(SPORTS.map(async ([name,sport,league])=>{
   try{
    const u=`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
    const response=await fetch(u);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const d=await response.json();

    for(const ev of (d.events||[]).slice(0,30)){
     const c=ev.competitions?.[0], comps=c?.competitors||[];
     const away=comps.find(x=>x.homeAway==="away");
     const home=comps.find(x=>x.homeAway==="home");

     out.push({
      id:`${name}-${ev.id}`,
      league:d.leagues?.[0]?.name||name,
      sport:name,
      away:away?.team?.abbreviation||away?.team?.displayName||away?.athlete?.displayName||comps[1]?.athlete?.displayName||"Away",
      home:home?.team?.abbreviation||home?.team?.displayName||home?.athlete?.displayName||comps[0]?.athlete?.displayName||"Home",
      awayScore:away?.score??comps[1]?.score??null,
      homeScore:home?.score??comps[0]?.score??null,
      status:ev.status?.type?.state==="in"?"in":ev.status?.type?.state,
      statusText:ev.status?.type?.shortDetail||ev.status?.type?.description||"",
      date:ev.date,
      awayOdds:null,
      homeOdds:null,
      spread:null,
      total:null
     });
    }
   }catch(e){
    console.warn(`ESPN feed unavailable: ${name}`,e);
   }
  }));

  state.games=out.sort((a,b)=>{
   const al=a.status==="in"?0:1;
   const bl=b.status==="in"?0:1;
   if(al!==bl)return al-bl;
   return new Date(a.date||0)-new Date(b.date||0);
  });

  render();
 }catch(e){
  console.warn(e);
 }
}
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{state.page=t.dataset.page;render()}));
$("#refreshBtn").addEventListener("click",loadGames);$("#addBetTop").addEventListener("click",openBet);$("#closeModal").addEventListener("click",closeBet);$("#cancelBet").addEventListener("click",closeBet);$("#betForm").addEventListener("submit",addBet);
loadLocal();render();initSupabase();loadGames();
setInterval(loadGames,Number(cfg.ESPN_REFRESH_MS)||60000);
})();
