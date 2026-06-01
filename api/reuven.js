const crypto = require("crypto");
const { rateLimit, sanitizeInput } = require("./_rate-limit");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const FOOTBALL_API_KEY = process.env.FOOTBALL_KEY;
const ODDS_API_KEY_EXT = process.env.ODDS_API_KEY;
const ODDS_API_EXT = "https://api.the-odds-api.com/v4";

// ── In-process AI response cache (prevents duplicate Claude calls) ────────────
// Keyed by SHA-256 of (query + winnerData). TTL: 4 minutes.
const _aiCache = new Map();
const AI_CACHE_TTL_MS = 4 * 60 * 1000;
function aiCacheKey(query, winnerSection) {
  return crypto.createHash("sha256").update(`${query}|${(winnerSection || "").slice(0, 500)}`).digest("hex").slice(0, 16);
}
function aiCacheGet(key) {
  const entry = _aiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _aiCache.delete(key); return null; }
  return entry.value;
}
function aiCacheSet(key, value) {
  if (_aiCache.size > 500) {
    const oldest = _aiCache.keys().next().value;
    _aiCache.delete(oldest);
  }
  _aiCache.set(key, { value, exp: Date.now() + AI_CACHE_TTL_MS });
}

// ── Winner API helpers ────────────────────────────────────────────────────────

function winnerHeaders(extra = {}) {
  return {
    "User-Agent": "Mozilla/5.0",
    Origin: "https://www.winner.co.il",
    Referer: "https://www.winner.co.il/",
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    RequestId: crypto.randomUUID(),
    DeviceId: crypto.randomUUID(),
    UserAgentData: JSON.stringify({
      devicemodel: "", deviceos: "windows", deviceosversion: "10",
      appversion: "2.6.1", apptype: "desktop", originId: 15, isAccessibility: false,
    }),
    appVersion: "2.6.1",
    ...extra,
  };
}

function cleanText(value) {
  return String(value || "").replace(/[‪-‮‌‎‏]/g, "").replace(/\s+/g, " ").trim();
}

