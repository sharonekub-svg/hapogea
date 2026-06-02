// /api/manual-results
// Reads a published Google Sheet CSV and returns structured result rows.
// Env var: RESULTS_SHEET_URL = published CSV URL from Google Sheets
//
// Sheet columns (row 1 = headers):
//   קבוצה ביתית | קבוצה חוץ | ספורט | הימור | סטטוס (V/X/blank) | תוצאה

const cache = globalThis.__HAPOGEA_MR_CACHE__ || (globalThis.__HAPOGEA_MR_CACHE__ = { data: null, ts: 0 });
const TTL = 45_000;

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

const COL_MAP = {
  home:   ["קבוצה ביתית","home","בית","team a","team_a"],
  away:   ["קבוצה חוץ","away","חוץ","team b","team_b"],
  sport:  ["ספורט","sport","type"],
  pick:   ["הימור","pick","prediction","המלצה"],
  status: ["סטטוס","status","פגע","result","v"],
  score:  ["תוצאה","score","final"],
};

function findCol(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// Normalize V/X/✓/✗ shorthand to Hebrew statuses
function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "ממתין";
  if (s === "v" || s === "✓" || s === "כן" || s === "פגע" || s === "1") return "פגע";
  if (s === "x" || s === "✗" || s === "לא" || s === "נפל" || s === "0") return "נפל";
  if (s === "נסגר" || s === "closed" || s === "lock") return "נסגר";
  return "ממתין";
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  const ci = {
    home:   findCol(headers, COL_MAP.home),
    away:   findCol(headers, COL_MAP.away),
    sport:  findCol(headers, COL_MAP.sport),
    pick:   findCol(headers, COL_MAP.pick),
    status: findCol(headers, COL_MAP.status),
    score:  findCol(headers, COL_MAP.score),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = parseLine(line);
    const get = i => (i >= 0 ? cols[i] || "" : "");
    const home = get(ci.home);
    const away = get(ci.away);
    if (!home && !away) continue;
    rows.push({
      home,
      away,
      sport:  get(ci.sport).trim().toLowerCase() || "football",
      pick:   get(ci.pick).trim(),
      status: normalizeStatus(get(ci.status)),
      score:  get(ci.score).trim(),
    });
  }
  return rows;
}

async function fetchSheet(url) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HapogeaBot/3.0", "Accept": "text/csv,text/plain,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCSV(await res.text());
  } finally {
    clearTimeout(tid);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const url = process.env.RESULTS_SHEET_URL;
  if (!url) {
    res.status(200).json({ ok: false, error: "RESULTS_SHEET_URL not configured", rows: [] });
    return;
  }

  if (cache.data && Date.now() - cache.ts < TTL) {
    res.setHeader("X-From-Cache", "1");
    res.status(200).json({ ok: true, rows: cache.data, ts: cache.ts });
    return;
  }

  try {
    const rows = await fetchSheet(url);
    cache.data = rows;
    cache.ts   = Date.now();
    res.status(200).json({ ok: true, rows, ts: cache.ts });
  } catch (err) {
    if (cache.data) {
      res.status(200).json({ ok: true, rows: cache.data, ts: cache.ts, stale: true });
    } else {
      res.status(200).json({ ok: false, error: err.message, rows: [] });
    }
  }
};
