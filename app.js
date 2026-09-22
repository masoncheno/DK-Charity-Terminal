const cfg = window.BT_CONFIG || {};

const state = {
  page: "dashboard",
  bets: [],
  games: [],
  weather: {},
  supabase: null,
  live: false,
  weatherLastLoaded: 0
};

const weatherCache = new Map();
const geocodeCache = new Map();

function $(id) {
  return document.getElementById(id);
}

function money(value) {
  const n = Number(value || 0);
  return `$${n.toFixed(2)}`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function oddsToProb(odds) {
  const n = Number(odds);

  if (!Number.isFinite(n)) return 0;

  if (n > 0) return 100 / (n + 100);

  if (n < 0) return (-n) / ((-n) + 100);

  return 0.5;
}

function payout(odds, stake) {
  const o = Number(odds || 0);
  const s = Number(stake || 0);

  if (!s || !o) return 0;

  if (o > 0) return s + (s * o / 100);

  return s + (s * 100 / Math.abs(o));
}

function pnl(bet) {
  const stake = Number(bet.stake || 0);
  const odds = Number(bet.odds || 0);
  const result = String(bet.result || "").toLowerCase();

  if (result === "win") {
    return payout(odds, stake) - stake;
  }

  if (result === "loss") {
    return -stake;
  }

  if (result === "push") {
    return 0;
  }

  return 0;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function saveLocal() {
  localStorage.setItem("bt_bets", JSON.stringify(state.bets));
}

function loadLocal() {
  try {
    state.bets = JSON.parse(localStorage.getItem("bt_bets") || "[]");
  } catch {
    state.bets = [];
  }
}

function formatDate(date) {
  if (!date) return "TBD";

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) return "TBD";

  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function gameStatus(game) {
  return String(game.status || "").toLowerCase();
}

function isLiveGame(game) {
  const status = gameStatus(game);

  return (
    status.includes("in progress") ||
    status.includes("live") ||
    status.includes("halftime") ||
    status.includes("quarter") ||
    status.includes("period") ||
    status.includes("inning")
  );
}

function isCompletedGame(game) {
  const status = gameStatus(game);

  return (
    status.includes("final") ||
    status.includes("complete") ||
    status.includes("ended")
  );
}

/* =========================================================
   WEATHER
========================================================= */

function weatherLabel(code) {
  const labels = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm",
    99: "Thunderstorm"
  };

  return labels[Number(code)] || "Unknown";
}

function weatherIcon(code) {
  const n = Number(code);

  if (n === 0) return "☀️";
  if ([1, 2].includes(n)) return "🌤️";
  if ([3].includes(n)) return "☁️";
  if ([45, 48].includes(n)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(n)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(n)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(n)) return "🌨️";
  if ([95, 96, 99].includes(n)) return "⛈️";

  return "🌡️";
}

async function geocodeVenue(city, stateName, country) {
  const key = [
    city,
    stateName,
    country
  ].filter(Boolean).join("|").toLowerCase();

  if (!key) return null;

  if (geocodeCache.has(key)) {
    return geocodeCache.get(key);
  }

  const query = [
    city,
    stateName,
    country
  ].filter(Boolean).join(", ");

  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(query)}` +
      "&count=1&language=en&format=json";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Geocoding request failed");
    }

    const data = await response.json();
    const result = data?.results?.[0];

    if (!result) {
      return null;
    }

    const coords = {
      lat: Number(result.latitude),
      lon: Number(result.longitude)
    };

    if (
      !Number.isFinite(coords.lat) ||
      !Number.isFinite(coords.lon)
    ) {
      return null;
    }

    geocodeCache.set(key, coords);

    return coords;
  } catch (error) {
    console.warn("Weather geocoding failed:", query, error);
    return null;
  }
}

async function getWeatherForGame(game) {
  if (!game.date) return null;

  let lat = Number(game.lat);
  let lon = Number(game.lon);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    const coords = await geocodeVenue(
      game.venueCity,
      game.venueState,
      game.venueCountry
    );

    if (!coords) {
      return null;
    }

    lat = coords.lat;
    lon = coords.lon;
  }

  const cacheKey =
    `${lat.toFixed(3)},${lon.toFixed(3)}`;

  let forecast = weatherCache.get(cacheKey);

  if (!forecast) {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}` +
      `&longitude=${lon}` +
      "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m" +
      "&temperature_unit=fahrenheit" +
      "&wind_speed_unit=mph" +
      "&precipitation_unit=inch" +
      "&timezone=auto" +
      "&forecast_days=7";

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Weather request failed");
      }

      forecast = await response.json();

      weatherCache.set(cacheKey, forecast);
    } catch (error) {
      console.warn("Weather request failed:", error);
      return null;
    }
  }

  const times = forecast?.hourly?.time || [];

  if (!times.length) {
    return null;
  }

  const target = new Date(game.date).getTime();

  let bestIndex = 0;
  let bestDifference = Infinity;

  times.forEach((time, index) => {
    const difference = Math.abs(
      new Date(time).getTime() - target
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = index;
    }
  });

  const hourly = forecast.hourly;

  return {
    temperature: hourly.temperature_2m?.[bestIndex],
    precipitationProbability:
      hourly.precipitation_probability?.[bestIndex],
    precipitation:
      hourly.precipitation?.[bestIndex],
    wind:
      hourly.wind_speed_10m?.[bestIndex],
    gust:
      hourly.wind_gusts_10m?.[bestIndex],
    code:
      hourly.weather_code?.[bestIndex],
    label:
      weatherLabel(hourly.weather_code?.[bestIndex]),
    icon:
      weatherIcon(hourly.weather_code?.[bestIndex]),
    updatedAt: Date.now()
  };
}

