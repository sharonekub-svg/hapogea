const { buildCachedWinnerFeedPayload } = require("./winner-feed");
const { getRecommendationStats, runRecommendationBot } = require("../lib/recommendation-tracker");
const { rateLimit } = require("./_rate-limit");

function isAuthorized(req) {
  if (req.headers["x-vercel-cron"]) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const custom = req.headers["x-cron-secret"] || req.query?.secret || "";
  return bearer === expected || custom === expected;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
  // 20 read requests per IP per minute
  if (rateLimit(req, res, { max: 20, windowMs: 60_000 })) return;

  const wantsRefresh = String(req.query?.refresh || "").toLowerCase() === "1";
  // Refresh trigger is expensive — require CRON_SECRET
  if (wantsRefresh && !isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized: ?refresh=1 requires CRON_SECRET" });
    return;
  }

  try {
    let stats = await getRecommendationStats();
    const shouldSeed = wantsRefresh || Number(stats.summary?.total || 0) === 0;
    if (shouldSeed) {
      const feed = await buildCachedWinnerFeedPayload({ force: false });
      await runRecommendationBot(feed);
      stats = await getRecommendationStats();
    }
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Daily recommendation stats unavailable",
      detail: error.message,
    });
  }
};