function decimal(value) {
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(14000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getWinnerLine() {
  const hashMessage = JSON.stringify({ prevCurrentVersion: null, reason: "Initiated" });
  const hashes = await fetchJson("https://api.winner.co.il/v2/publicapi/GetCMobileHashes", {
    headers: winnerHeaders({ HashesMessage: hashMessage }),
  });
  const lineMessage = JSON.stringify({
    prevCurrentVersion: null, newCurrentVersion: hashes.currentVersion,
    lineNewHash: hashes.lineChecksum, reason: "Hashes not equal",
  });
  const line = await fetchJson(
    `https://api.winner.co.il/v2/publicapi/GetCMobileLine?lineChecksum=${encodeURIComponent(hashes.lineChecksum)}`,
    { headers: winnerHeaders({ HashesMessage: lineMessage }) }
  );
  return line.markets || [];
}

function winnerDateToIso(value) {
  const raw = String(value || "");
  if (raw.length !== 6) return "";
  return `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
}

function normalizeTeamName(name) {
  return cleanText(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\b(fc|bc|bk|club|women|cf)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatchScore(query, candidate) {
  const q = normalizeTeamName(query);
  const c = normalizeTeamName(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1;
  if (c.includes(q) || q.includes(c)) return 0.9;
  const qWords = q.split(" ").filter(w => w.length >= 3);
  const cWords = c.split(" ").filter(w => w.length >= 3);
  if (!qWords.length) return 0;
  const hits = qWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw)));
  return hits.length / Math.max(qWords.length, 1) * 0.8;
}

function findMatchInMarkets(markets, homeQuery, awayQuery, dateKey) {
  const seen = new Map();
  for (const m of markets) {
    const date = winnerDateToIso(m.e_date);
    if (dateKey && date !== dateKey) continue;
    const desc = cleanText(m.desc);
    const parts = desc.split(" - ");
    if (parts.length < 2) continue;
    const [homeRaw, awayRaw] = parts;
    const homeScore = homeQuery ? teamMatchScore(homeQuery, homeRaw) : 0.4;
    const awayScore = awayQuery ? teamMatchScore(awayQuery, awayRaw) : 0.4;
    const total = homeScore + awayScore;
    if (total < 0.5) continue;
    const eId = String(m.eId);
    const prev = seen.get(eId);
    if (!prev || total > prev.total) {
      seen.set(eId, { eId, date, desc, homeRaw, awayRaw, total, sportId: m.sId, league: cleanText(m.league), time: m.m_hour || "" });
    }
  }
  return [...seen.values()].sort((a, b) => b.total - a.total)[0] || null;
}

// Broader search: by competition keyword and/or date when no team names given
function findMatchesByContext(markets, { competition, rawCompetitionFallback, dateKey, isFinal }) {
  const seen = new Map();
  const compNorm = competition
    ? normalizeTeamName(competition)
    : rawCompetitionFallback
      ? normalizeTeamName(rawCompetitionFallback)
      : null;

  for (const m of markets) {
    const date = winnerDateToIso(m.e_date);
    const matchesDate = !dateKey || date === dateKey;
    const leagueNorm = normalizeTeamName(cleanText(m.league || ""));
    const descNorm = normalizeTeamName(cleanText(m.desc || ""));

    const matchesComp = !compNorm || compNorm.split(" ").some(w => w.length >= 3 && leagueNorm.includes(w));
    const matchesFinal = !isFinal || leagueNorm.includes("final") || descNorm.includes("final") ||
                         leagueNorm.includes("גמר") || descNorm.includes("גמר");

    if (matchesDate && matchesComp && (!isFinal || matchesFinal) && !seen.has(String(m.eId))) {
      const desc = cleanText(m.desc);
      const parts = desc.split(" - ");
      seen.set(String(m.eId), {
        eId: String(m.eId), date, desc,
        home: parts[0] || "", away: parts[1] || "",
        league: cleanText(m.league), time: m.m_hour || "",
        sportId: m.sId,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

// Brief summary of all matches for a date (schedule view)
function formatScheduleSummary(markets, dateKey) {
  const seen = new Map();
  for (const m of markets) {
    const date = winnerDateToIso(m.e_date);
    if (dateKey && date !== dateKey) continue;
    const eId = String(m.eId);
    if (!seen.has(eId)) {
      const desc = cleanText(m.desc);
      const league = cleanText(m.league);
      const time = m.m_hour || "";
      seen.set(eId, `${time} | ${league} | ${desc}`);
    }
  }
  return [...seen.values()].slice(0, 20);
}

function formatMarketsForPrompt(markets, eId) {
  const eventMarkets = markets.filter(m => String(m.eId) === String(eId));
  return eventMarkets.map(m => {
    const title = cleanText(m.mp);
    const outcomes = (m.outcomes || []).map(o => {
      const price = decimal(o.price);
      const implied = price ? `(${(100 / price).toFixed(1)}%)` : "";
      return `  ${cleanText(o.desc)}: ${price ? price.toFixed(2) : "N/A"} ${implied}`;
    }).join("\n");
    return `【${title}】\n${outcomes}`;
  }).slice(0, 12).join("\n\n");
}

// ── Hebrew → English team name translations ───────────────────────────────────

const HE_TO_EN = {
  "ריאל מדריד": "Real Madrid", "ברצלונה": "Barcelona", "אטלטיקו מדריד": "Atletico Madrid",
  "מנצ'סטר סיטי": "Manchester City", "מנצ'סטר יונייטד": "Manchester United",
  "ארסנל": "Arsenal", "צ'לסי": "Chelsea", "ליברפול": "Liverpool",
  "טוטנהאם": "Tottenham", "ניוקאסל": "Newcastle", "אסטון וילה": "Aston Villa",
  "פריז סן ז'רמן": "Paris Saint-Germain", "מארסיי": "Marseille", "ליון": "Lyon",
  "בייר לברקוזן": "Bayer Leverkusen", "בוורוסיה דורטמונד": "Borussia Dortmund",
  "בוורוסיה מ'גלדבך": "Borussia Mönchengladbach",
  "באיירן מינכן": "Bayern Munich", "ליפציג": "RB Leipzig", "פרנקפורט": "Eintracht Frankfurt",
  "אינטר מילאן": "Inter Milan", "מילאן": "AC Milan", "יובנטוס": "Juventus",
  "נאפולי": "Napoli", "רומא": "AS Roma", "פיורנטינה": "Fiorentina", "לאציו": "Lazio",
  "איי אקס": "Ajax", "פנרבחה": "Fenerbahce", "גלטסראי": "Galatasaray",
  "בנפיקה": "Benfica", "פורטו": "Porto", "ספורטינג": "Sporting CP",
  "סלטיק": "Celtic", "ריינג'רס": "Rangers",
  "מכבי תל אביב": "Maccabi Tel Aviv", "הפועל תל אביב": "Hapoel Tel Aviv",
  "מכבי חיפה": "Maccabi Haifa", "הפועל באר שבע": "Hapoel Beer Sheva",
  "בני יהודה": "Bnei Yehuda", "מכבי פתח תקווה": "Maccabi Petah Tikva",
  "לוס אנג'לס": "LA Galaxy", "אינטר מיאמי": "Inter Miami",
  "בוקה ג'וניורס": "Boca Juniors", "ריבר פלייט": "River Plate",
  "פלמנגו": "Flamengo", "פלמינסה": "Palmeiras",
  "ליון בסקטבול": "LDLC ASVEL", "מכבי תל אביב בסקטבול": "Maccabi Tel Aviv Basketball",
  "ריאל מדריד בסקטבול": "Real Madrid Basketball",
  "CSKA מוסקבה": "CSKA Moscow", "אלבה ברלין": "ALBA Berlin",
  // נבחרות לאומיות — מונדיאל 2026
  "ברזיל": "Brazil", "ארגנטינה": "Argentina", "צרפת": "France",
  "ספרד": "Spain", "אנגליה": "England", "גרמניה": "Germany",
  "פורטוגל": "Portugal", "הולנד": "Netherlands", "איטליה": "Italy",
  "בלגיה": "Belgium", "אורוגוואי": "Uruguay", "קולומביה": "Colombia",
  "מקסיקו": "Mexico", "ארצות הברית": "United States", "קנדה": "Canada",
  "מרוקו": "Morocco", "סנגל": "Senegal", "יפן": "Japan",
  "קוריאה הדרומית": "South Korea", "אוסטרליה": "Australia",
  "קרואטיה": "Croatia", "שוויץ": "Switzerland", "דנמרק": "Denmark",
  "שבדיה": "Sweden", "אוסטריה": "Austria", "פולין": "Poland",
  "סרביה": "Serbia", "אוקראינה": "Ukraine", "טורקיה": "Turkey",
  "יוון": "Greece", "סקוטלנד": "Scotland", "ישראל": "Israel",
  "אקוודור": "Ecuador", "צ'ילה": "Chile", "פרו": "Peru",
  "ניגריה": "Nigeria", "גאנה": "Ghana", "חוף השנהב": "Ivory Coast",
  "קמרון": "Cameroon", "מצרים": "Egypt", "ערב הסעודית": "Saudi Arabia",
  "קטר": "Qatar", "איראן": "Iran",
};

function translateTeamName(name) {
  if (!name) return name;
  const direct = HE_TO_EN[name.trim()];
  if (direct) return direct;
  // Partial match: if any key is contained in the name, use its translation
  for (const [he, en] of Object.entries(HE_TO_EN)) {
    if (name.includes(he)) return en;
  }
  return name;
}

// ── API-Football (api-sports.io) ──────────────────────────────────────────────

async function fetchApiFootballData(home, away) {
  if (!FOOTBALL_API_KEY) return null;
  try {
    const homeEn = translateTeamName(home);
    const awayEn = translateTeamName(away);
    const h = { "x-apisports-key": FOOTBALL_API_KEY };

    // Search both teams in parallel
    const [homeSearch, awaySearch] = await Promise.allSettled([
      fetch(`https://v3.football.api-sports.io/teams?search=${encodeURIComponent(homeEn.slice(0, 30))}`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null),
      fetch(`https://v3.football.api-sports.io/teams?search=${encodeURIComponent(awayEn.slice(0, 30))}`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null),
    ]);
    const homeId = homeSearch.status === "fulfilled" ? homeSearch.value?.response?.[0]?.team?.id : null;
    const awayId = awaySearch.status === "fulfilled" ? awaySearch.value?.response?.[0]?.team?.id : null;
    if (!homeId && !awayId) return null;

    // Fetch form (last 5 each) + H2H + injuries in parallel
    const [homeForm, awayForm, h2h, homeInj, awayInj] = await Promise.allSettled([
      homeId ? fetch(`https://v3.football.api-sports.io/fixtures?team=${homeId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      awayId ? fetch(`https://v3.football.api-sports.io/fixtures?team=${awayId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      (homeId && awayId) ? fetch(`https://v3.football.api-sports.io/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      homeId ? fetch(`https://v3.football.api-sports.io/injuries?team=${homeId}&season=2026`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      awayId ? fetch(`https://v3.football.api-sports.io/injuries?team=${awayId}&season=2026`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
    ]);

    const parts = [];

    function formLines(data, nameEn) {
      const games = (data?.response || []).slice(0, 5);
      if (!games.length) return "";
      const lines = games.map(f => {
        const gh = f.goals?.home ?? "?";
        const ga = f.goals?.away ?? "?";
        const fh = f.teams?.home?.name || "";
        const fa = f.teams?.away?.name || "";
        const d = (f.fixture?.date || "").slice(0, 10);
        const isHome = teamMatchScore(nameEn, fh) >= 0.5;
        const res = isHome
          ? (gh > ga ? "נצ'" : gh < ga ? "הפסד" : "תיקו")
          : (ga > gh ? "נצ'" : ga < gh ? "הפסד" : "תיקו");
        return `  ${d}: ${fh} ${gh}:${ga} ${fa} [${res}]`;
      });
      return `📊 ${nameEn} — פורמה (5 אחרונים):\n${lines.join("\n")}`;
    }

    const homeFormVal = homeForm.status === "fulfilled" ? homeForm.value : null;
    const awayFormVal = awayForm.status === "fulfilled" ? awayForm.value : null;
    const h2hVal = h2h.status === "fulfilled" ? h2h.value : null;
    const homeInjVal = homeInj.status === "fulfilled" ? homeInj.value : null;
    const awayInjVal = awayInj.status === "fulfilled" ? awayInj.value : null;

    if (homeFormVal) { const s = formLines(homeFormVal, homeEn); if (s) parts.push(s); }
    if (awayFormVal) { const s = formLines(awayFormVal, awayEn); if (s) parts.push(s); }

    const h2hGames = (h2hVal?.response || []).slice(0, 5);
    if (h2hGames.length > 0) {
      const h2hLines = h2hGames.map(f => {
        const gh = f.goals?.home ?? "?";
        const ga = f.goals?.away ?? "?";
        const fh = f.teams?.home?.name || "";
        const fa = f.teams?.away?.name || "";
        const d = (f.fixture?.date || "").slice(0, 10);
        return `  ${d}: ${fh} ${gh}:${ga} ${fa}`;
      });
      parts.push(`🔄 H2H (5 עימותים אחרונים):\n${h2hLines.join("\n")}`);
    }

    function injLines(data, nameEn) {
      const injured = (data?.response || []).filter(i =>
        /injur|פצוע/i.test(i.player?.type || "") || /injur/i.test(i.player?.reason || "")
      ).slice(0, 5);
      if (!injured.length) return "";
      const lines = injured.map(i => `  ${i.player?.name || "?"} — ${i.player?.reason || "פציעה"}`);
      return `🚑 פצועים — ${nameEn}:\n${lines.join("\n")}`;
    }

    if (homeInjVal) { const s = injLines(homeInjVal, homeEn); if (s) parts.push(s); }
    if (awayInjVal) { const s = injLines(awayInjVal, awayEn); if (s) parts.push(s); }

    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

// ── The Odds API (external odds when Winner is blocked) ───────────────────────

const ODDS_SPORT_MAP = {
  // בינלאומי
  "מונדיאל": "soccer_fifa_world_cup",
  "World Cup": "soccer_fifa_world_cup",
  "FIFA": "soccer_fifa_world_cup",
  "קופה אמריקה": "soccer_conmebol_copa_america",
  "ליגת האומות": "soccer_uefa_nations_league",
  "גביע אפריקה": "soccer_africa_cup_of_nations",
  "CONCACAF": "soccer_concacaf_nations_league",
  // אירופה
  "ליגת האלופות": "soccer_uefa_champs_league",
  "ליגה אירופאית": "soccer_uefa_europa_league",
  "קונפרנס": "soccer_uefa_europa_conference_league",
  "פרמייר ליג": "soccer_epl",
  "צ'מפיונשיפ": "soccer_england_championship",
  "בונדסליגה": "soccer_germany_bundesliga",
  "סריה א": "soccer_italy_serie_a",
  "ליג 1": "soccer_france_ligue_one",
  "לה ליגה": "soccer_spain_la_liga",
  "ארדיביזי": "soccer_netherlands_eredivisie",
  "סופר ליג טורקיה": "soccer_turkey_super_league",
  "פרמייר ליג סקוטלנד": "soccer_scotland_premiership",
  "פורטוגלית": "soccer_portugal_primeira_liga",
  "בלגית": "soccer_belgium_first_div",
  "שבדית": "soccer_sweden_allsvenskan",
  "נורבגית": "soccer_norway_eliteserien",
  "דנית": "soccer_denmark_superliga",
  "ליגת העל": "soccer_israel_premier_league",
  // אמריקה
  "MLS": "soccer_usa_mls",
  "ליגה MX": "soccer_mexico_ligamx",
  "ברזילאית": "soccer_brazil_campeonato",
  "ארגנטינאית": "soccer_argentina_primera_division",
  "קופה ליברטדורס": "soccer_conmebol_copa_libertadores",
  // כדורסל
  "NBA": "basketball_nba",
  "יורוליג": "basketball_euroleague",
  "NCAA": "basketball_ncaab",
};

const ODDS_FALLBACK_KEYS = [
  // מונדיאל ראשון — עדיפות גבוהה בספורינג 2026
  "soccer_fifa_world_cup",
  "soccer_conmebol_copa_america",
  "soccer_uefa_nations_league",
  // ליגות גדולות
  "soccer_uefa_champs_league",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_netherlands_eredivisie",
  "soccer_england_championship",
  "soccer_portugal_primeira_liga",
  "soccer_turkey_super_league",
  "soccer_israel_premier_league",
  "soccer_usa_mls",
  "soccer_brazil_campeonato",
  "soccer_conmebol_copa_libertadores",
  "basketball_nba",
  "basketball_euroleague",
];

async function fetchOddsApiData(home, away, competition) {
  if (!ODDS_API_KEY_EXT) return null;
  const homeEn = translateTeamName(home);
  const awayEn = translateTeamName(away);
  const mappedKey = competition ? ODDS_SPORT_MAP[competition] : null;
  // When no competition known, try all fallback keys (saves quota by stopping early)
  const keysToTry = mappedKey ? [mappedKey] : ODDS_FALLBACK_KEYS;

  for (const sportKey of keysToTry) {
    try {
      const url = `${ODDS_API_EXT}/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY_EXT}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const events = await res.json();

      for (const ev of (Array.isArray(events) ? events : [])) {
        const s1 = Math.max(
          teamMatchScore(homeEn, ev.home_team) + teamMatchScore(awayEn, ev.away_team),
          teamMatchScore(home, ev.home_team) + teamMatchScore(away, ev.away_team),
        );
        const s2 = Math.max(
          teamMatchScore(homeEn, ev.away_team) + teamMatchScore(awayEn, ev.home_team),
          teamMatchScore(home, ev.away_team) + teamMatchScore(away, ev.home_team),
        );
        if (Math.max(s1, s2) < 0.75) continue;

        const bookmaker = ev.bookmakers?.[0];
        if (!bookmaker) continue;
        const h2h = bookmaker.markets?.find(m => m.key === "h2h");
        if (!h2h?.outcomes?.length) continue;

        const outcomeLines = h2h.outcomes
          .map(o => `  ${o.name}: ${Number(o.price).toFixed(2)} (${(100 / o.price).toFixed(1)}%)`)
          .join("\n");
        const date = new Date(ev.commence_time).toLocaleDateString("he-IL");
        return `💰 The Odds API (${bookmaker.title}): ${ev.home_team} vs ${ev.away_team}\nתאריך: ${date}\nיחסים:\n${outcomeLines}`;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ── Competition keyword map ───────────────────────────────────────────────────

const COMPETITION_MAP = [
  { key: "ליגת האלופות", terms: ["ליגת האלופות", "champions league", "ucl", "champion league"] },
  { key: "ליגה אירופאית", terms: ["ליגה אירופאית", "europa league", "uel"] },
  { key: "קונפרנס", terms: ["קונפרנס", "conference league", "uecl"] },
  { key: "סופר קאפ", terms: ["סופר קאפ", "super cup", "supercup", "uefa super"] },
  { key: "ליגת האומות", terms: ["ליגת האומות", "ליגה לאומית", "nations league", "uefa nations", "nations"] },
  { key: "יורו", terms: ["יורו", "euro 20", "european championship", "uefa euro", "אליפות אירופה"] },
  { key: "מונדיאל", terms: ["מונדיאל", "world cup", "fifa world", "גביע העולם", "wc 20"] },
  { key: "קופה אמריקה", terms: ["קופה אמריקה", "copa america", "copa améri"] },
  { key: "גביע אפריקה", terms: ["גביע אפריקה", "africa cup", "afcon", "can 20", "cup of nations"] },
  { key: "אסיאן קאפ", terms: ["אסיאן קאפ", "asian cup", "afc asian cup"] },
  { key: "גולד קאפ", terms: ["גולד קאפ", "gold cup", "concacaf gold"] },
  { key: "פרמייר ליג", terms: ["פרמייר ליג", "premier league", "epl", "אנגלית ראשונה", "english premier"] },
  { key: "צ'מפיונשיפ", terms: ["צ'מפיונשיפ", "championship", "efl championship", "אנגלית שנייה"] },
  { key: "גביע FA", terms: ["גביע fa", "fa cup", "גביע אנגליה"] },
  { key: "ליג קאפ", terms: ["ליג קאפ", "league cup", "carabao cup", "efl cup"] },
  { key: "לה ליגה", terms: ["לה ליגה", "la liga", "laliga", "ספרדית ראשונה"] },
  { key: "סגונדה", terms: ["סגונדה", "segunda", "ספרדית שנייה"] },
  { key: "קופה דל ריי", terms: ["קופה דל ריי", "copa del rey", "גביע ספרד"] },
  { key: "בונדסליגה", terms: ["בונדסליגה", "bundesliga", "גרמנית ראשונה"] },
  { key: "בונדסליגה 2", terms: ["בונדסליגה 2", "2. bundesliga", "גרמנית שנייה"] },
  { key: "DFB פוקאל", terms: ["dfb pokal", "dfb-pokal", "גביע גרמניה"] },
  { key: "סריה א", terms: ["סריה א", "serie a", "serie-a", "איטלקית ראשונה"] },
  { key: "סריה ב", terms: ["סריה ב", "serie b", "איטלקית שנייה"] },
  { key: "קופה איטליה", terms: ["קופה איטליה", "coppa italia", "גביע איטליה"] },
  { key: "ליג 1", terms: ["ליג 1", "ligue 1", "ligue-1", "צרפתית ראשונה"] },
  { key: "ליג 2", terms: ["ליג 2", "ligue 2", "צרפתית שנייה"] },
  { key: "קופה דה פראנס", terms: ["קופה דה פראנס", "coupe de france", "גביע צרפת"] },
  { key: "פורטוגלית", terms: ["פורטוגלית", "primeira liga", "liga portugal", "פורטוגל"] },
  { key: "ארדיביזי", terms: ["ארדיביזי", "eredivisie", "הולנדית", "dutch eredivisie"] },
  { key: "בלגית", terms: ["בלגית", "jupiler pro", "belgian first", "בלגיה"] },
  { key: "סופר ליג טורקיה", terms: ["טורקית", "super lig", "süper lig", "turkish süper", "טורקיה"] },
  { key: "פרמייר ליג סקוטלנד", terms: ["סקוטית", "scottish premiership", "spfl", "סקוטלנד"] },
  { key: "סופר ליג יוון", terms: ["יוונית", "super league greece", "greek super", "יוון"] },
  { key: "שווייצרית", terms: ["שווייצרית", "swiss super league", "שווייץ"] },
  { key: "אוסטרית", terms: ["אוסטרית", "austrian bundesliga", "admiral bundesliga", "אוסטריה"] },
  { key: "שבדית", terms: ["שבדית", "allsvenskan", "שבדיה"] },
  { key: "נורבגית", terms: ["נורבגית", "eliteserien", "נורבגיה"] },
  { key: "דנית", terms: ["דנית", "danish superliga", "דנמרק"] },
  { key: "פינית", terms: ["פינית", "veikkausliiga", "פינלנד"] },
  { key: "רוסית", terms: ["רוסית", "russian premier", "רפל", "רוסיה"] },
  { key: "אוקראינית", terms: ["אוקראינית", "ukrainian premier", "ukraine"] },
  { key: "פולנית", terms: ["פולנית", "ekstraklasa", "פולין"] },
  { key: "ליגת העל", terms: ["ליגת העל", "israeli premier", "ישראלית ראשונה", "ליגה ראשונה ישראל"] },
  { key: "ליגה לאומית ישראל", terms: ["ליגה לאומית", "leumit", "ישראלית שנייה", "ליגה לאומית ישראל"] },
  { key: "גביע המדינה", terms: ["גביע המדינה", "state cup", "גביע ישראל", "גביע הטוטו"] },
  { key: "MLS", terms: ["mls", "major league soccer"] },
  { key: "ליגה MX", terms: ["ליגה mx", "liga mx", "מקסיקנית", "מקסיקו"] },
  { key: "ברזילאית", terms: ["ברזילאית", "brasileirao", "campeonato brasileiro", "ברזיל"] },
  { key: "ארגנטינאית", terms: ["ארגנטינאית", "liga profesional", "primera division argentina", "ארגנטינה"] },
  { key: "קופה ליברטדורס", terms: ["ליברטדורס", "copa libertadores", "libertadores"] },
  { key: "קופה סודאמריקאנה", terms: ["סודאמריקאנה", "copa sudamericana", "sudamericana"] },
  { key: "AFC ליגת האלופות", terms: ["afc champions", "ליגת האלופות afc", "asian champions"] },
  { key: "J-League", terms: ["j-league", "j league", "jleague", "יפנית"] },
  { key: "K-League", terms: ["k-league", "k league", "kleague", "קוריאנית"] },
  { key: "סינית", terms: ["סינית", "chinese super league", "csl", "סין"] },
  { key: "סאודית", terms: ["סאודית", "saudi pro league", "roshn", "ערב הסעודית"] },
  { key: "אמירויות", terms: ["אמירויות", "uae pro league", "emirates"] },
  { key: "קטרית", terms: ["קטרית", "qatar stars league", "קטר"] },
  { key: "NBA", terms: ["nba"] },
  { key: "יורוליג", terms: ["יורוליג", "euroleague", "euro league"] },
  { key: "יורוקאפ", terms: ["יורוקאפ", "eurocup"] },
  { key: "NCAA", terms: ["ncaa", "college basketball", "march madness"] },
  { key: "כדורסל ישראל", terms: ["כדורסל ישראל", "ליגת winner כדורסל", "winner league basketball"] },
  { key: "FIBA", terms: ["fiba", "אליפות עולם כדורסל", "basketball world cup"] },
];

// ── Query parser ─────────────────────────────────────────────────────────────

function parseQuery(text) {
  const vsPatterns = [
    /(.+?)\s+(?:נגד|vs\.?|against|v\.?)\s+(.+)/i,
    /(.+?)\s*[-–—]\s*(.+)/,
  ];
  let home = null, away = null;
  for (const pattern of vsPatterns) {
    const m = text.match(pattern);
    if (m) {
      home = m[1].replace(/\b(היום|מחר|אתמול|today|tomorrow|yesterday)\b/gi, "").trim();
      away = m[2].replace(/\b(היום|מחר|אתמול|today|tomorrow|yesterday)\b/gi, "").trim();
      if (home && away) break;
    }
  }

  const lc = text.toLowerCase();

  const hasDateWord = /היום|מחר|אתמול|today|tomorrow|yesterday/.test(lc);
  let offset = 0;
  let dateKey = null;
  if (hasDateWord) {
    if (/מחר|tomorrow/.test(lc)) offset = 1;
    else if (/אתמול|yesterday/.test(lc)) offset = -1;
    const d = new Date();
    d.setDate(d.getDate() + offset);
    dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(d);
  }

  let competition = null;
  for (const { key, terms } of COMPETITION_MAP) {
    if (terms.some(t => lc.includes(t))) { competition = key; break; }
  }
  const rawCompetitionFallback = !competition && !home && !away ? text : null;
  const isFinal = /גמר|final/.test(lc);

  return { home, away, dateKey, offset, competition, rawCompetitionFallback, isFinal, hasDateWord };
}

// ── Groq API call ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are HaPogea's senior sports analyst — an elite AI agent specializing in soccer, basketball, statistics, odds, and match intelligence.

You receive structured real-time data from Winner, The Odds API, API-Football (form + H2H + injuries). Use ALL provided data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY RESPONSE FORMAT — NO EXCEPTIONS
Every single analysis response MUST follow this exact structure. Skipping any section is failure.

**ניתוח:** [2-3 sentences. Cover: current form, H2H record, tactical edge. Cite actual stats from the data provided — goals scored, win streaks, key absences.]

**המלצה:** [Single clear pick. Name the team/outcome explicitly.]

**ביטחון:** [X% — one specific number. Never a range. Commit to it.]

**הנימוק:** [One sentence: WHY this pick, based on the data.]

---
**💬 מה אני באמת חושב:** [1-2 sentences. Honest. No hedging. No "depends". Your real verdict.]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## HOW TO USE THE DATA PROVIDED

### Odds (Winner / The Odds API)
- Always calculate implied probability: 1/odds × 100%
- If home odds = 1.75 → implied = 57.1% — cite this number
- Note overround (sum of implied > 100%) and what it means

### Form (API-Football last 5)
- Count wins/draws/losses from the data. State it: "4W-1D in last 5"
- If away form differs from home form, flag it

### H2H (head-to-head)
- Count who won more. State: "X won 3 of last 5 meetings"
- Note if the H2H pattern contradicts the current odds

### Injuries
- If injury data is provided, ALWAYS mention key absences in **ניתוח**
- State it clearly: "X missing [position], which weakens their [attack/defense]"
- If no injuries listed: assume squad is healthy

## WORLD CUP 2026 GUIDANCE
- World Cup 2026 starts June 11, 2026. Group stage runs through July.
- You have knowledge of all 48 qualified teams, their coaches, systems, and group dynamics.
- For WC analysis: cover group context (who needs the points), travel/climate factors, squad depth.
- If user asks about a WC match and no odds are provided, you STILL give a full analysis.

## BANNED BEHAVIORS
- "קשה לתת תחזית" — NEVER
- "לא מספיק נתונים" for any major team — NEVER
- Vague "it could go either way" conclusions — NEVER
- Repeating the same sentence — NEVER
- Naming individual players beyond what's in injury data — NEVER

## Language
Hebrew only. Fluent, direct, Israeli sports analyst voice. Short sentences. No filler.

## Odds present → use them
Calculate implied prob, note market edge, cite the number in your analysis.

## No odds → use knowledge
Note: "⚠️ ניתוח מבוסס ידע כללי — אין נתוני שוק בזמן אמת." Then give full analysis anyway.

## Follow-up messages
"מחר", "ומה עם הגמר?", "כן", "מה הסיכויים?" — treat as follow-up. Never ask "מי הקבוצות?" if already established.

## Betting rule
If asked "מה לשים" / "על מה להמר" — say: "אני לא נותן הוראות הימור. לפי הנתונים:" then give analysis.`;


function buildMessages(userMessage, conversationHistory) {
  const historyMsgs = conversationHistory.slice(-6)
    .map(h => ({ role: h.role === "user" ? "user" : "assistant", content: h.text || "" }))
    .filter(h => h.content.trim().length > 0);

  const dedupedHistory = historyMsgs.reduce((acc, msg) => {
    if (acc.length > 0 && acc[acc.length - 1].role === msg.role) {
      acc[acc.length - 1] = msg;
    } else {
      acc.push(msg);
    }
    return acc;
  }, []);

  // Anthropic requires messages to start with "user" role
  const withCurrent = [...dedupedHistory, { role: "user", content: userMessage }];
  const firstUserIdx = withCurrent.findIndex(m => m.role === "user");
  return firstUserIdx > 0 ? withCurrent.slice(firstUserIdx) : withCurrent;
}

async function callClaude(userMessage, conversationHistory) {
  if (!ANTHROPIC_API_KEY) {
    return "הפוגע AI לא מופעל — מפתח ANTHROPIC_API_KEY חסר. יש להגדיר אותו ב-Vercel environment variables.";
  }

  const body = {
    model: CLAUDE_MODEL,
    system: SYSTEM_PROMPT,
    messages: buildMessages(userMessage, conversationHistory),
    max_tokens: 2500,
    temperature: 0.65,
  };

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [3000, 6000, 12000];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text || "לא קיבלתי תגובה.";
    }

    if (res.status === 529 && attempt < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }

    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
  }
}

async function streamClaude(res, userMessage, conversationHistory) {
  if (!ANTHROPIC_API_KEY) {
    res.write("הפוגע AI לא מופעל — מפתח ANTHROPIC_API_KEY חסר. יש להגדיר אותו ב-Vercel environment variables.");
    res.end();
    return;
  }

  const body = {
    model: CLAUDE_MODEL,
    system: SYSTEM_PROMPT,
    messages: buildMessages(userMessage, conversationHistory),
    max_tokens: 2500,
    temperature: 0.65,
    stream: true,
  };

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const fallback = await callClaude(userMessage, conversationHistory).catch(e => `שגיאה טכנית: ${e.message}`);
    res.write(fallback);
    res.end();
    return;
  }

  if (!upstream.ok || !upstream.body || !upstream.body.getReader) {
    const fallback = await callClaude(userMessage, conversationHistory).catch(e => `שגיאה טכנית: ${e.message}`);
    res.write(fallback);
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wrote = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
            const token = json.delta.text;
            if (token) { res.write(token); wrote = true; }
          }
        } catch { /* ignore keep-alive / partial frames */ }
      }
    }
  } catch (err) {
    if (!wrote) res.write(`שגיאה טכנית: ${err.message}. אנא נסה שוב.`);
  }
  res.end();
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  if (rateLimit(req, res, { max: 10, windowMs: 60_000 })) return;

  const rawQuery = (req.body || {}).query;
  const rawHistory = Array.isArray((req.body || {}).history) ? (req.body || {}).history : [];
  const wantStream = (req.body || {}).stream === true;
  const query = sanitizeInput(rawQuery, 1000);
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }
  const history = rawHistory.slice(-6).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    text: sanitizeInput(m.text, 500),
  }));

  let winnerSection = "";
  let matchInfo = null;

  try {
    const { home, away, dateKey, offset, competition, rawCompetitionFallback, isFinal } = parseQuery(query);

    try {
      const markets = await getWinnerLine();
      const dateLabel = offset === 0 ? "היום" : offset === 1 ? "מחר" : "אתמול";

      let found = (home || away) ? findMatchInMarkets(markets, home, away, dateKey) : null;
      if (!found && (home || away)) found = findMatchInMarkets(markets, home, away, null);

      if (found) {
        matchInfo = { desc: found.desc, league: found.league, date: found.date };
        const formatted = formatMarketsForPrompt(markets, found.eId);
        const dl = found.date === dateKey ? dateLabel : found.date;
        winnerSection = `✅ נמצא ב-Winner: ${found.desc}\nליגה: ${found.league}\nתאריך: ${dl} (${found.date})\n\nשווקים ויחסים:\n${formatted}`;

      } else {
        const contextMatches = findMatchesByContext(markets, { competition, rawCompetitionFallback, dateKey, isFinal });

        if (contextMatches.length === 1) {
          const m = contextMatches[0];
          matchInfo = { desc: m.desc, league: m.league, date: m.date };
          const formatted = formatMarketsForPrompt(markets, m.eId);
          winnerSection = `✅ נמצא ב-Winner: ${m.desc}\nליגה: ${m.league}\nתאריך: ${m.date} ${m.time}\n\nשווקים ויחסים:\n${formatted}`;

        } else if (contextMatches.length > 1) {
          const lines = contextMatches.slice(0, 8).map(m => {
            const odds = formatMarketsForPrompt(markets, m.eId);
            return `📅 ${m.date} ${m.time} | ${m.league}\n⚽ ${m.desc}\n${odds}`;
          }).join("\n\n---\n\n");
          winnerSection = `נמצאו ${contextMatches.length} משחקים רלוונטיים ב-Winner:\n\n${lines}`;

        } else if (home || away) {
          winnerSection = `⚠️ לא מצאתי "${[home, away].filter(Boolean).join(" נגד ")}" ב-Winner. ייתכן שהמשחק עבר, נדחה, או שם הקבוצה שונה.`;

        } else {
          if (dateKey) {
            const schedule = formatScheduleSummary(markets, dateKey);
            winnerSection = schedule.length > 0
              ? `לוח משחקים ${dateLabel} (${dateKey}) ב-Winner:\n${schedule.join("\n")}`
              : `לא מצאתי משחקים ב-Winner ל-${dateLabel} (${dateKey}).`;
          } else {
            const allUpcoming = formatScheduleSummary(markets, null);
            winnerSection = allUpcoming.length > 0
              ? `משחקים קרובים ב-Winner:\n${allUpcoming.join("\n")}`
              : "לא מצאתי משחקים קרובים ב-Winner כרגע.";
          }
        }
      }
    } catch (winnerErr) {
      winnerSection = `⚠️ לא הצלחתי להתחבר ל-Winner (${winnerErr.message}).`;
    }

    // Always fetch stats + external odds in parallel (regardless of Winner status)
    // Stats enrich analysis even when Winner has odds — form, H2H, injuries are independent
    const [apifResult, oddsResult] = await Promise.allSettled([
      (home && away) ? fetchApiFootballData(home, away) : Promise.resolve(null),
      (home || away) ? fetchOddsApiData(home || "", away || "", competition) : Promise.resolve(null),
    ]);
    const statsSection = apifResult.status === "fulfilled" && apifResult.value ? apifResult.value : "";
    const externalOdds = oddsResult.status === "fulfilled" && oddsResult.value ? oddsResult.value : "";

    // Append external odds to winnerSection only when Winner has no data
    const winnerLackingOdds = !winnerSection || winnerSection.startsWith("⚠️") || winnerSection.startsWith("לא מצאתי");
    if (winnerLackingOdds && externalOdds) {
      winnerSection = (winnerSection ? winnerSection + "\n\n" : "") + externalOdds;
    }

    const hasLiveOdds = winnerSection && !winnerSection.startsWith("⚠️") && winnerSection.length > 30;
    const safeQuery = query.replace(/`/g, "'").replace(/\$\{/g, "\\${" );
    const dataInstruction = hasLiveOdds
      ? "יש יחסי שוק — חשב הסתברות גלומה (1/יחס) לכל תוצאה ונתח לפי הנתונים."
      : "אין יחסי שוק בזמן אמת — בצע ניתוח מעמיק לפי ידע כללי ונתוני הסטטיסטיקה שסופקו.";

    const sections = [
      `שאלת המשתמש: ${safeQuery}`,
      "",
      "══ יחסי שוק (Winner / Odds API) ══",
      winnerSection || "(אין נתוני שוק)",
    ];
    if (statsSection) {
      sections.push("", "══ סטטיסטיקות | פורמה | H2H | פציעות (API-Football) ══", statsSection);
    }
    sections.push("═══════════════════════════════════", "", `ענה בעברית. ${dataInstruction} אל תיתן הוראות הימור.`);
    const userMessage = sections.join("\n");

    // Non-streaming path: check cache first (streaming is always live)
    if (!wantStream) {
      const cacheKey = aiCacheKey(safeQuery, winnerSection);
      const cached = aiCacheGet(cacheKey);
      if (cached) {
        return res.status(200).json({ ok: true, answer: cached, matchInfo, cached: true });
      }
      const answer = await callClaude(userMessage, history);
      aiCacheSet(cacheKey, answer);
      return res.status(200).json({ ok: true, answer, matchInfo });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.status(200);
    await streamClaude(res, userMessage, history);
  } catch (err) {
    console.error("Reuven API error:", err);
    // If we've already started streaming bytes, we can only finish the stream.
    if (res.headersSent) { try { res.end(); } catch {} return; }

    const isQuota = /429|quota|rate.?limit/i.test(err.message);
    const quotaText = (() => {
      const hasWinnerData = winnerSection && !winnerSection.startsWith("⚠️") && winnerSection.length > 20;
      return hasWinnerData
        ? `ה-AI לא זמין כרגע (מכסה יומית מוצתה). הנה נתוני Winner ישירות:\n\n${winnerSection}`
        : `ה-AI לא זמין כרגע (מכסה יומית מוצתה). ${winnerSection || "נסה שוב מאוחר יותר."}`;
    })();
    const errText = isQuota ? quotaText : `שגיאה טכנית: ${err.message}. אנא נסה שוב.`;

    if (wantStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).end(errText);
      return;
    }
    res.status(200).json({ ok: false, answer: errText, matchInfo: isQuota ? matchInfo : null });
  }
};