async function loadWeather(force = false) {
  if (!state.games.length) return;

  const now = Date.now();
  const refreshMs =
    Number(cfg.WEATHER_REFRESH_MS || 1800000);

  if (
    !force &&
    state.weatherLastLoaded &&
    now - state.weatherLastLoaded < refreshMs
  ) {
    return;
  }

  state.weatherLastLoaded = now;

  const games = state.games.filter(game =>
    game.date &&
    (
      game.venueCity ||
      (
        Number.isFinite(Number(game.lat)) &&
        Number.isFinite(Number(game.lon))
      )
    )
  );

  if (!games.length) {
    return;
  }

  console.log(
    `Loading weather for ${games.length} games...`
  );

  const results = await Promise.all(
    games.map(async game => ({
      id: game.id,
      weather: await getWeatherForGame(game)
    }))
  );

  const weatherByGame = new Map(
    results.map(result => [
      result.id,
      result.weather
    ])
  );

  state.games = state.games.map(game => ({
    ...game,
    weather:
      weatherByGame.get(game.id) ||
      game.weather ||
      null
  }));

  render();
}

function weatherHTML(game) {
  const weather = game.weather;

  if (!weather) {
    return `
      <div class="muted">
        Weather unavailable
      </div>
    `;
  }

  const temp =
    Number.isFinite(Number(weather.temperature))
      ? `${Math.round(Number(weather.temperature))}°F`
      : "—";

  const rain =
    Number.isFinite(
      Number(weather.precipitationProbability)
    )
      ? `${Math.round(Number(weather.precipitationProbability))}% rain`
      : "—";

  const wind =
    Number.isFinite(Number(weather.wind))
      ? `${Math.round(Number(weather.wind))} mph wind`
      : "—";

  return `
    <div class="weather-line">
      <span>${esc(weather.icon || "🌡️")}</span>
      <span>${esc(temp)}</span>
      <span>·</span>
      <span>${esc(rain)}</span>
      <span>·</span>
      <span>${esc(wind)}</span>
    </div>
    <div class="muted">
      ${esc(weather.label || "")}
    </div>
  `;
}

/* =========================================================
   RENDERING
========================================================= */

function render() {
  const app = $("app");

  if (!app) return;

  const pages = {
    dashboard: dashboardPage,
    live: livePage,
    bets: betsPage,
    games: gamesPage,
    analytics: analyticsPage,
    model: modelPage,
    settings: settingsPage
  };

  const page = pages[state.page] || dashboardPage;

  app.innerHTML = page();

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      state.page = button.dataset.page;
      render();
    });
  });

  bindPageActions();
}

