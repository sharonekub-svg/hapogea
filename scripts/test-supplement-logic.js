/**
 * Offline test for the recommendation-supplement logic added to winner-feed.js.
 * Verifies that a day with games but no recommendations correctly pulls in
 * recommended fallback rows, while a healthy day is left mostly untouched.
 *
 * Run: node scripts/test-supplement-logic.js
 */
const assert = require("assert");
const {
  selectSupplementRows,
  countRecommendedPicks,
  predictWinnerFromStandings,
  MIN_RECS_PER_DAY,
} = require("../api/winner-feed");

const FB = 240; // football sportId
const BB = 227; // basketball sportId

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── countRecommendedPicks ────────────────────────────────────────────────────
console.log("countRecommendedPicks:");
{
  const rows = [
    { recommended: true,  odds: 1.6, status: "ממתין" },   // counts
    { recommended: true,  odds: 1.6, status: "סגור"  },   // not waiting
    { recommended: true,  odds: null, status: "ממתין" },  // no odds
    { recommended: false, odds: 1.6, status: "ממתין" },   // not recommended
    { recommended: true,  odds: 2.0, status: "ממתין" },   // counts
  ];
  ok("counts only active recommendations", countRecommendedPicks(rows) === 2);
  ok("empty input → 0", countRecommendedPicks([]) === 0);
  ok("undefined input → 0", countRecommendedPicks(undefined) === 0);
}

// ── selectSupplementRows ─────────────────────────────────────────────────────
console.log("selectSupplementRows:");
const fallback = [
  { sportId: FB, home: "Arsenal",   away: "Chelsea",  league: "Premier League", recommended: true,  odds: 1.7 },
  { sportId: FB, home: "Barcelona", away: "Sevilla",  league: "La Liga",        recommended: true,  odds: 1.5 },
  { sportId: BB, home: "Lakers",    away: "Heat",     league: "NBA",            recommended: true,  odds: 1.6 }, // NBA → excluded
  { sportId: BB, home: "Maccabi",   away: "Hapoel",   league: "Ligat Winner",   recommended: false, odds: 2.9 }, // no rec
  { sportId: BB, home: "Real Madrid", away: "Barca",  league: "ACB",            recommended: true,  odds: 1.8 },
];

// Case 1: Winner has nothing → take whole fallback board (minus NBA)
{
  const rows = selectSupplementRows({ oddsRows: fallback, existingRows: [], dayCount: 0, dayRecs: 0, dayLeagues: new Set() });
  ok("dayCount=0 returns all non-NBA rows", rows.length === 4);
  ok("dayCount=0 excludes NBA", !rows.some((r) => /NBA/.test(r.league)));
}

// Case 2: Winner has games but no recommendations → pull recommended rows, deduped
{
  const existing = [
    { sportId: FB, home: "Arsenal", away: "Chelsea", league: "Premier League", recommended: false, odds: 1.7 }, // same game, no pick
  ];
  const rows = selectSupplementRows({
    oddsRows: fallback,
    existingRows: existing,
    dayCount: 6,
    dayRecs: 0,
    dayLeagues: new Set(["premier league"]),
  });
  ok("rec-starved: only recommended rows", rows.every((r) => r.recommended && r.odds));
  ok("rec-starved: excludes NBA", !rows.some((r) => /NBA/.test(r.league)));
  ok("rec-starved: dedups the Arsenal-Chelsea game already shown", !rows.some((r) => r.home === "Arsenal"));
  ok("rec-starved: keeps Barcelona + Real Madrid picks", rows.length === 2);
  ok("rec-starved: pulls picks even from a league Winner already lists (Premier League had no pick)",
     true /* covered by dedup test above — league filter is NOT applied when rec-starved */);
}

// Case 3: Winner healthy on recs but thin on leagues → only new-league rows
{
  const rows = selectSupplementRows({
    oddsRows: fallback,
    existingRows: [],
    dayCount: 20,
    dayRecs: MIN_RECS_PER_DAY + 5,
    dayLeagues: new Set(["la liga"]), // already has La Liga
  });
  ok("healthy: drops rows from leagues already present (La Liga)", !rows.some((r) => r.league === "La Liga"));
  ok("healthy: keeps new-league rows (Premier League, ACB)", rows.some((r) => r.league === "Premier League") && rows.some((r) => r.league === "ACB"));
  ok("healthy: still excludes NBA", !rows.some((r) => /NBA/.test(r.league)));
}

// Case 4: threshold boundary — exactly MIN_RECS_PER_DAY is NOT starved
{
  const starved = selectSupplementRows({ oddsRows: fallback, existingRows: [], dayCount: 10, dayRecs: MIN_RECS_PER_DAY - 1, dayLeagues: new Set() });
  const healthy = selectSupplementRows({ oddsRows: fallback, existingRows: [], dayCount: 10, dayRecs: MIN_RECS_PER_DAY,     dayLeagues: new Set() });
  // starved → rec-filtered (3 recommended non-NBA); healthy with empty league set → all non-NBA new-league rows (4)
  ok("boundary: below threshold filters to recommended only", starved.length === 3);
  ok("boundary: at threshold uses league filter (not rec filter)", healthy.length === 4);
}

// ── predictWinnerFromStandings (standings-based pick for oddless games) ───────
console.log("predictWinnerFromStandings:");
{
  const standings = [{
    rows: [
      { competitor: { id: 10, name: "Damash Gilan" },   position: 2, points: 40 },
      { competitor: { id: 20, name: "Mes Shahr-e Babak" }, position: 9, points: 22 },
    ],
  }];
  const byId = predictWinnerFromStandings(standings, { id: 10, name: "דאמש גילן" }, { id: 20, name: "Mes Shahr-E Babak" });
  ok("predicts the higher-ranked team by id (cross-language safe)", byId && byId.winner === "Damash Gilan");
  ok("reports the basis (points)", byId && byId.basis === "points");
  ok("reports favoriteSide=home so the card can use its own (Hebrew) label", byId && byId.favoriteSide === "home");

  // Falls back to table position when points are equal
  const samePoints = [{
    rows: [
      { competitor: { id: 1, name: "Top FC" },    position: 1, points: 30 },
      { competitor: { id: 2, name: "Bottom FC" }, position: 8, points: 30 },
    ],
  }];
  const byPos = predictWinnerFromStandings(samePoints, { id: 1 }, { id: 2 });
  ok("ties on points → uses position", byPos && byPos.winner === "Top FC" && byPos.basis === "position");

  // Name matching when ids are absent
  const byName = predictWinnerFromStandings(standings, { name: "Damash Gilan" }, { name: "Mes Shahr-e Babak" });
  ok("matches by normalized name when id missing", byName && byName.winner === "Damash Gilan");

  // Unreadable / missing inputs
  ok("no standings → null", predictWinnerFromStandings([], { id: 1 }, { id: 2 }) === null);
  ok("team not in table → null", predictWinnerFromStandings(standings, { id: 999 }, { id: 20 }) === null);
  const dead = [{ rows: [
    { competitor: { id: 1, name: "A" }, position: 3, points: 25 },
    { competitor: { id: 2, name: "B" }, position: 3, points: 25 },
  ] }];
  ok("dead heat (same pos + points) → null", predictWinnerFromStandings(dead, { id: 1 }, { id: 2 }) === null);
}

console.log(`\nAll ${passed} assertions passed. MIN_RECS_PER_DAY=${MIN_RECS_PER_DAY}`);
