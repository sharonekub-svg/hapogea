const crypto = require("crypto");
const { rateLimit, sanitizeInput } = require("./_rate-limit");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-4-6";

const FOOTBALL_API_KEY = process.env.FOOTBALL_KEY;
const ODDS_API_KEY_EXT = process.env.ODDS_API_KEY;
const ODDS_API_EXT = "https://api.the-odds-api.com/v4";

// ── Shared AI response cache (Supabase → fallback to in-process Map) ──────────
const SB_URL  = process.env.SUPABASE_URL || "https://jgcmtrlviuivbtimtqjq.supabase.co";
const SB_KEY  = process.env.SUPABASE_ANON_KEY || "";
const SB_TTL_MIN = 30; // minutes

// In-memory fallback
const _aiCache = new Map();
const AI_CACHE_TTL_MS = SB_TTL_MIN * 60 * 1000;

function aiCacheKey(query) {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

async function aiCacheGet(key) {
  if (SB_URL && SB_KEY) {
    try {
      const now = new Date().toISOString();
      const r = await fetch(
        `${SB_URL}/rest/v1/ai_cache?key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(now)}&select=value&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(2000) }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0]?.value) return rows[0].value;
      }
    } catch (_) {}
  }
  const entry = _aiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _aiCache.delete(key); return null; }
  return entry.value;
}

async function aiCacheSet(key, value) {
  if (SB_URL && SB_KEY) {
    const expiresAt = new Date(Date.now() + AI_CACHE_TTL_MS).toISOString();
    fetch(`${SB_URL}/rest/v1/ai_cache`, {
      method: "POST",
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key, value, expires_at: expiresAt }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
  if (_aiCache.size > 500) { _aiCache.delete(_aiCache.keys().next().value); }
  _aiCache.set(key, { value, exp: Date.now() + AI_CACHE_TTL_MS });
}

// ── Text helpers ───────────────────────────────────────────────────────────────
function cleanText(value) {
  return String(value || "").replace(/[‪-‮‌‎‏]/g, "").replace(/\s+/g, " ").trim();
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
  "הפועל ירושלים": "Hapoel Jerusalem", "בית\"ר ירושלים": "Beitar Jerusalem",
  "מכבי ירושלים": "Maccabi Jerusalem", "הפועל חיפה": "Hapoel Haifa",
  "הפועל רמת גן": "Hapoel Ramat Gan", "הפועל כפר שמריהו": "Hapoel Kfar Shmaryahu",
  "מכבי נתניה": "Maccabi Netanya", "הפועל נתניה": "Hapoel Netanya",
  "הפועל עכו": "Hapoel Acre", "הפועל קטמון": "Hapoel Katamon",
  "מכבי פתח תקווה": "Maccabi Petah Tikva", "הפועל פתח תקווה": "Hapoel Petah Tikva",
  "בני יהודה": "Bnei Yehuda", "עירוני קריית שמונה": "Ironi Kiryat Shmona",
  "עירוני נתניה": "Ironi Netanya", "עירוני טבריה": "Ironi Tiberias",
  "שמשון תל אביב": "Shimshon Tel Aviv", "אסא תל אביב": "Asa Tel Aviv",
  "הפועל רחובות": "Hapoel Rehovot", "הפועל כפר סבא": "Hapoel Kfar Saba",
  "מכבי כפר קנא": "Maccabi Kafr Kanna", "הפועל נוף הגליל": "Hapoel Nof HaGalil",
  "לוס אנג'לס": "LA Galaxy", "אינטר מיאמי": "Inter Miami",
  "בוקה ג'וניורס": "Boca Juniors", "ריבר פלייט": "River Plate",
  "פלמנגו": "Flamengo", "פלמינסה": "Palmeiras",
  "מכבי תל אביב בסקטבול": "Maccabi Tel Aviv Basketball",
  "ריאל מדריד בסקטבול": "Real Madrid Basketball",
  "CSKA מוסקבה": "CSKA Moscow", "אלבה ברלין": "ALBA Berlin",
  // נבחרות — מונדיאל 2026
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
  for (const [he, en] of Object.entries(HE_TO_EN)) {
    if (name.includes(he)) return en;
  }
  return name;
}

// ── TheSportsDB: free, no API key, form + next fixture ────────────────────────
async function fetchSportsDB(home, away) {
  try {
    const homeEn = translateTeamName(home);
    const awayEn = translateTeamName(away);
    const base = "https://www.thesportsdb.com/api/v1/json/3";

    async function searchTeam(name) {
      const terms = teamSearchTerms(name);
      for (const term of terms) {
        try {
          const d = await fetch(`${base}/searchteams.php?t=${encodeURIComponent(term)}`, {
            signal: AbortSignal.timeout(7000),
          }).then(r => r.ok ? r.json() : null).catch(() => null);
          const id = d?.teams?.[0]?.idTeam;
          if (id) return { id, name: d.teams[0].strTeam };
        } catch (_) {}
      }
      return null;
    }

    const [homeTeam, awayTeam] = await Promise.all([
      searchTeam(home),
      searchTeam(away),
    ]);

    const parts = [];

    async function getForm(team, labelHe) {
      if (!team) return "";
      try {
        const d = await fetch(`${base}/eventslast.php?id=${team.id}`, {
          signal: AbortSignal.timeout(7000),
        }).then(r => r.ok ? r.json() : null).catch(() => null);
        const events = (d?.results || []).slice(0, 5);
        if (!events.length) return "";
        const lines = events.map(e => {
          const isHome = e.strHomeTeam === team.name;
          const gs = parseInt(e.intHomeScore ?? 0);
          const ga = parseInt(e.intAwayScore ?? 0);
          const scored = isHome ? gs : ga;
          const conceded = isHome ? ga : gs;
          const res = scored > conceded ? "נצ'" : scored < conceded ? "הפסד" : "תיקו";
          return `  ${(e.dateEvent||"").slice(0,10)}: ${e.strHomeTeam} ${gs}:${ga} ${e.strAwayTeam} [${res}]`;
        });
        return `📊 פורמה — ${labelHe} (5 אחרונים):\n${lines.join("\n")}`;
      } catch { return ""; }
    }

    async function getNext(team, labelHe) {
      if (!team) return "";
      try {
        const d = await fetch(`${base}/eventsnext.php?id=${team.id}`, {
          signal: AbortSignal.timeout(7000),
        }).then(r => r.ok ? r.json() : null).catch(() => null);
        const e = d?.events?.[0];
        if (!e) return "";
        return `📅 משחק הבא — ${labelHe}: ${(e.dateEvent||"").slice(0,10)} | ${e.strHomeTeam} vs ${e.strAwayTeam} (${e.strLeague||""})`;
      } catch { return ""; }
    }

    const [homeForm, awayForm, homeNext, awayNext] = await Promise.all([
      getForm(homeTeam, homeEn),
      getForm(awayTeam, awayEn),
      getNext(homeTeam, homeEn),
      getNext(awayTeam, awayEn),
    ]);

    if (homeNext) parts.push(homeNext);
    if (awayNext && awayNext !== homeNext) parts.push(awayNext);
    if (homeForm) parts.push(homeForm);
    if (awayForm) parts.push(awayForm);

    return parts.length ? parts.join("\n\n") : null;
  } catch { return null; }
}

// ── API-Football: form + H2H + injuries + standings ──────────────────────────

function teamSearchTerms(name) {
  const translated = translateTeamName(name);
  const terms = new Set();
  if (translated !== name) terms.add(translated.slice(0, 30));
  const latinOnly = name.replace(/[֐-׿\s]/g, "").trim();
  const hasHebrew = /[֐-׿]/.test(name);
  if (hasHebrew) {
    if (latinOnly.length >= 3) terms.add(latinOnly.slice(0, 30));
    const stripped = name.replace(/^(הפועל|מכבי|בני|אחי|עירוני)\s*/u, "").replace(/[֐-׿\s]/g, "").trim();
    if (stripped.length >= 3 && stripped !== latinOnly) terms.add(stripped.slice(0, 30));
  } else {
    terms.add(name.slice(0, 30));
    const firstWord = name.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 4) terms.add(firstWord);
  }
  return [...terms].filter(Boolean);
}

async function searchTeamId(name, headers, base) {
  for (const term of teamSearchTerms(name)) {
    try {
      const data = await fetch(`${base}/teams?search=${encodeURIComponent(term)}`, { headers, signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null);
      const id = data?.response?.[0]?.team?.id;
      if (id) return id;
    } catch (_) {}
  }
  return null;
}

async function fetchApiFootballData(home, away) {
  if (!FOOTBALL_API_KEY) return null;
  try {
    const homeEn = translateTeamName(home);
    const awayEn = translateTeamName(away);
    const h = { "x-apisports-key": FOOTBALL_API_KEY };
    const base = "https://v3.football.api-sports.io";

    const [homeId, awayId] = await Promise.all([
      searchTeamId(home, h, base),
      searchTeamId(away, h, base),
    ]);
    if (!homeId && !awayId) return null;

    const curYear = new Date().getFullYear();
    const seasons = [curYear, curYear - 1];
    async function bestStandings(teamId) {
      for (const s of seasons) {
        const d = await fetch(`${base}/standings?team=${teamId}&season=${s}`, { headers: h, signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (d?.response?.length) return d;
      }
      return null;
    }

    const [homeForm, awayForm, h2h, homeInj, awayInj, homeStand, awayStand, homeNext, awayNext] = await Promise.allSettled([
      homeId ? fetch(`${base}/fixtures?team=${homeId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      awayId ? fetch(`${base}/fixtures?team=${awayId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      (homeId && awayId) ? fetch(`${base}/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      homeId ? fetch(`${base}/injuries?team=${homeId}&season=${curYear}`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      awayId ? fetch(`${base}/injuries?team=${awayId}&season=${curYear}`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      homeId ? bestStandings(homeId) : Promise.resolve(null),
      awayId ? bestStandings(awayId) : Promise.resolve(null),
      homeId ? fetch(`${base}/fixtures?team=${homeId}&next=1`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      awayId ? fetch(`${base}/fixtures?team=${awayId}&next=1`, { headers: h, signal: AbortSignal.timeout(9000) }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
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
      return `📊 פורמה — ${nameEn} (5 אחרונים):\n${lines.join("\n")}`;
    }

    function standingLine(data, nameEn) {
      const standings = data?.response?.[0]?.[0]?.league?.standings?.[0];
      if (!standings) return "";
      const entry = standings.find(s => teamMatchScore(nameEn, s.team?.name || "") >= 0.5);
      if (!entry) return "";
      const { rank, points, goalsDiff } = entry;
      const { win, draw, lose, played } = entry.all || {};
      return `📋 טבלה — ${nameEn}: מקום ${rank} | ${points} נקודות | ${win}נ ${draw}ת ${lose}ה | ${played} משחקים | הפרש ${goalsDiff > 0 ? "+" : ""}${goalsDiff}`;
    }

    function injLines(data, nameEn) {
      const injured = (data?.response || []).filter(i =>
        /injur|פצוע/i.test(i.player?.type || "") || /injur/i.test(i.player?.reason || "")
      ).slice(0, 4);
      if (!injured.length) return "";
      const lines = injured.map(i => `  ${i.player?.name || "?"} — ${i.player?.reason || "פציעה"}`);
      return `🚑 פצועים — ${nameEn}:\n${lines.join("\n")}`;
    }

    const homeFormVal = homeForm.status === "fulfilled" ? homeForm.value : null;
    const awayFormVal = awayForm.status === "fulfilled" ? awayForm.value : null;
    const h2hVal = h2h.status === "fulfilled" ? h2h.value : null;
    const homeInjVal = homeInj.status === "fulfilled" ? homeInj.value : null;
    const awayInjVal = awayInj.status === "fulfilled" ? awayInj.value : null;
    const homeStandVal = homeStand.status === "fulfilled" ? homeStand.value : null;
    const awayStandVal = awayStand.status === "fulfilled" ? awayStand.value : null;
    const homeNextVal = homeNext.status === "fulfilled" ? homeNext.value : null;
    const awayNextVal = awayNext.status === "fulfilled" ? awayNext.value : null;

    // Next fixture info
    function nextFixtureLine(data, nameEn) {
      const f = data?.response?.[0];
      if (!f) return "";
      const d = (f.fixture?.date || "").slice(0, 10);
      const fh = f.teams?.home?.name || "";
      const fa = f.teams?.away?.name || "";
      const league = f.league?.name || "";
      return `📅 משחק הבא — ${nameEn}: ${d} | ${fh} vs ${fa} (${league})`;
    }

    const hNext = nextFixtureLine(homeNextVal, homeEn);
    const aNext = nextFixtureLine(awayNextVal, awayEn);
    if (hNext) parts.push(hNext);
    if (aNext && aNext !== hNext) parts.push(aNext);

    const hStand = standingLine(homeStandVal, homeEn);
    const aStand = standingLine(awayStandVal, awayEn);
    if (hStand) parts.push(hStand);
    if (aStand) parts.push(aStand);

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

    if (homeInjVal) { const s = injLines(homeInjVal, homeEn); if (s) parts.push(s); }
    if (awayInjVal) { const s = injLines(awayInjVal, awayEn); if (s) parts.push(s); }

    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

// ── The Odds API ───────────────────────────────────────────────────────────────
const ODDS_SPORT_MAP = {
  "מונדיאל": "soccer_fifa_world_cup", "World Cup": "soccer_fifa_world_cup",
  "FIFA": "soccer_fifa_world_cup", "קופה אמריקה": "soccer_conmebol_copa_america",
  "ליגת האומות": "soccer_uefa_nations_league", "גביע אפריקה": "soccer_africa_cup_of_nations",
  "CONCACAF": "soccer_concacaf_nations_league",
  "ליגת האלופות": "soccer_uefa_champs_league", "ליגה אירופאית": "soccer_uefa_europa_league",
  "קונפרנס": "soccer_uefa_europa_conference_league",
  "פרמייר ליג": "soccer_epl", "צ'מפיונשיפ": "soccer_england_championship",
  "בונדסליגה": "soccer_germany_bundesliga", "סריה א": "soccer_italy_serie_a",
  "ליג 1": "soccer_france_ligue_one", "לה ליגה": "soccer_spain_la_liga",
  "ארדיביזי": "soccer_netherlands_eredivisie", "סופר ליג טורקיה": "soccer_turkey_super_league",
  "פרמייר ליג סקוטלנד": "soccer_scotland_premiership",
  "פורטוגלית": "soccer_portugal_primeira_liga", "בלגית": "soccer_belgium_first_div",
  "שבדית": "soccer_sweden_allsvenskan", "נורבגית": "soccer_norway_eliteserien",
  "דנית": "soccer_denmark_superliga", "ליגת העל": "soccer_israel_premier_league",
  "MLS": "soccer_usa_mls", "ליגה MX": "soccer_mexico_ligamx",
  "ברזילאית": "soccer_brazil_campeonato", "ארגנטינאית": "soccer_argentina_primera_division",
  "קופה ליברטדורס": "soccer_conmebol_copa_libertadores",
  "NBA": "basketball_nba", "יורוליג": "basketball_euroleague", "NCAA": "basketball_ncaab",
};

const ODDS_FALLBACK_KEYS = [
  "soccer_fifa_world_cup", "soccer_conmebol_copa_america", "soccer_uefa_nations_league",
  "soccer_uefa_champs_league", "soccer_epl", "soccer_spain_la_liga",
  "soccer_germany_bundesliga", "soccer_italy_serie_a", "soccer_france_ligue_one",
  "soccer_netherlands_eredivisie", "soccer_england_championship",
  "soccer_portugal_primeira_liga", "soccer_turkey_super_league",
  "soccer_israel_premier_league", "soccer_usa_mls", "soccer_brazil_campeonato",
  "soccer_conmebol_copa_libertadores", "basketball_nba", "basketball_euroleague",
];

async function fetchOddsApiData(home, away, competition) {
  if (!ODDS_API_KEY_EXT) return null;
  const homeEn = translateTeamName(home);
  const awayEn = translateTeamName(away);
  const mappedKey = competition ? ODDS_SPORT_MAP[competition] : null;
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
        return `💰 יחסים (${bookmaker.title}): ${ev.home_team} vs ${ev.away_team}\nתאריך: ${date}\nיחסים:\n${outcomeLines}`;
      }
    } catch { continue; }
  }
  return null;
}

// ── DuckDuckGo Web Search (free, no API key) ──────────────────────────────────
async function fetchBraveSearch(home, away) {
  try {
    const homeEn = translateTeamName(home);
    const awayEn = translateTeamName(away);

    const snippets = [];

    // Query 1: match preview/form
    const q1 = encodeURIComponent(`${homeEn} vs ${awayEn} match preview 2025 2026`);
    const d1 = await fetch(`https://api.duckduckgo.com/?q=${q1}&format=json&no_html=1&skip_disambig=1`, {
      headers: { "User-Agent": "HaPogea/1.0" },
      signal: AbortSignal.timeout(7000),
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (d1?.AbstractText) snippets.push(`• ${d1.AbstractText.slice(0, 300)}`);
    if (d1?.RelatedTopics?.length) {
      d1.RelatedTopics.slice(0, 3).forEach(t => {
        if (t.Text) snippets.push(`• ${t.Text.slice(0, 200)}`);
      });
    }

    // Query 2: injuries / team news
    const q2 = encodeURIComponent(`${homeEn} injuries squad news 2026`);
    const d2 = await fetch(`https://api.duckduckgo.com/?q=${q2}&format=json&no_html=1&skip_disambig=1`, {
      headers: { "User-Agent": "HaPogea/1.0" },
      signal: AbortSignal.timeout(7000),
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (d2?.AbstractText) snippets.push(`• ${homeEn} news: ${d2.AbstractText.slice(0, 250)}`);

    return snippets.length ? snippets.join("\n") : null;
  } catch {
    return null;
  }
}

// ── Competition keyword map ────────────────────────────────────────────────────
const COMPETITION_MAP = [
  { key: "ליגת האלופות", terms: ["ליגת האלופות", "champions league", "ucl", "champion league"] },
  { key: "ליגה אירופאית", terms: ["ליגה אירופאית", "europa league", "uel"] },
  { key: "קונפרנס", terms: ["קונפרנס", "conference league", "uecl"] },
  { key: "ליגת האומות", terms: ["ליגת האומות", "ליגה לאומית", "nations league", "uefa nations"] },
  { key: "מונדיאל", terms: ["מונדיאל", "world cup", "fifa world", "גביע העולם", "wc 20"] },
  { key: "קופה אמריקה", terms: ["קופה אמריקה", "copa america", "copa améri"] },
  { key: "גביע אפריקה", terms: ["גביע אפריקה", "africa cup", "afcon"] },
  { key: "פרמייר ליג", terms: ["פרמייר ליג", "premier league", "epl", "אנגלית ראשונה"] },
  { key: "צ'מפיונשיפ", terms: ["צ'מפיונשיפ", "championship", "efl championship"] },
  { key: "לה ליגה", terms: ["לה ליגה", "la liga", "laliga", "ספרדית ראשונה"] },
  { key: "בונדסליגה", terms: ["בונדסליגה", "bundesliga", "גרמנית ראשונה"] },
  { key: "סריה א", terms: ["סריה א", "serie a", "serie-a", "איטלקית ראשונה"] },
  { key: "ליג 1", terms: ["ליג 1", "ligue 1", "ligue-1", "צרפתית ראשונה"] },
  { key: "פורטוגלית", terms: ["פורטוגלית", "primeira liga", "liga portugal"] },
  { key: "ארדיביזי", terms: ["ארדיביזי", "eredivisie", "הולנדית"] },
  { key: "בלגית", terms: ["בלגית", "jupiler pro", "belgian first"] },
  { key: "סופר ליג טורקיה", terms: ["טורקית", "super lig", "süper lig", "טורקיה"] },
  { key: "פרמייר ליג סקוטלנד", terms: ["סקוטית", "scottish premiership", "spfl"] },
  { key: "ליגת העל", terms: ["ליגת העל", "israeli premier", "ישראלית ראשונה"] },
  { key: "MLS", terms: ["mls", "major league soccer"] },
  { key: "ליגה MX", terms: ["ליגה mx", "liga mx", "מקסיקנית"] },
  { key: "ברזילאית", terms: ["ברזילאית", "brasileirao", "campeonato brasileiro"] },
  { key: "ארגנטינאית", terms: ["ארגנטינאית", "liga profesional", "primera division argentina"] },
  { key: "קופה ליברטדורס", terms: ["ליברטדורס", "copa libertadores"] },
  { key: "NBA", terms: ["nba"] },
  { key: "יורוליג", terms: ["יורוליג", "euroleague", "euro league"] },
  { key: "NCAA", terms: ["ncaa", "college basketball"] },
];

// ── Query parser ───────────────────────────────────────────────────────────────
function parseQuery(text) {
  const vsPatterns = [
    /(.+?)\s+(?:נגד|vs\.?|against|v\.?)\s+(.+)/i,
    /(.+?)\s*[-–—]\s*(.+)/,
    /(.+?)\s+(?:או|or)\s+(.+)/i,
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
  let offset = 0, dateKey = null;
  if (/היום|מחר|אתמול|today|tomorrow|yesterday/.test(lc)) {
    if (/מחר|tomorrow/.test(lc)) offset = 1;
    else if (/אתמול|yesterday/.test(lc)) offset = -1;
    const d = new Date(); d.setDate(d.getDate() + offset);
    dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(d);
  }

  let competition = null;
  for (const { key, terms } of COMPETITION_MAP) {
    if (terms.some(t => lc.includes(t))) { competition = key; break; }
  }
  const rawCompetitionFallback = !competition && !home && !away ? text : null;
  const isFinal = /גמר|final/.test(lc);
  return { home, away, dateKey, offset, competition, rawCompetitionFallback, isFinal };
}

// ── Context linking: link vague follow-up to last known match in history ───────
const SPORT_KEYWORDS = /כדורסל|basketball|כדורגל|football|soccer|nba|euroleague/i;

function resolveQueryWithHistory(rawQuery, history) {
  const q = rawQuery.trim();
  const lc = q.toLowerCase();

  // If it's already a full query with teams, return as-is
  const hasTeams = /נגד|vs\.?|against|או\s+\S/.test(lc) || /[-–—]/.test(q);
  if (hasTeams) return rawQuery;

  // If it's just a sport keyword follow-up ("כדורסל", "מה עם כדורסל")
  const isSportOnly = SPORT_KEYWORDS.test(q) && q.length < 40;
  // If it's a very short follow-up ("כן", "מה הסיכויים?", "והגמר?")
  const isVague = q.length < 25 && !/\d/.test(q);

  if (!isSportOnly && !isVague) return rawQuery;

  // Look back through history for the last match that was analyzed
  const allMessages = [...history].reverse();
  for (const msg of allMessages) {
    const text = String(msg.text || "");
    const matchParsed = parseQuery(text);
    if (matchParsed.home && matchParsed.away) {
      // Build enriched query: preserve original intent + add match context
      const sportHint = isSportOnly ? ` (ענף: ${q})` : "";
      return `${text}${sportHint}\n[הקשר מהשיחה: המשתמש ממשיך לדון במשחק הקודם]`;
    }
  }
  return rawQuery;
}

// ── System Prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are HaPogea — Israel's sharpest sports betting analyst. You combine live market odds, real-time statistics, and deep football/basketball knowledge to give clear, data-driven picks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ MANDATORY FIRST LINE — NO EXCEPTIONS
Start every response with this exact line as its own paragraph:
"⚠️ ניתוח בלבד — אין המלצה. גיל 18+ בלבד."
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RESPONSE FORMAT (always after the warning line):

**ניתוח:** 3-4 sentences. Lead with the key stats from the context (form record, table position, H2H). Then add tactical/squad insight from your knowledge. Be specific.

**המלצה:** One clear pick. Team name or outcome. NEVER "תיקו" unless you have a strong specific reason. NEVER two options. ONE pick.

**ביטחון:** X% — one number between 52–85%. Never below 52, never above 85, never a range.

**הנימוק:** One sentence. The single strongest reason. No "אבל" or "אולי".

---
**💬 מה אני באמת חושב:** 1-2 sentences. Commit fully. If you had to bet your own money, this is what you'd pick and why. Zero hedging.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## HOW TO BUILD THE ANALYSIS

**Step 1 — Odds (if in context):**
Calculate implied probability for each outcome: 1/odds × 100%.
The team/outcome with lowest odds = market favorite. Note the bookmaker margin (sum of implied > 100%).

**Step 2 — Real-time stats (if in context):**
Use EXACTLY what is provided. Do not round, estimate, or change numbers.
- Form: "4נ-0ת-1ה ב-5 האחרונים"
- Standings: "מקום 2, 61 נקודות, 18נ 7ת 3ה"
- H2H: "ניצח 3 מתוך 5 עימותים"
- Injuries: list player names from the data

**Step 3 — Your expert knowledge (always):**
You know every club, national team, player, coach, and competition worldwide — Israeli Premier League, Danish second division, World Cup groups, NBA, Euroleague, everything.
Fill in what the live data doesn't cover: tactical style, key players, squad depth, historical tendency, motivation, coaching philosophy, group stage stakes.

**RULE: Never fabricate a current result.** You may reference a team's general form or historical tendency without citing a specific score. If the context has form data, cite THOSE exact results. Never invent a result like "ניצח 2:0 לפני שלושה ימים" unless it appears in the context.

## OUT OF SCOPE
Only applies if user asks something with NO team names and NO match context:
Reply: "אני מנתח משחקים ספציפיים בלבד — שתי קבוצות, תאריך, שוק. שאל אותי על משחק קונקרטי 🎯"

## WORLD CUP 2026
Started June 11, 2026. Know every group, schedule, squad, coach, and key player.

## HARD RULES
- Never ask the user for any data — NEVER
- "לא מספיק נתונים" / "חייב נתונים" — NEVER
- "קשה לתת תחזית" / "יכול ללכת לכל כיוון" — NEVER
- "לא מכיר את הקבוצה" — NEVER
- Skip המלצה or ביטחון — NEVER
- Give two picks or say "depends" — NEVER. ONE pick always.
- Mention API / Football API / DuckDuckGo — NEVER

## Language & Tone
Hebrew only. You are a decisive, opinionated Israeli sports analyst. You always have a clear view. Short punchy sentences. Never hedge. Never qualify with "אבל קשה לדעת" or "זה תלוי".

## No odds in context
Write once: "⚠️ ניתוח מבוסס ידע כללי — אין נתוני שוק בזמן אמת." Then give full analysis anyway.

## "מה לשים" / "על מה להמר"
Reply: "אני לא נותן הוראות הימור. לפי הנתונים:" then full analysis.`;

// ── Claude API calls ───────────────────────────────────────────────────────────
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

  const withCurrent = [...dedupedHistory, { role: "user", content: userMessage }];
  const firstUserIdx = withCurrent.findIndex(m => m.role === "user");
  return firstUserIdx > 0 ? withCurrent.slice(firstUserIdx) : withCurrent;
}

async function callClaude(userMessage, conversationHistory) {
  if (!ANTHROPIC_API_KEY) {
    return "הפוגע AI לא מופעל — מפתח ANTHROPIC_API_KEY חסר.";
  }

  const body = {
    model: CLAUDE_MODEL,
    system: SYSTEM_PROMPT,
    messages: buildMessages(userMessage, conversationHistory),
    max_tokens: 2500,
    temperature: 0,
  };

  const RETRY_DELAYS = [3000, 6000, 12000];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text || "לא קיבלתי תגובה.";
    }
    if (res.status === 529 && attempt < 2) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      continue;
    }
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
  }
}

async function streamClaude(res, userMessage, conversationHistory) {
  if (!ANTHROPIC_API_KEY) {
    res.write("הפוגע AI לא מופעל — מפתח ANTHROPIC_API_KEY חסר.");
    res.end();
    return;
  }

  const body = {
    model: CLAUDE_MODEL,
    system: SYSTEM_PROMPT,
    messages: buildMessages(userMessage, conversationHistory),
    max_tokens: 2500,
    temperature: 0,
    stream: true,
  };

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const fallback = await callClaude(userMessage, conversationHistory).catch(e => `שגיאה טכנית: ${e.message}`);
    res.write(fallback); res.end(); return;
  }

  if (!upstream.ok || !upstream.body || !upstream.body.getReader) {
    const fallback = await callClaude(userMessage, conversationHistory).catch(e => `שגיאה טכנית: ${e.message}`);
    res.write(fallback); res.end(); return;
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

// ── Handler ────────────────────────────────────────────────────────────────────
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
  if (!query) { res.status(400).json({ error: "Missing query" }); return; }

  const history = rawHistory.slice(-6).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    text: sanitizeInput(m.text, 500),
  }));

  // Resolve vague follow-up queries using conversation history
  const resolvedQuery = resolveQueryWithHistory(query, history);
  const { home, away, dateKey, competition } = parseQuery(resolvedQuery);

  let oddsSection = "";
  let statsSection = "";
  let matchInfo = null;

  try {
    // Step 1: Odds API + Football API + TheSportsDB in parallel
    const [oddsResult, statsResult, sportsDbResult] = await Promise.allSettled([
      (home || away) ? fetchOddsApiData(home || "", away || "", competition) : Promise.resolve(null),
      (home && away) ? fetchApiFootballData(home, away) : Promise.resolve(null),
      (home && away) ? fetchSportsDB(home, away) : Promise.resolve(null),
    ]);

    oddsSection = oddsResult.status === "fulfilled" && oddsResult.value ? oddsResult.value : "";
    const footballStats = statsResult.status === "fulfilled" && statsResult.value ? statsResult.value : "";
    const sportsDbStats = sportsDbResult.status === "fulfilled" && sportsDbResult.value ? sportsDbResult.value : "";
    // Merge: Football API first (richer), TheSportsDB fills gaps
    statsSection = [footballStats, sportsDbStats].filter(Boolean).join("\n\n") || "";

    // Step 2: Web search only if both APIs returned nothing
    let webSection = "";
    if (home && away && !statsSection) {
      const webResult = await fetchBraveSearch(home, away).catch(() => null);
      webSection = webResult || "";
    }

    if (home && away) {
      matchInfo = { desc: `${home} נגד ${away}`, league: competition || "", date: dateKey || "" };
    }

    const hasOdds = oddsSection.length > 10;
    const safeQuery = resolvedQuery.replace(/`/g, "'").replace(/\$\{/g, "\\${");

    const sections = [
      `שאלת המשתמש: ${safeQuery}`,
      "",
      "══ יחסי שוק ══",
      hasOdds ? oddsSection : "(אין נתוני שוק בזמן אמת — נתח לפי ידע כללי)",
    ];
    if (statsSection) {
      sections.push("", "══ סטטיסטיקות | טבלה | פורמה | H2H | פציעות ══", statsSection);
    }
    if (webSection) {
      sections.push("", "══ תוצאות חיפוש אינטרנט (עדכני) ══", webSection);
    }
    sections.push(
      "═══════════════════════════════════",
      "",
      hasOdds
        ? "יש יחסי שוק — חשב הסתברות גלומה לכל תוצאה."
        : "אין יחסי שוק — נתח לפי ידע כללי.",
      "⚠️ MANDATORY: Give the full analysis NOW. Do NOT ask the user for any data. Do NOT say you need more information. Use everything in this context plus your training knowledge. Pick one team and commit.",
      "ענה בעברית בלבד. אל תיתן הוראות הימור."
    );
    const userMessage = sections.join("\n");

    if (!wantStream) {
      const cacheKey = aiCacheKey(resolvedQuery);
      const cached = await aiCacheGet(cacheKey);
      if (cached) return res.status(200).json({ ok: true, answer: cached, matchInfo, cached: true });
      const answer = await callClaude(userMessage, history);
      await aiCacheSet(cacheKey, answer);
      return res.status(200).json({ ok: true, answer, matchInfo });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.status(200);
    await streamClaude(res, userMessage, history);

  } catch (err) {
    console.error("Reuven API error:", err);
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const isQuota = /429|quota|rate.?limit/i.test(err.message);
    const errText = isQuota
      ? "ה-AI לא זמין כרגע (מכסה יומית מוצתה). נסה שוב מאוחר יותר."
      : `שגיאה טכנית: ${err.message}. אנא נסה שוב.`;
    if (wantStream) { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.status(200).end(errText); return; }
    res.status(200).json({ ok: false, answer: errText, matchInfo: null });
  }
};