function dashboardPage() {
  const settled = state.bets.filter(
    bet => ["win", "loss", "push"].includes(
      String(bet.result || "").toLowerCase()
    )
  );

  const wagered = state.bets.reduce(
    (sum, bet) => sum + Number(bet.stake || 0),
    0
  );

  const net = state.bets.reduce(
    (sum, bet) => sum + pnl(bet),
    0
  );

  const wins = state.bets.filter(
    bet => String(bet.result || "").toLowerCase() === "win"
  ).length;

  const losses = state.bets.filter(
    bet => String(bet.result || "").toLowerCase() === "loss"
  ).length;

  const recordTotal = wins + losses;

  const roi = wagered ? net / wagered : 0;
  const winRate = recordTotal ? wins / recordTotal : 0;

  const liveGames = state.games.filter(isLiveGame);
  const upcoming = state.games.filter(
    game => !isCompletedGame(game) && !isLiveGame(game)
  );

  const recent = [...state.bets]
    .sort(
      (a, b) =>
        new Date(b.created_at || b.createdAt || 0) -
        new Date(a.created_at || a.createdAt || 0)
    )
    .slice(0, 8);

  return `
    <div class="page-head">
      <div>
        <h1>Betting Terminal</h1>
        <p class="muted">
          Shared sports betting tracker and live model workspace.
        </p>
      </div>
    </div>

    <div class="stats-grid">
      ${statCard("Net P/L", money(net))}
      ${statCard("ROI", pct(roi))}
      ${statCard("Record", `${wins}-${losses}`)}
      ${statCard("Win Rate", pct(winRate))}
      ${statCard("Wagered", money(wagered))}
      ${statCard("Pending", String(state.bets.filter(b => !["win","loss","push"].includes(String(b.result || "").toLowerCase())).length))}
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Live / Upcoming</h2>
        <button class="button" data-page="live">Open Live</button>
      </div>

      ${
        liveGames.length || upcoming.length
          ? gamesList([
              ...liveGames,
              ...upcoming
            ].slice(0, 8))
          : emptyState("No live or upcoming games found.")
      }
    </div>

    <div class="two-column">
      <div class="section">
        <div class="section-head">
          <h2>Group Leaderboard</h2>
        </div>
        ${leaderboardHTML()}
      </div>

      <div class="section">
        <div class="section-head">
          <h2>Recent Bets</h2>
        </div>

        ${
          recent.length
            ? recent.map(betRowHTML).join("")
            : emptyState("No bets entered yet.")
        }
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Terminal Status</h2>
      </div>

      <div class="status-grid">
        ${statusItem(
          "Shared Database",
          state.supabase ? "CONNECTED" : "LOCAL MODE",
          state.supabase
        )}

        ${statusItem(
          "Sports Feed",
          state.games.length ? "LIVE" : "WAITING",
          state.games.length > 0
        )}

        ${statusItem(
          "Weather",
          state.games.some(g => g.weather)
            ? "LIVE"
            : "WAITING",
          state.games.some(g => g.weather)
        )}
      </div>
    </div>
  `;
}

function statCard(label, value) {
  return `
    <div class="stat-card">
      <div class="muted">${esc(label)}</div>
      <strong>${esc(value)}</strong>
    </div>
  `;
}

function statusItem(label, value, good) {
  return `
    <div class="status-item">
      <span>${esc(label)}</span>
      <strong class="${good ? "good" : ""}">
        ${esc(value)}
      </strong>
    </div>
  `;
}

