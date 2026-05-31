const crypto = require("crypto");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN_ENV = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.CRON_SECRET || process.env.PREMIUM_SECRET || "";

// ── KV helpers ────────────────────────────────────────────────────────────────

async function kvGetJson(key) {
  if (!KV_URL || !KV_TOKEN_ENV) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN_ENV}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => null);
    if (!data?.result) return null;
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  } catch { return null; }
}

async function kvSetJson(key, value, exSeconds) {
  if (!KV_URL || !KV_TOKEN_ENV) return;
  const url = exSeconds
    ? `${KV_URL}/set/${encodeURIComponent(key)}?ex=${exSeconds}`
    : `${KV_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN_ENV}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(18).toString("hex"); // 36-char hex string
}

function isAdminAuthed(req) {
  if (!ADMIN_SECRET) return false; // require secret to be set
  const secret = req.query?.secret || req.body?.secret || "";
  const bearer = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return secret === ADMIN_SECRET || bearer === ADMIN_SECRET;
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const action = req.query?.action || req.body?.action || "";

  // ── CREATE — admin only ───────────────────────────────────────────────────
  if (action === "create") {
    if (!isAdminAuthed(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const email = String(req.query?.email || req.body?.email || "unknown").slice(0, 200);
    const messagesMax = parseInt(req.query?.max || req.body?.max || "100", 10);
    const token = generateToken();
    const now = new Date().toISOString();
    const weekStart = now.slice(0, 10); // YYYY-MM-DD

    const tokenData = {
      token,
      email,
      createdAt: now,
      weekStart,
      messagesUsed: 0,
      messagesMax: Math.min(Math.max(messagesMax, 1), 500),
      active: true,
    };

    await kvSetJson(`premium:${token}`, tokenData, 9 * 86400); // 9-day TTL (7-day valid + 2-day grace)

    return res.status(200).json({
      ok: true,
      token,
      email,
      weekStart,
      messagesMax: tokenData.messagesMax,
      expiresAt: new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString(),
    });
  }

  // ── CHECK — public (used by frontend to verify token) ─────────────────────
  if (action === "check") {
    const token = String(req.query?.token || req.body?.token || "").slice(0, 128);
    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

    const data = await kvGetJson(`premium:${token}`);
    if (!data || !data.active) {
      return res.status(200).json({ ok: false, error: "Token not found or inactive" });
    }

    const weekStartDate = new Date(data.weekStart);
    const daysSince = (Date.now() - weekStartDate.getTime()) / 86400000;

    if (daysSince > 7) {
      return res.status(200).json({ ok: false, expired: true, error: "Token expired" });
    }

    const remaining = Math.max(0, data.messagesMax - data.messagesUsed);
    const expiresAt = new Date(weekStartDate.getTime() + 7 * 86400000).toISOString();

    return res.status(200).json({
      ok: true,
      remaining,
      messagesUsed: data.messagesUsed,
      messagesMax: data.messagesMax,
      expiresAt,
      weekStart: data.weekStart,
    });
  }

  // ── DEACTIVATE — admin only ───────────────────────────────────────────────
  if (action === "deactivate") {
    if (!isAdminAuthed(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const token = String(req.query?.token || req.body?.token || "").slice(0, 128);
    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

    const data = await kvGetJson(`premium:${token}`);
    if (!data) return res.status(404).json({ ok: false, error: "Token not found" });

    data.active = false;
    data.deactivatedAt = new Date().toISOString();
    await kvSetJson(`premium:${token}`, data, 86400); // keep for 1 day for audit

    return res.status(200).json({ ok: true, token, deactivated: true });
  }

  return res.status(400).json({ ok: false, error: "Unknown action. Use: create, check, deactivate" });
};
