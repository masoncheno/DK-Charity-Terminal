(() => {
  "use strict";

  const cfg = window.BT_CONFIG || {};
  const ROOM = cfg.ROOM_CODE || "FRIENDS-1";
  const REFRESH = Number(cfg.ESPN_REFRESH_MS) || 60000;
  const LOCAL_KEY = "bt_local_bets_v6";
  const PRED_KEY = "bt_local_predictions_v6";

  const SPORTS = [
    ["NFL","football","nfl"],
    ["NBA","basketball","nba"],
    ["MLB","baseball","mlb"],
    ["NHL","hockey","nhl"],
    ["CFB","football","college-football"],
    ["CBB","basketball","mens-college-basketball"],
    ["EPL","soccer","eng.1"],
    ["Champions League","soccer","uefa.champions"]
  ];

  const state = {
    page: "dashboard",
    tab: "overview",
    games: [],
    selectedGame: null,
    detail: null,
    bets: [],
    predictions: [],
    standings: [],
    form: {},
    loading: false,
    live: false,
    supabase: null,
    lastRefresh: null,
    errors: [],
    filters: { sport:"", status:"all", search:"" }
  };

  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const fmt = n => Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "—";
  const pct = n => Number.isFinite(Number(n)) ? `${(Number(n)*100).toFixed(1)}%` : "—";
  const now = () => new Date().toISOString();

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "show";
    setTimeout(() => el.className = "", 2200);
  }

  function normalizeSupabaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  }

  async function espn(url) {
    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    return r.json();
  }

  function sportMeta(sport, league) {
    return SPORTS.find(x => x[1] === sport && x[2] === league) || SPORTS.find(x => x[0] === sport) || ["","",""];
  }

  function parseEvent(e, sport, league) {
    const comp = e.competitions?.[0];
    const teams = comp?.competitors || [];
    const home = teams.find(t => t.homeAway === "home") || teams[0] || {};
    const away = teams.find(t => t.homeAway === "away") || teams[1] || {};
    const status = e.status?.type || {};
    return {
      id: e.id,
      sourceId: e.id,
      sport, league,
      name: e.name || `${away.team?.displayName || "Away"} at ${home.team?.displayName || "Home"}`,
      shortName: e.shortName || e.name,
      date: e.date,
      status: status.description || status.shortDetail || "Scheduled",
      state: status.state || "pre",
      completed: !!status.completed,
      home: {
        id: home.team?.id, name: home.team?.displayName || "Home",
        abbr: home.team?.abbreviation || "HOME", score: Number(home.score || 0),
        record: home.records?.[0]?.summary || ""
      },
      away: {
        id: away.team?.id, name: away.team?.displayName || "Away",
        abbr: away.team?.abbreviation || "AWAY", score: Number(away.score || 0),
        record: away.records?.[0]?.summary || ""
      },
      odds: parseOdds(comp),
      venue: comp?.venue?.fullName || comp?.venue?.address?.city || "",
      broadcast: comp?.broadcasts?.[0]?.names?.join(", ") || ""
    };
  }

  function parseOdds(comp) {
    const o = comp?.odds?.[0];
    if (!o) return null;
    return {
      provider: o.provider?.name || "ESPN",
      details: o.details || "",
      overUnder: o.overUnder,
      homeMoneyLine: o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.odds,
      awayMoneyLine: o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.odds,
      homeSpread: o.spread,
      homeSpreadOdds: o.spread?.home?.odds,
      awaySpreadOdds: o.spread?.away?.odds,
      homeTeam: o.spread?.home?.name,
      awayTeam: o.spread?.away?.name
    };
  }

  async function loadGames() {
    state.loading = true;
    render();
    const out = [];
    const errs = [];
    for (const [label,sport,league] of SPORTS) {
      try {
        const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
        (data.events || []).forEach(e => out.push(parseEvent(e, sport, league)));
      } catch (e) {
        errs.push(`${label}: ${e.message}`);
      }
    }
    state.games = out.sort((a,b) => new Date(a.date)-new Date(b.date));
    state.errors = errs;
    state.lastRefresh = now();
    state.loading = false;
    render();
  }

  async function loadDetail(game) {
    state.selectedGame = game;
    state.tab = "overview";
    state.detail = null;
    render();
    try {
      state.detail = await espn(`https://site.api.espn.com/apis/site/v2/sports/${game.sport}/${game.league}/summary?event=${game.id}`);
      await captureSnapshot(game);
      await buildTeamForm(game);
      render();
    } catch (e) {
      state.errors.unshift(`Game detail: ${e.message}`);
      toast("Game detail feed unavailable");
      render();
    }
  }

  async function buildTeamForm(game) {
    const key = game.id;
    if (state.form[key]) return;
    try {
      const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${game.sport}/${game.league}/scoreboard?limit=50`);
      const events = (data.events || []).map(e => parseEvent(e, game.sport, game.league));
      const relevant = events.filter(e =>
        e.home.id === game.home.id || e.away.id === game.home.id ||
        e.home.id === game.away.id || e.away.id === game.away.id
      ).filter(e => e.id !== game.id).slice(-10);
      const rec = team => {
        const gs = relevant.filter(e => e.home.id === team.id || e.away.id === team.id);
        let w=0,l=0;
        gs.forEach(e => {
          const isHome = e.home.id === team.id;
          const a = isHome ? e.home.score : e.away.score;
          const b = isHome ? e.away.score : e.home.score;
          if (e.completed) a>b ? w++ : l++;
        });
        return {w,l,total:gs.length};
      };
      state.form[key] = {home:rec(game.home), away:rec(game.away)};
    } catch {}
  }

  async function captureSnapshot(game) {
    if (!state.supabase) return;
    try {
      await state.supabase.from("game_snapshots").insert({
        room_code: ROOM, event_id: game.id, sport: game.sport, league: game.league,
        home_team: game.home.name, away_team: game.away.name,
        game_status: game.status, home_score: game.home.score, away_score: game.away.score,
        payload: game
      });
    } catch {}
  }

  async function initSupabase() {
    const url = normalizeSupabaseUrl(cfg.SUPABASE_URL);
    const key = cfg.SUPABASE_ANON_KEY;
    if (!url || !key || !window.supabase?.createClient) {
      setLive(false, "Local mode");
      loadLocal();
      return;
    }
    try {
      state.supabase = window.supabase.createClient(url, key);
      const { error } = await state.supabase.from("bets").select("id").eq("room_code", ROOM).limit(1);
      if (error) throw error;
      state.live = true;
      setLive(true, "Shared live");
      await loadBets();
      state.supabase.channel("bt-v6-bets")
        .on("postgres_changes",{event:"*",schema:"public",table:"bets",filter:`room_code=eq.${ROOM}`}, async () => {
          await loadBets(); render();
        }).subscribe();
    } catch (e) {
      state.live = false;
      setLive(false, "Local mode");
      state.errors.unshift(`Supabase: ${e.message || e}`);
      loadLocal();
    }
  }

  function setLive(live,label) {
    const el = $("#livePill");
    if (!el) return;
    el.textContent = label;
    el.className = `live-pill ${live ? "live" : "local"}`;
  }

  function loadLocal() {
    try { state.bets = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { state.bets=[]; }
    try { state.predictions = JSON.parse(localStorage.getItem(PRED_KEY) || "[]"); } catch { state.predictions=[]; }
  }

  async function loadBets() {
    if (!state.supabase) return;
    const {data,error} = await state.supabase.from("bets").select("*").eq("room_code",ROOM).order("created_at",{ascending:false});
    if (!error) state.bets = data || [];
  }

  async function saveBet(bet) {
    if (state.supabase) {
      const {error} = await state.supabase.from("bets").insert(bet);
      if (error) throw error;
      await loadBets();
    } else {
      state.bets.unshift({...bet,id:crypto.randomUUID(),created_at:now()});
      localStorage.setItem(LOCAL_KEY,JSON.stringify(state.bets));
    }
  }

  function implied(odds) {
    const o = Number(odds);
    if (!Number.isFinite(o)) return null;
    return o > 0 ? 100/(o+100) : (-o)/(-o+100);
  }

  function modelFor(game) {
    const f = state.form[game.id] || {};
    const hr = f.home?.total ? f.home.w/f.home.total : null;
    const ar = f.away?.total ? f.away.w/f.away.total : null;
    let home = 0.5;
    if (hr != null && ar != null) home = 0.5 + (hr-ar)*0.22;
    if (game.state === "in") {
      const diff = game.home.score - game.away.score;
      home += Math.max(-0.12, Math.min(0.12, diff*0.015));
    }
    home = Math.max(.05,Math.min(.95,home));
    const away = 1-home;
    const marketHome = implied(game.odds?.homeMoneyLine);
    const edge = marketHome == null ? null : home-marketHome;
    return {home,away,marketHome,edge,side:edge == null ? "No market" : edge > 0 ? game.home.name : game.away.name};
  }

  async function logPrediction(game) {
    const m = modelFor(game);
    const row = {
      room_code:ROOM,event_id:game.id,sport:game.sport,league:game.league,
      home_team:game.home.name,away_team:game.away.name,model_name:"V6 baseline",
      home_probability:m.home,away_probability:m.away,
      market_home_probability:m.marketHome,edge:m.edge,predicted_side:m.side,payload:m
    };
    if (state.supabase) {
      const {error} = await state.supabase.from("prediction_results").insert(row);
      if (error) throw error;
    } else {
      state.predictions.unshift({...row,id:crypto.randomUUID(),created_at:now()});
      localStorage.setItem(PRED_KEY,JSON.stringify(state.predictions));
    }
    toast("Prediction logged");
  }

  function filteredGames() {
    return state.games.filter(g => {
      const q = state.filters.search.toLowerCase();
      const sportOk = !state.filters.sport || g.sport === state.filters.sport;
      const statusOk = state.filters.status === "all" ||
        (state.filters.status === "live" && g.state === "in") ||
        (state.filters.status === "upcoming" && g.state === "pre") ||
        (state.filters.status === "final" && g.completed);
      const searchOk = !q || `${g.name} ${g.home.name} ${g.away.name} ${g.league}`.toLowerCase().includes(q);
      return sportOk && statusOk && searchOk;
    });
  }

  function dashboard() {
    const live = state.games.filter(g=>g.state==="in").length;
    const upcoming = state.games.filter(g=>g.state==="pre").length;
    const settled = state.bets.filter(b=>String(b.status||"").toLowerCase()==="settled").length;
    const units = state.bets.reduce((s,b)=>s+Number(b.stake||0),0);
    return `<div class="page">
      <div class="page-head"><div><div class="eyebrow">Command Center</div><div class="title">Live sports intelligence</div><div class="sub">Real ESPN game feeds + shared bet ledger + transparent V6 model.</div></div>
      <div class="actions"><button class="primary" id="refreshBtn">Refresh All</button><button class="ghost" id="addBetTop">+ Log Bet</button></div></div>
      <div class="grid cards">
        <div class="card"><div class="muted">Live Games</div><div class="metric">${live}</div></div>
        <div class="card"><div class="muted">Upcoming</div><div class="metric">${upcoming}</div></div>
        <div class="card"><div class="muted">Tracked Bets</div><div class="metric">${state.bets.length}</div></div>
        <div class="card"><div class="muted">Staked Units</div><div class="metric">${fmt(units)}</div></div>
      </div>
      <div class="grid two" style="margin-top:12px">
        <div class="card"><div class="section-title">Today's Games</div>${gameRows(filteredGames().slice(0,12))}</div>
        <div class="card"><div class="section-title">V6 Model Status</div>
          <div class="list">
            <div class="list-item"><b>Live data</b><br><span class="muted">ESPN scoreboard / summaries</span></div>
            <div class="list-item"><b>Learning data</b><br><span class="muted">${state.live ? "Supabase snapshots + predictions" : "Local browser storage"}</span></div>
            <div class="list-item"><b>Market rule</b><br><span class="muted">No market = no invented odds</span></div>
            <div class="list-item"><b>Settled records</b><br><span class="muted">${settled}</span></div>
          </div>
        </div>
      </div>
      <div class="footer-note">Last refresh: ${state.lastRefresh ? new Date(state.lastRefresh).toLocaleTimeString() : "—"}</div>
    </div>`;
  }

  function gameRows(games) {
    if (!games.length) return `<div class="empty">No games match the current feed/filter.</div>`;
    return games.map(g => `<div class="game-row" data-game="${esc(g.id)}">
      <div><div class="pill">${esc(g.league)}</div><div class="status">${esc(g.status)}</div></div>
      <div><div class="team">${esc(g.away.name)}</div><div class="team">${esc(g.home.name)}</div></div>
      <div class="score">${g.state==="pre" ? "—" : `${g.away.score}<br>${g.home.score}`}</div>
      <div class="hide-mobile"><div>${g.odds ? "Market" : "No market"}</div><div class="muted mini">${esc(g.venue)}</div></div>
    </div>`).join("");
  }

  function gamesPage() {
    const gs = filteredGames();
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">Game Center</div><div class="title">Games</div><div class="sub">Scores, schedules, event detail and available markets.</div></div><button class="primary" id="refreshGames">Refresh Games</button></div>
      <div class="filters"><select id="sportFilter"><option value="">All sports</option>${SPORTS.map(s=>`<option value="${s[1]}" ${state.filters.sport===s[1]?"selected":""}>${s[0]}</option>`).join("")}</select>
      <select id="statusFilter"><option value="all">All</option><option value="live" ${state.filters.status==="live"?"selected":""}>Live</option><option value="upcoming" ${state.filters.status==="upcoming"?"selected":""}>Upcoming</option><option value="final" ${state.filters.status==="final"?"selected":""}>Final</option></select>
      <input id="searchGames" value="${esc(state.filters.search)}" placeholder="Search team, league, matchup..."></div>
      <div>${gameRows(gs)}</div></div>`;
  }

  function detailPage() {
    const g=state.selectedGame;
    if (!g) return gamesPage();
    const m=modelFor(g);
    const tabs=[["overview","Overview"],["market","Market"],["stats","Stats"],["form","Team Form"],["bets","Bets"]];
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">${esc(g.league)} · ${esc(g.status)}</div><div class="title">${esc(g.away.name)} at ${esc(g.home.name)}</div><div class="sub">${esc(g.venue)} ${g.broadcast ? "· "+esc(g.broadcast):""}</div></div><div class="actions"><button class="ghost" id="backGames">← Games</button><button class="primary" id="logGameBet">+ Log Bet</button></div></div>
      <div class="card"><div class="grid two"><div><div class="muted">${esc(g.away.name)}</div><div class="terminal-score">${g.state==="pre"?"—":g.away.score}</div><div class="muted">${esc(g.away.record)}</div></div><div><div class="muted">${esc(g.home.name)}</div><div class="terminal-score">${g.state==="pre"?"—":g.home.score}</div><div class="muted">${esc(g.home.record)}</div></div></div></div>
      <div class="tabs">${tabs.map(t=>`<button class="tab ${state.tab===t[0]?"active":""}" data-tab="${t[0]}">${t[1]}</button>`).join("")}</div>
      ${detailTab(g,m)}
    </div>`;
  }

  function detailTab(g,m) {
    if (state.tab==="market") return `<div class="card"><div class="section-title">Available Market</div>${g.odds ? `<div class="odds">
      <div class="odd"><span class="muted">Provider</span><b>${esc(g.odds.provider)}</b></div>
      <div class="odd"><span class="muted">Home ML</span><b>${esc(g.odds.homeMoneyLine ?? "—")}</b></div>
      <div class="odd"><span class="muted">Away ML</span><b>${esc(g.odds.awayMoneyLine ?? "—")}</b></div>
      <div class="odd"><span class="muted">Spread</span><b>${esc(g.odds.details || "—")}</b></div>
      <div class="odd"><span class="muted">Total</span><b>${esc(g.odds.overUnder ?? "—")}</b></div>
    </div>` : `<div class="empty">ESPN did not provide a market for this event. V6 will not invent sportsbook odds.</div>`}</div>`;
    if (state.tab==="form") {
      const f=state.form[g.id]||{};
      return `<div class="grid two"><div class="card"><div class="section-title">${esc(g.away.name)}</div><div class="model-big">${f.away ? `${f.away.w}-${f.away.l}` : "Loading…"}</div><div class="muted">Recent games available in feed</div></div><div class="card"><div class="section-title">${esc(g.home.name)}</div><div class="model-big">${f.home ? `${f.home.w}-${f.home.l}` : "Loading…"}</div><div class="muted">Recent games available in feed</div></div></div>`;
    }
    if (state.tab==="stats") {
      const box=state.detail?.boxscore?.teams || [];
      return `<div class="card"><div class="section-title">Game Stats</div>${box.length ? `<div class="table-wrap"><table class="table"><tr><th>Team</th><th>Stats</th></tr>${box.map(t=>`<tr><td>${esc(t.team?.displayName||"Team")}</td><td>${(t.statistics||[]).map(s=>`${esc(s.name)}: ${esc(s.displayValue)}`).join(" · ")}</td></tr>`).join("")}</table></div>` : `<div class="empty">Detailed box-score statistics are not available in this ESPN response yet.</div>`}</div>`;
    }
    if (state.tab==="bets") {
      const bs=state.bets.filter(b=>String(b.event_id||b.game_id||"")===String(g.id) || String(b.event||"").includes(g.home.name));
      return `<div class="card"><div class="section-title">Bets linked to this game</div>${bs.length ? `<div class="table-wrap"><table class="table"><tr><th>Bettor</th><th>Market</th><th>Selection</th><th>Odds</th><th>Stake</th></tr>${bs.map(b=>`<tr><td>${esc(b.bettor||b.user_name)}</td><td>${esc(b.market)}</td><td>${esc(b.selection)}</td><td>${esc(b.odds)}</td><td>${esc(b.stake)}</td></tr>`).join("")}</table></div>` : `<div class="empty">No linked bets yet.</div>`}</div>`;
    }
    return `<div class="grid two"><div class="card"><div class="section-title">Model Snapshot</div><div class="model-big">${pct(m.home)}</div><div class="muted">Home win probability</div><hr><div>Away: <b>${pct(m.away)}</b></div><div>Market home: <b>${pct(m.marketHome)}</b></div><div>Edge: <b class="${m.edge!=null&&m.edge>0?".good":""}">${pct(m.edge)}</b></div><div>Lean: <b>${esc(m.side)}</b></div><div class="actions" style="margin-top:12px"><button class="primary" id="logPrediction">Log Prediction</button></div></div>
    <div class="card"><div class="section-title">Event Information</div><div class="list"><div class="list-item"><b>Status</b><br>${esc(g.status)}</div><div class="list-item"><b>Venue</b><br>${esc(g.venue||"—")}</div><div class="list-item"><b>Broadcast</b><br>${esc(g.broadcast||"—")}</div></div></div></div>`;
  }

  function betsPage() {
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">Shared Ledger</div><div class="title">Bets</div><div class="sub">One live ledger for the group.</div></div><button class="primary" id="addBetBtn">+ Log Bet</button></div>
      <div class="card"><div class="table-wrap"><table class="table"><tr><th>Bettor</th><th>Sport</th><th>Event</th><th>Market</th><th>Selection</th><th>Odds</th><th>Stake</th><th>Status</th></tr>
      ${state.bets.length ? state.bets.map(b=>`<tr><td>${esc(b.bettor||b.user_name)}</td><td>${esc(b.sport)}</td><td>${esc(b.event)}</td><td>${esc(b.market)}</td><td>${esc(b.selection)}</td><td>${esc(b.odds)}</td><td>${esc(b.stake)}</td><td>${esc(b.status||"open")}</td></tr>`).join("") : `<tr><td colspan="8" class="muted">No bets yet.</td></tr>`}</table></div></div></div>`;
  }

  function analyticsPage() {
    const by={};
    state.bets.forEach(b=>{const k=b.bettor||b.user_name||"Unknown";by[k]=(by[k]||0)+Number(b.stake||0)});
    const preds=state.predictions.length;
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">Analytics</div><div class="title">Group Performance</div><div class="sub">Tracking data collected by the terminal.</div></div></div>
      <div class="grid cards"><div class="card"><div class="muted">Bets</div><div class="metric">${state.bets.length}</div></div><div class="card"><div class="muted">Predictions Logged</div><div class="metric">${preds}</div></div><div class="card"><div class="muted">Total Staked</div><div class="metric">${fmt(state.bets.reduce((s,b)=>s+Number(b.stake||0),0))}</div></div><div class="card"><div class="muted">Data Mode</div><div class="metric">${state.live?"LIVE":"LOCAL"}</div></div></div>
      <div class="card" style="margin-top:12px"><div class="section-title">Stake by Bettor</div>${Object.keys(by).length ? Object.entries(by).map(([k,v])=>`<div class="list-item" style="margin-bottom:7px"><b>${esc(k)}</b><span style="float:right">${fmt(v)}</span><div class="progress"><i style="width:${Math.min(100,v/Math.max(...Object.values(by))*100)}%"></i></div></div>`).join("") : `<div class="empty">No bet data yet.</div>`}</div>
    </div>`;
  }

  function modelPage() {
    const gs=state.games.filter(g=>!g.completed).slice(0,20);
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">Model Lab</div><div class="title">V6 Solo Modeler</div><div class="sub">Transparent baseline now; historical learning dataset builds automatically.</div></div></div>
      <div class="grid two"><div class="card"><div class="section-title">How V6 calculates</div><div class="list"><div class="list-item">1. Start from 50/50.</div><div class="list-item">2. Adjust for available recent win rate.</div><div class="list-item">3. Adjust live games for score state.</div><div class="list-item">4. Compare to market implied probability when an ESPN market exists.</div><div class="list-item">5. Log the prediction so later versions can backtest/calibrate it.</div></div></div>
      <div class="card"><div class="section-title">Model dataset</div><div class="model-big">${state.predictions.length}</div><div class="muted">predictions stored locally in this browser or in Supabase when shared mode is active.</div></div></div>
      <div class="card" style="margin-top:12px"><div class="section-title">Current Model Board</div>${gs.length ? `<div class="table-wrap"><table class="table"><tr><th>Game</th><th>Home</th><th>Away</th><th>Market</th><th>Edge</th><th>Action</th></tr>${gs.map(g=>{const m=modelFor(g);return `<tr><td>${esc(g.shortName)}</td><td>${pct(m.home)}</td><td>${pct(m.away)}</td><td>${pct(m.marketHome)}</td><td>${pct(m.edge)}</td><td><button class="ghost model-open" data-game="${esc(g.id)}">Open</button></td></tr>`}).join("")}</table></div>`:`<div class="empty">No upcoming/live games in the current feed.</div>`}</div>
    </div>`;
  }

  function settingsPage() {
    return `<div class="page"><div class="page-head"><div><div class="eyebrow">System</div><div class="title">Settings & Data Sources</div><div class="sub">V6 connection and feed diagnostics.</div></div><button class="primary" id="reconnect">Reconnect Supabase</button></div>
      <div class="grid two"><div class="card"><div class="section-title">Supabase</div><div class="list"><div class="list-item"><b>Mode</b><br>${state.live ? '<span class="good">Shared live</span>' : '<span class="warn">Local mode</span>'}</div><div class="list-item"><b>Room</b><br>${esc(ROOM)}</div><div class="list-item"><b>URL</b><br>${esc(normalizeSupabaseUrl(cfg.SUPABASE_URL)||"Not configured")}</div></div></div>
      <div class="card"><div class="section-title">ESPN</div><div class="list"><div class="list-item"><b>Feeds</b><br>Scoreboards + event summaries</div><div class="list-item"><b>Refresh</b><br>${REFRESH/1000}s</div><div class="list-item"><b>Games loaded</b><br>${state.games.length}</div></div></div></div>
      ${state.errors.length ? `<div class="card" style="margin-top:12px"><div class="section-title">Recent diagnostics</div>${state.errors.slice(0,8).map(e=>`<div class="list-item">${esc(e)}</div>`).join("")}</div>`:""}
      <div class="footer-note">V6 preserves the real-data-first rule: unavailable data is shown as unavailable instead of being fabricated.</div>
    </div>`;
  }

  function render() {
    const main=$("#main");
    if (!main) return;
    if (state.selectedGame) main.innerHTML=detailPage();
    else if(state.page==="dashboard") main.innerHTML=dashboard();
    else if(state.page==="games") main.innerHTML=gamesPage();
    else if(state.page==="bets") main.innerHTML=betsPage();
    else if(state.page==="analytics") main.innerHTML=analyticsPage();
    else if(state.page==="model") main.innerHTML=modelPage();
    else main.innerHTML=settingsPage();

    document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===state.page));
    bind();
  }

  function openBet(game=null) {
    $("#betModal").classList.remove("hidden");
    if(game){
      $("#betGameId").value=game.id;
      $("#betSport").value=game.sport.toUpperCase();
      $("#betEvent").value=game.name;
    }
  }

  function bind() {
    document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>{state.selectedGame=null;state.page=b.dataset.page;render()});
    document.querySelectorAll("[data-game]").forEach(el=>el.onclick=()=>{const g=state.games.find(x=>x.id===el.dataset.game);if(g)loadDetail(g)});
    document.querySelectorAll("[data-tab]").forEach(el=>el.onclick=()=>{state.tab=el.dataset.tab;render()});

    $("#refreshBtn")?.addEventListener("click",loadGames);
    $("#refreshGames")?.addEventListener("click",loadGames);
    $("#addBetTop")?.addEventListener("click",()=>openBet());
    $("#addBetBtn")?.addEventListener("click",()=>openBet());
    $("#logGameBet")?.addEventListener("click",()=>openBet(state.selectedGame));
    $("#backGames")?.addEventListener("click",()=>{state.selectedGame=null;state.page="games";render()});
    $("#logPrediction")?.addEventListener("click",()=>logPrediction(state.selectedGame));
    $("#reconnect")?.addEventListener("click",async()=>{await initSupabase();render()});
    $("#sportFilter")?.addEventListener("change",e=>{state.filters.sport=e.target.value;render()});
    $("#statusFilter")?.addEventListener("change",e=>{state.filters.status=e.target.value;render()});
    $("#searchGames")?.addEventListener("input",e=>{state.filters.search=e.target.value;render()});
    document.querySelectorAll(".model-open").forEach(el=>el.onclick=()=>{const g=state.games.find(x=>x.id===el.dataset.game);if(g)loadDetail(g)});
  }

  $("#closeModal").onclick=()=>$("#betModal").classList.add("hidden");
  $("#cancelBet").onclick=()=>$("#betModal").classList.add("hidden");
  $("#betForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const bet={
      room_code:ROOM,
      event_id:$("#betGameId").value || null,
      bettor:$("#betBettor").value.trim(),
      sport:$("#betSport").value.trim(),
      event:$("#betEvent").value.trim(),
      market:$("#betMarket").value.trim(),
      selection:$("#betSelection").value.trim(),
      odds:Number($("#betOdds").value),
      stake:Number($("#betStake").value),
      notes:$("#betNotes").value.trim(),
      status:"open"
    };
    try{
      await saveBet(bet);
      $("#betModal").classList.add("hidden");
      e.target.reset();
      toast(state.live ? "Bet saved to shared ledger" : "Bet saved locally");
      render();
    }catch(err){toast(`Save failed: ${err.message||err}`)}
  });

  loadLocal();
  render();
  initSupabase();
  loadGames();
  setInterval(loadGames,REFRESH);
})();
