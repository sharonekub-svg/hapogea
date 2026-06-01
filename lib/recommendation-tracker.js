const { hashId, loadDb, saveDb, upsertMany } = require("./recommendation-db");

const ILS_STAKE = 100;

function israelDate(offsetDays = 0, from = new Date()) {
  const date = new Date(from.getTime() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recommendationId(row) {
  return hashId([
    row.day,
    row.sportId,
    row.eventId || row.resultKey || row.match,
    row.marketId || row.market || "",
    row.outcomeId || "",
    normalize(row.pickTeam || row.winnerPick || row.pick || ""),
  ].join("|"));
}

function resultId(row) {
  return hashId([
    row.day,
    row.sportId,
    row.eventId || row.resultKey || row.match,
    normalize(row.home),
    normalize(row.away),
  ].join("|"));
}

function allFeedRows(feed) {
  return Object.entries(feed?.tabs || {}).flatMap(([dayKey, tab]) =>
    Object.entries(tab?.sports || {}).flatMap(([sportKey, rows]) =>
      (rows || []).map(row => ({ ...row, dayKey, sportKey, tabDate: tab.date }))
    )
  );
}

function extractRecommendations(feed) {
  return allFeedRows(feed)
    .filter(row => row.recommended === true && row.odds && !row.outsideRange)
    .filter(row => row.dayKey === "today" || row.dayKey === "tomorrow")
    .map(row => {
      const id = recommendationId(row);
      const createdAt = feed.generatedAt || new Date().toISOString();
      return {
        id,
        event_id: String(row.eventId || ""),
        result_key: row.resultKey || "",
        sport: row.sportKey || (Number(row.sportId) === 227 ? "basketball" : "football"),
        sport_id: Number(row.sportId || 0),
        match_date: row.day || row.tabDate,
        kickoff_time: row.time || "",
        league: row.league || "",
        home_team: row.home || "",
        away_team: row.away || "",
        match_name: row.match || `${row.home || ""} - ${row.away || ""}`,
        market_id: row.marketId || "",
        outcome_id: row.outcomeId || "",
        market: row.market || "",
        algorithm_pick: row.winnerPick || row.pick || row.pickTeam || "",
        pick_team: row.pickTeam || row.winnerPick || row.pick || "",
        odds_at_recommendation: Number(row.odds),
        odds_source: row.oddsSource || feed.oddsSource || "Winner",
        recommendation_type: row.recommendationReason === "top-20" || row.recommended ? "premium" : "regular",
        score: Number(row.recommendationScore || row.score || 0),
        probability: Number(row.probability || row.normalizedProbability || 0),
        status: "pending",
        result: "",
        actual_winner: "",
        created_at: createdAt,
        updated_at: createdAt,
        settled_at: "",
        finished_at: "",
      };
    });
}

function extractResults(feed) {
  const rows = [
    ...allFeedRows(feed),
    ...(feed?.trackingResults || []),
  ];
  return rows
    .filter(row => row.actualWinner || row.matchPhase === "final" || /cancel|postpon|בוטל|נדחה/i.test(String(row.status || row.bettingStatus || "")))
    .map(rawRow => {
      // Normalize Odds-API rows: they use lowercase/alternate field names
      // and store actualWinner inside markets[], not as a top-level field
      let actualWinner = rawRow.actualWinner;
      if (!actualWinner && rawRow.markets) {
        const mkt = rawRow.markets.find(m => /המנצח|winner|1X2/i.test(String(m.title || "")));
        if (mkt?.marketResults?.[0]) actualWinner = String(mkt.marketResults[0]);
      }
      // Score-based fallback for Odds-API rows
      if (!actualWinner && (rawRow.isFinal || Number(rawRow.statusGroup) === 4)) {
        const h = Number(rawRow.scoreA), a = Number(rawRow.scoreB);
        if (Number.isFinite(h) && Number.isFinite(a)) {
          const hn = rawRow.home || rawRow.teamA || "";
          const an = rawRow.away || rawRow.teamB || "";
          actualWinner = h === a ? "תיקו" : h > a ? hn : an;
        }
      }
      const row = {
        ...rawRow,
        actualWinner: actualWinner || rawRow.actualWinner || "",
        // Mark as final when Odds API says the game is done
        matchPhase: rawRow.matchPhase || (rawRow.isFinal || Number(rawRow.statusGroup) === 4 ? "final" : ""),
        sportId: rawRow.sportId ?? rawRow.sportid,
        eventId: rawRow.eventId || rawRow.eventid,
        day: rawRow.day || rawRow.tabDate || rawRow.date,
        home: rawRow.home || rawRow.teamA,
        away: rawRow.away || rawRow.teamB,
        match: rawRow.match || ((rawRow.home || rawRow.teamA) ? `${rawRow.home || rawRow.teamA} - ${rawRow.away || rawRow.teamB}` : ""),
        liveScore: rawRow.result || rawRow.liveScore || (rawRow.scoreA != null ? `${rawRow.scoreA}:${rawRow.scoreB}` : ""),
      };
      return {
        id: resultId(row),
        event_id: String(row.eventId || ""),
        result_key: row.resultKey || "",
        sport: Number(row.sportId) === 227 ? "basketball" : "football",
        sport_id: Number(row.sportId || 0),
        match_date: row.day || "",
        kickoff_time: row.time || "",
        league: row.league || "",
        home_team: row.home || "",
        away_team: row.away || "",
        match_name: row.match || `${row.home || ""} - ${row.away || ""}`,
        final_score: row.liveScore || "",
        actual_winner: row.actualWinner || "",
        result_status: resultStatus(row),
        source: row.source || "Winner/365Scores",
        verified_at: row.resultVerifiedAt || row.verifiedAt || feed.generatedAt || new Date().toISOString(),
        finished_at: row.finishedAt || "",
      };
    });
}

function resultStatus(row) {
  const raw = `${row.status || ""} ${row.bettingStatus || ""} ${row.matchPhase || ""}`.toLowerCase();
  if (/cancel|בוטל/.test(raw)) return "cancelled";
  if (/postpon|נדחה/.test(raw)) return "cancelled";
  if (row.matchPhase === "final" || row.actualWinner) return row.actualWinner ? "final" : "unknown";
  return "unknown";
}

function scoreParts(value) {
  const match = String(value || "").match(/(\d+)\D+(\d+)/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function sameSide(a, b) {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return false;
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

function matchResultFor(rec, results) {
  const exactEvent = results.find(result => result.event_id && rec.event_id && String(result.event_id) === String(rec.event_id));
  if (exactEvent) return exactEvent;
  const exactKey = results.find(result => result.result_key && rec.result_key && String(result.result_key) === String(rec.result_key));
  if (exactKey) return exactKey;
  return results
    .map(result => ({ result, score: resultMatchScore(rec, result) }))
    .filter(item => item.score >= 0.62)
    .sort((a, b) => b.score - a.score)[0]?.result || null;
}

function resultMatchScore(rec, result) {
  if (String(rec.sport_id) !== String(result.sport_id)) return 0;
  if (rec.match_date && result.match_date && rec.match_date !== result.match_date) return 0;
  let score = 0;
  if (sameSide(rec.home_team, result.home_team)) score += 0.34;
  if (sameSide(rec.away_team, result.away_team)) score += 0.34;
  if (sameSide(rec.league, result.league)) score += 0.12;
  if (rec.kickoff_time && result.kickoff_time && rec.kickoff_time.slice(0, 2) === result.kickoff_time.slice(0, 2)) score += 0.10;
  if (sameSide(rec.match_name, result.match_name)) score += 0.10;
  return score;
}

function settleStatus(rec, result) {
  if (!result) return { status: "pending" };
  if (result.result_status === "cancelled") return { status: "cancelled", actual: "", result: result.final_score || "" };
  if (result.result_status !== "final" || !result.actual_winner) return { status: "unknown", actual: "", result: result.final_score || "" };

  if (/יתרון|spread|handicap|ליין/i.test(String(rec.market))) {
    const score = scoreParts(result.final_score);
    const line = String(rec.algorithm_pick || "").match(/([+-]\d+(?:\.\d+)?)/);
    if (score && line) {
      const selectedHome = sameSide(rec.pick_team, rec.home_team) || sameSide(rec.algorithm_pick, rec.home_team);
      const selectedScore = selectedHome ? score.home : score.away;
      const otherScore = selectedHome ? score.away : score.home;
      const covered = selectedScore + Number(line[1]) > otherScore;
      return { status: covered ? "won" : "lost", actual: result.actual_winner, result: result.final_score || "" };
    }
    return { status: "unknown", actual: result.actual_winner, result: result.final_score || "" };
  }

  const won = sameSide(rec.pick_team || rec.algorithm_pick, result.actual_winner);
  return { status: won ? "won" : "lost", actual: result.actual_winner, result: result.final_score || "" };
}

// Helper: compute all stats for a slice of recommendations
function computeStats(recs) {
  const won = recs.filter(i => i.status === "won");
  const lost = recs.filter(i => i.status === "lost");
  const settled = won.length + lost.length;
  const settledRecs = [...won, ...lost];
  const profitIls = recs.reduce((sum, i) => {
    if (i.status === "won") return sum + (Number(i.odds_at_recommendation || 0) - 1) * ILS_STAKE;
    if (i.status === "lost") return sum - ILS_STAKE;
    return sum;
  }, 0);
  const totalStake = settled * ILS_STAKE;
  return {
    total: recs.length,
    won: won.length,
    lost: lost.length,
    pending: recs.filter(i => i.status === "pending").length,
    cancelled: recs.filter(i => i.status === "cancelled").length,
    unknown: recs.filter(i => i.status === "unknown").length,
    settled,
    // average_odds only from settled picks (won + lost), never pending
    average_odds: settledRecs.length
      ? Number((settledRecs.reduce((s, i) => s + Number(i.odds_at_recommendation || 0), 0) / settledRecs.length).toFixed(2))
      : 0,
    success_rate: settled ? Number(((won.length / settled) * 100).toFixed(1)) : 0,
    theoretical_profit_ils: Math.round(profitIls),
    // roi_percent = net_profit / total_stake × 100
    roi_percent: totalStake > 0 ? Number(((profitIls / totalStake) * 100).toFixed(1)) : 0,
  };
}

function buildDailyStats(recommendations, dateKey) {
  const items = recommendations.filter(item => item.match_date === dateKey);
  const stats = computeStats(items);
  return {
    stat_date: dateKey,
    total: stats.total,
    won: stats.won,
    lost: stats.lost,
    pending: stats.pending,
    cancelled: stats.cancelled,
    unknown: stats.unknown,
    settled: stats.settled,
    success_rate: stats.success_rate,
    average_odds: stats.average_odds,
    theoretical_profit_ils: stats.theoretical_profit_ils,
    roi_percent: stats.roi_percent,
    generated_at: new Date().toISOString(),
  };
}

async function runRecommendationBot(feed, { notify = false } = {}) {
  const db = await loadDb();
  const now = new Date().toISOString();
  const incomingRecommendations = extractRecommendations(feed);
  const existingById = new Map((db.recommendations || []).map(item => [item.id, item]));
  const recommendations = incomingRecommendations.map(row => {
    const previous = existingById.get(row.id);
    if (!previous) return row;
    return {
      ...previous,
      ...row,
      status: previous.status && previous.status !== "pending" ? previous.status : row.status,
      created_at: previous.created_at || row.created_at,
      updated_at: now,
    };
  });
  const match_results = extractResults(feed);
  let mergedRecommendations = upsertMany(db.recommendations, recommendations);
  const mergedResults = upsertMany(db.match_results, match_results);

  mergedRecommendations = mergedRecommendations.map(rec => {
    if (rec.status && !["pending", "unknown"].includes(rec.status)) return rec;
    const result = matchResultFor(rec, mergedResults);
    const settled = settleStatus(rec, result);
    if (settled.status === "pending") return rec;
    return {
      ...rec,
      status: settled.status,
      actual_winner: settled.actual || rec.actual_winner || "",
      result: settled.result || rec.result || "",
      settled_at: result?.verified_at || now,
      finished_at: result?.finished_at || "",
      updated_at: now,
    };
  });

  const dates = new Set([
    israelDate(-1),
    israelDate(0),
    ...mergedRecommendations.map(item => item.match_date).filter(Boolean),
  ]);
  const daily_stats = upsertMany(
    db.daily_stats,
    [...dates].map(dateKey => buildDailyStats(mergedRecommendations, dateKey)),
    "stat_date"
  ).sort((a, b) => String(b.stat_date).localeCompare(String(a.stat_date)));

  const saved = await saveDb({ recommendations: mergedRecommendations, match_results: mergedResults, daily_stats });
  const report = buildReport(mergedRecommendations, daily_stats.find(item => item.stat_date === israelDate(0)) || buildDailyStats(mergedRecommendations, israelDate(0)));
  return {
    ok: true,
    mode: saved.mode || db.mode,
    notifyReady: notify,
    savedRecommendations: incomingRecommendations.length,
    savedResults: match_results.length,
    recommendations: mergedRecommendations.length,
    results: mergedResults.length,
    dailyStats: daily_stats.slice(0, 45),
    report,
  };
}

function buildReport(recommendations, stats) {
  const rows = recommendations.filter(item => item.match_date === stats.stat_date);
  const line = label => rows
    .filter(item => item.status === label)
    .slice(0, 12)
    .map(item => `- ${item.match_name} — ניתוח: ${item.algorithm_pick} — תוצאה: ${item.result || "אין עדיין"}`);
  return [
    `סיכום יומי - ${stats.stat_date}`,
    `סה"כ המלצות: ${stats.total}`,
    `נתפסו: ${stats.won}`,
    `נפלו: ${stats.lost}`,
    `ממתינים: ${stats.pending}`,
    `אחוז הצלחה: ${stats.success_rate}%`,
    `יחס ממוצע: ${stats.average_odds}`,
    `ROI: ${stats.roi_percent >= 0 ? "+" : ""}${stats.roi_percent}%`,
    `רווח תאורטי לפי 100₪ למשחק: ${stats.theoretical_profit_ils >= 0 ? "+" : ""}${stats.theoretical_profit_ils}₪`,
    "",
    "משחקים שנתפסו:",
    ...(line("won").length ? line("won") : ["- אין"]),
    "",
    "משחקים שנפלו:",
    ...(line("lost").length ? line("lost") : ["- אין"]),
    "",
    "ממתינים:",
    ...(line("pending").length ? line("pending") : ["- אין"]),
  ].join("\n");
}

async function getRecommendationStats() {
  const db = await loadDb();
  const recommendations = db.recommendations || [];
  const today = israelDate(0);
  const yesterday = israelDate(-1);
  const weekAgo = israelDate(-7);
  const monthStart = today.slice(0, 7) + "-01";

  const dates = new Set([
    yesterday,
    today,
    ...recommendations.map(item => item.match_date).filter(Boolean),
  ]);
  const dailyStats = upsertMany(
    db.daily_stats || [],
    [...dates].map(dateKey => buildDailyStats(recommendations, dateKey)),
    "stat_date"
  ).sort((a, b) => String(b.stat_date).localeCompare(String(a.stat_date)));

  // All-time summary
  const summary = computeStats(recommendations);

  // Weekly: last 7 days
  const weekly = computeStats(recommendations.filter(i => i.match_date >= weekAgo));

  // Monthly: current calendar month
  const monthly = computeStats(recommendations.filter(i => i.match_date >= monthStart));

  // Sport breakdown
  const sports = [...new Set(recommendations.map(i => i.sport))].filter(Boolean);
  const by_sport = Object.fromEntries(
    sports.map(sport => [sport, computeStats(recommendations.filter(i => i.sport === sport))])
  );

  // League breakdown (top 15 by volume)
  const leagueMap = new Map();
  for (const item of recommendations) {
    const league = item.league || "אחר";
    if (!leagueMap.has(league)) leagueMap.set(league, []);
    leagueMap.get(league).push(item);
  }
  const by_league = Object.fromEntries(
    [...leagueMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 15)
      .map(([league, recs]) => [league, computeStats(recs)])
  );

  // Premium vs regular breakdown
  const by_type = {
    premium: computeStats(recommendations.filter(i => i.recommendation_type === "premium")),
    regular: computeStats(recommendations.filter(i => i.recommendation_type !== "premium")),
  };

  return {
    ok: true,
    mode: db.mode,
    today,
    yesterday,
    summary,
    weekly,
    monthly,
    by_sport,
    by_league,
    by_type,
    dailyStats,
    recommendations: recommendations.sort((a, b) => `${b.match_date} ${b.kickoff_time}`.localeCompare(`${a.match_date} ${a.kickoff_time}`)),
    results: db.match_results || [],
  };
}

module.exports = {
  buildDailyStats,
  computeStats,
  extractRecommendations,
  extractResults,
  getRecommendationStats,
  israelDate,
  runRecommendationBot,
};
