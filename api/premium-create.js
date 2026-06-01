const crypto = require("crypto");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function isAdmin(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const custom = req.headers["x-cron-secret"] || req.query?.secret || "";
  return bearer === secret || custom === secret;
}

async function kvSet(key, value, exSeconds) {
  if (!KV_URL || !KV_TOKEN) return false;
  const url = exSeconds
    ? `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?ex=${exSeconds}`
    : `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  return res.ok;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const { days = 30, plan = "premium", note = "" } = req.body || {};
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const meta = {
    created: new Date().toISOString(),
    days: Number(days) || 30,
    plan: String(plan),
    note: String(note).slice(0, 100),
    used: false,
  };

  const ok = await kvSet(`premium:${code}`, JSON.stringify(meta), (Number(days) + 90) * 24 * 3600).catch(() => false);
  if (!ok) {
    return res.status(500).json({ ok: false, error: "KV write failed — check KV env vars" });
  }

  return res.status(200).json({ ok: true, code, days: meta.days, plan: meta.plan });
};
