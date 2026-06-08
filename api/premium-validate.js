const { rateLimit } = require("./_rate-limit");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

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
  if (!KV_URL || !KV_TOKEN) return;
  const url = exSeconds
    ? `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?ex=${exSeconds}`
    : `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  if (rateLimit(req, res, { max: 10, windowMs: 60_000, message: "יותר מדי ניסיונות. נסה שוב בעוד דקה." })) return;

  const code  = String((req.body || {}).code  || "").trim().toUpperCase();
  const email = String((req.body || {}).email || "").trim().toLowerCase();

  if (!code || code.length < 3) {
    return res.status(200).json({ ok: false, error: "קוד לא תקין" });
  }

  // Owner permanent code — never expires, never consumed
  if (code === "HIT") {
    return res.status(200).json({ ok: true, plan: "premium" });
  }

  // Fetch code from KV
  const kvValue = await kvGet(`premium:${code}`).catch(() => null);
  if (!kvValue) {
    return res.status(200).json({ ok: false, error: "קוד לא נמצא" });
  }

  let meta = {};
  try { meta = JSON.parse(kvValue); } catch { meta = {}; }

  if (meta.used) {
    return res.status(200).json({ ok: false, error: "קוד כבר נוצל" });
  }

  // Email check — if code was issued for a specific email, enforce it
  if (meta.email) {
    if (!email) {
      return res.status(200).json({ ok: false, error: "יש להתחבר עם האימייל שלך לפני שימוש בקוד זה" });
    }
    if (meta.email.toLowerCase() !== email) {
      return res.status(200).json({ ok: false, error: "הקוד מיועד לאימייל אחר" });
    }
  }

  // Mark code as used (keep record for 1 year)
  await kvSet(
    `premium:${code}`,
    JSON.stringify({ ...meta, used: true, usedAt: new Date().toISOString(), usedBy: email }),
    365 * 24 * 3600
  ).catch(() => {});

  // Use stored expiresAt if present (more accurate), else compute from days
  const expiresAt = meta.expiresAt
    ? Number(meta.expiresAt)
    : Date.now() + (meta.days || 30) * 24 * 3600 * 1000;

  return res.status(200).json({ ok: true, expiresAt, plan: meta.plan || "premium" });
};
