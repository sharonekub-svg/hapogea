// /api/analyze-game
// Claude Sonnet agentic loop — fetches form, H2H, standings + season stats
// from API-Sports, then gives a structured Hebrew prediction with depth.
// Required env vars: ANTHROPIC_API_KEY, FOOTBALL_KEY

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FOOTBALL_KEY  = process.env.FOOTBALL_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FOOTBALL_API  = "https://v3.football.api-sports.io";
const BBALL_API     = "https://v1.basketball.api-sports.io";

// ── Tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_team_stats",
    description: "Get the last 6 results, win/draw/loss record, home vs away split, goals scored and conceded averages, and current league standings for ONE team. Call for BOTH teams before writing any analysis.",
    input_schema: {
      type: "object",
      properties: {
        team:  { type: "string", description: "Team name (Hebrew or English)" },
        sport: { type: "string", enum: ["football", "basketball"] },
      },
      required: ["team", "sport"],
    },
  },
  {
    name: "get_head_to_head",
    description: "Get the last 6 direct meetings between the two teams. Call AFTER you have stats for both teams.",
    input_schema: {
      type: "object",
      properties: {
        home:  { type: "string", description: "Home team name" },
        away:  { type: "string", description: "Away team name" },
        sport: { type: "string", enum: ["football", "basketball"] },
      },
      required: ["home", "away", "sport"],
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function currentSeason() {
  const m = new Date().getMonth(); // 0-based
  return new Date().getFullYear() - (m < 6 ? 1 : 0); // Aug = new season
}

async function fetchJson(url, headers, timeoutMs = 9000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  return res.json();
}

// ── Team search + ID cache (request-scoped) ───────────────────────────────────
function makeCache() {
  const map = {};
  return {
    get: k => map[k],
    set: (k, v) => { map[k] = v; },
  };
}

async function resolveTeam(name, base, headers, cache) {
  const key = `${base}::${name.toLowerCase()}`;
  if (cache.get(key)) return cache.get(key);
  const data = await fetchJson(`${base}/teams?search=${encodeURIComponent(name)}`, headers);
  const entry = data.response?.[0];
  if (!entry) return null;
  const isBball = base === BBALL_API;
  const id   = isBball ? entry.id          : entry.team?.id;
  const canonical = isBball ? entry.name   : entry.team?.name;
  if (!id) return null;
  const result = { id, name: canonical };
  cache.set(key, result);
  return result;
}

// ── Tool implementations ──────────────────────────────────────────────────────
async function getTeamStats(teamName, sport, cache) {
  if (!FOOTBALL_KEY) return { error: "FOOTBALL_KEY not set — no external data available" };
  const isBball = sport === "basketball";
  const base    = isBball ? BBALL_API : FOOTBALL_API;
  const headers = { "x-apisports-key": FOOTBALL_KEY };

  const team = await resolveTeam(teamName, base, headers, cache);
  if (!team) return { error: `Team not found: ${teamName}` };

  // ── Last 6 results ──
  const endpoint = isBball ? "games" : "fixtures";
  const resultsData = await fetchJson(
    `${base}/${endpoint}?team=${team.id}&last=6`,
    headers
  );

  const games = (resultsData.response || []).map(r => {
    if (isBball) {
      const h = r.teams.home, a = r.teams.away;
      const hs = r.scores.home.total, as2 = r.scores.away.total;
      const isHome = h.id === team.id;
      const won = isHome ? hs > as2 : as2 > hs;
      return {
        date: r.game.date?.slice(0, 10),
        home: h.name, away: a.name,
        score: `${hs}-${as2}`,
        result: hs === as2 ? "D" : won ? "W" : "L",
        venue: isHome ? "home" : "away",
        pts_for: isHome ? hs : as2,
        pts_ag:  isHome ? as2 : hs,
      };
    } else {
      const h = r.teams.home, a = r.teams.away;
      const hg = r.goals.home ?? 0, ag = r.goals.away ?? 0;
      const isHome = h.id === team.id;
      const won = isHome ? hg > ag : ag > hg;
      return {
        date: r.fixture.date?.slice(0, 10),
        home: h.name, away: a.name,
        score: `${hg ?? "?"}-${ag ?? "?"}`,
        result: hg === ag ? "D" : won ? "W" : "L",
        venue: isHome ? "home" : "away",
        gf: isHome ? hg : ag,
        ga: isHome ? ag : hg,
      };
    }
  });

  // ── Aggregate stats ──
  const total = games.length;
  const wins   = games.filter(g => g.result === "W").length;
  const draws  = games.filter(g => g.result === "D").length;
  const losses = games.filter(g => g.result === "L").length;
  const homeGames = games.filter(g => g.venue === "home");
  const awayGames = games.filter(g => g.venue === "away");
  const homeWins  = homeGames.filter(g => g.result === "W").length;
  const awayWins  = awayGames.filter(g => g.result === "W").length;

  const stats = isBball
    ? {
        pts_for_avg: total ? (games.reduce((s, g) => s + (g.pts_for || 0), 0) / total).toFixed(1) : null,
        pts_ag_avg:  total ? (games.reduce((s, g) => s + (g.pts_ag  || 0), 0) / total).toFixed(1) : null,
      }
    : {
        gf_avg: total ? (games.reduce((s, g) => s + (g.gf || 0), 0) / total).toFixed(2) : null,
        ga_avg: total ? (games.reduce((s, g) => s + (g.ga || 0), 0) / total).toFixed(2) : null,
        clean_sheets: games.filter(g => g.ga === 0).length,
      };

  // ── Standings (football only) ──
  let standing = null;
  if (!isBball) {
    try {
      const season = currentSeason();
      const stData = await fetchJson(
        `${FOOTBALL_API}/standings?team=${team.id}&season=${season}`,
        headers,
        8000
      );
      const entry = stData.response?.[0]?.league?.standings?.[0]?.find(s => s.team?.id === team.id);
      if (entry) {
        standing = {
          league:   stData.response[0].league.name,
          position: entry.rank,
          points:   entry.points,
          played:   entry.all?.played,
          gd:       entry.goalsDiff,
          form:     entry.form, // e.g. "WWDLW"
        };
      }
    } catch (_) { /* standings are bonus data — don't fail */ }
  }

  return {
    team: team.name,
    last_6: games,
    record: { W: wins, D: draws, L: losses, home_wins: homeWins, away_wins: awayWins },
    ...stats,
    ...(standing ? { standing } : {}),
  };
}

async function getHeadToHead(homeName, awayName, sport, cache) {
  if (!FOOTBALL_KEY) return { error: "FOOTBALL_KEY not set" };
  const isBball = sport === "basketball";
  const base    = isBball ? BBALL_API : FOOTBALL_API;
  const headers = { "x-apisports-key": FOOTBALL_KEY };

  const homeTeam = await resolveTeam(homeName, base, headers, cache);
  const awayTeam = await resolveTeam(awayName, base, headers, cache);
  if (!homeTeam || !awayTeam) return { error: "Could not resolve team IDs for H2H" };

  try {
    let url, key;
    if (isBball) {
      url = `${BBALL_API}/games?h2h=${homeTeam.id}-${awayTeam.id}&last=6`;
      key = "games";
    } else {
      url = `${FOOTBALL_API}/fixtures/headtohead?h2h=${homeTeam.id}-${awayTeam.id}&last=6`;
      key = "fixtures";
    }
    const data = await fetchJson(url, headers, 9000);
    const meetings = (data.response || []).map(r => {
      if (isBball) {
        const hs = r.scores.home.total, as2 = r.scores.away.total;
        return { date: r.game.date?.slice(0, 10), home: r.teams.home.name, away: r.teams.away.name, score: `${hs}-${as2}` };
      } else {
        return { date: r.fixture.date?.slice(0, 10), home: r.teams.home.name, away: r.teams.away.name, score: `${r.goals.home}-${r.goals.away}` };
      }
    });
    return { home: homeTeam.name, away: awayTeam.name, h2h: meetings };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Agentic loop ──────────────────────────────────────────────────────────────
async function runLoop(messages, system, cache) {
  for (let i = 0; i < 8; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 950,
        system,
        tools: TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Claude ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();

    if (data.stop_reason === "end_turn") {
      return (data.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    }

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });

      const toolResults = await Promise.all(
        (data.content || [])
          .filter(c => c.type === "tool_use")
          .map(async tu => {
            let result;
            if (tu.name === "get_team_stats") {
              result = await getTeamStats(tu.input.team, tu.input.sport, cache);
            } else if (tu.name === "get_head_to_head") {
              result = await getHeadToHead(tu.input.home, tu.input.away, tu.input.sport, cache);
            } else {
              result = { error: "unknown tool" };
            }
            return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
          })
      );

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }
  throw new Error("agentic loop did not complete");
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ ok: false, error: "POST only" }); return; }
  if (!ANTHROPIC_KEY)           { res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY not set" }); return; }

  const { home, away, sport, league, odds } = req.body || {};
  if (!home || !away) { res.status(400).json({ ok: false, error: "home and away required" }); return; }

  const sportHint = isBasketball(sport) ? "basketball" : "football";

  const oddsLine = odds
    ? `\nיחסי Winner למשחק זה: ${typeof odds === "object" ? JSON.stringify(odds) : odds}`
    : "";
  const leagueLine = league ? `\nליגה: ${league}` : "";

  const system = `אתה הפוגע — אנליסט ספורט. ענה תמיד בעברית, קצר וישיר — 2-3 משפטים בלבד.

השתמש בכלים כדי לבדוק נתונים אמיתיים (צורה, H2H, טבלה), אבל בתשובה הסופית אל תפרט את הנתונים — פשוט כתוב מסקנה ברורה המבוססת עליהם.
בסוף הוסף שורה אחת: "📊 תחזית: [שם קבוצה / תיקו]"

אל תמציא נתונים. אל תתן ייעוץ הימורים. השתמש ב-sport="${sportHint}" בכל קריאות הכלים.${leagueLine}${oddsLine}`;

  const userMsg = `${home} נגד ${away} — בדוק get_team_stats לשתי הקבוצות ו-get_head_to_head, ואז תן תחזית קצרה.`;

  try {
    const cache = makeCache();
    const analysis = await runLoop(
      [{ role: "user", content: userMsg }],
      system,
      cache
    );
    res.status(200).json({ ok: true, analysis });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

function isBasketball(sport) {
  if (!sport) return false;
  const s = String(sport).toLowerCase();
  return s.includes("סל") || s.includes("basket") || s === "227";
}
