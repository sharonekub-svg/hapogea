const crypto = require("crypto");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// World Cup 2026 final: July 19, 2026
const WORLDCUP_END_MS = new Date("2026-07-20T00:00:00Z").getTime();

const PLAN_DAYS = {
  weekly:   7,
  monthly:  30,
  worldcup: () => Math.max(1, Math.ceil((WORLDCUP_END_MS - Date.now()) / 86400000)),
};

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const {
    email = "",
    plan  = "monthly",
    note  = "",
    code: customCode = "",
  } = req.body || {};

  // Resolve days for plan
  let days;
  if (PLAN_DAYS[plan]) {
    days = typeof PLAN_DAYS[plan] === "function" ? PLAN_DAYS[plan]() : PLAN_DAYS[plan];
  } else {
    days = Number(plan) || 30; // allow raw number as fallback
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const code = customCode
    ? String(customCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    : crypto.randomBytes(4).toString("hex").toUpperCase();

  if (!code) {
    return res.status(400).json({ ok: false, error: "Invalid code" });
  }

  const expiresAt = Date.now() + days * 24 * 3600 * 1000;
  const meta = {
    created:   new Date().toISOString(),
    days,
    plan:      String(plan),
    email:     normalizedEmail,
    note:      String(note).slice(0, 200),
    expiresAt,
    used:      false,
  };

  const ok = await kvSet(`premium:${code}`, JSON.stringify(meta), (days + 90) * 24 * 3600).catch(() => false);
  if (!ok) {
    return res.status(500).json({ ok: false, error: "KV write failed — check KV env vars" });
  }

  return res.status(200).json({
    ok: true,
    code,
    days,
    plan: meta.plan,
    email: normalizedEmail || null,
    expiresAt: new Date(expiresAt).toISOString(),
  });
};
