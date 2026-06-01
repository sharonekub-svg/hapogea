const { buildCachedWinnerFeedPayload } = require("./winner-feed");

function isAuthorized(req) {
  if (req.headers["x-vercel-cron"]) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const custom = req.headers["x-cron-secret"] || req.query?.secret || "";
  return bearer === expected || custom === expected;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized cron request" });
    return;
  }

  try {
    const payload = await buildCachedWinnerFeedPayload({ force: true });
    res.status(200).json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      generatedAt: payload.generatedAt,
      cache: payload.cache,
      lineStats: payload.lineStats,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Winner cron refresh failed",
      detail: error.message,
    });
  }
};
