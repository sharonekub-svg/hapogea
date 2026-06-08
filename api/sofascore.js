// Sofascore unofficial API proxy — live + today's scheduled events
// Used for live scores display only. Cached 60s to minimize requests.

const SF_BASE = "https://api.sofascore.com/api/v1";
const SF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.sofascore.com/",
  "Origin": "https://www.sofascore.com",
  "Cache-Control": "no-cache",
};

// Simple in-memory cache
const _cache = new Map();
const CACHE_TTL = 60_000; // 60 seconds

async function sfFetch(path) {
  const cached = _cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
  const res = await fetch(`${SF_BASE}${path}`, {
    headers: SF_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Sofascore ${res.status} for ${path}`);
  const data = await res.json();
  _cache.set(path, { data, at: Date.now() });
  return data;
}

// Status code → Hebrew label
function statusLabel(code) {
  if (code === 0)   return "טרם התחיל";
  if (code === 6)   return "מחצית ראשונה";
  if (code === 7)   return "הפסקה";
  if (code === 8)   return "מחצית שנייה";
  if (code === 9)   return "הארכה";
  if (code === 10)  return "הפסקת הארכה";
  if (code === 11)  return "פנדלים";
  if (code === 100) return "נגמר";
  if (code === 31)  return "נדחה";
  if (code === 41)  return "בוטל";
  if (code === 70)  return "לא התקיים";
  return "לא ידוע";
}

function isLive(code) {
  return [6, 7, 8, 9, 10, 11].includes(code);
}

function mapEvent(ev, sport) {
  const sc = ev.status?.code ?? 0;
  const hs = ev.homeScore?.current ?? null;
  const as = ev.awayScore?.current ?? null;
  const minute = ev.status?.currentPeriodStartTimestamp
    ? Math.floor((Date.now() / 1000 - ev.status.currentPeriodStartTimestamp) / 60)
    : null;
  const halfOffset = sc === 8 ? 45 : sc === 9 ? 90 : 0;
  const displayMinute = minute !== null && isLive(sc) ? Math.min(halfOffset + minute, sc === 9 ? 120 : sc === 8 ? 90 : 45) : null;
  return {
    id: ev.id,
    sport,
    league: ev.tournament?.name || "",
    country: ev.tournament?.category?.country?.name || "",
    home: ev.homeTeam?.name || "",
    away: ev.awayTeam?.name || "",
    homeShort: ev.homeTeam?.shortName || "",
    awayShort: ev.awayTeam?.shortName || "",
    homeId: ev.homeTeam?.id,
    awayId: ev.awayTeam?.id,
    homeScore: hs,
    awayScore: as,
    score: hs !== null && as !== null ? `${hs}:${as}` : null,
    statusCode: sc,
    statusLabel: statusLabel(sc),
    live: isLive(sc),
    finished: sc === 100,
    startTs: ev.startTimestamp || null,
    minute: displayMinute,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=55, stale-while-revalidate=120");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const sport = req.query.sport || "football"; // football | basketball

  // Use Israel date (UTC+3)
  const now = new Date();
  const israelOffset = 3 * 60;
  const israelNow = new Date(now.getTime() + israelOffset * 60000);
  const today = israelNow.toISOString().slice(0, 10);

  try {
    const [liveData, todayData] = await Promise.all([
      sfFetch(`/sport/${sport}/events/live`).catch(() => ({ events: [] })),
      sfFetch(`/sport/${sport}/scheduled-events/${today}`).catch(() => ({ events: [] })),
    ]);

    const liveEvents = (liveData.events || []).map(ev => mapEvent(ev, sport));
    const liveIds = new Set(liveEvents.map(e => e.id));

    const scheduledEvents = (todayData.events || [])
      .map(ev => mapEvent(ev, sport))
      .filter(ev => !liveIds.has(ev.id));

    // All events: live first, then scheduled (upcoming + finished)
    const all = [
      ...liveEvents,
      ...scheduledEvents,
    ].sort((a, b) => {
      // live first
      if (a.live && !b.live) return -1;
      if (!a.live && b.live) return 1;
      // then by start time
      return (a.startTs || 0) - (b.startTs || 0);
    });

    return res.status(200).json({
      ok: true,
      sport,
      date: today,
      live: liveEvents.length,
      total: all.length,
      events: all,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.message,
      events: [],
    });
  }
};