function gamesList(games) {
  if (!games.length) {
    return emptyState("No games available.");
  }

  return `
    <div class="games-list">
      ${games.map(game => `
        <div class="game-row">
          <div class="game-main">
            <div class="game-meta">
              ${esc(game.league || game.sport || "")}
              ·
              ${esc(formatDate(game.date))}
            </div>

            <strong>
              ${esc(game.away || "Away")}
              ${game.awayScore != null ? ` ${esc(game.awayScore)}` : ""}
              @
              ${esc(game.home || "Home")}
              ${game.homeScore != null ? ` ${esc(game.homeScore)}` : ""}
            </strong>

            ${
              game.venueName
                ? `<div class="muted">${esc(game.venueName)}</div>`
                : ""
            }

            <div class="weather">
              ${weatherHTML(game)}
            </div>
          </div>

          <div class="game-status">
            ${esc(game.status || "Scheduled")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function livePage() {
  const live = state.games.filter(isLiveGame);

  return `
    <div class="page-head">
      <div>
        <h1>Live</h1>
        <p class="muted">
          Live games, scores, weather, and market workspace.
        </p>
      </div>

      <button class="button" id="refreshLive">
        Refresh
      </button>
    </div>

    ${
      live.length
        ? `
          <div class="live-grid">
            ${live.map(game => liveGameCard(game)).join("")}
          </div>
        `
        : emptyState("No live games right now.")
    }
  `;
}

function liveGameCard(game) {
  return `
    <div class="live-card">
      <div class="game-meta">
        ${esc(game.league || game.sport || "")}
      </div>

      <h2>
        ${esc(game.away || "Away")}
        ${game.awayScore != null ? ` ${esc(game.awayScore)}` : ""}
        @
        ${esc(game.home || "Home")}
        ${game.homeScore != null ? ` ${esc(game.homeScore)}` : ""}
      </h2>

      <div class="live-status">
        ${esc(game.status || "LIVE")}
      </div>

      ${
        game.venueName
          ? `<div class="muted">${esc(game.venueName)}</div>`
          : ""
      }

      <div class="weather-box">
        <strong>Weather</strong>
        ${weatherHTML(game)}
      </div>

      <div class="market-grid">
        <div>
          <span class="muted">Moneyline</span>
          <b>
            ${esc(game.awayOdds || "—")}
            /
            ${esc(game.homeOdds || "—")}
          </b>
        </div>

        <div>
          <span class="muted">Spread</span>
          <b>${esc(game.spread || "—")}</b>
        </div>

        <div>
          <span class="muted">Total</span>
          <b>${esc(game.total || "—")}</b>
        </div>
      </div>
    </div>
  `;
}

function betsPage() {
  return `
    <div class="page-head">
      <div>
        <h1>Bets</h1>
        <p class="muted">
          Shared bet ledger.
        </p>
      </div>

      <button class="button primary" id="openAddBet">
        Add Bet
      </button>
    </div>

    <div class="filters">
      <select id="betSportFilter">
        <option value="">All Sports</option>
        ${[
          "NFL",
          "NBA",
          "MLB",
          "NHL",
          "CFB",
          "CBB",
          "EPL",
          "Champions League",
          "Other Soccer"
        ].map(s => `<option>${s}</option>`).join("")}
      </select>

      <select id="betResultFilter">
        <option value="">All Results</option>
        <option value="pending">Pending</option>
        <option value="win">Win</option>
        <option value="loss">Loss</option>
        <option value="push">Push</option>
      </select>

      <select id="betBettorFilter">
        <option value="">All Bettors</option>
        ${["Bettor 1", "Bettor 2", "Bettor 3"]
          .map(s => `<option>${s}</option>`)
          .join("")}
      </select>
    </div>

    <div id="betsTable">
      ${betsTableHTML()}
    </div>
  `;
}

function betsTableHTML() {
  if (!state.bets.length) {
    return emptyState("No bets entered yet.");
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Bettor</th>
            <th>Sport</th>
            <th>Game</th>
            <th>Selection</th>
            <th>Odds</th>
            <th>Stake</th>
            <th>Result</th>
            <th>P/L</th>
          </tr>
        </thead>

        <tbody>
          ${state.bets.map(bet => `
            <tr>
              <td>${esc(bet.bettor)}</td>
              <td>${esc(bet.sport)}</td>
              <td>${esc(bet.game || bet.matchup)}</td>
              <td>${esc(bet.selection)}</td>
              <td>${esc(bet.odds)}</td>
              <td>${money(bet.stake)}</td>
              <td>${esc(bet.result || "Pending")}</td>
              <td>${money(pnl(bet))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function gamesPage() {
  const upcoming = state.games.filter(
    game => !isCompletedGame(game)
  );

  return `
    <div class="page-head">
      <div>
        <h1>Games</h1>
        <p class="muted">
          Live and upcoming games across supported sports.
        </p>
      </div>

      <button class="button" id="refreshGames">
        Refresh
      </button>
    </div>

    ${gamesList(upcoming)}
  `;
}

function analyticsPage() {
  const sports = {};

  state.bets.forEach(bet => {
    const sport = bet.sport || "Other";

    if (!sports[sport]) {
      sports[sport] = {
        bets: 0,
        wagered: 0,
        pnl: 0,
        wins: 0,
        losses: 0
      };
    }

    sports[sport].bets++;
    sports[sport].wagered += Number(bet.stake || 0);
    sports[sport].pnl += pnl(bet);

    const result =
      String(bet.result || "").toLowerCase();

    if (result === "win") sports[sport].wins++;
    if (result === "loss") sports[sport].losses++;
  });

  return `
    <div class="page-head">
      <div>
        <h1>Analytics</h1>
        <p class="muted">
          Performance breakdown by sport.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sport</th>
              <th>Bets</th>
              <th>Wagered</th>
              <th>P/L</th>
              <th>ROI</th>
              <th>Record</th>
            </tr>
          </thead>

          <tbody>
            ${
              Object.entries(sports).map(([sport, data]) => `
                <tr>
                  <td>${esc(sport)}</td>
                  <td>${data.bets}</td>
                  <td>${money(data.wagered)}</td>
                  <td>${money(data.pnl)}</td>
                  <td>
                    ${pct(
                      data.wagered
                        ? data.pnl / data.wagered
                        : 0
                    )}
                  </td>
                  <td>
                    ${data.wins}-${data.losses}
                  </td>
                </tr>
              `).join("")
              ||
              `
                <tr>
                  <td colspan="6">
                    No betting data yet.
                  </td>
                </tr>
              `
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Risk Snapshot</h2>

      <div class="stats-grid">
        ${statCard(
          "Open Bets",
          state.bets.filter(b =>
            !["win", "loss", "push"].includes(
              String(b.result || "").toLowerCase()
            )
          ).length
        )}

        ${statCard(
          "Open Exposure",
          money(
            state.bets
              .filter(b =>
                !["win", "loss", "push"].includes(
                  String(b.result || "").toLowerCase()
                )
              )
              .reduce(
                (sum, b) => sum + Number(b.stake || 0),
                0
              )
          )
        )}

        ${statCard(
          "Total Bets",
          state.bets.length
        )}
      </div>
    </div>
  `;
}

function modelPage() {
  return `
    <div class="page-head">
      <div>
        <h1>Model</h1>
        <p class="muted">
          Probability calculator and future predictive-model workspace.
        </p>
      </div>
    </div>

    <div class="two-column">
      <div class="section">
        <h2>American Odds Calculator</h2>

        <label>
          American Odds
          <input
            type="number"
            id="modelOdds"
            placeholder="-110"
          >
        </label>

        <div id="modelProbability" class="model-result">
          Enter odds to calculate implied probability.
        </div>
      </div>

      <div class="section">
        <h2>Model Development</h2>

        <div class="progress-item">
          <span>Live data inputs</span>
          <strong>In Progress</strong>
        </div>

        <div class="progress-item">
          <span>Weather variables</span>
          <strong>Connected</strong>
        </div>

        <div class="progress-item">
          <span>Team/player statistics</span>
          <strong>Next</strong>
        </div>

        <div class="progress-item">
          <span>Predictive models</span>
          <strong>Planned</strong>
        </div>

        <div class="progress-item">
          <span>Backtesting</span>
          <strong>Planned</strong>
        </div>
      </div>
    </div>
  `;
}

function settingsPage() {
  return `
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="muted">
          Data connections and terminal configuration.
        </p>
      </div>
    </div>

    <div class="section">
      <h2>Connections</h2>

      ${statusItem(
        "Supabase",
        state.supabase ? "CONNECTED" : "LOCAL MODE",
        !!state.supabase
      )}

      ${statusItem(
        "ESPN Sports Feed",
        state.games.length ? "CONNECTED" : "WAITING",
        state.games.length > 0
      )}

      ${statusItem(
        "Open-Meteo Weather",
        state.games.some(g => g.weather)
          ? "CONNECTED"
          : "WAITING",
        state.games.some(g => g.weather)
      )}
    </div>

    <div class="section">
      <h2>Data Sources</h2>

      <div class="source-list">
        <div>
          <strong>Scores / Schedules</strong>
          <span>ESPN public scoreboard endpoints</span>
        </div>

        <div>
          <strong>Weather</strong>
          <span>Open-Meteo forecast + geocoding</span>
        </div>

        <div>
          <strong>Odds</strong>
          <span>Optional replaceable odds adapter</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Room</h2>
      <p>
        Shared room:
        <strong>${esc(cfg.ROOM_CODE || "FRIENDS-1")}</strong>
      </p>
    </div>
  `;
}

function leaderboardHTML() {
  const players = {};

  state.bets.forEach(bet => {
    const name = bet.bettor || "Unknown";

    if (!players[name]) {
      players[name] = {
        wagered: 0,
        pnl: 0,
        wins: 0,
        losses: 0
      };
    }

    players[name].wagered += Number(bet.stake || 0);
    players[name].pnl += pnl(bet);

    const result =
      String(bet.result || "").toLowerCase();

    if (result === "win") players[name].wins++;
    if (result === "loss") players[name].losses++;
  });

  const rows = Object.entries(players);

  if (!rows.length) {
    return emptyState("No bettor activity yet.");
  }

  return `
    <div class="leaderboard">
      ${rows.map(([name, data]) => `
        <div class="leader-row">
          <strong>${esc(name)}</strong>

          <span>
            ${data.wins}-${data.losses}
          </span>

          <span>
            ${money(data.pnl)}
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function betRowHTML(bet) {
  return `
    <div class="bet-row">
      <div>
        <strong>
          ${esc(bet.selection || bet.game || "Bet")}
        </strong>

        <div class="muted">
          ${esc(bet.bettor || "")}
          ·
          ${esc(bet.sport || "")}
        </div>
      </div>

      <div>
        ${money(bet.stake)}
      </div>

      <div>
        ${esc(bet.result || "Pending")}
      </div>

      <div>
        ${money(pnl(bet))}
      </div>
    </div>
  `;
}

function emptyState(message) {
  return `
    <div class="empty-state">
      ${esc(message)}
    </div>
  `;
}

/* =========================================================
   PAGE ACTIONS
========================================================= */

function bindPageActions() {
  const refreshLive = $("refreshLive");
  const refreshGames = $("refreshGames");
  const openAddBet = $("openAddBet");

  if (refreshLive) {
    refreshLive.addEventListener("click", async () => {
      await loadGames();
      await loadWeather(true);
    });
  }

  if (refreshGames) {
    refreshGames.addEventListener("click", async () => {
      await loadGames();
      await loadWeather(true);
    });
  }

  if (openAddBet) {
    openBetModal();
  }

  const oddsInput = $("modelOdds");

  if (oddsInput) {
    oddsInput.addEventListener("input", () => {
      const odds = Number(oddsInput.value);
      const probability = oddsToProb(odds);

      $("modelProbability").textContent =
        Number.isFinite(odds) && odds !== 0
          ? `Implied probability: ${(probability * 100).toFixed(2)}%`
          : "Enter odds to calculate implied probability.";
    });
  }

  const sportFilter = $("betSportFilter");
  const resultFilter = $("betResultFilter");
  const bettorFilter = $("betBettorFilter");

  [sportFilter, resultFilter, bettorFilter]
    .filter(Boolean)
    .forEach(input => {
      input.addEventListener("change", applyBetFilters);
    });
}

function applyBetFilters() {
  const sport =
    $("betSportFilter")?.value || "";

  const result =
    $("betResultFilter")?.value || "";

  const bettor =
    $("betBettorFilter")?.value || "";

  let bets = [...state.bets];

  if (sport) {
    bets = bets.filter(
      bet => String(bet.sport || "") === sport
    );
  }

  if (bettor) {
    bets = bets.filter(
      bet => String(bet.bettor || "") === bettor
    );
  }

  if (result === "pending") {
    bets = bets.filter(
      bet =>
        !["win", "loss", "push"].includes(
          String(bet.result || "").toLowerCase()
        )
    );
  } else if (result) {
    bets = bets.filter(
      bet =>
        String(bet.result || "").toLowerCase() === result
    );
  }

  const container = $("betsTable");

  if (!container) return;

  if (!bets.length) {
    container.innerHTML =
      emptyState("No bets match those filters.");
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Bettor</th>
            <th>Sport</th>
            <th>Game</th>
            <th>Selection</th>
            <th>Odds</th>
            <th>Stake</th>
            <th>Result</th>
            <th>P/L</th>
          </tr>
        </thead>

        <tbody>
          ${bets.map(bet => `
            <tr>
              <td>${esc(bet.bettor)}</td>
              <td>${esc(bet.sport)}</td>
              <td>${esc(bet.game || bet.matchup)}</td>
              <td>${esc(bet.selection)}</td>
              <td>${esc(bet.odds)}</td>
              <td>${money(bet.stake)}</td>
              <td>${esc(bet.result || "Pending")}</td>
              <td>${money(pnl(bet))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* =========================================================
   BET MODAL
========================================================= */

function openBetModal() {
  const modal = $("betModal");

  if (modal) {
    modal.classList.add("open");
  }
}

function closeBetModal() {
  const modal = $("betModal");

  if (modal) {
    modal.classList.remove("open");
  }
}

async function addBet(bet) {
  const normalized = {
    ...bet,
    id: bet.id || uid(),
    room_code:
      bet.room_code ||
      cfg.ROOM_CODE ||
      "FRIENDS-1"
  };

  if (state.supabase) {
    const { error } = await state.supabase
      .from("bets")
      .insert([normalized]);

    if (error) {
      console.error("Supabase bet insert failed:", error);

      state.bets.unshift(normalized);
      saveLocal();
    }

    return;
  }

  state.bets.unshift(normalized);
  saveLocal();
  render();
}

/* =========================================================
   SUPABASE
========================================================= */

async function initSupabase() {
  try {
    if (
      !window.supabase ||
      !cfg.SUPABASE_URL ||
      !cfg.SUPABASE_ANON_KEY
    ) {
      console.warn(
        "Supabase configuration missing. Using local mode."
      );
      return;
    }

    state.supabase =
      window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      );

    const {
      data,
      error
    } = await state.supabase
      .from("bets")
      .select("*")
      .eq(
        "room_code",
        cfg.ROOM_CODE || "FRIENDS-1"
      )
      .order("created_at", {
        ascending: false
      });

    if (error) {
      throw error;
    }

    state.bets = data || [];

    state.supabase
      .channel("bets-room")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bets",
          filter:
            `room_code=eq.${cfg.ROOM_CODE || "FRIENDS-1"}`
        },
        payload => {
          console.log(
            "Realtime bet update:",
            payload
          );

          if (payload.eventType === "INSERT") {
            state.bets.unshift(payload.new);
          }

          if (payload.eventType === "UPDATE") {
            const index =
              state.bets.findIndex(
                bet => bet.id === payload.new.id
              );

            if (index >= 0) {
              state.bets[index] = payload.new;
            }
          }

          if (payload.eventType === "DELETE") {
            state.bets =
              state.bets.filter(
                bet => bet.id !== payload.old.id
              );
          }

          render();
        }
      )
      .subscribe(status => {
        console.log(
          "Realtime status:",
          status
        );
      });

    state.live = true;

    console.log(
      "Supabase connected successfully."
    );
  } catch (error) {
    console.error(
      "Supabase initialization failed:",
      error
    );

    state.supabase = null;
    loadLocal();
  }

  render();
}

/* =========================================================
   ESPN SPORTS FEED
========================================================= */

async function loadGames() {
  const previousWeather = new Map(
    state.games.map(game => [
      game.id,
      game.weather
    ])
  );

  const sports = [
    ["football", "nfl", "NFL"],
    ["basketball", "nba", "NBA"],
    ["baseball", "mlb", "MLB"],
    ["hockey", "nhl", "NHL"],
    ["football", "college-football", "CFB"],
    [
      "basketball",
      "mens-college-basketball",
      "CBB"
    ],
    ["soccer", "eng.1", "EPL"],
    [
      "soccer",
      "uefa.champions",
      "Champions League"
    ]
  ];

  const out = [];

  await Promise.all(
    sports.map(async ([sport, league, leagueName]) => {
      try {
        const url =
          `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `${leagueName} feed failed`
          );
        }

        const data = await response.json();

        (data.events || []).forEach(event => {
          const competition =
            event.competitions?.[0];

          if (!competition) return;

          const competitors =
            competition.competitors || [];

          const away =
            competitors.find(
              team => team.homeAway === "away"
            );

          const home =
            competitors.find(
              team => team.homeAway === "home"
            );

          const venue =
            competition.venue || {};

          const address =
            venue.address || {};

          const geo =
            venue.geoCoordinates || {};

          const lat = Number(
            geo.latitude ??
            geo.lat
          );

          const lon = Number(
            geo.longitude ??
            geo.lng
          );

          out.push({
            id: event.id,
            date: event.date,

            sport,
            league: leagueName,

            away:
              away?.team?.displayName ||
              away?.team?.shortDisplayName ||
              "Away",

            home:
              home?.team?.displayName ||
              home?.team?.shortDisplayName ||
              "Home",

            awayScore:
              away?.score ?? null,

            homeScore:
              home?.score ?? null,

            status:
              event.status?.type?.detail ||
              event.status?.type?.shortDetail ||
              event.status?.type?.description ||
              "Scheduled",

            statusState:
              event.status?.type?.state ||
              "",

            venueName:
              venue.fullName || "",

            venueCity:
              address.city || "",

            venueState:
              address.state || "",

            venueCountry:
              address.country || "US",

            lat:
              Number.isFinite(lat)
                ? lat
                : null,

            lon:
              Number.isFinite(lon)
                ? lon
                : null,

            indoor:
              Boolean(venue.indoor),

            weather:
              previousWeather.get(event.id) ||
              null,

            awayOdds: null,
            homeOdds: null,
            spread: null,
            total: null
          });
        });
      } catch (error) {
        console.warn(
          `ESPN ${leagueName} error:`,
          error
        );
      }
    })
  );

  out.sort(
    (a, b) =>
      new Date(a.date || 0) -
      new Date(b.date || 0)
  );

  state.games = out;

  render();

  /*
    Weather is intentionally separate from the
    60-second ESPN refresh. This prevents us from
    hammering Open-Meteo every minute.
  */
  await loadWeather();
}

/* =========================================================
   INITIALIZATION
========================================================= */

async function init() {
  loadLocal();

  render();

  await initSupabase();

  await loadGames();

  /*
    ESPN:
    Refresh every 60 seconds.
  */
  setInterval(
    async () => {
      await loadGames();
    },
    Number(cfg.ESPN_REFRESH_MS || 60000)
  );

  /*
    Weather:
    Refresh every 30 minutes by default.
  */
  setInterval(
    async () => {
      await loadWeather(true);
    },
    Number(
      cfg.WEATHER_REFRESH_MS ||
      1800000
    )
  );

  /*
    Top-bar Refresh button.
  */
  const refreshButton =
    $("refreshButton");

  if (refreshButton) {
    refreshButton.addEventListener(
      "click",
      async () => {
        await loadGames();
        await loadWeather(true);
      }
    );
  }

  /*
    Add Bet button in the top navigation.
  */
  const addBetButton =
    $("addBetButton");

  if (addBetButton) {
    addBetButton.addEventListener(
      "click",
      openBetModal
    );
  }

  /*
    Close modal buttons.
  */
  document
    .querySelectorAll(
      "[data-close-bet-modal]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        closeBetModal
      );
    });

  /*
    Add Bet form.
  */
  const betForm =
    $("betForm");

  if (betForm) {
    betForm.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const formData =
          new FormData(betForm);

        const bet = {
          bettor:
            formData.get("bettor") || "",

          sport:
            formData.get("sport") || "",

          game:
            formData.get("game") || "",

          bet_type:
            formData.get("bet_type") || "",

          selection:
            formData.get("selection") || "",

          odds:
            Number(
              formData.get("odds") || 0
            ),

          stake:
            Number(
              formData.get("stake") || 0
            ),

          sportsbook:
            formData.get("sportsbook") || "",

          result:
            formData.get("result") || "Pending",

          notes:
            formData.get("notes") || "",

          room_code:
            cfg.ROOM_CODE ||
            "FRIENDS-1"
        };

        await addBet(bet);

        betForm.reset();

        closeBetModal();

        render();
      }
    );
  }
}

document.addEventListener(
  "DOMContentLoaded",
  init
);
