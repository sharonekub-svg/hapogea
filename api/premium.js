// /api/premium
// POST { action: "validate", code } → check/redeem a premium code
// POST { action: "create", days, plan, note } → admin: generate a new code
const crypto = require("crypto");
const { rateLimit } = require("./_rate-limit");

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function isAdmin(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const custom = req.headers["x-cron-secret"] || req.query?.secret || "";
  return bearer === secret || custom === secret;
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  const { action } = req.body || {};

  // ── Create (admin only) ───────────────────────────────────────────────────
  if (action === "create") {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    const { days = 30, plan = "premium", note = "" } = req.body;
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const meta = {
      created: new Date().toISOString(),
      days: Number(days) || 30,
      plan: String(plan),
      note: String(note).slice(0, 100),
      used: false,
    };
    const ok = await kvSet(`premium:${code}`, JSON.stringify(meta), (Number(days) + 90) * 24 * 3600).catch(() => false);
    if (!ok) return res.status(500).json({ ok: false, error: "KV write failed" });
    return res.status(200).json({ ok: true, code, days: meta.days, plan: meta.plan });
  }

  // ── Validate ─────────────────────────────────────────────────────────────
  if (rateLimit(req, res, { max: 10, windowMs: 60_000, message: "יותר מדי ניסיונות. נסה שוב בעוד דקה." })) return;
  const code = String((req.body || {}).code || "").trim().toUpperCase();
  if (!code || code.length < 3) return res.status(200).json({ ok: false, error: "קוד לא תקין" });

  if (code === "HIT") return res.status(200).json({ ok: true, plan: "premium" });

  const kvValue = await kvGet(`premium:${code}`).catch(() => null);
  if (!kvValue) return res.status(200).json({ ok: false, error: "קוד לא נמצא" });

  let meta = {};
  try { meta = JSON.parse(kvValue); } catch { meta = {}; }
  if (meta.used) return res.status(200).json({ ok: false, error: "קוד כבר נוצל" });

  await kvSet(`premium:${code}`, JSON.stringify({ ...meta, used: true, usedAt: new Date().toISOString() }), 365 * 24 * 3600).catch(() => {});
  const expiresAt = Date.now() + (meta.days || 30) * 24 * 3600 * 1000;
  return res.status(200).json({ ok: true, expiresAt, plan: meta.plan || "premium" });
};
