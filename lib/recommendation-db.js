const crypto = require("crypto");

const STORE_KEY = "recommendation-bot:v1";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jgcmtrlviuivbtimtqjq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const memoryStore = globalThis.__RECOMMENDATION_BOT_STORE__ || (globalThis.__RECOMMENDATION_BOT_STORE__ = {
  recommendations: [],
  match_results: [],
  daily_stats: [],
});

function hashId(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 32);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 260)}`);
  return text ? JSON.parse(text) : null;
}

async function kvGet(key) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const data = await fetchJson(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    }).catch(() => null);
    if (data?.result) {
      try {
        return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function kvSet(key, value) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    await fetchJson(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    }).catch(() => null);
  }
}

function emptyDb() {
  return { recommendations: [], match_results: [], daily_stats: [] };
}

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseSelect(table) {
  const data = await fetchJson(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  return Array.isArray(data) ? data : [];
}

async function supabaseUpsert(table, rows, conflictKey = "id") {
  if (!rows.length) return;
  await fetchJson(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictKey}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
}

async function loadDb() {
  if (supabaseEnabled()) {
    try {
      const [recommendations, match_results, daily_stats] = await Promise.all([
        supabaseSelect("recommendations"),
        supabaseSelect("match_results"),
        supabaseSelect("daily_stats"),
      ]);
      return { mode: "supabase", recommendations, match_results, daily_stats };
    } catch (error) {
      // Tables may not exist yet. Fall back to KV/memory and expose mode to UI.
    }
  }
  const kv = await kvGet(STORE_KEY);
  if (kv?.recommendations) return { mode: "kv", ...kv };
  return { mode: process.env.KV_REST_API_URL ? "kv-empty" : "memory", ...memoryStore };
}

async function saveDb(db) {
  const clean = {
    recommendations: db.recommendations || [],
    match_results: db.match_results || [],
    daily_stats: db.daily_stats || [],
  };
  memoryStore.recommendations = clean.recommendations;
  memoryStore.match_results = clean.match_results;
  memoryStore.daily_stats = clean.daily_stats;
  if (supabaseEnabled()) {
    try {
      await Promise.all([
        supabaseUpsert("recommendations", clean.recommendations),
        supabaseUpsert("match_results", clean.match_results),
        supabaseUpsert("daily_stats", clean.daily_stats, "stat_date"),
      ]);
      return { mode: "supabase" };
    } catch (error) {
      // Keep KV fallback when Supabase tables/env are not ready.
    }
  }
  await kvSet(STORE_KEY, clean);
  return { mode: process.env.KV_REST_API_URL ? "kv" : "memory" };
}

function upsertMany(existing, rows, key = "id") {
  const byKey = new Map((existing || []).map(item => [String(item[key]), item]));
  for (const row of rows || []) {
    const id = String(row[key] || "");
    if (!id) continue;
    byKey.set(id, { ...(byKey.get(id) || {}), ...row });
  }
  return [...byKey.values()];
}

module.exports = {
  emptyDb,
  hashId,
  loadDb,
  saveDb,
  upsertMany,
};
