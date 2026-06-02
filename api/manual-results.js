// /api/manual-results
// Fetches a published Google Sheet CSV and returns structured result rows.
// Env var: RESULTS_SHEET_URL = "https://docs.google.com/spreadsheets/d/SHEET_ID/pub?output=csv"
//
// Expected sheet columns (row 1 = headers):
//   קבוצה ביתית | קבוצה חוץ | ספורט | סטטוס | תוצאה
//   home         | away       | sport  | status | score
//
// Status values: פגע  /  נפל  /  ממתין  /  נסגר

const cache = globalThis.__HAPOGEA_MR_CACHE__ || (globalThis.__HAPOGEA_MR_CACHE__ = { data: null, ts: 0 });
const TTL = 40_000; // 40 s

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += ch;
  }
  result.push(cur);
  return result.map(c => c.trim());
}

// Column aliases – accepts both Hebrew headers and English fallbacks
const COL_MAP = {
  home:   ["קבוצה ביתית","home","בית","קבוצה א","team a","team_a"],
  away:   ["קבוצה חוץ","away","חוץ","קבוצה ב","team b","team_b"],
  sport:  ["ספורט","sport","type"],
  status: ["סטטוס","status","result","תוצאה_סטטוס","פגע/נפל"],
  score:  ["תוצאה","score","scores","final"],
};

function findCol(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  const ci = {
    home:   findCol(headers, COL_MAP.home),
    away:   findCol(headers, COL_MAP.away),
    sport:  findCol(headers, COL_MAP.sport),
    status: findCol(headers, COL_MAP.status),
    score:  findCol(headers, COL_MAP.score),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = parseLine(line);
    const get = i => (i >= 0 ? cols[i] || "" : "");
    const home   = get(ci.home);
    const away   = get(ci.away);
    const status = get(ci.status).trim();
    if (!home && !away) continue;
    rows.push({
      home,
      away,
      sport:  get(ci.sport).trim().toLowerCase() || "football",
      status: status || "ממתין",
      score:  get(ci.score).trim(),
    });
  }
  return rows;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────
async function fetchSheet(url) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HapogeaBot/2.0", "Accept": "text/csv,text/plain,*/*" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseCSV(text);
  } finally {
    clearTimeout(tid);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const url = process.env.RESULTS_SHEET_URL;
  if (!url) {
    res.status(200).json({ ok: false, error: "RESULTS_SHEET_URL not configured", rows: [] });
    return;
  }

  // Serve cache if fresh
  if (cache.data && Date.now() - cache.ts < TTL) {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.setHeader("X-From-Cache", "1");
    res.status(200).json({ ok: true, rows: cache.data, ts: cache.ts });
    return;
  }

  try {
    const rows = await fetchSheet(url);
    cache.data = rows;
    cache.ts   = Date.now();
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(200).json({ ok: true, rows, ts: cache.ts });
  } catch (err) {
    // Return stale cache rather than fail
    if (cache.data) {
      res.setHeader("Cache-Control", "public, max-age=30");
      res.status(200).json({ ok: true, rows: cache.data, ts: cache.ts, stale: true });
    } else {
      res.status(200).json({ ok: false, error: err.message, rows: [] });
    }
  }
};
