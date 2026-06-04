// /api/analyze-game
// Claude Sonnet with tool use — fetches real recent form from API-Sports,
// combines with odds from the card, returns a short Hebrew prediction.
// Required env vars: ANTHROPIC_API_KEY, FOOTBALL_KEY

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FOOTBALL_KEY  = process.env.FOOTBALL_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FOOTBALL_API  = "https://v3.football.api-sports.io";
const BBALL_API     = "https://v1.basketball.api-sports.io";

// ── Tool definition ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_recent_matches",
    description: "Get the last 5 match results for a team — wins, losses, scores. Use this for both teams before giving a prediction.",
    input_schema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team name (Hebrew or English)" },
        sport: { type: "string", enum: ["football", "basketball"] },
      },
      required: ["team", "sport"],
    },
  },
];

// ── Tool implementation ──────────────────────────────────────────────────────
async function getRecentMatches(teamName, sport) {
  if (!FOOTBALL_KEY) return { error: "FOOTBALL_KEY not set" };

  const isBasketball = sport === "basketball";
  const base    = isBasketball ? BBALL_API : FOOTBALL_API;
  const headers = { "x-apisports-key": FOOTBALL_KEY };
  const timeout = AbortSignal.timeout(9000);

  try {
    // 1. Find team ID
    const searchRes  = await fetch(`${base}/teams?search=${encodeURIComponent(teamName)}`, { headers, signal: timeout });
    const searchData = await searchRes.json();
    const entry      = searchData.response?.[0];
    if (!entry) return { error: `Team not found: ${teamName}` };

    const teamId   = isBasketball ? entry.id : entry.team?.id;
    const teamName2 = isBasketball ? entry.name : entry.team?.name;
    if (!teamId) return { error: `No ID for: ${teamName}` };

    // 2. Fetch last 5 results
    const endpoint  = isBasketball ? "games" : "fixtures";
    const resultsRes  = await fetch(`${base}/${endpoint}?team=${teamId}&last=5`, { headers, signal: AbortSignal.timeout(9000) });
    const resultsData = await resultsRes.json();

    const games = (resultsData.response || []).map(r => {
      if (isBasketball) {
        const h = r.teams.home, a = r.teams.away;
        const hs = r.scores.home.total, as2 = r.scores.away.total;
        const isHome = h.id === teamId;
        return {
          date:   r.game.date?.slice(0, 10),
          home:   h.name, away: a.name,
          score:  `${hs}-${as2}`,
          result: hs === as2 ? "D" : (isHome ? hs > as2 : as2 > hs) ? "W" : "L",
        };
      } else {
        const h = r.teams.home, a = r.teams.away;
        const hg = r.goals.home, ag = r.goals.away;
        const isHome = h.id === teamId;
        return {
          date:   r.fixture.date?.slice(0, 10),
          home:   h.name, away: a.name,
          score:  `${hg ?? "?"}–${ag ?? "?"}`,
          result: hg === ag ? "D" : (isHome ? hg > ag : ag > hg) ? "W" : "L",
        };
      }
    });

    return { team: teamName2, last_5: games };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Agentic loop ─────────────────────────────────────────────────────────────
async function runLoop(messages, system) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system,
        tools: TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(28000),
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

      // Run all tool calls in parallel
      const toolResults = await Promise.all(
        (data.content || [])
          .filter(c => c.type === "tool_use")
          .map(async tu => {
            let result;
            if (tu.name === "get_recent_matches") {
              result = await getRecentMatches(tu.input.team, tu.input.sport);
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
  throw new Error("loop did not complete");
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ ok: false, error: "POST only" }); return; }
  if (!ANTHROPIC_KEY)           { res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY not set" }); return; }

  const { home, away, sport, league, date, time, odds1, oddsX, odds2 } = req.body || {};
  if (!home || !away) { res.status(400).json({ ok: false, error: "home and away required" }); return; }

  const sportLabel = isBasketball(sport) ? "כדורסל" : "כדורגל";
  const sportTool  = isBasketball(sport) ? "basketball" : "football";

  const oddsLine = [
    odds1 ? `${home} ${odds1}` : null,
    oddsX ? `תיקו ${oddsX}` : null,
    odds2 ? `${away} ${odds2}` : null,
  ].filter(Boolean).join(" | ");

  const system = "אתה אנליסט ספורט. ענה תמיד בעברית, קצר וישיר — 2-3 משפטים בלבד. אל תרשום כותרות.";

  const userMsg = [
    `משחק: ${home} נגד ${away}`,
    league ? `ליגה: ${league}` : null,
    `ספורט: ${sportLabel}`,
    date || time ? `מועד: ${[date, time].filter(Boolean).join(" ")}` : null,
    oddsLine ? `יחסים: ${oddsLine}` : null,
    ``,
    `שלוף 5 משחקים אחרונים לכל קבוצה, ואז תן תחזית קצרה: מי מנצח ולמה.`,
  ].filter(s => s !== null).join("\n");

  try {
    const analysis = await runLoop(
      [{ role: "user", content: userMsg }],
      system
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
