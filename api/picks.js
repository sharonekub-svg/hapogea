/**
 * GET /api/picks
 *
 * Returns today's algorithmically ranked picks for football + basketball.
 * Targets 10–15 picks per sport; expands to outsideRange rows if needed.
 * First 2 per sport are "free", the rest are "premium".
 *
 * Response shape:
 * {
 *   generatedAt: string,
 *   date: string,          // "YYYY-MM-DD"
 *   oddsSource: string,
 *   football:   { total: N, picks: [Pick] },
 *   basketball: { total: N, picks: [Pick] }
 * }
 *
 * Pick shape:
 * {
 *   rank: number,
 *   sport: string,
 *   match: string,
 *   league: string,
 *   country: string,
 *   pick: string,          // Hebrew team name or "תיקו"
 *   odds: number | null,
 *   probability: number,   // 0–100
 *   rationale: string,
 *   score: number,
 *   tier: "free" | "premium",
 *   day: "today" | "tomorrow",
 *   time: string,
 *   isOutsideRange: boolean
 * }
 */

const { buildWinnerFeedPayload, scoreBreakdown } = require("./winner-feed");

const FREE_PICKS_PER_SPORT = 2;
const TARGET_PICKS = 15;
const MIN_PICKS = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;

function rankScore(row) {
  return scoreBreakdown(row).total;
}

function buildRationale(row) {
  const prob = Math.round((row.normalizedProbability || 0) * 100);
  const gap  = Math.round((row.marketGap || 0) * 100);
  const ev   = typeof row.ev === "number" ? (row.ev * 100).toFixed(1) : null;
  const parts = [];

  if (prob >= 55) parts.push(`הסתברות ${prob}%`);
  if (gap >= 8)   parts.push(`פער שוק ${gap}%`);
  if (ev && Number(ev) > 0) parts.push(`EV+${ev}%`);
  if (row.valueIndicator === "winner_higher") parts.push("Winner מתמחר מעל השוק ההוגן");
  if (!parts.length && row.oddsRaw) parts.push(`פייבוריט ב-${row.oddsRaw}`);

  return parts.join(" | ");
}

function sortByScore(rows) {
  return [...rows].sort((a, b) => rankScore(b) - rankScore(a));
}

function selectPicks(rows) {
  const recommended = sortByScore(rows.filter((r) => r.recommended && r.odds));

  if (recommended.length >= MIN_PICKS) {
    return recommended.slice(0, TARGET_PICKS);
  }

  // Not enough recommended → pad with best outsideRange rows
  const outside = sortByScore(rows.filter((r) => !r.recommended && !r.noOddsYet && r.oddsRaw));
  const combined = [...recommended, ...outside];
  return combined.slice(0, Math.max(recommended.length, MIN_PICKS));
}

function formatPicks(rows, sportLabel) {
  return selectPicks(rows).map((row, i) => ({
    rank: i + 1,
    sport: sportLabel,
    match: row.match || `${row.home} - ${row.away}`,
    league: row.league || "",
    country: row.country || "",
    pick: row.winnerPick || row.pick || "",
    odds: row.odds ?? row.oddsRaw ?? null,
    probability: Math.round((row.normalizedProbability || row.probability || 0) * 100),
    rationale: buildRationale(row),
    score: rankScore(row),
    tier: i < FREE_PICKS_PER_SPORT ? "free" : "premium",
    day: row.day,
    time: row.time || "",
    isOutsideRange: row.outsideRange || false,
  }));
}

async function buildPicksPayload() {
  const payload = await buildWinnerFeedPayload({ withLogos: false });

  const todayFootball    = payload.tabs?.today?.sports?.football    || [];
  const tomorrowFootball = payload.tabs?.tomorrow?.sports?.football || [];
  const todayBasket      = payload.tabs?.today?.sports?.basketball    || [];
  const tomorrowBasket   = payload.tabs?.tomorrow?.sports?.basketball || [];

  const football   = formatPicks([...todayFootball,  ...tomorrowFootball], "football");
  const basketball = formatPicks([...todayBasket,    ...tomorrowBasket],   "basketball");

  return {
    generatedAt: new Date().toISOString(),
    date: payload.israelDate || new Date().toISOString().slice(0, 10),
    oddsSource: payload.oddsSource || "Winner",
    football:   { total: football.length,   picks: football },
    basketball: { total: basketball.length, picks: basketball },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const now = Date.now();
    if (!_cache || now - _cacheTime > CACHE_TTL_MS) {
      _cache = await buildPicksPayload();
      _cacheTime = now;
    }

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(_cache);
  } catch (err) {
    console.error("[picks] error:", err.message);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
};
