const { buildCachedWinnerFeedPayload, getOddsApiScores } = require("./winner-feed");
const { runRecommendationBot } = require("../lib/recommendation-tracker");

function isAuthorized(req) {
  if (req.headers["x-vercel-cron"]) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const custom = req.headers["x-cron-secret"] || req.query?.secret || "";
  return bearer === expected || custom === expected;
}

async function sendDailyNotification(report) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
  if (telegramToken && telegramChatId) {
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text: report }),
    }).catch(() => null);
  }

  const webhookUrl = process.env.DAILY_STATS_WEBHOOK_URL || "";
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: report, generatedAt: new Date().toISOString() }),
    }).catch(() => null);
  }
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized recommendation bot request" });
    return;
  }

  try {
    const force = String(req.query?.force || "").toLowerCase() === "1";
    const notify = String(req.query?.notify || "").toLowerCase() === "1";
    const [feed, oddsApiScores] = await Promise.all([
      buildCachedWinnerFeedPayload({ force }),
      getOddsApiScores().catch(() => []),
    ]);
    // Enrich trackingResults with Odds API scores so pending picks can be settled
    // even when 365Scores or Winner results API are unavailable
    if (oddsApiScores.length > 0) {
      feed.trackingResults = [...(feed.trackingResults || []), ...oddsApiScores];
    }
    const result = await runRecommendationBot(feed, { notify });
    if (notify && result.report) await sendDailyNotification(result.report);
    res.status(200).json({
      ...result,
      feedGeneratedAt: feed.generatedAt,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Recommendation bot failed",
      detail: error.message,
    });
  }
};
