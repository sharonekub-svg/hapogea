const crypto = require("crypto");
const SNAPSHOT = require("./winner-snapshot.json");
const { rateLimit } = require("./_rate-limit");

// ── The Odds API (fallback when Winner is blocked) ───────────────────────────
const ODDS_API_KEY  = process.env.ODDS_API_KEY || "";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
// ── API-Sports (api-sports.io) — comprehensive results source ─────────────────
const FOOTBALL_API_KEY   = process.env.FOOTBALL_KEY || "";
const APISPORTS_FOOTBALL = "https://v3.football.api-sports.io";
const APISPORTS_BBALL    = "https://v1.basketball.api-sports.io";
// Full league pool — discoverActiveSports() filters to only leagues with upcoming events,
// so off-season leagues cost 0 extra API requests.
const ODDS_API_SPORTS = [
  // מונדיאל ותחרויות בינלאומיות — קריטי לאזור הזמן יוני 2026
  { key: "soccer_fifa_world_cup",                label: "מונדיאל 2026",            sportId: 240 },
  { key: "soccer_conmebol_copa_america",         label: "קופה אמריקה",             sportId: 240 },
  { key: "soccer_uefa_nations_league",           label: "ליגת האומות (UEFA)",      sportId: 240 },
  { key: "soccer_conmebol_wc_qualifying",        label: "מוקדמות מונדיאל CONMEBOL", sportId: 240 },
  { key: "soccer_concacaf_nations_league",       label: "ליגת האומות CONCACAF",    sportId: 240 },
  { key: "soccer_africa_cup_of_nations",         label: "גביע אפריקה",             sportId: 240 },
  // 5 ליגות אירופה הגדולות — כולל פלייאוף / סיום עונה
  { key: "soccer_epl",                           label: "פרמייר ליג",              sportId: 240 },
  { key: "soccer_spain_la_liga",                 label: "לה ליגה",                 sportId: 240 },
  { key: "soccer_germany_bundesliga",            label: "בונדסליגה",               sportId: 240 },
  { key: "soccer_italy_serie_a",                 label: "סרייה א",                 sportId: 240 },
  { key: "soccer_france_ligue_one",              label: "ליג 1 (צרפת)",           sportId: 240 },
  { key: "soccer_netherlands_eredivisie",        label: "ארדיוויזי",               sportId: 240 },
  // אנגליה — ליגות נמוכות עם פלייאוף מאי–יוני
  { key: "soccer_england_championship",          label: "צ'מפיונשיפ",             sportId: 240 },
  { key: "soccer_england_league1",               label: "ליג 1 (אנגליה)",         sportId: 240 },
  // סקוטלנד
  { key: "soccer_scotland_premiership",          label: "פרמייר ספורט (סקוטלנד)", sportId: 240 },
  // דרום אמריקה — קופות (שלישי/חמישי) וליגות (שוטף כל השנה)
  { key: "soccer_conmebol_copa_libertadores",    label: "קופה ליברטדורס",          sportId: 240 },
  { key: "soccer_conmebol_copa_sudamericana",    label: "קופה סודאמריקאנה",        sportId: 240 },
  { key: "soccer_brazil_campeonato",             label: "ברזילאית ראשונה",          sportId: 240 },
  { key: "soccer_brazil_serie_b",               label: "ברזילאית שנייה",            sportId: 240 },
  { key: "soccer_argentina_primera_division",    label: "ארגנטינאית ראשונה",       sportId: 240 },
  { key: "soccer_colombia_primera_a",           label: "קולומביאנית ראשונה",       sportId: 240 },
  { key: "soccer_chile_primera_division",       label: "צ'יליאנית ראשונה",         sportId: 240 },
  // צפון אמריקה (אביב–סתיו)
  { key: "soccer_usa_mls",                       label: "MLS",                       sportId: 240 },
  { key: "soccer_usa_usl_championship",         label: "USL Championship",          sportId: 240 },
  { key: "soccer_mexico_ligamx",                label: "ליגה MX",                   sportId: 240 },
  // אירופה — גביעים ו-UEFA
  { key: "soccer_uefa_champs_league",            label: "ליגת האלופות",              sportId: 240 },
  { key: "soccer_uefa_europa_league",            label: "ליגה אירופית",              sportId: 240 },
  { key: "soccer_uefa_europa_conference_league", label: "ליגת הקונפרנס",            sportId: 240 },
  // ליגות אירופאיות שמסיימות/פלייאוף במאי
  { key: "soccer_turkey_super_league",          label: "טורקית ראשונה",              sportId: 240 },
  { key: "soccer_greece_super_league",          label: "יוונית ראשונה",              sportId: 240 },
  { key: "soccer_portugal_primeira_liga",       label: "פורטוגלית ראשונה",          sportId: 240 },
  { key: "soccer_israel_premier_league",        label: "ליגת העל",                   sportId: 240 },
  { key: "soccer_belgium_first_div",            label: "בלגית ראשונה",               sportId: 240 },
  // סקנדינביה (אפריל–נובמבר — פעיל בימי חול)
  { key: "soccer_sweden_allsvenskan",           label: "שבדית ראשונה",               sportId: 240 },
  { key: "soccer_norway_eliteserien",           label: "נורבגית ראשונה",             sportId: 240 },
  { key: "soccer_denmark_superliga",            label: "דנית ראשונה",                sportId: 240 },
  { key: "soccer_finland_veikkausliiga",        label: "פינית ראשונה",               sportId: 240 },
  // אסיה (מרץ–נובמבר — לרוב שלישי/שישי)
  { key: "soccer_south_korea_kleague1",         label: "K-League",                  sportId: 240 },
  { key: "soccer_japan_j_league",               label: "J-League",                  sportId: 240 },
  { key: "soccer_china_superleague",            label: "סינית ראשונה",               sportId: 240 },
  { key: "soccer_australia_aleague",            label: "A-League",                  sportId: 240 },
  // כדורסל
  { key: "basketball_nba",                       label: "NBA",                       sportId: 227 },
  { key: "basketball_nbl",                      label: "NBL",                       sportId: 227 },
  { key: "basketball_euroleague",                label: "יורוליג",                   sportId: 227 },
  { key: "basketball_ncaab",                    label: "NCAA",                      sportId: 227 },
];
// ─────────────────────────────────────────────────────────────────────────────

const ODDS_MIN = 1.4;
const ODDS_MAX = 1.9;
const SOFT_ODDS_MIN = 1.20;
const SOFT_ODDS_MAX = 2.10;
const MIN_PREMIUM_ROWS_PER_DAY = 15;
// Basketball 2-way markets have different odds structure than football 3-way
const BASKETBALL_ODDS_MIN = 1.25;
const BASKETBALL_ODDS_MAX_MONEYLINE = 1.90;
const BASKETBALL_ODDS_MAX_SPREAD = 2.05;
/** Top Winner picks shown per day (verified line + odds in range). */
const TARGET_PICKS_PER_SPORT = 20;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jgcmtrlviuivbtimtqjq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SPORTS = {
  240: "כדורגל",
  227: "כדורסל",
};
const WINNER_FOOTBALL_ID = 240;
const WINNER_BASKETBALL_ID = 227;
const SCORES365_FOOTBALL_ID = 1;
const SCORES365_BASKETBALL_ID = 2;

// English→Hebrew team name translations for Odds API score settlement
const ODDS_API_TEAM_HE = {
  // Premier League
  "Arsenal": "ארסנל", "Aston Villa": "אסטון וילה", "Bournemouth": "בורנמות'",
  "Brentford": "ברנטפורד", "Brighton": "ברייטון", "Chelsea": "צ'לסי",
  "Crystal Palace": "קריסטל פאלאס", "Everton": "אברטון", "Fulham": "פולהאם",
  "Liverpool": "ליברפול", "Manchester City": "מנצ'סטר סיטי",
  "Manchester United": "מנצ'סטר יונייטד", "Newcastle": "ניוקאסל",
  "Newcastle United": "ניוקאסל", "Nottingham Forest": "נוטינגהאם פורסט",
  "Sheffield United": "שפילד יונייטד", "Tottenham": "טוטנהאם",
  "Tottenham Hotspur": "טוטנהאם", "West Ham": "ווסט הם",
  "West Ham United": "ווסט הם", "Wolves": "וולברהמפטון",
  "Wolverhampton Wanderers": "וולברהמפטון", "Ipswich": "איפסוויץ'",
  "Ipswich Town": "איפסוויץ'", "Leicester": "לסטר", "Leicester City": "לסטר",
  "Southampton": "סאות'המפטון",
  // La Liga
  "Real Madrid": "ריאל מדריד", "Barcelona": "ברצלונה",
  "Atletico Madrid": "אטלטיקו מדריד", "Athletic Club": "אתלטיק בילבאו",
  "Real Sociedad": "ריאל סוסיאדד", "Real Betis": "ריאל בטיס",
  "Sevilla": "סביליה", "Valencia": "ולנסיה", "Villarreal": "ויארריאל",
  "Osasuna": "אוסאסונה", "Getafe": "חטאפה", "Celta Vigo": "סלטה ביגו",
  "Rayo Vallecano": "ראיו ואייקאנו", "Girona": "ג'ירונה",
  "Mallorca": "מיורקה", "Alaves": "אלאוס", "Las Palmas": "לאס פאלמאס",
  "Leganes": "לגאנס", "Espanol": "ספניול", "RCD Espanol": "ספניול",
  "Valladolid": "ואיאדוליד",
  // Bundesliga
  "Bayern Munich": "באיירן מינכן", "Borussia Dortmund": "בוורוסיה דורטמונד",
  "Bayer Leverkusen": "בייר לברקוזן", "RB Leipzig": "לייפציג",
  "Eintracht Frankfurt": "פרנקפורט", "Wolfsburg": "וולפסבורג",
  "Borussia Monchengladbach": "בוורוסיה מ'גלדבך",
  "Borussia Mönchengladbach": "בוורוסיה מ'גלדבך",
  "Union Berlin": "אוניון ברלין", "Freiburg": "פרייבורג",
  "Bochum": "בוחום", "Augsburg": "אאוגסבורג", "Mainz": "מיינץ",
  "Mainz 05": "מיינץ", "Hoffenheim": "הופנהיים", "TSG Hoffenheim": "הופנהיים",
  "Stuttgart": "שטוטגרט", "VfB Stuttgart": "שטוטגרט",
  "Heidenheim": "היידנהיים", "Werder Bremen": "ורדר ברמן",
  "Hamburger SV": "המבורג", "Schalke": "שלקה",
  // Serie A
  "Inter Milan": "אינטר מילאן", "AC Milan": "מילאן",
  "Juventus": "יובנטוס", "Napoli": "נאפולי", "AS Roma": "רומא",
  "Lazio": "לאציו", "Atalanta": "אטלנטה", "Fiorentina": "פיורנטינה",
  "Bologna": "בולוניה", "Monza": "מונצה", "Torino": "טורינו",
  "Hellas Verona": "ורונה", "Cagliari": "קאלייארי",
  "Udinese": "אודינזה", "Genoa": "גנואה", "Empoli": "אמפולי",
  "Lecce": "לצ'ה", "Sassuolo": "סאסואולו", "Venezia": "ונציה",
  "Parma": "פארמה", "Como": "קומו", "Sampdoria": "סמפדוריה",
  // Ligue 1
  "Paris Saint-Germain": "פריז סן ז'רמן", "PSG": "פריז סן ז'רמן",
  "Marseille": "מארסיי", "Lyon": "ליון", "Monaco": "מונאקו",
  "Lille": "ליל", "Nice": "ניס", "Lens": "לנס", "Rennes": "רן",
  "Toulouse": "טולוז", "Reims": "ריימס", "Montpellier": "מונפליה",
  "Brest": "ברסט", "Nantes": "נאנט", "Strasbourg": "שטרסבור",
  "Le Havre": "לה אבר", "Angers": "אנז'ה", "Saint-Etienne": "סנט-אטיין",
  "Auxerre": "אוקסר",
  // Netherlands
  "Ajax": "איי אקס", "PSV": "פ.ס.ו.", "PSV Eindhoven": "פ.ס.ו.",
  "Feyenoord": "פייאנורד", "AZ": "א.ז.", "AZ Alkmaar": "א.ז.",
  "Twente": "טוונטה", "FC Twente": "טוונטה",
  // Portugal
  "Porto": "פורטו", "Benfica": "בנפיקה", "Sporting CP": "ספורטינג",
  "Braga": "בראגה", "Vitoria de Guimaraes": "גימאראנש",
  // Turkey
  "Galatasaray": "גלטסראי", "Fenerbahce": "פנרבחה",
  "Besiktas": "בשיקטש", "Trabzonspor": "טרבזונספור",
  // Scotland
  "Celtic": "סלטיק", "Rangers": "ריינג'רס",
  // Belgium
  "Club Brugge": "קלוב ברוז'", "Anderlecht": "אנדרלכט",
  "Gent": "גנט", "Union Saint-Gilloise": "יוניון",
  // European cups
  "Red Bull Salzburg": "זלצבורג", "Shakhtar Donetsk": "שחטר",
  "Dynamo Kyiv": "דינמו קייב",
  // Israel
  "Maccabi Tel Aviv": "מכבי תל אביב", "Maccabi Haifa": "מכבי חיפה",
  "Hapoel Beer Sheva": "הפועל באר שבע", "Hapoel Tel Aviv": "הפועל תל אביב",
  "Beitar Jerusalem": "בית\"ר ירושלים",
  "Bnei Yehuda": "בני יהודה", "Maccabi Petah Tikva": "מכבי פתח תקווה",
  // NBA
  "Atlanta Hawks": "אטלנטה הוקס", "Boston Celtics": "בוסטון סלטיקס",
  "Brooklyn Nets": "ברוקלין נטס", "Charlotte Hornets": "שרלוט הורנטס",
  "Chicago Bulls": "שיקגו בולס", "Cleveland Cavaliers": "קליבלנד קאבלייארס",
  "Dallas Mavericks": "דאלאס מאבריקס", "Denver Nuggets": "דנוור נאגטס",
  "Detroit Pistons": "דטרויט פיסטונס",
  "Golden State Warriors": "גולדן סטייט ווריירס",
  "Houston Rockets": "יוסטון רוקטס", "Indiana Pacers": "אינדיאנה פייסרס",
  "Los Angeles Clippers": "לוס אנג'לס קליפרס",
  "Los Angeles Lakers": "לוס אנג'לס לייקרס",
  "Memphis Grizzlies": "ממפיס גריזליז", "Miami Heat": "מיאמי היט",
  "Milwaukee Bucks": "מילווקי באקס",
  "Minnesota Timberwolves": "מינסוטה טימברוולבס",
  "New Orleans Pelicans": "ניו אורלינס פליקנס",
  "New York Knicks": "ניו יורק קניקס",
  "Oklahoma City Thunder": "אוקלהומה סיטי תאנדר",
  "Orlando Magic": "אורלנדו מאג'יק",
  "Philadelphia 76ers": "פילדלפיה 76'רס",
  "Phoenix Suns": "פניקס סאנס",
  "Portland Trail Blazers": "פורטלנד טרייל בלייזרס",
  "Sacramento Kings": "סקרמנטו קינגס",
  "San Antonio Spurs": "סן אנטוניו ספארס",
  "Toronto Raptors": "טורונטו ראפטורס",
  "Utah Jazz": "יוטה ג'אז", "Washington Wizards": "וושינגטון ויזרדס",
  // EuroLeague
  "Real Madrid Basketball": "ריאל מדריד",
  "FC Barcelona Basketball": "ברצלונה",
  "Fenerbahce Basketball": "פנרבחה",
  "Anadolu Efes": "אנדולו אפס",
  "CSKA Moscow": "CSKA מוסקבה",
  "Olympiacos": "אולימפיאקוס",
  "Panathinaikos": "פנתינאיקוס",
  "ALBA Berlin": "אלבה ברלין",
  "Zalgiris": "ז'לגיריס", "Baskonia": "בסקוניה",
  "AS Monaco Basketball": "מונאקו",
  // נבחרות לאומיות — מונדיאל 2026 ותחרויות בינלאומיות
  "Brazil": "ברזיל", "Argentina": "ארגנטינה", "France": "צרפת",
  "Spain": "ספרד", "England": "אנגליה", "Germany": "גרמניה",
  "Portugal": "פורטוגל", "Netherlands": "הולנד", "Italy": "איטליה",
  "Belgium": "בלגיה", "Uruguay": "אורוגוואי", "Colombia": "קולומביה",
  "Mexico": "מקסיקו", "United States": "ארצות הברית", "USA": "ארצות הברית",
  "Canada": "קנדה", "Morocco": "מרוקו", "Senegal": "סנגל",
  "Japan": "יפן", "South Korea": "קוריאה הדרומית", "Australia": "אוסטרליה",
  "Croatia": "קרואטיה", "Switzerland": "שוויץ", "Denmark": "דנמרק",
  "Sweden": "שבדיה", "Austria": "אוסטריה", "Poland": "פולין",
  "Serbia": "סרביה", "Hungary": "הונגריה", "Czech Republic": "צ'כיה",
  "Slovakia": "סלובקיה", "Ukraine": "אוקראינה", "Turkey": "טורקיה",
  "Greece": "יוון", "Scotland": "סקוטלנד", "Wales": "וויילס",
  "Ireland": "אירלנד", "Ecuador": "אקוודור", "Chile": "צ'ילה",
  "Peru": "פרו", "Bolivia": "בוליביה", "Paraguay": "פרגוואי",
  "Venezuela": "ונצואלה", "Costa Rica": "קוסטה ריקה", "Honduras": "הונדורס",
  "Panama": "פנמה", "Jamaica": "ג'מייקה", "Nigeria": "ניגריה",
  "Ghana": "גאנה", "Ivory Coast": "חוף השנהב", "Cote d'Ivoire": "חוף השנהב",
  "Cameroon": "קמרון", "Egypt": "מצרים", "Algeria": "אלג'יריה",
  "Tunisia": "תוניסיה", "Iran": "איראן", "Saudi Arabia": "ערב הסעודית",
  "Qatar": "קטאר", "New Zealand": "ניו זילנד", "Israel": "ישראל",
  "Romania": "רומניה", "Norway": "נורווגיה", "Finland": "פינלנד",
  "Russia": "רוסיה", "China": "סין", "South Africa": "דרום אפריקה",
  "Uzbekistan": "אוזבקיסטן", "Iraq": "עיראק", "United Arab Emirates": "איחוד האמירויות",
  "Indonesia": "אינדונזיה", "Vietnam": "וייטנאם",
};

// Sport keys to query for settlement scores (one request each, runs once/day in cron)
const SCORES_SPORT_KEYS = [
  // בינלאומי — קריטי למונדיאל 2026
  { key: "soccer_fifa_world_cup",                  sportId: 240 },
  { key: "soccer_conmebol_copa_america",           sportId: 240 },
  { key: "soccer_uefa_nations_league",             sportId: 240 },
  // 5 ליגות גדולות + ארדיוויזי
  { key: "soccer_epl",                             sportId: 240 },
  { key: "soccer_spain_la_liga",                   sportId: 240 },
  { key: "soccer_germany_bundesliga",              sportId: 240 },
  { key: "soccer_italy_serie_a",                   sportId: 240 },
  { key: "soccer_france_ligue_one",                sportId: 240 },
  { key: "soccer_netherlands_eredivisie",          sportId: 240 },
  { key: "soccer_england_championship",            sportId: 240 },
  { key: "soccer_scotland_premiership",            sportId: 240 },
  { key: "soccer_portugal_primeira_liga",          sportId: 240 },
  { key: "soccer_turkey_super_league",             sportId: 240 },
  { key: "soccer_belgium_first_div",               sportId: 240 },
  { key: "soccer_greece_super_league",             sportId: 240 },
  { key: "soccer_uefa_champs_league",              sportId: 240 },
  { key: "soccer_uefa_europa_league",              sportId: 240 },
  { key: "soccer_uefa_europa_conference_league",   sportId: 240 },
  { key: "soccer_israel_premier_league",           sportId: 240 },
  // דרום אמריקה
  { key: "soccer_brazil_campeonato",               sportId: 240 },
  { key: "soccer_argentina_primera_division",      sportId: 240 },
  { key: "soccer_conmebol_copa_libertadores",      sportId: 240 },
  // צפון אמריקה
  { key: "soccer_usa_mls",                         sportId: 240 },
  { key: "soccer_mexico_ligamx",                   sportId: 240 },
  // כדורסל
  { key: "basketball_nba",                         sportId: 227 },
  { key: "basketball_euroleague",                  sportId: 227 },
  { key: "basketball_ncaab",                       sportId: 227 },
];
const CACHE_TTL_MS = {
  today: 5 * 60 * 1000,
  tomorrow: 60 * 60 * 1000,
  full: 5 * 60 * 1000,
};
const memoryCache = globalThis.__WINNER_FEED_CACHE__ || (globalThis.__WINNER_FEED_CACHE__ = new Map());
// Persists across warm Lambda invocations — avoids re-fetching logos for the same teams
const globalLogoCache = globalThis.__LOGO_CACHE__ || (globalThis.__LOGO_CACHE__ = new Map());

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
      devicemodel: "",
      deviceos: "windows",
      deviceosversion: "10",
      appversion: "2.6.1",
      apptype: "desktop",
      originId: 15,
      isAccessibility: false,
    }),
    appVersion: "2.6.1",
    ...extra,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, label, { attempts = 3, baseDelay = 2000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const jitter = Math.floor(Math.random() * 350);
      await sleep(baseDelay * (2 ** (attempt - 1)) + jitter);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

async function fetchJson(url, options = {}) {
  return withRetry(async () => {
    const response = await fetch(url, options);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status}: ${text.slice(0, 240)}`);
    }
    return text ? JSON.parse(text) : null;
  }, `fetch ${url}`, { attempts: options.retryAttempts || 3, baseDelay: options.retryBaseDelay || 2000 });
}

function israelDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function israelNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function cacheKeyForToday() {
  const today = israelDate(0);
  return `winner-feed:${today}`;
}

function isFreshCache(entry, maxAgeMs) {
  return entry?.payload && Date.now() - Number(entry.cachedAt || 0) < maxAgeMs;
}

async function kvGet(key) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const data = await fetchJson(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      retryAttempts: 1,
    }).catch(() => null);
    if (data?.result) {
      try {
        return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
      } catch {
        return null;
      }
    }
  }
  return memoryCache.get(key) || null;
}

async function kvSet(key, value, ttlSeconds = 3600) {
  memoryCache.set(key, value);
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    await fetchJson(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
      retryAttempts: 1,
    }).catch(() => null);
    await fetchJson(`${process.env.KV_REST_API_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      retryAttempts: 1,
    }).catch(() => null);
  }
}

function winnerDateToIso(value) {
  const raw = String(value || "");
  if (raw.length !== 6) return "";
  return `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
}

function winnerHour(value) {
  const raw = String(value || "").padStart(4, "0");
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
}

function kickoffMs(dateKey, winnerTime) {
  const time = winnerHour(winnerTime);
  return zonedTimeToUtcMs(dateKey, time, "Asia/Jerusalem");
}

function zonedTimeToUtcMs(dateKey, time, timeZone = "Asia/Jerusalem") {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return NaN;
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const zoneParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(targetAsUtc));
  const map = Object.fromEntries(zoneParts.map((part) => [part.type, part.value]));
  const zoneAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second || 0));
  const offsetMs = zoneAsUtc - targetAsUtc;
  return targetAsUtc - offsetMs;
}

function isOpenDisplayable(row, nowMs = Date.now()) {
  if (!row || row.matchPhase === "final" || row.bettingStatus === "cancelled" || row.bettingStatus === "postponed") return false;
  const kick = kickoffMs(row.day, row.time);
  if (!Number.isFinite(kick)) return true;
  const graceMs = Number(row.sportId) === WINNER_BASKETBALL_ID ? 2.5 * 60 * 60 * 1000 : 3 * 60 * 60 * 1000;
  return kick + graceMs >= nowMs;
}

function decimal(value) {
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreText(a, b, fallback = "") {
  const left = cleanText(a);
  const right = cleanText(b);
  if (left !== "" && right !== "") return `${left}:${right}`;
  return cleanText(fallback);
}

function parseSpread(value) {
  const match = cleanText(value).match(/\(([+-]?\d+(?:\.\d+)?)\)/);
  return match ? Number(match[1]) : null;
}

function parseOverUnderLine(desc) {
  const clean = cleanText(desc);
  const m = clean.match(/(?:מעל|מתחת)\s+([+-]?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : parseSpread(clean);
}

function outcomeTeam(value) {
  return cleanText(value).replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/, "").trim();
}

function splitTeams(match) {
  const [home, away] = cleanText(match).split(" - ").map(cleanText);
  return { home: home || cleanText(match), away: away || "" };
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u202A-\u202E\u202C\u200E\u200F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatchName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(fc|bc|bk|basket|basketball|club|women|w)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultKeyFor(row) {
  const home = normalizeMatchName(row?.home || row?.teamA);
  const away = normalizeMatchName(row?.away || row?.teamB);
  const day = cleanText(row?.day || row?.date);
  const sportId = Number(row?.sportId || row?.sportid || 0);
  if (!day || !sportId || !home || !away) return "";
  return `${sportId}:${day}:${home}:${away}`;
}

function resultKeyVariants(row) {
  const key = resultKeyFor(row);
  if (!key) return [];
  const parts = key.split(":");
  return [
    key,
    `${parts[0]}:${parts[1]}:${parts[3]}:${parts[2]}`,
  ];
}

function scores365Date(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function initials(value) {
  const firstWord = cleanText(value).split(" ").filter(Boolean)[0] || "";
  return ([...firstWord][0] || "?").toUpperCase();
}

function fallbackLogo(name, type = "team") {
  const text = cleanText(name);
  const firstWord = text.split(/\s+/).filter(Boolean)[0] || "";
  const abbr = ([...firstWord][0] || "?").toUpperCase();
  if (type === "league") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="10" fill="#10161b"/><circle cx="22" cy="22" r="17" fill="#182027"/><circle cx="22" cy="22" r="13" fill="none" stroke="#8fb6c9" stroke-width="1.8" stroke-dasharray="4 3"/><text x="22" y="28" text-anchor="middle" font-size="15" font-family="Arial,sans-serif" font-weight="900" fill="#e8eef2">${abbr}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 50"><rect width="44" height="50" rx="10" fill="#10161b"/><path d="M22 3 L39 11 L39 28 Q39 41 22 47 Q5 41 5 28 L5 11 Z" fill="#182027"/><path d="M22 8 L35 14 L35 28 Q35 38 22 43 Q9 38 9 28 L9 14 Z" fill="none" stroke="#9aa6af" stroke-width="1.8" stroke-dasharray="4 3"/><text x="22" y="32" text-anchor="middle" font-size="16" font-family="Arial,sans-serif" font-weight="900" fill="#e8eef2">${abbr}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function normalizeLogoName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(מכבי|הפועל|בני|עירוני|ביתר|אף\.קיי|בי\.סי|פ\.ק|fc|f\.c|cf|bc|bk|club|women|basketball|basket)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const left = normalizeLogoName(a);
  const right = normalizeLogoName(b);
  if (!left || !right) return Math.max(left.length, right.length);
  const matrix = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[left.length][right.length];
}

function similarity(a, b) {
  const left = normalizeLogoName(a);
  const right = normalizeLogoName(b);
  const max = Math.max(left.length, right.length);
  if (!max) return 0;
  return 1 - levenshtein(left, right) / max;
}

function bestAssetCandidate(term, rows) {
  const candidates = (rows || [])
    .map((row) => ({
      ...row,
      score: Math.max(similarity(term, row.name), similarity(term, row.name_he), similarity(term, row.slug)),
    }))
    .filter((row) => row.logo_url && row.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function logoSearchTerms(name, kind) {
  const clean = cleanText(name);
  const terms = [clean, normalizeLogoName(clean)];
  const withoutSuffixes = clean
    .replace(/\b(מכבי|הפועל|בני|עירוני|אף\.קיי|בי\.סי|פ\.ק|מועדון|כדורסל|נשים)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutSuffixes && withoutSuffixes !== clean) terms.push(withoutSuffixes);
  return [...new Set(terms.filter(Boolean))];
}

async function supabaseSearch(table, term) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const value = cleanText(term);
  if (!value || value.length < 2) return null;
  const query = `${table}?select=id,name,name_he,logo_url,slug&or=(name_he.ilike.*${encodeURIComponent(value)}*,name.ilike.*${encodeURIComponent(value)}*,slug.ilike.*${encodeURIComponent(value)}*)&limit=20`;
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    retryAttempts: 1,
  }).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  const exact = rows.find((row) => cleanText(row.name_he) === value || cleanText(row.name) === value);
  return exact || bestAssetCandidate(value, rows) || rows.find((row) => row.logo_url) || null;
}

async function sportsDbSearch(kind, term) {
  const value = cleanText(term);
  if (!value || value.length < 3) return null;
  const endpoint = kind === "league" ? "search_all_leagues.php" : "searchteams.php";
  const param = kind === "league" ? "l" : "t";
  const url = `https://www.thesportsdb.com/api/v1/json/3/${endpoint}?${param}=${encodeURIComponent(value)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const data = await fetchJson(url, { signal: controller.signal, retryAttempts: 1 }).catch(() => null);
  clearTimeout(timeout);
  const rows = kind === "league" ? (data?.countries || data?.leagues) : data?.teams;
  if (!Array.isArray(rows) || !rows.length) return null;
  const normalized = value.toLowerCase();
  const exact = rows.find((row) =>
    cleanText(row.strTeam || row.strLeague).toLowerCase() === normalized
  );
  const row = exact || rows[0];
  return {
    name: cleanText(row.strTeam || row.strLeague || value),
    logo_url: row.strBadge || row.strLogo || row.strFanart1 || "",
    source: "TheSportsDB",
  };
}

async function sofascoreLogoSearch(name, kind) {
  const value = cleanText(name);
  if (!value || value.length < 2) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const url = `https://api.sofascore.com/api/v1/search/all?q=${encodeURIComponent(value)}&page=0`;
    const data = await fetchJson(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Referer: "https://www.sofascore.com/",
      },
      signal: controller.signal,
      retryAttempts: 0,
    }).catch(() => null);
    clearTimeout(timeout);
    if (!data) return null;
    const type = kind === "league" ? "uniqueTournament" : "team";
    const results = (data.results || []).filter(r => r.type === type);
    if (!results.length) return null;
    const hit = results[0];
    const id = hit.entity?.id;
    if (!id) return null;
    const imgPath = kind === "league"
      ? `https://api.sofascore.com/api/v1/unique-tournament/${id}/image`
      : `https://api.sofascore.com/api/v1/team/${id}/image`;
    return {
      name: cleanText(hit.entity?.name || value),
      logo_url: imgPath,
      source: `SofaScore ${kind}`,
    };
  } catch (_) {
    clearTimeout(timeout);
    return null;
  }
}

async function wikipediaLogoSearch(name, kind) {
  const value = cleanText(name);
  if (!value || value.length < 3) return null;
  for (const lang of ["he", "en"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(value)}`;
    const data = await fetchJson(url, {
      headers: { "User-Agent": "HapogeaLogoBot/1.0" },
      signal: controller.signal,
      retryAttempts: 1,
    }).catch(() => null);
    clearTimeout(timeout);
    const logo = data?.thumbnail?.source || data?.originalimage?.source || "";
    if (logo) {
      return {
        name: cleanText(data.title || value),
        logo_url: logo,
        source: `Wikipedia ${lang} ${kind}`,
      };
    }
  }
  return null;
}

async function wikipediaSearchLogo(name, kind) {
  const value = cleanText(name);
  if (!value || value.length < 3) return null;
  for (const lang of ["he", "en"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: value,
      gsrlimit: "1",
      prop: "pageimages",
      pithumbsize: "160",
      format: "json",
      origin: "*",
    });
    const data = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": "HapogeaLogoBot/1.0" },
      signal: controller.signal,
      retryAttempts: 1,
    }).catch(() => null);
    clearTimeout(timeout);
    const page = Object.values(data?.query?.pages || {})[0];
    const logo = page?.thumbnail?.source || page?.original?.source || "";
    if (logo) {
      return {
        name: cleanText(page.title || value),
        logo_url: logo,
        source: `Wikipedia search ${lang} ${kind}`,
      };
    }
  }
  return null;
}

async function wikidataLogoSearch(name, kind) {
  const value = cleanText(name);
  if (!value || value.length < 3) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=he&format=json&limit=1&search=${encodeURIComponent(value)}`;
  const search = await fetchJson(searchUrl, {
    headers: { "User-Agent": "HapogeaLogoBot/1.0" },
    signal: controller.signal,
    retryAttempts: 1,
  }).catch(() => null);
  clearTimeout(timeout);
  const id = search?.search?.[0]?.id;
  if (!id) return null;

  const entityController = new AbortController();
  const entityTimeout = setTimeout(() => entityController.abort(), 1000);
  const entity = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, {
    headers: { "User-Agent": "HapogeaLogoBot/1.0" },
    signal: entityController.signal,
    retryAttempts: 1,
  }).catch(() => null);
  clearTimeout(entityTimeout);
  const entityData = entity?.entities?.[id] || {};
  const claims = entityData.claims || {};
  const labels = entityData.labels || {};
  // P154 = logo image, P18 = image (fallback)
  const image = claims.P154?.[0]?.mainsnak?.datavalue?.value ||
    claims.P18?.[0]?.mainsnak?.datavalue?.value;
  // Return English label so callers can use it for TheSportsDB
  const englishName = labels?.en?.value || null;
  if (!image && !englishName) return null;
  return {
    name: value,
    logo_url: image
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=160`
      : null,
    englishName,
    source: `Wikidata ${kind}`,
  };
}

async function resolveLogoRow(table, kind, name) {
  const key = `${kind}:${cleanText(name)}`;
  if (globalLogoCache.has(key)) return globalLogoCache.get(key);
  if (globalLogoCache.has(`${key}:pending`)) {
    await globalLogoCache.get(`${key}:pending`);
    return globalLogoCache.get(key) || null;
  }
  let resolvePending;
  const pending = new Promise(r => { resolvePending = r; });
  globalLogoCache.set(`${key}:pending`, pending);
  let row = null;
  try {
    row = await Promise.race([
      (async () => {
        const terms = logoSearchTerms(cleanText(name), kind);

        // 1. All Supabase lookups in parallel — eliminates N+1 serial DB calls
        const sbResults = await Promise.allSettled(terms.map(t => supabaseSearch(table, t)));
        const sbHit = sbResults.find(r => r.status === "fulfilled" && r.value?.logo_url)?.value;
        if (sbHit?.logo_url) return sbHit;

        // 2. SofaScore + Wikidata for ALL terms in parallel
        const extResults = await Promise.allSettled(
          terms.flatMap(t => [sofascoreLogoSearch(t, kind), wikidataLogoSearch(t, kind)])
        );
        // Prefer SofaScore (even-indexed), then Wikidata (odd-indexed)
        for (let i = 0; i < extResults.length; i += 2) {
          if (extResults[i].status === "fulfilled" && extResults[i].value?.logo_url)
            return extResults[i].value;
        }
        let englishName = null;
        for (let i = 1; i < extResults.length; i += 2) {
          const r = extResults[i];
          if (r.status === "fulfilled" && r.value?.logo_url) return r.value;
          if (r.status === "fulfilled" && r.value?.englishName && !englishName)
            englishName = r.value.englishName;
        }

        // 3. TheSportsDB + Wikipedia in parallel using best term
        const lookupTerm = englishName || terms[0];
        const fallbackResults = await Promise.allSettled([
          sportsDbSearch(kind, lookupTerm),
          wikipediaLogoSearch(lookupTerm, kind),
          wikipediaSearchLogo(lookupTerm, kind),
        ]);
        return fallbackResults.find(r => r.status === "fulfilled" && r.value?.logo_url)?.value || null;
      })(),
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
  } catch (_) {
    row = null;
  }
  globalLogoCache.set(key, row);
  globalLogoCache.delete(`${key}:pending`);
  resolvePending();
  return row;
}

function asset365(name, logoUrl, kind) {
  return {
    name: cleanText(name),
    logo: logoUrl,
    initials: initials(name),
    logoSource: "365Scores",
    logoTier: 1,
  };
}

async function enrichLogos(rows) {
  async function teamAsset(name, directUrl) {
    const key = cleanText(name);
    // If we already have a 365Scores URL, use it directly — no lookup needed
    if (directUrl) return asset365(key, directUrl, "team");
    const row = await resolveLogoRow("teams", "team", key);
    return {
      name: key,
      logo: row?.logo_url || fallbackLogo(key, "team"),
      initials: initials(key),
      logoSource: row?.source || (row?.logo_url ? "win2go teams" : "generated team badge"),
    };
  }
  async function leagueAsset(name, directUrl) {
    const key = cleanText(name);
    if (directUrl) return asset365(key, directUrl, "league");
    const row = await resolveLogoRow("leagues", "league", key);
    return {
      name: key,
      logo: row?.logo_url || fallbackLogo(key, "league"),
      initials: initials(key),
      logoSource: row?.source || (row?.logo_url ? "win2go leagues" : "generated league badge"),
    };
  }
  function withLeagueFallback(asset, leagueAssetValue, teamName) {
    if (hasVerifiedLogo(asset)) return { ...asset, logoTier: asset.logoTier || 1 };
    if (hasVerifiedLogo(leagueAssetValue)) {
      return {
        ...asset,
        logo: leagueAssetValue.logo,
        logoSource: `league fallback: ${leagueAssetValue.logoSource}`,
        logoTier: 3,
        fallbackFor: teamName,
      };
    }
    return { ...asset, logo: fallbackLogo(teamName, "team"), logoSource: "dynamic generated shield", logoTier: 4 };
  }
  return Promise.all(rows.map(async (row) => {
    const [leagueAssetValue, homeRaw, awayRaw] = await Promise.all([
      leagueAsset(row.league, row.leagueLogoUrl),
      teamAsset(row.home, row.homeLogoUrl),
      teamAsset(row.away, row.awayLogoUrl),
    ]);
    const homeAsset = withLeagueFallback(homeRaw, leagueAssetValue, row.home);
    const awayAsset = withLeagueFallback(awayRaw, leagueAssetValue, row.away);
    return { ...row, homeAsset, awayAsset, leagueAsset: leagueAssetValue };
  }));
}

function resultIndex(results) {
  const map = new Map();
  map.set("__events__", results || []);
  for (const event of results || []) {
    map.set(String(event.eventid), event);
    for (const key of resultKeyVariants({
      day: event.date,
      sportId: event.sportid,
      home: event.teamA,
      away: event.teamB,
    })) {
      map.set(key, event);
    }
  }
  return map;
}

function nameTokens(value) {
  return normalizeMatchName(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !["fc", "bc", "bk", "cf", "u19", "u20", "u21"].includes(token));
}

function teamNameScore(a, b) {
  const left = normalizeMatchName(a);
  const right = normalizeMatchName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const leftTokens = new Set(nameTokens(left));
  const rightTokens = new Set(nameTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function resultMatchScore(row, event) {
  if (!row || !event) return 0;
  // Support both raw API events (sportid/date/teamA/teamB) and processed rows (sportId/day/home/away)
  const rowSportId = String(row.sportId || row.sportid || "");
  const evtSportId = String(event.sportId || event.sportid || "");
  if (rowSportId !== evtSportId) return 0;
  const rowDay = String(row.day || row.date || "");
  const evtDay = String(event.day || event.date || "");
  if (rowDay !== evtDay) return 0;
  const evtHome = event.home || event.teamA;
  const evtAway = event.away || event.teamB;
  const direct = (teamNameScore(row.home, evtHome) + teamNameScore(row.away, evtAway)) / 2;
  const swapped = (teamNameScore(row.home, evtAway) + teamNameScore(row.away, evtHome)) / 2;
  return Math.max(direct, swapped);
}

function findResultEvent(resultsByEvent, row) {
  if (!resultsByEvent || !row) return null;
  const direct = resultsByEvent.get(String(row.eventId)) || resultsByEvent.get(String(row.resultKey || ""));
  if (direct) return direct;
  for (const key of resultKeyVariants(row)) {
    const event = resultsByEvent.get(key);
    if (event) return event;
  }
  const events = resultsByEvent.get("__events__") || [];
  let best = null;
  let bestScore = 0;
  for (const event of events) {
    const score = resultMatchScore(row, event);
    if (score > bestScore) {
      best = event;
      bestScore = score;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

function resultWinner(event) {
  const markets = event?.markets || [];
  const market = markets.find((m) => /1X2|winner/i.test(cleanText(m.title)) || cleanText(m.title).includes("המנצח") || cleanText(m.title).includes("׳”׳׳ ׳¦׳—"));
  const raw = cleanText((market?.marketResults || [])[0]);
  if (raw) return raw.toLowerCase() === "x" ? "תיקו" : raw;
  return isFinalResultEvent(event) ? scoreBasedWinner(event) : "";
}

function scoreNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreBasedWinner(event) {
  const homeScore = scoreNumber(event?.scoreA);
  const awayScore = scoreNumber(event?.scoreB);
  if (homeScore === null || awayScore === null) return "";
  if (homeScore === awayScore) return "תיקו";
  return homeScore > awayScore ? cleanText(event?.teamA) : cleanText(event?.teamB);
}

function isFinalResultEvent(event) {
  const status = cleanText(event?.status || event?.statusText || event?.eventStatus || event?.matchStatus || event?.state);
  return event?.isFinal === true ||
    Number(event?.statusGroup) === 4 ||
    /final|ended|finished|full.?time|after extra time|הסתיים|סיום|נגמר/i.test(status);
}

function spreadStatus(event, row) {
  const rawSpread = row?.spread;
  // null/undefined/empty means no spread — don't run spread logic on 1X2 picks
  if (rawSpread === null || rawSpread === undefined || rawSpread === "") return "";
  const spread = Number(rawSpread);
  if (!Number.isFinite(spread)) return "";
  const homeScore = scoreNumber(event?.scoreA);
  const awayScore = scoreNumber(event?.scoreB);
  if (homeScore === null || awayScore === null) return "";
  const pick = cleanText(row.pickTeam || row.winnerPick || row.pick);
  const home = cleanText(row.home);
  const away = cleanText(row.away);
  const adjusted = pick === home
    ? homeScore + spread - awayScore
    : pick === away
      ? awayScore + spread - homeScore
      : null;
  if (adjusted === null) return "";
  if (adjusted > 0) return "hit";
  if (adjusted < 0) return "miss";
  return "לא אומת";
}

function resultPhase(event) {
  if (!event) return "scheduled";
  const status = cleanText(event.status || event.statusText || event.eventStatus || event.matchStatus || event.state);
  const hasScore = scoreText(event.scoreA, event.scoreB, event.noScoreLabel);
  const statusGroup = Number(event.statusGroup);
  // Check FINAL first — a game with a winner is always over, regardless of status text
  if (resultWinner(event)) return "final";
  if (/cancel|cancelled|canceled|abandon|void|בוטל|מבוטל/i.test(status)) return "cancelled";
  if (/postpone|postponed|delayed|נדחה|דחוי/i.test(status)) return "postponed";
  if (/halftime|half.?time|half_time|הפסקה|מחצית/i.test(status)) return "ht";
  if (/final|ended|finished|over|הסתיים|נגמר/i.test(status)) return "final";
  if (isFinalResultEvent(event)) return "final";
  if ((statusGroup === 2 || statusGroup === 3) && hasScore) return "live";
  if (/live|in.?play|playing|חי|משוחק/i.test(status)) return "live";
  // hasScore alone is NOT enough to call live — many cached/stale feeds have scores but are finished
  // Only call live if statusGroup explicitly signals it (365Scores) or status says so
  return "scheduled";
}

function applyResult(row, event) {
  if (!event) return row;
  const actualWinner = resultWinner(event);
  const result = scoreText(event.scoreA, event.scoreB, event.noScoreLabel);
  const phase = resultPhase(event);
  const calculatedSpreadStatus = phase === "final" ? spreadStatus(event, row) : "";
  let finalStatus = "ממתין";
  if (phase === "cancelled") {
    finalStatus = "בוטל";
  } else if (phase === "postponed") {
    finalStatus = "לא אומת";
  } else if (phase === "final") {
    if (calculatedSpreadStatus) {
      finalStatus = calculatedSpreadStatus;
    } else {
      const serverStatus = resultStatus({ markets: event.markets || [] }, row.winnerPick || row.pick);
      if (serverStatus !== "ממתין") {
        finalStatus = serverStatus;
      } else if (actualWinner) {
        // marketResults empty (or no match) — fuzzy-compare actual winner with pick
        // handles Winner vs 365scores transliteration differences
        const pick = cleanText(row.winnerPick || row.pickTeam || row.pick);
        finalStatus = (pick === actualWinner || teamNameScore(pick, actualWinner) >= 0.75) ? "hit" : "miss";
      }
    }
  }
  return {
    ...row,
    liveScore: result || row.liveScore || "",
    result: result || row.result || "",
    actualWinner: actualWinner || row.actualWinner || "",
    matchPhase: phase,
    bettingStatus: phase === "cancelled" ? "cancelled" : phase === "postponed" ? "postponed" : row.bettingStatus,
    resultVerifiedAt: phase === "final" || phase === "cancelled" || phase === "postponed" ? new Date().toISOString() : row.resultVerifiedAt,
    finishedAt: phase === "final" ? (event.finishedAt || event.closedAt || new Date().toISOString()) : row.finishedAt,
    matchMinute: phase === "live" || phase === "ht" ? event.matchMinute || event.gameTime || row.matchMinute || "" : row.matchMinute,
    status: finalStatus,
  };
}

function marketReliability(title, sportId) {
  const text = cleanText(title);
  if (Number(sportId) === WINNER_FOOTBALL_ID && text.includes("1X2") && text.includes("תוצאת סיום")) return 0.98;
  if (Number(sportId) === WINNER_BASKETBALL_ID && (text.includes("המנצח") || text.includes("מנצח") || text.includes("מנצחת"))) return 0.97;
  if (text.includes("מעל/מתחת")) return 0.91;
  if (text.includes("הימור יתרון")) return 0.88;
  return 0.72;
}

function marketCategory(title) {
  const clean = cleanText(title);
  if (clean.includes("1X2") || clean.includes("המנצח")) return "מנצח";
  if (clean.includes("מעל/מתחת")) return "מעל/מתחת";
  if (clean.includes("הימור יתרון")) return "יתרון";
  if (clean.includes("מבקיע") || clean.includes("סל ראשון") || clean.includes("שער ראשון")) return "ראשון במשחק";
  if (clean.includes("מחצית")) return "מחציות";
  return "שוק נוסף";
}

function marketTier(title, sportId) {
  const clean = cleanText(title);
  if (Number(sportId) === WINNER_FOOTBALL_ID && clean.includes("1X2") && clean.includes("תוצאת סיום")) return "primary";
  if (Number(sportId) === WINNER_BASKETBALL_ID && (clean.includes("המנצח") || clean.includes("מנצח") || clean.includes("מנצחת"))) return "primary";
  if (Number(sportId) === WINNER_BASKETBALL_ID && clean.includes("הימור יתרון")) return "spread";
  if (clean.includes("סיכוי כפול")) return "alternative-double-chance";
  if (clean.includes("מעל/מתחת")) return "alternative-total";
  return "alternative";
}

function scoreAnyOutcome(market, outcome) {
  const odds = decimal(outcome.price);
  if (!odds) return null;
  const reliability = marketReliability(market.mp, market.sId);
  const implied = 1 / odds;
  const sourceDepth = Math.min(1, Number(market.count || market.outcomes?.length || 1) / 8);
  const hitProbability = Math.max(0.08, Math.min(0.82, implied * reliability));
  const score = Math.round(hitProbability * 68 + reliability * 18 + sourceDepth * 14);
  return {
    outcomeId: outcome.outcomeId,
    desc: cleanText(outcome.desc),
    team: outcomeTeam(outcome.desc),
    price: odds,
    spread: cleanText(outcome.spread) || parseSpread(outcome.desc),
    probability: hitProbability,
    score,
  };
}

function marketOddsBook(market) {
  const teams = splitTeams(market.desc);
  const rawOutcomes = (market.outcomes || [])
    .map((outcome) => ({
      desc: cleanText(outcome.desc),
      team: outcomeTeam(outcome.desc),
      spread: parseSpread(outcome.desc),
      odds: decimal(outcome.price),
    }))
    .filter((outcome) => outcome.desc && outcome.odds);
  const impliedTotal = rawOutcomes.reduce((total, outcome) => total + (1 / outcome.odds), 0);
  const withProbability = rawOutcomes.map((outcome) => ({
    ...outcome,
    implied: 1 / outcome.odds,
    noVigProbability: impliedTotal ? (1 / outcome.odds) / impliedTotal : null,
  }));
  const findBySide = (side) => {
    const raw = side === "home" ? teams.home : teams.away;
    const target = outcomeTeam(raw); // strip spread e.g. "(+6.5)" from desc-derived name
    return withProbability.find((outcome) => cleanText(outcome.team || outcome.desc) === cleanText(target));
  };
  const draw = withProbability.find((outcome) => cleanText(outcome.desc).toLowerCase() === "x");
  return {
    home: findBySide("home") || null,
    draw: draw || null,
    away: findBySide("away") || null,
    outcomes: withProbability,
    overround: Math.max(0, impliedTotal - 1),
  };
}

function buildEventMarkets(eventMarkets) {
  return eventMarkets.map((market) => {
    const outcomes = (market.outcomes || [])
      .map((outcome) => scoreAnyOutcome(market, outcome))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.price - a.price);
    return {
      marketId: market.mId,
      title: cleanText(market.mp),
      category: marketCategory(market.mp),
      bettable: outcomes.length > 0,
      best: outcomes[0] || null,
      outcomes,
    };
  }).filter((market) => market.bettable);
}

function allowedMarket(market) {
  const title = cleanText(market.mp);
  const desc = cleanText(market.desc);
  if (!SPORTS[market.sId]) return false;
  if (title.includes("תוצאה מדויקת")) return false;
  if (title.includes("מחצית/סיום")) return false;
  if (title.includes("מחצית ראשונה")) return false;
  if (title.includes("רבע ראשון")) return false;
  if (title.includes("סל ראשון")) return false;
  if (title.includes("הראשונה ל")) return false;
  if (title.includes("מבקיע")) return false;
  if (title.includes("קרנות")) return false;
  if (title.includes("הזוכה")) return false;
  if (desc.includes("הזוכה")) return false;
  if (Number(market.sId) === WINNER_FOOTBALL_ID) {
    const primary = title.includes("1X2") && title.includes("תוצאת סיום");
    const doubleChance = title.includes("סיכוי כפול") || title.includes("Double Chance");
    const overUnder = title.includes("מעל/מתחת") && !title.includes("מחצית");
    return primary || doubleChance || overUnder;
  }
  if (Number(market.sId) === WINNER_BASKETBALL_ID) {
    // Accept any "winner / moneyline" style basketball market
    const isWinner = title.includes("המנצח") || title.includes("מנצח") || title.includes("מנצחת");
    const isFullGameSpread =
      title.includes("הימור יתרון") &&
      (title.includes("כולל הארכות") || title.includes("ללא הארכות"));
    const isMoneyline = title.includes("1X2") && !title.includes("מחצית");
    return isWinner || isFullGameSpread || isMoneyline;
  }
  return false;
}

function scoreOutcome(market, outcome) {
  const odds = decimal(outcome.price);
  const isBasketball = Number(market.sId) === WINNER_BASKETBALL_ID;
  const isSpread = cleanText(market.mp).includes("הימור יתרון");
  const oddsMin = isBasketball ? BASKETBALL_ODDS_MIN : ODDS_MIN;
  const oddsMax = isBasketball
    ? (isSpread ? BASKETBALL_ODDS_MAX_SPREAD : BASKETBALL_ODDS_MAX_MONEYLINE)
    : ODDS_MAX;
  if (!odds || odds <= oddsMin || odds >= oddsMax) return null;
  const oddsBook = marketOddsBook(market);
  const reliability = marketReliability(market.mp, market.sId);
  const implied = 1 / odds;
  const desc = cleanText(outcome.desc);
  const isOverUnder = cleanText(market.mp).includes("מעל/מתחת");
  const pickTeam = isOverUnder
    ? (desc.includes("מעל") ? "מעל" : desc.includes("מתחת") ? "מתחת" : outcomeTeam(desc))
    : outcomeTeam(desc);
  const spread = isOverUnder ? parseOverUnderLine(desc) : parseSpread(desc);
  const current = oddsBook.outcomes.find((item) => item.desc === cleanText(outcome.desc) && item.odds === odds);
  const normalizedProbability = current?.noVigProbability || implied;
  const competitors = oddsBook.outcomes
    .filter((item) => item.desc !== cleanText(outcome.desc))
    .map((item) => item.noVigProbability || item.implied)
    .sort((a, b) => b - a);
  const closestCompetitor = competitors[0] || 0;
  const marketGap = Math.max(0, normalizedProbability - closestCompetitor);
  const overround = oddsBook.overround;
  const marginPenalty = overround > 0.10
    ? Math.min(0.16, overround) * 60
    : overround * 25;
  const sourceDepth = Math.min(1, Number(market.count || market.outcomes?.length || 1) / 8);
  const hitProbability = Math.max(0.34, Math.min(0.82, normalizedProbability * reliability));
  const ev = normalizedProbability * odds - 1;
  const evBonus = ev > 0 ? Math.min(20, ev * 50) : Math.max(-15, ev * 30);
  const largeGapBonus = marketGap > 0.15 ? Math.round((marketGap - 0.15) * 40) : 0;
  const score = Math.round(
    normalizedProbability * 70 +
      marketGap * 34 +
      largeGapBonus +
      reliability * 12 +
      sourceDepth * 6 +
      evBonus -
      marginPenalty
  );
  return {
    outcomeId: outcome.outcomeId,
    pick: cleanText(outcome.desc),
    pickTeam,
    spread,
    odds,
    implied,
    normalizedProbability,
    marketGap,
    overround: oddsBook.overround,
    hitProbability,
    reliability,
    ev,
    score: Math.max(1, Math.min(100, score)),
    oddsBook,
  };
}

function describeOverUnderPick(market, scored) {
  const dir = scored.pickTeam || (cleanText(scored.pick).includes("מעל") ? "מעל" : "מתחת");
  const opposite = dir === "מעל" ? "מתחת" : "מעל";
  const line = scored.spread;
  const lineText = line != null ? `${line} גולים` : "גולים";
  const impliedPct = Math.round((scored.normalizedProbability || 0) * 100);
  const odds = scored.odds ? scored.odds.toFixed(2) : "?";
  const opponentOutcome = scored.oddsBook?.outcomes?.find((o) => {
    const d = cleanText(o.team || o.desc);
    return dir === "מעל" ? d.includes("מתחת") : d.includes("מעל");
  });
  const oppOdds = opponentOutcome?.odds;
  const oppPct = opponentOutcome?.noVigProbability ? Math.round(opponentOutcome.noVigProbability * 100) : null;
  let parts = [
    `שוק מעל/מתחת ${lineText}: Winner מתמחר "${dir}" ב-${odds} — הסתברות מנוכת מרווח של ${impliedPct}%.`,
  ];
  if (oppOdds && oppPct) {
    const gap = impliedPct - oppPct;
    parts.push(`"${opposite}" מתומחר ב-${oppOdds.toFixed(2)} (${oppPct}%) — האלגוריתם סימן את "${dir}" כצד בעל יתרון של ${gap} נקודות אחוז.`);
  }
  if (line != null) {
    if (line <= 2.5) {
      parts.push(`קו ${line} גולים הוא נפוץ בכדורגל אירופאי (ממוצע הלשכות ~2.6 גולים למשחק). ${dir === "מעל" ? "הניתוח מניח שהמשחק יהיה פתוח." : "הניתוח מניח שהמשחק יהיה כבד הגנתית."}`);
    } else {
      parts.push(`קו ${line} גולים — קו גבוה, מתאים למשחקים התקפיים. ${dir === "מעל" ? "הניתוח מניח לפחות " + Math.ceil(line) + " גולים." : "הניתוח מניח משחק צמוד ומועט גולים."}`);
    }
  }
  parts.push(`האלגוריתם מבוסס על סיגנל שוק Winner: כשהצד "${dir}" מתומחר בטווח 1.40–1.90 ומשקף הסתברות גבוהה לאחר ניכוי מרווח הבית, הוא נכנס לניתוח המרכזי.`);
  return parts.join(" ");
}

function describeWinnerPick(market, scored, teams) {
  if (cleanText(market.mp).includes("מעל/מתחת")) return describeOverUnderPick(market, scored);
  const outcomes = (market.outcomes || [])
    .map((outcome) => ({
      desc: cleanText(outcome.desc),
      odds: decimal(outcome.price),
    }))
    .filter((outcome) => outcome.odds)
    .sort((a, b) => a.odds - b.odds);
  const favorite = outcomes[0];
  const opponent = outcomes.find((outcome) => outcome.desc !== scored.pick && cleanText(outcome.desc).toLowerCase() !== "x");
  const draw = outcomes.find((outcome) => cleanText(outcome.desc).toLowerCase() === "x");
  const alternatives = outcomes
    .filter((outcome) => outcome.desc !== scored.pick)
    .slice(0, 2)
    .map((outcome) => `${outcome.desc} ${outcome.odds.toFixed(2)}`)
    .join(", ");
  const pickText = cleanText(scored.pick).toLowerCase() === "x" ? "תיקו" : scored.pick;
  const pickedTeam = cleanText(scored.pickTeam || scored.pick);
  const side =
    pickedTeam === cleanText(teams.home) ? "home" :
    pickedTeam === cleanText(teams.away) ? "away" :
    cleanText(scored.pick).toLowerCase() === "x" ? "draw" : "team";
  const venueReason =
    side === "home" ? `${pickText} משחקת בבית, ולכן הצד שנבחן מקבל גם יתרון מגרש.` :
    side === "away" ? `${pickText} מסומנת כפייבוריטית גם בחוץ, וזה בדרך כלל מצביע על פער איכות מול היריבה ולא רק על יתרון ביתיות.` :
    side === "draw" ? "תיקו נבחר רק אם השוק מתמחר אותו בתוך הטווח ובפער סביר מהקבוצות." :
    "הצד שנבחן מזוהה ישירות מתוך שוק המנצח של Winner.";
  const gapReason = opponent?.odds
    ? `מול ${opponent.desc}, השוק נותן ליריבה יחס ${opponent.odds.toFixed(2)}, כלומר Winner רואה אותה כפחות סבירה לניצחון.`
    : "";
  const drawReason = draw?.odds ? `גם התיקו רחוק יותר ביחס ${draw.odds.toFixed(2)}.` : "";
  if (favorite?.desc === scored.pick) {
    return `${pickText} מסומנת כבעלת יתרון סטטיסטי כי היא הפייבוריטית הברורה בשוק המנצח של Winner. ${venueReason} ${gapReason} ${drawReason} ${alternatives ? `חלופות השוק: ${alternatives}.` : ""}`.replace(/\s+/g, " ").trim();
  }
  return `${pickText} מסומנת כי היא עדיין צד מנצח פתוח ב-Winner בתוך הטווח המבוקש. ${venueReason} ${favorite ? `חשוב: הפייבוריט הראשי לפי Winner הוא ${favorite.desc}, לכן זה צד מסוכן יותר.` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Rich explanation for a basketball pick, incorporating the confidence score
 * and the moneyline-vs-spread rationale.
 */
function describeBasketballPick(market, scored, teams, confidence, rationale) {
  const isSpread = cleanText(market.mp).includes("הימור יתרון");
  const pick = isSpread
    ? `${scored.pickTeam || scored.pick}${scored.spread != null ? ` (${scored.spread > 0 ? "+" : ""}${scored.spread})` : ""}`
    : scored.pickTeam || scored.pick;
  const prob    = Math.round((scored.normalizedProbability || 0) * 100);
  const gap     = Math.round((scored.marketGap || 0) * 100);
  const band    = confidenceBand(confidence);
  const conf    = confidence || 0;

  const oddsBook = scored.oddsBook;
  const opponent = (oddsBook?.outcomes || [])
    .filter((o) => cleanText(o.team || o.desc) !== cleanText(scored.pickTeam || scored.pick))
    .sort((a, b) => (b.noVigProbability || 0) - (a.noVigProbability || 0))[0];
  const oppOdds = opponent?.odds?.toFixed(2);
  const oppPct  = opponent?.noVigProbability ? Math.round(opponent.noVigProbability * 100) : null;

  const confLine = conf >= 90
    ? `ביטחון גבוה מאוד (${conf}/100 — ${band}): האלגוריתם מזהה יתרון ברור בשוק המנצח.`
    : conf >= 80
    ? `ביטחון גבוה (${conf}/100 — ${band}): ניתוח מונילין מועדף; ספרד רק אם הפער מצדיק זאת.`
    : `ביטחון מספיק (${conf}/100 — ${band}): המודל ממליץ על שוק המנצח בלבד.`;

  const marketLine = isSpread
    ? `שוק יתרון (ספרד): הבחירה בליין ${scored.spread != null ? scored.spread : "?"} נבחרה כי יתרון השוק (${gap}%) גבוה מספיק על פני המונילין לאותו משחק.`
    : `שוק מנצח (מונילין): ניתוח ישיר מי ינצח — פחות מסוכן מהימור ספרד, בעל שיעור הצלחה גבוה יותר לאורך זמן.`;

  const probLine = `הסתברות מנוכת מרווח לטובת "${pick}": ${prob}%.`;
  const gapLine  = oppOdds && oppPct
    ? `פער מהיריב: ${gap}% — ${opponent.team || opponent.desc} מתומחר ב-${oppOdds} (${oppPct}%).`
    : `פער שוק: ${gap}%.`;

  const rationaleLine = {
    "strong-moneyline": "הניתוח בחר ישירות במונילין — ביטחון 90+ מוביל לבחירה מכוונת בשוק הבטוח יותר.",
    "moneyline-preferred": "המונילין נבחר כברירת מחדל; ספרד לא הגיע לפער מינימלי של 15 נקודות ביטחון.",
    "moneyline-only": "ביטחון 75–79: האלגוריתם מגביל את הניתוח לשוק המנצח בלבד.",
    "spread-edge": "ספרד נבחר רק כי הציון שלו גבוה ב-15+ נקודות מהמונילין — יתרון שוק יוצא דופן.",
  }[rationale] || "";

  return [confLine, marketLine, probLine, gapLine, rationaleLine].filter(Boolean).join(" ");
}

const BOARD_PICK_LIMIT = 60;
const CENTRAL_LEAGUE_PATTERNS = [
  // בינלאומי — מונדיאל ותחרויות נבחרות
  "מונדיאל",
  "World Cup",
  "FIFA",
  "ליגת האומות",
  "Nations League",
  "קופה אמריקה",
  "Copa America",
  "גביע אפריקה",
  "CONCACAF",
  // ליגות מובילות
  "ליגת Winner",
  "פרמייר ליג",
  "אנגלית ראשונה",
  "ספרדית ראשונה",
  "לה ליגה",
  "איטלקית ראשונה",
  "סרייה א",
  "גרמנית ראשונה",
  "בונדסליגה",
  "NBA",
  "יורוליג",
  "ליגת אלופות",
  "Champions League",
  "Europa League",
  "ליגת האלופות",
  "ליגת אירופה",
  "ליגה הלאומית",
  "Ligue 1",
  "Eredivisie",
  "מחצית ראשונה",
];
const HIGH_PROFILE_TEAM_PATTERNS = [
  // נבחרות לאומיות גדולות
  "ברזיל",
  "ארגנטינה",
  "צרפת",
  "ספרד",
  "אנגליה",
  "גרמניה",
  "פורטוגל",
  "הולנד",
  "איטליה",
  "ישראל",
  "מרוקו",
  "ארצות הברית",
  // קבוצות ישראלי
  "בית\"ר ירושלים",
  "הפועל תל אביב",
  "מכבי תל אביב",
  "מכבי חיפה",
  "הפועל באר שבע",
  // קבוצות אירופה
  "ריאל מדריד",
  "ברצלונה",
  "ליברפול",
  "מנצ'סטר",
  "ארסנל",
  "צ'לסי",
  "טוטנהאם",
  "יובנטוס",
  "מילאן",
  "אינטר",
  "נאפולי",
  "באיירן",
  "דורטמונד",
  // כדורסל
  "קליבלנד",
  "ניו יורק ניקס",
];

function countRecommendedPicks(rows) {
  return (rows || []).filter((row) => row.recommended && row.odds && row.status === "ממתין").length;
}

function includesPattern(value, patterns) {
  const text = cleanText(value);
  return patterns.some((pattern) => text.includes(cleanText(pattern)));
}

function isCentralEvent(row) {
  return includesPattern(row.league, CENTRAL_LEAGUE_PATTERNS) ||
    includesPattern(`${row.home} ${row.away}`, HIGH_PROFILE_TEAM_PATTERNS);
}

function hasVerifiedLogo(asset) {
  return Boolean(asset?.logo);
}

function hasVerifiedTeamLogos(row) {
  return hasVerifiedLogo(row.homeAsset) &&
    hasVerifiedLogo(row.awayAsset) &&
    row.homeAsset.logo !== row.awayAsset.logo;
}

function favoriteInfo(row) {
  const outcomes = (row.oddsBook?.outcomes || [])
    .filter((item) => Number(item.odds))
    .sort((a, b) => a.odds - b.odds);
  const favorite = outcomes[0] || null;
  const second = outcomes[1] || null;
  const pick = cleanText(row.pickTeam || row.winnerPick || row.pick);
  const favoriteTeam = cleanText(favorite?.team || favorite?.desc);
  return {
    favorite,
    second,
    isFavorite: Boolean(favorite && pick && (pick === favoriteTeam || favoriteTeam.includes(pick) || pick.includes(favoriteTeam))),
    oddsGap: favorite && second ? second.odds - favorite.odds : 0,
  };
}

function hasSingleClearFavorite(row) {
  // Basketball spread markets are designed to be 50/50 — the lower-odds side is the pick
  if (Number(row.sportId) === WINNER_BASKETBALL_ID && row.marketTier === "spread") {
    return Number(row.normalizedProbability || 0) >= 0.47 || Number(row.marketGap || 0) >= 0.01;
  }
  // Basketball moneyline clear favorites have very high normalizedProbability
  if (Number(row.sportId) === WINNER_BASKETBALL_ID) {
    const info = favoriteInfo(row);
    return info.isFavorite && (
      Number(row.normalizedProbability || 0) >= 0.52 ||
      Number(info.oddsGap || 0) >= 0.15 ||
      Number(row.marketGap || 0) >= 0.04
    );
  }
  const info = favoriteInfo(row);
  return info.isFavorite && (
    Number(row.marketGap || 0) >= 0.06 ||
    Number(info.oddsGap || 0) >= 0.25 ||
    Number(row.normalizedProbability || 0) >= 0.55
  );
}

/**
 * Basketball-specific confidence score (0–100).
 * Drives moneyline-vs-spread decision and minimum pick threshold.
 *
 * Factors (all derived from live Winner odds data):
 *   • Normalized win probability (market-implied, vig-stripped)   → up to 60 pts
 *   • Market gap vs closest opponent                              → up to 22 pts
 *   • Odds sweet-spot 1.50–1.80                                   → up to 10 pts
 *   • Overround penalty (sharp markets score higher)              → up to −18 pts
 *   • Spread/handicap market inherent risk penalty                → −12 pts
 *
 * Decision thresholds:
 *   ≥ 90 → Strong Moneyline
 *   80–89 → Moneyline preferred; Spread only if edge ≥ 15 pts higher
 *   75–79 → Moneyline only
 *   < 75  → No recommendation
 */
function basketballConfidence(row) {
  if (Number(row.sportId) !== WINNER_BASKETBALL_ID) return 0;
  const prob = Number(row.normalizedProbability || row.probability || 0);
  const gap  = Number(row.marketGap || 0);
  const over = Number(row.overround || 0);
  const odds = Number(row.odds || row.oddsRaw || 0);
  const isSpread = row.marketTier === "spread";

  let conf = Math.round(prob * 60);                          // 0–60
  conf += Math.min(22, Math.round(gap * 90));                // market gap
  if (odds >= 1.45 && odds <= 1.85) {
    conf += Math.round((1 - Math.abs(odds - 1.65) / 0.4) * 10); // sweet-spot
  }
  conf -= Math.round(Math.min(18, over * 90));               // overround penalty
  if (isSpread) conf -= 12;                                  // spread risk penalty
  return Math.max(0, Math.min(100, conf));
}

/**
 * Returns a human-readable label for the confidence band.
 */
function confidenceBand(conf) {
  if (conf >= 90) return "חזק מאוד";
  if (conf >= 80) return "גבוה";
  if (conf >= 75) return "בינוני-גבוה";
  return "נמוך";
}

function scoreBreakdown(row) {
  const odds = Number(row.odds || row.oddsRaw || 0);
  const oddsQuality = odds
    ? Math.max(0, Math.min(1, (odds - ODDS_MIN) / (ODDS_MAX - ODDS_MIN)))
    : 0;
  const hit = Number(row.probability || row.normalizedProbability || 0);
  const marketGap = Number(row.marketGap || 0);
  const reliability = Number(row.reliability || 0);
  const overroundPenalty = Math.min(0.16, Number(row.overround || 0)) * 30;
  const clearFavorite = hasSingleClearFavorite(row);
  const central = isCentralEvent(row);
  const spread = Number(row.spread);
  const proximityBonus = Number(row.proximityBonus || 0);
  const isBasketballRow = Number(row.sportId) === WINNER_BASKETBALL_ID;
  // For basketball spread picks: large lines are riskier; also apply a base spread penalty
  const isBballSpread = isBasketballRow && row.marketTier === "spread";
  const extremeSpreadPenalty = isBasketballRow && Number.isFinite(spread) && Math.abs(spread) > 12
    ? 24
    : isBballSpread ? 10 : 0;
  const tooLowOddsPenalty = !isBasketballRow && odds <= 1.42 && marketGap < 0.08 ? 10 : 0;
  // Sweet spot bonus: odds 1.55–1.80 are statistically the most reliable range
  const sweetSpotBonus = odds >= 1.50 && odds <= 1.85
    ? Math.round((1 - Math.abs(odds - 1.675) / 0.325) * 14)
    : 0;
  // Expected Value bonus: positive EV is the core signal for a genuine value pick
  const ev = Number(row.ev || 0);
  const evBonus = ev > 0
    ? Math.round(Math.min(30, ev * 55))
    : Math.max(-20, Math.round(ev * 35));
  // Value indicator bonus: when Winner prices this outcome higher than fair odds
  const valueIndicatorBonus = row.valueIndicator === "winner_higher" ? 8 : 0;
  // Large market gap bonus: gap > 15% is a very strong signal
  const largeGapBonus = marketGap > 0.15 ? Math.round((marketGap - 0.15) * 50) : 0;
  // Aggressive overround penalty: markets with >10% margin are much less trustworthy
  const overroundRaw = Number(row.overround || 0);
  const sharpOverroundPenalty = overroundRaw > 0.10
    ? Math.round(overroundRaw * 70)
    : Math.round(overroundRaw * 30);
  const components = {
    hitProbability: Math.round(hit * 72),
    oddsValue: Math.round(oddsQuality * 14) + sweetSpotBonus,
    marketGap: Math.round(marketGap * 34) + largeGapBonus,
    reliability: Math.round(reliability * 10),
    ev: evBonus,
    valueIndicator: valueIndicatorBonus,
    niche: 0,
    clearFavorite: clearFavorite ? 18 : -30,
    proximity: proximityBonus,
    overroundPenalty: -sharpOverroundPenalty,
    lowOddsPenalty: -tooLowOddsPenalty,
    extremeSpreadPenalty: -extremeSpreadPenalty,
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  return {
    ...components,
    total,
    labels: {
      hitProbability: "הסתברות מודל",
      oddsValue: "ערך יחס + sweet spot",
      marketGap: "פער שוק",
      reliability: "אמינות שוק",
      ev: "ערך צפוי (EV)",
      valueIndicator: "Winner מעל שוק הוגן",
      niche: "נישה",
      clearFavorite: "פייבוריטית ברורה",
      proximity: "קרבה לפתיחה",
      overroundPenalty: "מרווח בית",
      lowOddsPenalty: "יחס נמוך מדי",
      extremeSpreadPenalty: "ליין קיצוני",
    },
  };
}

function recommendationRank(row) {
  return scoreBreakdown(row).total;
}

function rejectionReasons(row) {
  const reasons = [];
  if (!row.recommended || !row.odds) reasons.push("לא ניתוח פעיל");
  if (!hasVerifiedLogo(row.homeAsset)) reasons.push("אין לוגו אמיתי לקבוצת הבית");
  if (!hasVerifiedLogo(row.awayAsset)) reasons.push("אין לוגו אמיתי לקבוצת החוץ");
  if (row.homeAsset?.logo && row.homeAsset.logo === row.awayAsset?.logo) reasons.push("לוגו זהה לשתי הקבוצות");
  if (!hasSingleClearFavorite(row)) reasons.push("אין פייבוריטית אחת מספיק ברורה");
  const oddsLowThreshold = Number(row.sportId) === WINNER_BASKETBALL_ID ? 1.27 : 1.42;
  if (Number(row.odds || 0) <= oddsLowThreshold && Number(row.marketGap || 0) < 0.04) {
    reasons.push("יחס נמוך מדי בלי פער שוק גדול");
  }
  return reasons;
}

function buildCurrentPicks(markets, dateKey, limit = TARGET_PICKS_PER_SPORT, resultsByEvent = new Map(), sportIdFilter = null, standingsMap365 = new Map()) {
  const events = new Map();

  // First pass: collect all events that have an allowed market on this date
  // regardless of odds range — so every Winner game is represented
  for (const market of markets) {
    const date = winnerDateToIso(market.e_date);
    if (sportIdFilter && Number(market.sId) !== Number(sportIdFilter)) continue;
    if (date !== dateKey || !allowedMarket(market)) continue;

    const teams = splitTeams(market.desc);
    const oddsBook = marketOddsBook(market);
    const eventMarkets = buildEventMarkets(markets.filter((candidate) => candidate.eId === market.eId));

    // Try to find an in-range scored outcome first
    let bestScored = null;
    for (const outcome of market.outcomes || []) {
      const scored = scoreOutcome(market, outcome);
      if (!scored) continue;
      if (!bestScored || scored.score > bestScored.score || (scored.score === bestScored.score && scored.odds < bestScored.odds)) {
        bestScored = scored;
      }
    }

    // If no in-range outcome, pick the best (lowest odds = favourite) outcome
    // and mark it as outside-range so the UI can show it without a recommendation
    let outsideRange = false;
    let noOddsYet = false;
    if (!bestScored) {
      const allOutcomes = (market.outcomes || [])
        .map((outcome) => ({ outcome, odds: decimal(outcome.price) }))
        .filter((item) => item.odds)
        .sort((a, b) => a.odds - b.odds); // ascending = favourite first
      if (allOutcomes.length) {
        const best = allOutcomes[0];
        const odds = best.odds;
        const bestDesc = cleanText(best.outcome.desc);
        const isOverUnderFallback = cleanText(market.mp).includes("מעל/מתחת");
        const pickTeam = isOverUnderFallback
          ? (bestDesc.includes("מעל") ? "מעל" : bestDesc.includes("מתחת") ? "מתחת" : outcomeTeam(bestDesc))
          : outcomeTeam(bestDesc);
        const spread = isOverUnderFallback ? parseOverUnderLine(bestDesc) : parseSpread(bestDesc);
        const normalizedProbability = oddsBook.outcomes.find(
          (item) => item.desc === cleanText(best.outcome.desc)
        )?.noVigProbability || (1 / odds);
        bestScored = {
          outcomeId: best.outcome.outcomeId,
          pick: cleanText(best.outcome.desc),
          pickTeam,
          spread,
          odds,
          implied: 1 / odds,
          normalizedProbability,
          marketGap: 0,
          overround: oddsBook.overround,
          hitProbability: normalizedProbability,
          reliability: marketReliability(market.mp, market.sId),
          score: 0,
          oddsBook,
        };
        outsideRange = true;
      } else if ((market.outcomes || []).length >= 2) {
        // Betting lines not open yet — show game name only, no odds
        noOddsYet = true;
        outsideRange = true;
        bestScored = {
          outcomeId: null,
          pick: teams.home || "",
          pickTeam: teams.home || "",
          spread: null,
          odds: null,
          implied: null,
          normalizedProbability: null,
          marketGap: null,
          overround: null,
          hitProbability: null,
          reliability: null,
          score: 0,
          oddsBook: { outcomes: [], overround: 0 },
        };
      }
    }

    if (!bestScored) continue; // market has no outcomes at all — skip

    const scored = bestScored;
    const _verifiedAt = new Date().toISOString();
    const kickMs = kickoffMs(dateKey, market.m_hour);
    const hoursToKickoff = Number.isFinite(kickMs) ? (kickMs - Date.now()) / 3600000 : 99;
    const proximityBonus = hoursToKickoff >= 0 && hoursToKickoff <= 1 ? 14
      : hoursToKickoff <= 3 ? 10
      : hoursToKickoff <= 6 ? 6
      : hoursToKickoff <= 24 ? 2
      : 0;
    const fairOdds = scored.normalizedProbability > 0 ? 1 / scored.normalizedProbability : null;
    const valueIndicator = fairOdds && scored.odds && scored.odds > fairOdds * 1.03 ? "winner_higher" : null;
    const row = {
      id: `winner-${market.eId}`,
      eventId: String(market.eId),
      source: "Winner",
      verifiedAt: _verifiedAt,
      bettingStatus: "available",
      day: dateKey,
      time: winnerHour(market.m_hour),
      sport: SPORTS[market.sId],
      sportId: market.sId,
      league: cleanText(market.league),
      country: cleanText(market.country),
      match: cleanText(market.desc),
      home: teams.home,
      away: teams.away,
      resultKey: resultKeyFor({ day: dateKey, sportId: market.sId, home: teams.home, away: teams.away }),
      market: cleanText(market.mp),
      marketTier: marketTier(market.mp, market.sId),
      isAlternativeMarket: marketTier(market.mp, market.sId).startsWith("alternative"),
      marketId: market.mId,
      outcomeId: scored.outcomeId,
      pick: scored.pick,
      pickTeam: scored.pickTeam,
      spread: scored.spread,
      winnerPick: cleanText(scored.pick).toLowerCase() === "x" ? "תיקו" : scored.pick,
      odds: outsideRange ? null : scored.odds,           // null = no recommendation
      oddsRaw: scored.odds,                               // always the actual odds
      outsideRange,
      noOddsYet,
      oddsBook: scored.oddsBook,
      probability: outsideRange ? null : scored.hitProbability,
      normalizedProbability: scored.normalizedProbability,
      marketGap: scored.marketGap,
      overround: scored.overround,
      ev: outsideRange ? null : (scored.ev ?? null),
      globalAverageOdds: null,
      valueIndicator,
      fairOdds,
      proximityBonus,
      score: outsideRange ? 0 : scored.score,
      status: "ממתין",
      result: "",
      signals: noOddsYet
        ? ["קווי הימורים טרם נפתחו בווינר עבור משחק זה", "המשחק יוצג ברגע שהיחסים יתעדכנו"]
        : outsideRange
        ? [
            `יחס Winner ${scored.odds.toFixed(2)} — מחוץ לטווח הניתוח המרכזי (1.40–1.90)`,
            `הסתברות שוק ${Math.round(scored.normalizedProbability * 100)} אחוז`,
            "המשחק מוצג ללא יתרון סטטיסטי",
          ]
        : [
            `הסתברות Winner מנוכת מרווח ${Math.round(scored.normalizedProbability * 100)} אחוז`,
            `אמינות שוק ${Math.round(scored.reliability * 100)} אחוז`,
            `יחס Winner ${scored.odds.toFixed(2)}`,
            `פער מול היריבה הקרובה ${Math.round(scored.marketGap * 100)} אחוז`,
            ...(scored.ev > 0 ? [`ערך צפוי חיובי (EV +${(scored.ev * 100).toFixed(1)}%) — סיגנל ערך`] : []),
          ],
      allMarkets: eventMarkets,
      explanation: noOddsYet
        ? [
            "המשחק קיים במערכת Winner אך קווי ההימורים טרם נפתחו.",
            "ווינר פותחים קווים בהדרגה — בדרך כלל כמה שעות לפני הקיקאוף. המשחק יקבל ניתוח מלא ברגע שהיחסים יעלו.",
          ]
        : outsideRange
        ? [
            "המשחק מופיע בווינר-ליין אך הפייבוריט מחוץ לטווח הניתוח המרכזי.",
            `יחס הפייבוריט הוא ${scored.odds.toFixed(2)} — ${scored.odds < 1.4 ? "נמוך מדי (פערים ברורים מדי, סיכון גבוה להפתעה)" : "גבוה מדי (שוק פתוח מדי, אין יתרון ברור)"}. אין כאן יתרון סטטיסטי מסומן.`,
            "האלגוריתם מציג את המשחק כדי שתוכל לראות את כל הלוח — בלי לתת הוראת פעולה.",
          ]
        : [
            "המשחק מופיע בווינר-ליין ולכן יש נתון שוק פעיל בזמן משיכת הנתונים.",
            describeWinnerPick(market, scored, teams),
            "האלגוריתם משתמש ביחסי Winner לפני המשחק, ממיר אותם להסתברויות, מנכה את מרווח הבית, ואז מדרג לפי הסתברות מנורמלת ופער מול היריבה הקרובה. אין כאן המצאה של פציעות, הרכבים או מידע שלא חזר מהמקור.",
          ],
    };

    const matchedResult = findResultEvent(resultsByEvent, row);
    const enrichedRow = applyResult(row, matchedResult);

    // ── Motivation check via 365scores standings ──
    // Only applies when the pick is a specific team win (not draw/X)
    let motivationInfo = null;
    const pickRaw = cleanText(scored.pick).toLowerCase();
    const isDrawPick = pickRaw === "x" || pickRaw === "תיקו";
    if (!isDrawPick && matchedResult?.competitionId365 && standingsMap365.size) {
      const standings = standingsMap365.get(String(matchedResult.competitionId365));
      if (standings?.length) {
        // Determine which team is the favourite pick
        const pickNorm = normalizeMatchName(scored.pickTeam || outcomeTeam(scored.pick));
        const homeNorm = normalizeMatchName(teams.home);
        const awayNorm = normalizeMatchName(teams.away);
        const homeScore = teamNameScore(pickNorm, homeNorm);
        const awayScore = teamNameScore(pickNorm, awayNorm);
        const isPickHome = homeScore >= awayScore && homeScore >= 0.5;
        const favoriteCompetitorId = isPickHome
          ? matchedResult.homeCompetitorId
          : matchedResult.awayCompetitorId;
        if (favoriteCompetitorId) {
          motivationInfo = getTeamStakeFromStandings(standings, favoriteCompetitorId);
        }
      }
    }

    const current = events.get(market.eId);
    // Prefer: in-range pick > outside-range; within same category prefer higher score
    const currentOutside = current?.outsideRange ?? true;
    const newOutside = enrichedRow.outsideRange;
    const enrichedWithMotivation = motivationInfo
      ? { ...enrichedRow, motivationInfo, motivationRisk: !motivationInfo.hasStake }
      : enrichedRow;

    // Basketball-specific replacement logic: moneyline > spread unless spread edge ≥ 15 conf pts
    const isBball = Number(market.sId) === WINNER_BASKETBALL_ID;
    const newIsSpread  = enrichedWithMotivation.marketTier === "spread";
    const currIsSpread = current?.marketTier === "spread";
    let shouldReplace;
    if (!current) {
      shouldReplace = true;
    } else if (currentOutside && !newOutside) {
      shouldReplace = true;
    } else if (!currentOutside && !newOutside) {
      if (isBball && currIsSpread && !newIsSpread) {
        // Always prefer moneyline over a spread that's already stored
        shouldReplace = true;
      } else if (isBball && !currIsSpread && newIsSpread) {
        // Replace moneyline with spread only when spread confidence clearly dominates
        const mlConf = basketballConfidence(current);
        const spConf = basketballConfidence(enrichedWithMotivation);
        shouldReplace = spConf >= 75 && (spConf - mlConf) >= 15;
      } else {
        shouldReplace = enrichedWithMotivation.score > current.score
          || (enrichedWithMotivation.score === current.score && (enrichedWithMotivation.oddsRaw || 0) < (current.oddsRaw || 0));
      }
    } else {
      shouldReplace = false;
    }
    if (shouldReplace) {
      events.set(market.eId, enrichedWithMotivation);
    }
  }

  const candidates = [...events.values()]
    .filter((row) => isOpenDisplayable(row) || row.matchPhase === "final")
    // outsideRange rows show without a recommendation — don't require hasSingleClearFavorite
    // so friendlies/playoffs with clear (but out-of-range) favorites aren't silently dropped
    .filter((row) => row.matchPhase === "final" || row.outsideRange || hasSingleClearFavorite(row))
    // Basketball confidence gate: below 75 = no recommendation
    .filter((row) => {
      if (Number(row.sportId) !== WINNER_BASKETBALL_ID) return true;
      if (row.noOddsYet || row.outsideRange || row.matchPhase === "final") return true;
      const conf = basketballConfidence(row);
      if (conf < 75) {
        console.info(`[bball-confidence] Excluded: ${row.match} — conf ${conf}/100`);
        return false;
      }
      return true;
    })
    // Motivation filter: exclude games where the favourite has no meaningful stake
    .filter((row) => {
      if (row.noOddsYet || !row.motivationRisk) return true;
      console.info(
        `[motivation-filter] Excluded: ${row.match} — ${row.motivationInfo?.label || "no stake"}`
      );
      return false;
    });
  const strictCandidates = candidates.filter((row) => !row.outsideRange && row.odds);
  const softCandidates = candidates
    .filter((row) => row.outsideRange && row.oddsRaw >= SOFT_ODDS_MIN && row.oddsRaw <= SOFT_ODDS_MAX)
    .map((row) => ({
      ...row,
      odds: row.oddsRaw,
      outsideRange: false,
      softRange: true,
      recommendationReason: "soft-range",
      score: Math.max(1, Math.round((row.score || 46) - 8)),
      probability: row.normalizedProbability || row.probability || null,
      signals: [
        `יחס Winner ${Number(row.oddsRaw).toFixed(2)} — הרחבת טווח כדי להשלים יום פרימיום`,
        `הסתברות שוק ${Math.round((row.normalizedProbability || 0) * 100)} אחוז`,
        "מסומן כניתוח משלים, לא כטווח אידיאלי",
      ],
      explanation: [
        "המשחק נכנס כניתוח משלים כי לא נמצאו מספיק משחקים בטווח האידיאלי.",
        `יחס Winner הוא ${Number(row.oddsRaw).toFixed(2)} — קרוב לטווח המרכזי 1.40-1.90, ולכן נשמר רק אם יש פייבוריט ברור.`,
        "היחס משמש כנתון שוק בלבד; אין כאן הוראת פעולה.",
      ],
    }));
  const selectionPool = strictCandidates.length >= Math.min(MIN_PREMIUM_ROWS_PER_DAY, limit)
    ? strictCandidates
    : [...strictCandidates, ...softCandidates];
  return selectionPool
    .map((row) => ({
      ...row,
      scoreBreakdown: scoreBreakdown(row),
      recommendationScore: Math.max(1, Math.min(100, recommendationRank(row))),
      nichePick: !isCentralEvent(row),
    }))
    .sort((a, b) => {
      return (b.recommendationScore || 0) - (a.recommendationScore || 0)
        || (b.probability || 0) - (a.probability || 0)
        || (b.odds || 0) - (a.odds || 0)
        || String(a.time).localeCompare(String(b.time));
    })
    .slice(0, limit)
    .map((row) => {
      const sc = row.recommendationScore || row.score || 0;
      const isBball = Number(row.sportId) === WINNER_BASKETBALL_ID;
      const conf = isBball ? basketballConfidence(row) : null;
      const band = conf !== null ? confidenceBand(conf) : null;

      // Basketball pick rationale based on confidence band
      let rationale = null;
      if (isBball && conf !== null) {
        if (conf >= 90) rationale = "strong-moneyline";
        else if (conf >= 80) rationale = row.marketTier === "spread" ? "spread-edge" : "moneyline-preferred";
        else rationale = "moneyline-only";
      }

      // Explanation: richer for basketball
      const explanation = isBball && !row.outsideRange
        ? [describeBasketballPick(row._market || { mp: row.market, outcomes: row.oddsBook?.outcomes }, row, { home: row.home, away: row.away }, conf, rationale)]
        : row.explanation;

      return {
        ...row,
        score: Math.max(1, Math.min(100, sc)),
        recommended: true,
        recommendationReason: "top-20",
        confidence: conf,
        confidenceBand: band,
        pickRationale: rationale,
        riskLevel: isBball && conf !== null
          ? (conf >= 85 ? "נמוך" : conf >= 75 ? "בינוני" : "גבוה")
          : (sc >= 70 ? "נמוך" : sc >= 50 ? "בינוני" : "גבוה"),
        signals: isBball && conf !== null
          ? [
              `ביטחון ${conf}/100 — ${band}`,
              `סבירות פגיעה ${Math.round((row.probability || 0) * 100)}%`,
              `יחס Winner ${Number(row.odds).toFixed(2)}`,
              row.marketTier === "spread"
                ? `ספרד: ליין ${row.spread != null ? row.spread : "?"}`
                : "שוק מנצח (מונילין)",
            ]
          : [
              `סבירות פגיעה ${Math.round((row.probability || 0) * 100)} אחוז`,
              `יחס Winner ${Number(row.odds).toFixed(2)}`,
              `ציון משולב ${sc}`,
            ],
        explanation,
      };
    });
}

function buildReuvenSchedule(markets, fromDate, daysAhead = 31) {
  const end = new Date(`${fromDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + daysAhead);
  const endDate = end.toISOString().slice(0, 10);
  const byEvent = new Map();
  for (const market of markets || []) {
    if (!allowedMarket(market)) continue;
    const date = winnerDateToIso(market.e_date);
    if (!date || date < fromDate || date > endDate) continue;
    const teams = splitTeams(market.desc);
    if (!teams.home || !teams.away) continue;
    const key = String(market.eId || `${date}:${market.sId}:${market.desc}`);
    const oddsBook = marketOddsBook(market);
    const item = byEvent.get(key) || {
      id: `reuven-${key}`,
      eventId: market.eId,
      day: date,
      time: winnerHour(market.m_hour),
      sport: SPORTS[market.sId] || "",
      sportId: Number(market.sId),
      league: cleanText(market.league),
      country: cleanText(market.country),
      match: cleanText(market.desc),
      home: teams.home,
      away: teams.away,
      markets: [],
    };
    item.markets.push({
      marketId: market.mId,
      title: cleanText(market.mp),
      tier: marketTier(market.mp, market.sId),
      outcomes: (oddsBook.outcomes || []).map((outcome) => ({
        label: outcome.team || outcome.desc,
        desc: outcome.desc,
        team: outcome.team,
        spread: outcome.spread,
        odds: outcome.odds,
        implied: outcome.implied,
        noVigProbability: outcome.noVigProbability,
      })),
    });
    byEvent.set(key, item);
  }
  return [...byEvent.values()]
    .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
    .slice(0, 500);
}

function resultStatus(event, pick) {
  const results = (event.markets || []).flatMap((market) => market.marketResults || []).map(cleanText);
  if (!results.length) return "ממתין";
  const cleanPick = cleanText(pick);
  return results.some((result) => result === cleanPick || result.includes(cleanPick) || cleanPick.includes(result))
    ? "hit"
    : "miss";
}

function buildResultRows(results, dateKey) {
  return (results || [])
    .filter((event) => ["240", "227"].includes(String(event.sportid)) && event.date === dateKey)
    .map((event) => {
      const verifiedAt = new Date().toISOString();
      const markets = event.markets || [];
      const market = markets.find((m) => cleanText(m.title).includes("1X2")) ||
        markets.find((m) => cleanText(m.title).includes("המנצח") || cleanText(m.title).includes("מנצח") || cleanText(m.title).includes("מנצחת"));
      if (!market) return null;
      const actualWinnerRaw = cleanText((market.marketResults || [])[0]);
      const actualWinner = actualWinnerRaw.toLowerCase() === "x" ? "תיקו" : actualWinnerRaw;
      const finishedAt = event.closedAt || event.finishedAt || (actualWinner ? verifiedAt : null);
      const teams = { home: cleanText(event.teamA), away: cleanText(event.teamB) };
      const _resultScore = scoreText(event.scoreA, event.scoreB, event.noScoreLabel);
      return {
        id: `result-${event.eventid}`,
        eventId: String(event.eventid),
        source: "Winner Results",
        verifiedAt,
        finishedAt,
        bettingStatus: "closed",
        resultVerified: !!actualWinner,
        day: dateKey,
        time: String(event.time || "").slice(0, 5),
        sport: SPORTS[Number(event.sportid)] || "ספורט",
        sportId: Number(event.sportid),
        league: cleanText(event.league),
        country: "",
        match: `${cleanText(event.teamA)} - ${cleanText(event.teamB)}`,
        home: teams.home,
        away: teams.away,
        resultKey: resultKeyFor({ day: dateKey, sportId: event.sportid, home: teams.home, away: teams.away }),
        market: cleanText(market?.title || "תוצאת משחק"),
        pick: actualWinner,
        winnerPick: actualWinner,
        actualWinner,
        odds: null,
        probability: null,
        score: 0,
        status: "נסגר",
        liveScore: _resultScore,
        matchPhase: actualWinner ? "final" : resultPhase(event),
        result: _resultScore,
        resultVerifiedAt: actualWinner ? verifiedAt : "",
        signals: ["תוצאה רשמית מווינר", "ארכיון לבדיקת תחזית סטטיסטית", "אין יחס עבר בממשק הציבורי"],
        allMarkets: (event.markets || []).map((item) => ({
          marketId: null,
          title: cleanText(item.title),
          category: marketCategory(item.title),
          bettable: false,
          best: null,
          outcomes: (item.marketResults || []).map((result) => ({
            outcomeId: null,
            desc: cleanText(result),
            price: null,
            spread: "",
            probability: null,
            score: null,
          })),
        })),
        explanation: [
          "זהו משחק סגור מארכיון התוצאות של Winner.",
          `התוצאה הרשמית בשוק המנצח היא ${actualWinner || "לא זמינה"}. היא משמשת רק לסגירת תחזיות שנשמרו קודם לכן.`,
          "ממשק התוצאות הציבורי לא מחזיר יחס סגירה, ולכן יחס עבר לא מוצג ולא מומצא.",
        ],
      };
    })
    .filter(Boolean)
    .slice(0, 200);
}

function seed365Logo(kind, name, id, folder) {
  if (!name || !id) return;
  const key = `${kind}:${name}`;
  if (!globalLogoCache.has(key)) {
    globalLogoCache.set(key, {
      name,
      logo_url: `https://imagecache.365scores.com/image/upload/f_png,w_200,h_200,c_limit/${folder}/${id}`,
      source: "365Scores",
    });
  }
}

async function get365Results(startDate, endDate, sportId365, winnerSportId, refererSport) {
  const dates = [startDate];
  if (endDate && endDate !== startDate) dates.push(endDate);
  const rows = [];
  for (const dateKey of dates) {
    const day = scores365Date(dateKey);
    if (!day) continue;
    const params = new URLSearchParams({
      langId: "2",
      timezoneName: "Asia/Jerusalem",
      userCountryId: "6",
      appTypeId: "5",
      sports: String(sportId365),
      startDate: day,
      endDate: day,
    });
    const data = await fetchJson(`https://webws.365scores.com/web/games/?${params}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Origin: "https://www.365scores.com",
        Referer: `https://www.365scores.com/he/${refererSport}/match-results`,
        Accept: "application/json",
      },
    }).catch(() => null);
    for (const game of data?.games || []) {
      const home = cleanText(game.homeCompetitor?.name);
      const away = cleanText(game.awayCompetitor?.name);
      if (!home || !away) continue;
      // Seed globalLogoCache so enrichLogos finds logos without extra lookups
      seed365Logo("team", home, game.homeCompetitor?.id, "Competitors");
      seed365Logo("team", away, game.awayCompetitor?.id, "Competitors");
      seed365Logo("league", cleanText(game.competitionDisplayName), game.competition?.id || game.competitionId, "Competitions");
      const homeScore = Number(game.homeCompetitor?.score);
      const awayScore = Number(game.awayCompetitor?.score);
      const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore) && homeScore >= 0 && awayScore >= 0;
      const isFinal = Number(game.statusGroup) === 4 || /final|ended|הסתיים/i.test(cleanText(game.statusText));
      const actualWinner = hasScore && isFinal
        ? homeScore === awayScore
          ? "תיקו"
          : homeScore > awayScore ? home : away
        : "";
      const start = game.startTime ? new Date(game.startTime) : null;
      // Store 365Scores IDs — used to build direct CDN logo URLs
      const homeId = game.homeCompetitor?.id;
      const awayId = game.awayCompetitor?.id;
      const competitionId = game.competition?.id || game.competitionId;
      rows.push({
        eventid: `365-${game.id}`,
        eventid365: String(game.id),
        date: dateKey,
        time: start && !Number.isNaN(start.getTime())
          ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(start)
          : "",
        sportid: winnerSportId,
        league: cleanText(game.competitionDisplayName),
        teamA: home,
        teamB: away,
        scoreA: hasScore ? String(homeScore) : "",
        scoreB: hasScore ? String(awayScore) : "",
        matchMinute: game.gameTime || game.shortStatusText || "",
        statusGroup: game.statusGroup,
        isFinal,
        statusText: cleanText(game.statusText),
        markets: actualWinner ? [{ title: "המנצח", marketResults: [actualWinner] }] : [],
        source: "365Scores",
        // Direct logo CDN paths — no lookup needed for matches we already got from 365
        homeLogoUrl: homeId ? `https://imagecache.365scores.com/image/upload/f_png,w_200,h_200,c_limit/Competitors/${homeId}` : null,
        awayLogoUrl: awayId ? `https://imagecache.365scores.com/image/upload/f_png,w_200,h_200,c_limit/Competitors/${awayId}` : null,
        leagueLogoUrl: competitionId ? `https://imagecache.365scores.com/image/upload/f_png,w_200,h_200,c_limit/Competitions/${competitionId}` : null,
        // Carry raw IDs for standings / motivation lookup
        homeCompetitorId: homeId || null,
        awayCompetitorId: awayId || null,
        competitionId365: competitionId || null,
      });
    }
  }
  return rows;
}

function get365FootballResults(startDate, endDate) {
  return get365Results(startDate, endDate, SCORES365_FOOTBALL_ID, WINNER_FOOTBALL_ID, "football");
}

function get365BasketballResults(startDate, endDate) {
  return get365Results(startDate, endDate, SCORES365_BASKETBALL_ID, WINNER_BASKETBALL_ID, "basketball");
}

function translateEnTeamToHe(name) {
  if (!name) return name;
  const direct = ODDS_API_TEAM_HE[name.trim()];
  if (direct) return direct;
  // Partial match: check if any known key is a substring (handles "FC Barcelona" → "Barcelona")
  for (const [en, he] of Object.entries(ODDS_API_TEAM_HE)) {
    if (name.includes(en) || en.includes(name)) return he;
  }
  return name; // fall back to original English name
}

// Fetch completed match scores from Odds API and return in the internal event format.
// Only called by the nightly cron — not on every feed build — to preserve API quota.
async function getOddsApiScores() {
  if (!ODDS_API_KEY) return [];
  const yesterday = israelDate(-1);
  const today = israelDate(0);
  const rows = [];

  await Promise.allSettled(
    SCORES_SPORT_KEYS.map(async ({ key, sportId }) => {
      try {
        const data = await fetchJson(
          `${ODDS_API_BASE}/sports/${key}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`,
          { signal: AbortSignal.timeout(8000) }
        );
        for (const game of (Array.isArray(data) ? data : [])) {
          if (!game.completed || !game.scores?.length) continue;
          const homeEn = game.home_team;
          const awayEn = game.away_team;
          const homeScoreEntry = game.scores.find((s) => s.name === homeEn);
          const awayScoreEntry = game.scores.find((s) => s.name === awayEn);
          if (!homeScoreEntry || !awayScoreEntry) continue;
          const homeScore = homeScoreEntry.score;
          const awayScore = awayScoreEntry.score;

          const startDate = new Date(game.commence_time);
          const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(startDate);
          if (dateKey !== yesterday && dateKey !== today) continue;

          // Translate English names to Hebrew for cross-match with Winner picks
          const homeHe = translateEnTeamToHe(homeEn);
          const awayHe = translateEnTeamToHe(awayEn);

          const hNum = Number(homeScore);
          const aNum = Number(awayScore);
          const actualWinner = (Number.isFinite(hNum) && Number.isFinite(aNum))
            ? (hNum === aNum ? "תיקו" : hNum > aNum ? homeHe : awayHe)
            : "";

          const timeStr = new Intl.DateTimeFormat("he-IL", {
            timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false,
          }).format(startDate);

          rows.push({
            eventid: `oddsapi-${game.id}`,
            date: dateKey,
            time: timeStr,
            sportid: sportId,
            league: key.replace(/^(soccer|basketball)_/, "").replace(/_/g, " "),
            teamA: homeHe,
            teamB: awayHe,
            scoreA: String(homeScore),
            scoreB: String(awayScore),
            isFinal: true,
            statusGroup: 4,
            statusText: "final",
            markets: actualWinner ? [{ title: "המנצח", marketResults: [actualWinner] }] : [],
            source: "OddsAPI",
          });
        }
      } catch { /* skip this sport on error */ }
    })
  );
  return rows;
}

// ── API-Sports results (football + basketball) ────────────────────────────────
async function fetchApiSports(url) {
  const res = await fetch(url, {
    headers: { "x-apisports-key": FOOTBALL_API_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error(`[API-Sports] ${res.status} for ${url}`);
    return null;
  }
  return res.json().catch(() => null);
}

async function getApiSportsFootballResults(dateKey) {
  if (!FOOTBALL_API_KEY) return [];
  const cacheKey = `apisports-fb-${dateKey}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
  const data = await fetchApiSports(`${APISPORTS_FOOTBALL}/fixtures?date=${dateKey}&status=FT`);
  const rows = [];
  for (const item of (data?.response || [])) {
    const homeEn = item.teams?.home?.name;
    const awayEn = item.teams?.away?.name;
    if (!homeEn || !awayEn) continue;
    const hNum = Number(item.goals?.home);
    const aNum = Number(item.goals?.away);
    if (!Number.isFinite(hNum) || !Number.isFinite(aNum)) continue;
    const homeHe = translateEnTeamToHe(homeEn);
    const awayHe = translateEnTeamToHe(awayEn);
    const actualWinner = hNum === aNum ? "תיקו" : hNum > aNum ? homeHe : awayHe;
    rows.push({
      eventid: `apisports-f-${item.fixture?.id}`,
      date: dateKey,
      time: new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.fixture?.date)),
      sportid: WINNER_FOOTBALL_ID,
      league: item.league?.name || "",
      teamA: homeHe,
      teamB: awayHe,
      scoreA: String(item.goals?.home),
      scoreB: String(item.goals?.away),
      isFinal: true,
      statusGroup: 4,
      statusText: "FT",
      markets: [{ title: "המנצח", marketResults: [actualWinner] }],
      source: "API-Sports",
    });
  }
  console.log(`[API-Sports] football ${dateKey}: ${rows.length} finished games`);
  if (rows.length > 0) memoryCache.set(cacheKey, { ts: Date.now(), data: rows });
  return rows;
}

async function getApiSportsBasketballResults(dateKey) {
  if (!FOOTBALL_API_KEY) return [];
  const cacheKey = `apisports-bk-${dateKey}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
  const data = await fetchApiSports(`${APISPORTS_BBALL}/games?date=${dateKey}`);
  const rows = [];
  for (const item of (data?.response || [])) {
    const status = item.status?.short;
    if (status !== "FT" && status !== "AOT") continue;
    const homeEn = item.teams?.home?.name;
    const awayEn = item.teams?.away?.name;
    if (!homeEn || !awayEn) continue;
    const hNum = Number(item.scores?.home?.total);
    const aNum = Number(item.scores?.away?.total);
    if (!Number.isFinite(hNum) || !Number.isFinite(aNum) || hNum === aNum) continue;
    const homeHe = translateEnTeamToHe(homeEn);
    const awayHe = translateEnTeamToHe(awayEn);
    rows.push({
      eventid: `apisports-b-${item.id}`,
      date: dateKey,
      time: new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.date)),
      sportid: WINNER_BASKETBALL_ID,
      league: item.league?.name || "",
      teamA: homeHe,
      teamB: awayHe,
      scoreA: String(item.scores?.home?.total),
      scoreB: String(item.scores?.away?.total),
      isFinal: true,
      statusGroup: 4,
      statusText: "FT",
      markets: [{ title: "המנצח", marketResults: [hNum > aNum ? homeHe : awayHe] }],
      source: "API-Sports",
    });
  }
  console.log(`[API-Sports] basketball ${dateKey}: ${rows.length} finished games`);
  if (rows.length > 0) memoryCache.set(cacheKey, { ts: Date.now(), data: rows });
  return rows;
}

function build365ResultRows(results, dateKey, winnerSportId, marketTitle, signals) {
  return (results || [])
    .filter((event) => String(event.sportid) === String(winnerSportId) && event.date === dateKey)
    .map((event) => {
      const actualWinner = resultWinner(event);
      const phase = resultPhase(event);
      const verifiedAt = new Date().toISOString();
      const finishedAt = event.closedAt || event.finishedAt || (phase === "final" ? verifiedAt : null);
      const teams = { home: cleanText(event.teamA), away: cleanText(event.teamB) };
      return {
        id: `result-${event.eventid}`,
        eventId: String(event.eventid),
        eventId365: event.eventid365 || String(event.eventid).replace(/^365-/, ""),
        source: "365Scores Results",
        verifiedAt,
        finishedAt,
        bettingStatus: "closed",
        resultVerified: !!actualWinner,
        day: dateKey,
        time: String(event.time || "").slice(0, 5),
        sport: SPORTS[winnerSportId],
        sportId: winnerSportId,
        league: cleanText(event.league),
        country: "",
        match: `${teams.home} - ${teams.away}`,
        home: teams.home,
        away: teams.away,
        // Carry 365Scores CDN logo URLs so enrichLogos can skip the lookup
        homeLogoUrl: event.homeLogoUrl || null,
        awayLogoUrl: event.awayLogoUrl || null,
        leagueLogoUrl: event.leagueLogoUrl || null,
        resultKey: resultKeyFor({ day: dateKey, sportId: winnerSportId, home: teams.home, away: teams.away }),
        market: marketTitle,
        pick: actualWinner,
        winnerPick: actualWinner,
        actualWinner,
        odds: null,
        probability: null,
        score: 0,
        status: phase === "final" ? "נסגר" : phase === "cancelled" ? "בוטל" : phase === "postponed" ? "לא אומת" : "ממתין",
        liveScore: scoreText(event.scoreA, event.scoreB, event.noScoreLabel),
        matchPhase: actualWinner ? "final" : resultPhase(event),
        matchMinute: event.matchMinute || "",
        result: scoreText(event.scoreA, event.scoreB, event.noScoreLabel),
        resultVerifiedAt: phase === "final" ? verifiedAt : "",
        signals,
        allMarkets: [{
          marketId: null,
          title: marketTitle,
          category: marketCategory(marketTitle),
          bettable: false,
          best: null,
          outcomes: actualWinner ? [{ outcomeId: null, desc: actualWinner, price: null, spread: "", probability: null, score: null }] : [],
        }],
        explanation: [
          `זהו משחק ${SPORTS[winnerSportId] || "ספורט"} מארכיון התוצאות של 365Scores.`,
          `התוצאה הרשמית לפי 365Scores היא ${actualWinner || "לא זמינה"}.`,
          "היחסים והצד שנבחן עדיין מגיעים מ-Winner; 365Scores משמש רק לסגירת התוצאה.",
        ],
      };
    })
    .slice(0, 200);
}

function build365FootballRows(results, dateKey) {
  return build365ResultRows(
    results,
    dateKey,
    WINNER_FOOTBALL_ID,
    "1X2",
    ["תוצאה מ-365Scores", "כיסוי כדורגל מ-365Scores", "משמש לסגירת תחזיות Winner"]
  );
}

function build365BasketballRows(results, dateKey) {
  return build365ResultRows(
    results,
    dateKey,
    WINNER_BASKETBALL_ID,
    "המנצח",
    ["תוצאה מ-365Scores", "כיסוי כדורסל לכל הליגות", "משמש לסגירת תחזיות Winner"]
  );
}

// Build noOddsYet display rows from 365Scores scheduled events when Winner has no open markets
function build365ScheduledRows(results, dateKey, winnerSportId) {
  const now = new Date().toISOString();
  return (results || [])
    .filter((event) => {
      if (String(event.sportid) !== String(winnerSportId)) return false;
      if (event.date !== dateKey) return false;
      const phase = resultPhase(event);
      return phase === "scheduled" || phase === "pre";
    })
    .map((event) => {
      const teams = { home: cleanText(event.teamA), away: cleanText(event.teamB) };
      return {
        id: `sched-365-${event.eventid}`,
        eventId: String(event.eventid),
        eventId365: event.eventid365 || String(event.eventid).replace(/^365-/, ""),
        source: "365Scores",
        verifiedAt: now,
        bettingStatus: "available",
        day: dateKey,
        time: String(event.time || "").slice(0, 5),
        sport: SPORTS[winnerSportId],
        sportId: winnerSportId,
        league: cleanText(event.league),
        country: "",
        match: `${teams.home} - ${teams.away}`,
        home: teams.home,
        away: teams.away,
        homeLogoUrl: event.homeLogoUrl || null,
        awayLogoUrl: event.awayLogoUrl || null,
        leagueLogoUrl: event.leagueLogoUrl || null,
        resultKey: resultKeyFor({ day: dateKey, sportId: winnerSportId, home: teams.home, away: teams.away }),
        market: "",
        pick: "",
        pickTeam: "",
        winnerPick: "",
        odds: null,
        oddsRaw: null,
        outsideRange: true,
        noOddsYet: true,
        probability: null,
        normalizedProbability: null,
        score: 0,
        status: "ממתין",
        matchPhase: "scheduled",
        result: "",
        liveScore: "",
        signals: ["קווי הימורים טרם נפתחו בווינר עבור משחק זה", "המשחק יוצג ברגע שהיחסים יתעדכנו"],
        explanation: [
          "המשחק קיים במערכת 365Scores אך ווינר טרם פרסם קווי הימורים.",
          "ווינר פותחים קווים בהדרגה לאורך היום — בדרך כלל כמה שעות לפני הקיקאוף.",
        ],
      };
    });
}

function compactTrackingRow(row) {
  return {
    id: row.id,
    eventId: row.eventId,
    eventId365: row.eventId365,
    source: row.source,
    day: row.day,
    time: row.time,
    sport: row.sport,
    sportId: row.sportId,
    league: row.league,
    match: row.match,
    home: row.home,
    away: row.away,
    resultKey: row.resultKey,
    actualWinner: row.actualWinner || "",
    result: row.result || row.liveScore || "",
    liveScore: row.liveScore || row.result || "",
    matchPhase: row.matchPhase || "",
    matchMinute: row.matchMinute || "",
    status: row.status,
    bettingStatus: row.bettingStatus,
    verifiedAt: row.verifiedAt,
    finishedAt: row.finishedAt,
    resultVerifiedAt: row.resultVerifiedAt,
  };
}

function splitBySport(rows) {
  return {
    football:   rows.filter((row) => Number(row.sportId) === WINNER_FOOTBALL_ID),
    basketball: rows.filter((row) => Number(row.sportId) === WINNER_BASKETBALL_ID),
  };
}

function mergeRows(primary, secondary) {
  const PHASE_RANK = { final: 4, cancelled: 3, postponed: 3, ht: 2, live: 1, scheduled: 0, "": 0 };
  const definitiveStatus = (s) => s && s !== "ממתין";
  function mergeTwo(current, row) {
    const rankCurrent = PHASE_RANK[current.matchPhase] ?? 0;
    const rankRow = PHASE_RANK[row.matchPhase] ?? 0;
    const mergedPhase = rankCurrent >= rankRow ? current.matchPhase : row.matchPhase;
    return {
      ...row,
      ...current,
      liveScore: current.liveScore || row.liveScore || "",
      result: current.result || row.result || "",
      actualWinner: current.actualWinner || row.actualWinner || "",
      matchPhase: mergedPhase || "",
      recommended: current.recommended || row.recommended,
      pick: current.pick || row.pick || "",
      pickTeam: current.pickTeam || row.pickTeam || "",
      winnerPick: current.winnerPick || row.winnerPick || "",
      status: definitiveStatus(current.status)
        ? current.status
        : definitiveStatus(row.status)
          ? row.status
          : (current.status || "ממתין"),
    };
  }

  const byEvent = new Map();
  // Pass 1: exact key matching
  for (const row of [...primary, ...secondary]) {
    const key = String(row.resultKey || row.eventId || row.id);
    const current = byEvent.get(key);
    if (!current) { byEvent.set(key, row); continue; }
    byEvent.set(key, mergeTwo(current, row));
  }

  // Pass 2: fuzzy match — pick rows missing actualWinner against result rows that
  // have actualWinner but no recommendation. Handles Winner vs 365scores name diffs.
  const unmatchedPicks = [...byEvent.entries()]
    .filter(([, r]) => r.recommended && r.odds && !r.actualWinner);
  const unmatchedResults = [...byEvent.entries()]
    .filter(([, r]) => r.actualWinner && !r.recommended);

  for (const [pickKey, pick] of unmatchedPicks) {
    let best = null, bestScore = 0, bestKey = null;
    for (const [resKey, result] of unmatchedResults) {
      if (String(pick.sportId || "") !== String(result.sportId || "")) continue;
      if (String(pick.day || "") !== String(result.day || "")) continue;
      const score = resultMatchScore(pick, result);
      if (score > bestScore) { best = result; bestScore = score; bestKey = resKey; }
    }
    if (bestScore >= 0.55 && best && bestKey) {
      byEvent.set(pickKey, mergeTwo(pick, best));
      byEvent.delete(bestKey); // absorb the separate result row into the pick
    }
  }

  return [...byEvent.values()];
}

function capPerLeague(rows, max = 5) {
  const counts = {};
  return rows.filter((row) => {
    const key = String(row.league || "").trim().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts[key] <= max;
  });
}

function finalOpenRows(rows) {
  const sorted = (rows || [])
    .filter((row) => row.recommended && row.odds && (row.status === "ממתין" || row.matchPhase === "final" || row.matchPhase === "live" || row.matchPhase === "ht"))
    .sort((a, b) => {
      return (b.recommendationScore || 0) - (a.recommendationScore || 0)
        || (b.probability || 0) - (a.probability || 0)
        || (b.odds || 0) - (a.odds || 0)
        || String(a.time).localeCompare(String(b.time));
    });
  const strict = sorted.filter((row) => rejectionReasons(row).length === 0);
  const strictIds = new Set(strict.map((row) => row.id));
  const logoFill = sorted
    .filter((row) => !strictIds.has(row.id))
    .filter((row) => {
      const hardReasons = rejectionReasons(row).filter((reason) => !reason.includes("לוגו"));
      return hardReasons.length === 0;
    });
  return capPerLeague([...strict, ...logoFill])
    .slice(0, TARGET_PICKS_PER_SPORT)
    .map((row) => ({
      ...row,
      logoVerified: hasVerifiedTeamLogos(row),
    }));
}

function finalOpenRowsByDay(rows) {
  // Each sport is capped independently inside finalOpenRows.
  // No combined cap here — football and basketball render in separate tabs on the frontend.
  const football   = (rows || []).filter((r) => Number(r.sportId) === WINNER_FOOTBALL_ID);
  const basketball = (rows || []).filter((r) => Number(r.sportId) === WINNER_BASKETBALL_ID);
  // noOddsYet rows bypass the normal pick filter — they're display-only scheduled games
  const noOddsFootball   = football.filter((r) => r.noOddsYet);
  const noOddsBasketball = basketball.filter((r) => r.noOddsYet);
  return [
    ...finalOpenRows(football.filter((r) => !r.noOddsYet)),
    ...noOddsFootball,
    ...finalOpenRows(basketball.filter((r) => !r.noOddsYet)),
    ...noOddsBasketball,
  ];
}

// Compute hit/miss status for merged rows that have actualWinner but no settled status.
// Called after mergeRows() because applyResult() only runs on live picks, not on
// yesterday's snapshot picks that get merged with result rows post-hoc.
function resolvePickStatuses(rows) {
  return (rows || []).map((row) => {
    const actualWinner = row.actualWinner;
    // Only process recommended picks that finished and aren't already settled
    if (!actualWinner || row.matchPhase !== "final") return row;
    if (!row.odds && !row.recommended) return row;
    const alreadySettled = row.status && row.status !== "ממתין" && row.status !== "נסגר";
    if (alreadySettled) return row;

    // Spread bets: derive status from score + spread
    const rawSpread = row.spread;
    if (rawSpread !== null && rawSpread !== undefined && rawSpread !== "") {
      const spread = Number(rawSpread);
      if (Number.isFinite(spread)) {
        const scoreStr = row.result || row.liveScore || "";
        const parts = scoreStr.split(":");
        if (parts.length === 2) {
          const homeScore = Number(parts[0]);
          const awayScore = Number(parts[1]);
          if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
            const pick = cleanText(row.pickTeam || row.winnerPick || row.pick);
            const home = cleanText(row.home);
            const away = cleanText(row.away);
            const adjusted = teamNameScore(pick, home) >= 0.75
              ? homeScore + spread - awayScore
              : teamNameScore(pick, away) >= 0.75
                ? awayScore + spread - homeScore
                : null;
            if (adjusted !== null) {
              const spreadSt = adjusted > 0 ? "hit" : adjusted < 0 ? "miss" : "לא אומת";
              return { ...row, status: spreadSt };
            }
          }
        }
      }
    }

    // 1X2 / moneyline: fuzzy-compare pick with actualWinner
    const pick = cleanText(row.winnerPick || row.pickTeam || row.pick);
    const hit = pick === actualWinner || teamNameScore(pick, actualWinner) >= 0.75;
    return { ...row, status: hit ? "hit" : "miss" };
  });
}

function finalResultRowsByDay(rows) {
  // Process each sport separately so basketball gets its own quota
  function resultRowsForSport(sportRows) {
    const sorted = (sportRows || [])
      .sort((a, b) => {
        const sourceA = a.source === "Winner Results" ? 1 : 0;
        const sourceB = b.source === "Winner Results" ? 1 : 0;
        return sourceB - sourceA ||
          String(b.time || "").localeCompare(String(a.time || "")) ||
          String(a.match || "").localeCompare(String(b.match || ""));
      });
    const strict = sorted.filter((row) => hasVerifiedTeamLogos(row));
    const strictIds = new Set(strict.map((row) => row.id));
    return capPerLeague([...strict, ...sorted.filter((row) => !strictIds.has(row.id))])
      .slice(0, TARGET_PICKS_PER_SPORT)
      .map((row) => ({ ...row, logoVerified: hasVerifiedTeamLogos(row) }));
  }
  const football   = (rows || []).filter((r) => Number(r.sportId) === WINNER_FOOTBALL_ID);
  const basketball = (rows || []).filter((r) => Number(r.sportId) === WINNER_BASKETBALL_ID);
  return [
    ...resultRowsForSport(football),
    ...resultRowsForSport(basketball),
  ];
}

function auditOpenRows(rows, acceptedRows) {
  const acceptedIds = new Set((acceptedRows || []).map((row) => String(row.id)));
  return (rows || [])
    .map((row) => ({
      id: row.id,
      eventId: row.eventId,
      day: row.day,
      sport: row.sport,
      sportId: row.sportId,
      league: row.league,
      match: row.match,
      pick: row.pickTeam || row.winnerPick || row.pick,
      odds: row.odds,
      score: row.score,
      recommendationScore: row.recommendationScore,
      scoreBreakdown: row.scoreBreakdown,
      homeLogoSource: row.homeAsset?.logoSource || "",
      awayLogoSource: row.awayAsset?.logoSource || "",
      leagueLogoSource: row.leagueAsset?.logoSource || "",
      accepted: acceptedIds.has(String(row.id)),
      reasons: acceptedIds.has(String(row.id)) ? ["accepted"] : rejectionReasons(row),
    }))
    .sort((a, b) => Number(b.accepted) - Number(a.accepted) || (b.recommendationScore || 0) - (a.recommendationScore || 0))
    .slice(0, 120);
}

async function getWinnerLine() {
  const hashMessage = JSON.stringify({ prevCurrentVersion: null, reason: "Initiated" });
  const hashes = await fetchJson("https://api.winner.co.il/v2/publicapi/GetCMobileHashes", {
    headers: winnerHeaders({ HashesMessage: hashMessage }),
  });
  const lineMessage = JSON.stringify({
    prevCurrentVersion: null,
    newCurrentVersion: hashes.currentVersion,
    lineNewHash: hashes.lineChecksum,
    reason: "Hashes not equal",
  });
  const line = await fetchJson(
    `https://api.winner.co.il/v2/publicapi/GetCMobileLine?lineChecksum=${encodeURIComponent(hashes.lineChecksum)}`,
    { headers: winnerHeaders({ HashesMessage: lineMessage }) }
  );
  return { hashes, markets: line.markets || [] };
}

async function getResults(startDate, endDate) {
  const payload = {
    startDate: `${startDate}T00:00:00+03:00`,
    endDate: `${endDate}T23:59:59+03:00`,
    sports: [],
    leagues: [],
  };
  const data = await fetchJson("https://www.winner.co.il/api/v2/publicapi/GetResults", {
    method: "POST",
    headers: winnerHeaders(),
    body: JSON.stringify(payload),
  });
  return data?.results?.events || [];
}

async function buildWinnerFeedPayload({ withLogos = true } = {}) {
  const yesterday = israelDate(-1);
  const today = israelDate(0);
  const tomorrow = israelDate(1);
  const [{ hashes, markets }, winnerResultEvents, scores365Events, oddsApiScores, apiSportsScores] = await Promise.all([
    getWinnerLine().catch((error) => {
      console.warn("[winner-feed] Winner line unavailable, using snapshot picks only:", error.message);
      return { hashes: { currentVersion: null }, markets: [] };
    }),
    getResults(yesterday, tomorrow).catch((error) => {
      console.warn("Winner results unavailable; continuing with live line only:", error.message);
      return [];
    }),
    Promise.all([
      get365FootballResults(yesterday, yesterday),
      get365FootballResults(today, today),
      get365FootballResults(tomorrow, tomorrow),
      get365BasketballResults(yesterday, yesterday),
      get365BasketballResults(today, today),
      get365BasketballResults(tomorrow, tomorrow),
    ]).then((items) => items.flat()),
    getOddsApiScores().catch(() => []),
    Promise.all([
      getApiSportsFootballResults(yesterday),
      getApiSportsFootballResults(today),
      getApiSportsBasketballResults(yesterday),
      getApiSportsBasketballResults(today),
    ]).then((items) => items.flat()).catch(() => []),
  ]);
  const resultEvents = [...winnerResultEvents, ...scores365Events, ...oddsApiScores, ...apiSportsScores];
  const resultsByEvent = resultIndex(resultEvents);

  // ── Standings: fetch for competitions appearing in today's / tomorrow's 365scores games
  const competitionIds365 = new Set(
    scores365Events
      .filter((e) => e.competitionId365 && (e.date === today || e.date === tomorrow))
      .map((e) => String(e.competitionId365))
  );
  const standingsEntries = await Promise.allSettled(
    [...competitionIds365].map(async (id) => [id, await fetch365Standings(id)])
  );
  const standingsMap365 = new Map(
    standingsEntries
      .filter((r) => r.status === "fulfilled" && r.value[1]?.length)
      .map((r) => r.value)
  );

  // Pull previously-recommended picks from snapshot to remember what was selected.
  // Without this, finished games disappear from the live odds line and lose their hit/miss status.
  const snapshotPicksForDay = (dateKey) => {
    for (const key of ["yesterday", "today", "tomorrow"]) {
      const tab = SNAPSHOT?.tabs?.[key];
      if (tab?.date === dateKey) {
        return [
          ...(tab.sports?.football || []),
          ...(tab.sports?.basketball || []),
        ].filter((r) => !r.day || r.day === dateKey);
      }
    }
    return [];
  };

  const yesterdayResultRows = [
    ...buildResultRows(winnerResultEvents, yesterday),
    ...build365FootballRows(scores365Events, yesterday),
    ...build365BasketballRows(scores365Events, yesterday),
    ...build365FootballRows(oddsApiScores, yesterday),
    ...build365BasketballRows(oddsApiScores, yesterday),
    ...build365FootballRows(apiSportsScores, yesterday),
    ...build365BasketballRows(apiSportsScores, yesterday),
  ];
  // Primary: snapshot picks for yesterday (knows what was recommended + picked team)
  // Secondary: live result rows (have actualWinner + matchPhase:final)
  const snapshotYesterdayPicks = snapshotPicksForDay(yesterday);
  const yesterdayMerged = resolvePickStatuses(mergeRows(
    snapshotYesterdayPicks.length > 0 ? snapshotYesterdayPicks : buildResultRows(winnerResultEvents, yesterday),
    yesterdayResultRows
  ));

  const liveFootballToday = buildCurrentPicks(markets, today, BOARD_PICK_LIMIT, resultsByEvent, WINNER_FOOTBALL_ID, standingsMap365);
  const liveBasketballToday = buildCurrentPicks(markets, today, BOARD_PICK_LIMIT, resultsByEvent, WINNER_BASKETBALL_ID, standingsMap365);
  // When Winner has no open markets for today, show 365Scores scheduled games as "ממתין לקווים" cards
  const s365today = (scores365Events || []).filter(e => e.date === today);
  console.info(`[today-fallback] live football=${liveFootballToday.length} basketball=${liveBasketballToday.length} scores365today=${s365today.length}`);
  const fallbackFootball = liveFootballToday.length === 0
    ? build365ScheduledRows(scores365Events, today, WINNER_FOOTBALL_ID).slice(0, BOARD_PICK_LIMIT)
    : [];
  const fallbackBasketball = liveBasketballToday.length === 0
    ? build365ScheduledRows(scores365Events, today, WINNER_BASKETBALL_ID).slice(0, BOARD_PICK_LIMIT)
    : [];
  console.info(`[today-fallback] fallbackFootball=${fallbackFootball.length} fallbackBasketball=${fallbackBasketball.length}`);
  const liveTodayPicks = [...liveFootballToday, ...liveBasketballToday, ...fallbackFootball, ...fallbackBasketball];
  // Supplement live picks with snapshot picks for games that fell off the live line (already started)
  const snapshotTodayPicks = snapshotPicksForDay(today);
  const todayCurrentRows = resolvePickStatuses(mergeRows(
    [...liveTodayPicks, ...snapshotTodayPicks],
    [
      ...buildResultRows(winnerResultEvents, today),
      ...build365FootballRows(scores365Events, today),
      ...build365BasketballRows(scores365Events, today),
      ...build365FootballRows(oddsApiScores, today),
      ...build365BasketballRows(oddsApiScores, today),
      ...build365FootballRows(apiSportsScores, today),
      ...build365BasketballRows(apiSportsScores, today),
    ]
  ));
  const tomorrowCurrentRows = [
    ...buildCurrentPicks(markets, tomorrow, BOARD_PICK_LIMIT, resultsByEvent, WINNER_FOOTBALL_ID, standingsMap365),
    ...buildCurrentPicks(markets, tomorrow, BOARD_PICK_LIMIT, resultsByEvent, WINNER_BASKETBALL_ID, standingsMap365),
  ];
  // Enrich all three days in parallel — was sequential (3x slower)
  const [yesterdayEnrichedRows, todayEnrichedRows, tomorrowEnrichedRows] = withLogos
    ? await Promise.all([
        enrichLogos(yesterdayMerged),
        enrichLogos(todayCurrentRows),
        enrichLogos(tomorrowCurrentRows),
      ])
    : [yesterdayMerged, todayCurrentRows, tomorrowCurrentRows];
  const yesterdayFinalRows = withLogos ? finalResultRowsByDay(yesterdayEnrichedRows) : yesterdayEnrichedRows.slice(0, TARGET_PICKS_PER_SPORT);
  const yesterdayRows = splitBySport(yesterdayFinalRows);
  const todayFinalRows = withLogos ? finalOpenRowsByDay(todayEnrichedRows) : todayEnrichedRows.slice(0, TARGET_PICKS_PER_SPORT);
  const todayRows = splitBySport(todayFinalRows);
  const tomorrowFinalRows = withLogos ? finalOpenRowsByDay(tomorrowEnrichedRows) : tomorrowEnrichedRows.slice(0, TARGET_PICKS_PER_SPORT);
  const tomorrowRows = splitBySport(tomorrowFinalRows);
  const trackingResults = [
    ...buildResultRows(winnerResultEvents, yesterday),
    ...buildResultRows(winnerResultEvents, today),
    ...buildResultRows(winnerResultEvents, tomorrow),
    ...build365FootballRows(scores365Events, yesterday),
    ...build365FootballRows(scores365Events, today),
    ...build365FootballRows(scores365Events, tomorrow),
    ...build365BasketballRows(scores365Events, yesterday),
    ...build365BasketballRows(scores365Events, today),
    ...build365BasketballRows(scores365Events, tomorrow),
    ...build365FootballRows(oddsApiScores, yesterday),
    ...build365FootballRows(oddsApiScores, today),
    ...build365BasketballRows(oddsApiScores, yesterday),
    ...build365BasketballRows(oddsApiScores, today),
  ].map(compactTrackingRow);
  const lineStats = {
    football: {
      today: countRecommendedPicks(todayRows.football),
      tomorrow: countRecommendedPicks(tomorrowRows.football),
    },
    basketball: {
      today: countRecommendedPicks(todayRows.basketball),
      tomorrow: countRecommendedPicks(tomorrowRows.basketball),
    },
    total: {
      yesterday: yesterdayFinalRows.length,
      today: todayFinalRows.length,
      tomorrow: tomorrowFinalRows.length,
    },
  };
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    serverVersion: hashes.currentVersion,
    oddsRange: { min: ODDS_MIN, max: ODDS_MAX },
    targetPicksPerSport: TARGET_PICKS_PER_SPORT,
    lineStats,
    trackingResults,
    reuvenSchedule: buildReuvenSchedule(markets, today, 31),
    debugAudit: {
      today: splitBySport(auditOpenRows(todayEnrichedRows, todayFinalRows)),
      tomorrow: splitBySport(auditOpenRows(tomorrowEnrichedRows, tomorrowFinalRows)),
    },
    tabs: {
      yesterday: { label: "אתמול", date: yesterday, sports: yesterdayRows },
      today: { label: "היום", date: today, sports: todayRows },
      tomorrow: { label: "מחר", date: tomorrow, sports: tomorrowRows },
    },
    modelStats: {
      title: "מה עומד מאחורי הניתוחים",
      factors: [
        "שוקי בסיס: 1X2 בכדורגל, מנצחת/ליין יתרון בכדורסל מכל הליגות שמופיעות ב-Winner. בימים חלשים נכנסים שווקים חלופיים מסומנים בלבד.",
        `${TARGET_PICKS_PER_SPORT} ניתוחים ביום — יחס Winner אמיתי בטווח 1.40-1.90 כנתון שוק; אם יחס יוצא מהטווח או השוק לא זמין, המשחק לא נכנס לטופ.`,
        "היחסים מומרים להסתברות, עוברים ניכוי מרווח בית, ואז מדורגים לפי הסתברות מנורמלת ופער מול היריבה הקרובה.",
        "בית/חוץ: פייבוריט בחוץ מקבל הסבר של פער איכות; פייבוריט בבית מקבל יתרון מגרש.",
        "לא מוצגים פציעות, הרכבים או חדשות אם הם לא חזרו ממקור מאומת.",
      ],
    },
    win2goFeatures: [
      "טאבים אתמול/היום/מחר",
      "קטגוריות כדורגל וכדורסל",
      "יחסי Winner בזמן אמת או snapshot מאומת",
      "לוגואים לקבוצות ולליגות",
      "דיוק תחזיות סטטיסטיות לפי ניתוחים שנשמרו",
      "ציון ביטחון והסתברות שוק",
      "הסבר יתרון סטטיסטי לכל משחק",
      "AI Sports Analyst: ניתוח משחק ידני, סיכון, חלופות שוק וסטטיסטיקות רלוונטיות",
      "מונדיאל: ניתוחים רק בחלון 48 שעות לפני משחק עם פציעות, סגלים, מאמנים וכושר",
      "חיפוש ומיון",
      "פירוט משחק",
    ],
    notes: [
      `אתמול/היום/מחר: עד ${TARGET_PICKS_PER_SPORT} ניתוחים ביום עם יחס Winner בטווח 1.40-1.90 כנתון שוק; כדורגל וכדורסל מופרדים בתצוגה.`,
      "אם בווינר יש פחות מ-20 משחקי בסיס בטווח, האלגוריתם מוסיף סיכוי כפול או מעל/מתחת רק כשהיחס עדיין בטווח ומסמן זאת כשוק חלופי.",
      "אתמול הוא מסך סגירה ובדיקת תחזית סטטיסטית מול תוצאה רשמית, לא מסך פעולה פתוחה.",
      "לכל קבוצה וליגה מוצג לוגו ממקור חיצוני או תג גרפי כאשר אין לוגו רשמי זמין.",
    ],
  };
}

function normalizePredictionStatus(status) {
  const value = cleanText(status);
  if (value === "נתפס" || value === "תפס" || value === "hit") return "hit";
  if (value === "לא נתפס" || value === "נפל" || value === "miss") return "miss";
  if (value === "החזר" || value === "לא אומת") return "לא אומת";
  if (value === "בוטל") return "בוטל";
  return value || "ממתין";
}

// ── Standings & Motivation filter ────────────────────────────────────────────

const standingsCache365 = globalThis.__STANDINGS_365_CACHE__ ||
  (globalThis.__STANDINGS_365_CACHE__ = new Map());

/**
 * Fetch league standings from 365scores for a given competition ID.
 * Cached for 6 hours. Returns [] on any error (fail-open).
 */
async function fetch365Standings(competitionId) {
  if (!competitionId) return [];
  const cacheKey = `standings365:${competitionId}`;
  const cached = standingsCache365.get(cacheKey);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;
  const url =
    `https://webws.365scores.com/web/standings/?appTypeId=5&langId=8` +
    `&competitionId=${competitionId}&games=0`;
  const data = await fetchJson(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Origin: "https://www.365scores.com",
      Referer: "https://www.365scores.com/",
      Accept: "application/json",
    },
    retryAttempts: 1,
  }).catch(() => null);
  const standings = data?.standings || [];
  standingsCache365.set(cacheKey, { at: Date.now(), data: standings });
  return standings;
}

/**
 * Check a team's motivation based on standings.
 * Returns:
 *   { hasStake: false, penaltyType, label, signal }  → exclude from recommendations
 *   { hasStake: true,  penaltyType: null, label }    → keep, may have soft note
 *   null                                              → no data, keep by default
 *
 * penaltyType values:
 *   "champion_confirmed"  – team already secured the title
 *   "relegated_confirmed" – team already relegated
 *   "promotion_confirmed" – team already promoted (in lower league)
 */
function getTeamStakeFromStandings(standings, competitorId) {
  if (!standings?.length || !competitorId) return null;
  for (const group of standings) {
    for (const row of group.rows || []) {
      if (String(row.competitor?.id) !== String(competitorId)) continue;
      const qt = cleanText(row.qualifiedType || row.type || "").toLowerCase();
      const isQual = Boolean(row.qualified);
      // Title / Championship confirmed
      if (isQual && (
        qt.includes("champion") || qt === "winner" || qt.includes("title") ||
        qt === "1st" || qt === "first"
      )) {
        return {
          hasStake: false,
          penaltyType: "champion_confirmed",
          label: "אליפות בטוחה",
          signal: "קבוצה זו כבר הבטיחה את האליפות — מוטיבציה עלולה להיות נמוכה, לא מומלצת.",
        };
      }
      // Promotion confirmed (lower league teams)
      if (isQual && (qt.includes("promot") || qt.includes("upgrad"))) {
        return {
          hasStake: false,
          penaltyType: "promotion_confirmed",
          label: "עלייה בטוחה",
          signal: "קבוצה זו כבר הבטיחה עלייה — מוטיבציה עלולה להיות נמוכה, לא מומלצת.",
        };
      }
      // Relegation confirmed — bad team anyway, rarely a favourite
      if (isQual && (
        qt.includes("relegat") || qt.includes("descent") || qt.includes("demot") || qt.includes("drop")
      )) {
        return {
          hasStake: false,
          penaltyType: "relegated_confirmed",
          label: "ירידה בטוחה",
          signal: "קבוצה זו כבר ירדה לדיוויזיה נמוכה — מוטיבציה עלולה להיות נמוכה.",
        };
      }
      // Still fighting (European spot, avoiding relegation, title race, etc.)
      return {
        hasStake: true,
        penaltyType: null,
        label: isQual ? "מוכשרת למטרה, עדיין נלחמת על מיקום" : "עדיין נלחמת על מטרה",
        signal: null,
      };
    }
  }
  return null; // team not found — keep by default
}

// ── The Odds API integration ─────────────────────────────────────────────────

// In-process cache for the /sports discovery result (6-hour TTL across warm lambdas)
const oddsDiscoveryCache = globalThis.__ODDS_DISCOVERY_CACHE__ ||
  (globalThis.__ODDS_DISCOVERY_CACHE__ = { at: 0, keys: null });

// Returns a Set of currently-active sport keys (1 API request), or null on failure.
// Callers fall back to querying the full candidate pool when null is returned.
async function discoverActiveSports() {
  if (oddsDiscoveryCache.keys && Date.now() - oddsDiscoveryCache.at < 6 * 60 * 60 * 1000) {
    return oddsDiscoveryCache.keys;
  }
  try {
    const data = await fetchJson(`${ODDS_API_BASE}/sports/?apiKey=${ODDS_API_KEY}`, {
      retryAttempts: 1, retryBaseDelay: 500,
    });
    if (!Array.isArray(data)) return null;
    const keys = new Set(data.map((s) => s.key));
    oddsDiscoveryCache.keys = keys;
    oddsDiscoveryCache.at   = Date.now();
    return keys;
  } catch {
    return null;
  }
}

async function fetchOddsApiSport(sportKey, dateFrom, dateTo) {
  // The Odds API requires UTC (Z) format — timezone offsets cause 422.
  // Use uk,eu,us regions for broad coverage across European, American and South-American leagues.
  const url =
    `${ODDS_API_BASE}/sports/${sportKey}/odds` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=uk,eu,us&markets=h2h&dateFormat=iso&oddsFormat=decimal` +
    `&commenceTimeFrom=${dateFrom}T00:00:00Z` +
    `&commenceTimeTo=${dateTo}T23:59:59Z`;
  try {
    const data = await fetchJson(url, { retryAttempts: 1, retryBaseDelay: 500 });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // Propagate quota errors so callers can fall back to snapshot
    if (e.message?.includes("401:")) throw e;
    return [];
  }
}

function oddsApiEventToRow(event, sportMeta) {
  const bookmaker =
    event.bookmakers?.find((b) => ["bet365", "unibet", "williamhill", "betfair"].includes(b.key)) ||
    event.bookmakers?.[0];
  if (!bookmaker) return null;

  const h2h = bookmaker.markets?.find((m) => m.key === "h2h");
  if (!h2h?.outcomes?.length) return null;

  const home = event.home_team;
  const away = event.away_team;
  const homeOdds = h2h.outcomes.find((o) => o.name === home)?.price || null;
  const awayOdds = h2h.outcomes.find((o) => o.name === away)?.price || null;
  const drawOdds = h2h.outcomes.find((o) => o.name === "Draw")?.price || null;

  const commenceDate = new Date(event.commence_time);
  const ilParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(commenceDate).map((p) => [p.type, p.value])
  );
  const day  = `${ilParts.year}-${ilParts.month}-${ilParts.day}`;
  const time = `${ilParts.hour}:${ilParts.minute}`;
  // UTC date of the game (used for "tomorrow" matching — South American games start
  // after Israel midnight but are still "tomorrow" on the international calendar)
  const utcDay = event.commence_time ? event.commence_time.slice(0, 10) : day;

  const isFootball = Number(sportMeta.sportId) === WINNER_FOOTBALL_ID;

  // Collect all candidates regardless of odds range, then pick closest to Winner sweet spot.
  // Winner typically recommends outcomes around 1.5–1.8 (high confidence).
  const allCandidates = isFootball
    ? [
        homeOdds ? { name: home,    odds: homeOdds } : null,
        drawOdds ? { name: "תיקו", odds: drawOdds } : null,
        awayOdds ? { name: away,    odds: awayOdds } : null,
      ].filter(Boolean)
    : [
        homeOdds ? { name: home, odds: homeOdds } : null,
        awayOdds ? { name: away, odds: awayOdds } : null,
      ].filter(Boolean);

  if (!allCandidates.length) return null;

  // Wide range: captures strong favourites (≥1.20) through mild underdogs (≤2.80).
  // Narrower Winner-style range [1.40–1.90] would miss many valid picks.
  const TARGET_MIN = 1.20, TARGET_MAX = 2.80;
  const inRange = allCandidates.filter((c) => c.odds >= TARGET_MIN && c.odds <= TARGET_MAX);
  const hasInRange = inRange.length > 0;
  const pool = hasInRange ? inRange : allCandidates;
  // Among valid candidates, pick the one closest to 1.65 (ideal confidence score ~61%)
  const TARGET_ODDS = 1.65;
  const pick = pool.sort((a, b) => Math.abs(a.odds - TARGET_ODDS) - Math.abs(b.odds - TARGET_ODDS))[0];
  const prob  = 1 / pick.odds;
  const score = Math.round(prob * 100);

  return {
    id:                 `odds-${event.id}`,
    eventId:            event.id,
    source:             "The Odds API",
    utcDay,
    day,
    time,
    sport:              isFootball ? "כדורגל" : "כדורסל",
    sportId:            sportMeta.sportId,
    league:             sportMeta.label,
    match:              `${home} - ${away}`,
    home,
    away,
    pick:               pick.name,
    pickTeam:           pick.name,
    winnerPick:         pick.name,
    odds:               pick.odds,
    oddsRaw:            pick.odds,
    homeOdds:           homeOdds  || null,
    drawOdds:           drawOdds  || null,
    awayOdds:           awayOdds  || null,
    probability:        prob,
    recommendationScore:score,
    score,
    recommended:        hasInRange,   // only recommend if odds are in the 1.35–2.20 range
    outsideRange:       !hasInRange,  // properly marks games outside the preferred range
    status:             "ממתין",
    matchPhase:         "scheduled",
    bettingStatus:      "available",
    riskLevel:          score >= 70 ? "נמוך" : score >= 50 ? "בינוני" : "גבוה",
    resultKey:          `${sportMeta.sportId}:${day}:${normalizeMatchName(home)}:${normalizeMatchName(away)}`,
    verifiedAt:         new Date().toISOString(),
  };
}

async function buildOddsApiFeed() {
  if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY not set");

  // Discover which leagues currently have upcoming events (1 API request).
  // This prevents wasting quota on dead/off-season leagues.
  const activeSportKeys = await discoverActiveSports();
  const sportsToQuery = activeSportKeys
    ? ODDS_API_SPORTS.filter((s) => activeSportKeys.has(s.key))
    : ODDS_API_SPORTS;

  const today    = israelDate(0);
  const tomorrow = israelDate(1);
  const dayPlus4 = israelDate(5);

  // Query from yesterday (UTC) so Copa/South-American games starting at 22:00 UTC
  // (= 01:00 AM Israel) are captured before they go in-play.
  // The Israel-timezone day (row.day) filter below keeps only today-onwards.
  const queryFrom = israelDate(-1);
  const BATCH = 5;
  const allRows = [];
  for (let i = 0; i < sportsToQuery.length; i += BATCH) {
    const batch = sportsToQuery.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map((sport) =>
        fetchOddsApiSport(sport.key, queryFrom, dayPlus4).then((events) =>
          events.map((e) => oddsApiEventToRow(e, sport)).filter(Boolean)
        )
      )
    );
    for (const r of batchResults) {
      if (r.status === "rejected") {
        if (r.reason?.message?.includes("401:")) {
          throw new Error("Odds API quota exceeded: " + r.reason.message.slice(0, 120));
        }
        continue;
      }
      for (const row of r.value) {
        if (row.day >= today) allRows.push(row);
      }
    }
    if (i + BATCH < sportsToQuery.length) await sleep(300);
  }

  const sortByScore = (rows) =>
    [...rows].sort((a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0));

  const FOOTBALL_MIN = 15;

  const todayRows    = allRows.filter((r) => r.day === today);
  const tomorrowRows = allRows.filter((r) => r.day === tomorrow);

  // Fill today: if recommended football < FOOTBALL_MIN, pull from nearest future days.
  // Rows keep their original `day` so the UI shows the real date.
  const todayFootballRec = todayRows.filter(
    (r) => Number(r.sportId) === WINNER_FOOTBALL_ID && r.recommended
  );
  if (todayFootballRec.length < FOOTBALL_MIN) {
    const todayIds = new Set(todayRows.map((r) => r.id));
    const fill = allRows
      .filter((r) => r.day > today && Number(r.sportId) === WINNER_FOOTBALL_ID && r.recommended && !todayIds.has(r.id))
      .sort((a, b) => a.day.localeCompare(b.day) || (b.recommendationScore || 0) - (a.recommendationScore || 0))
      .slice(0, FOOTBALL_MIN - todayFootballRec.length);
    for (const row of fill) todayRows.push(row);
  }

  // Fill tomorrow similarly
  const tomorrowFootballRec = tomorrowRows.filter(
    (r) => Number(r.sportId) === WINNER_FOOTBALL_ID && r.recommended
  );
  if (tomorrowFootballRec.length < FOOTBALL_MIN) {
    const tomorrowIds = new Set(tomorrowRows.map((r) => r.id));
    const fill = allRows
      .filter((r) => r.day > tomorrow && Number(r.sportId) === WINNER_FOOTBALL_ID && r.recommended && !tomorrowIds.has(r.id))
      .sort((a, b) => a.day.localeCompare(b.day) || (b.recommendationScore || 0) - (a.recommendationScore || 0))
      .slice(0, FOOTBALL_MIN - tomorrowFootballRec.length);
    for (const row of fill) tomorrowRows.push(row);
  }

  const tomorrowDate = tomorrowRows.length > 0 ? tomorrow : israelDate(1);

  const pickedToday    = sortByScore(todayRows).slice(0, TARGET_PICKS_PER_SPORT * 2);
  const pickedTomorrow = sortByScore(tomorrowRows).slice(0, TARGET_PICKS_PER_SPORT * 2);

  // Snapshot for yesterday only
  const snapshotNorm = normalizeFallbackRows(SNAPSHOT);
  const yesterdayTab = snapshotNorm.tabs?.yesterday || {
    label: "אתמול", date: israelDate(-1), sports: { football: [], basketball: [] },
  };

  const now = new Date().toISOString();
  return {
    ok:           true,
    generatedAt:  now,
    oddsSource:   "The Odds API",
    tabs: {
      yesterday: { ...yesterdayTab, date: israelDate(-1) },
      today:     { label: "היום",  date: today,        sports: splitBySport(pickedToday) },
      tomorrow:  { label: "מחר",   date: tomorrowDate, sports: splitBySport(pickedTomorrow) },
    },
    reuvenSchedule: [],
    audit:          {},
    trackingResults:[],
    faq:            [],
  };
}
// ─────────────────────────────────────────────────────────────────────────────

function normalizeFallbackRows(payload) {
  const verifiedAt = payload.generatedAt || new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(payload));

  // Shift tabs if snapshot is stale relative to current Israeli date
  const snapshotTodayDate = copy.tabs?.today?.date;
  const currentDate = israelDate(0);
  if (snapshotTodayDate && snapshotTodayDate !== currentDate) {
    const snapshotMs = new Date(`${snapshotTodayDate}T00:00:00+03:00`).getTime();
    const currentMs  = new Date(`${currentDate}T00:00:00+03:00`).getTime();
    const daysDiff   = Math.round((currentMs - snapshotMs) / (24 * 60 * 60 * 1000));

    const emptyTab = (label, date) => ({ label, date, sports: { football: [], basketball: [] } });

    if (daysDiff === 1) {
      // Snapshot 1 day old: snapshot.today (yesterday's games) → yesterday tab,
      // snapshot.tomorrow (today's scheduled games) → today tab.
      // Row dates already match tab dates — no re-labelling needed.
      copy.tabs = {
        yesterday: { ...copy.tabs.today,    label: "אתמול", date: israelDate(-1) },
        today:     { ...copy.tabs.tomorrow, label: "היום",  date: currentDate },
        tomorrow:  emptyTab("מחר", israelDate(1)),
      };
    } else if (daysDiff === 2) {
      // Snapshot 2 days old: snapshot.tomorrow held yesterday's games (day = israelDate(-1)).
      // today and tomorrow have no real data — show empty rather than fake dates.
      copy.tabs = {
        yesterday: { ...copy.tabs.tomorrow, label: "אתמול", date: israelDate(-1) },
        today:     emptyTab("היום",  currentDate),
        tomorrow:  emptyTab("מחר",   israelDate(1)),
      };
    } else {
      // Snapshot 3+ days old: all stale — clear everything.
      copy.tabs = {
        yesterday: emptyTab("אתמול", israelDate(-1)),
        today:     emptyTab("היום",  currentDate),
        tomorrow:  emptyTab("מחר",  israelDate(1)),
      };
    }
    // NOTE: row.day is NOT overwritten — each row keeps its original date.
    // Overwriting caused stale games to masquerade as today's games.
  }

  // Enforce row.day matches tab.date — removes rows that slipped into the wrong tab
  for (const tab of Object.values(copy.tabs || {})) {
    if (!tab.date) continue;
    for (const sport of Object.keys(tab.sports || {})) {
      tab.sports[sport] = (tab.sports[sport] || []).filter((r) => !r.day || r.day === tab.date);
    }
  }

  // Normalize row fields
  for (const tab of Object.values(copy.tabs || {})) {
    for (const rows of Object.values(tab.sports || {})) {
      for (const row of rows || []) {
        row.verifiedAt = row.verifiedAt || verifiedAt;
        row.bettingStatus = row.bettingStatus || "available";
        row.status = normalizePredictionStatus(row.status);
        if (row.result && !row.resultVerifiedAt && (row.matchPhase === "final" || row.actualWinner)) {
          row.resultVerifiedAt = verifiedAt;
        }
        const sc = row.recommendationScore || row.score || 0;
        row.riskLevel = row.riskLevel || (sc >= 70 ? "נמוך" : sc >= 50 ? "בינוני" : "גבוה");
      }
    }
  }
  return copy;
}

function expectedIsraelTabDates() {
  return {
    yesterday: israelDate(-1),
    today: israelDate(0),
    tomorrow: israelDate(1),
  };
}

function payloadMatchesIsraelDates(payload) {
  const expected = expectedIsraelTabDates();
  return Boolean(
    payload?.tabs?.yesterday?.date === expected.yesterday &&
    payload?.tabs?.today?.date === expected.today &&
    payload?.tabs?.tomorrow?.date === expected.tomorrow
  );
}

function markStaleDatePayload(payload, reason) {
  const copy = normalizeFallbackRows(payload || {});
  const expected = expectedIsraelTabDates();
  copy.ok = true;
  copy.fallback = true;
  copy.staleDate = true;
  copy.fallbackReason = reason;
  copy.expectedDates = expected;
  copy.tabs = {
    yesterday: { label: "אתמול", date: expected.yesterday, sports: { football: [], basketball: [] } },
    today: { label: "היום", date: expected.today, sports: { football: [], basketball: [] } },
    tomorrow: { label: "מחר", date: expected.tomorrow, sports: { football: [], basketball: [] } },
  };
  copy.lineStats = { football: { today: 0, tomorrow: 0 }, basketball: { today: 0, tomorrow: 0 }, total: { yesterday: 0, today: 0, tomorrow: 0 } };
  return copy;
}

async function buildCachedWinnerFeedPayload({ force = false } = {}) {
  const key = cacheKeyForToday();
  const cached = await kvGet(key);
  const cachedMatchesDates = payloadMatchesIsraelDates(cached?.payload);
  // Fresh hit — serve immediately
  if (!force && cachedMatchesDates && isFreshCache(cached, CACHE_TTL_MS.full)) {
    return {
      ...cached.payload,
      cache: { status: "hit", key, cachedAt: cached.cachedAt, ttlMs: CACHE_TTL_MS.full },
    };
  }
  // Stale but recent (< 20 min): serve immediately, let CDN stale-while-revalidate
  // trigger the background rebuild on the next CDN revalidation cycle.
  const staleAgeMs = cached?.cachedAt ? Date.now() - Number(cached.cachedAt) : Infinity;
  if (!force && cachedMatchesDates && cached?.payload && staleAgeMs < 20 * 60 * 1000) {
    return {
      ...cached.payload,
      stale: true,
      cache: { status: "stale-recent", key, cachedAt: cached.cachedAt, staleAgeMs },
    };
  }
  // Cache missing or very stale: full rebuild
  let payload;
  try {
    payload = await buildWinnerFeedPayload({ withLogos: true });
  } catch (winnerError) {
    console.error("[winner-feed] buildWinnerFeedPayload threw:", winnerError?.message, winnerError?.stack?.split("\n")[1]);
    // Winner blocked — prefer the local snapshot (real Winner data) over Odds API.
    const snapshotNorm1 = normalizeFallbackRows(SNAPSHOT);
    if (payloadMatchesIsraelDates(snapshotNorm1)) {
      payload = {
        ...snapshotNorm1,
        ok: true,
        oddsSource: "Winner Snapshot",
        liveError: winnerError.message,
      };
    } else {
      // Snapshot is stale — fall back to Odds API.
      try {
        payload = await buildOddsApiFeed();
      } catch (oddsError) {
        console.error("[winner-feed] buildOddsApiFeed also threw:", oddsError?.message);
        payload = {
          ...markStaleDatePayload(snapshotNorm1, "טעינת Winner ו-The Odds API נכשלה וה-snapshot המקומי שייך לתאריך אחר, לכן לא מוצגים משחקים ישנים בתור היום."),
          ok: true,
          fallback: true,
          fallbackReason: "Winner ו-The Odds API לא זמינים, נטען snapshot רק אם הוא תואם לתאריך ישראל הנוכחי.",
          liveError: winnerError.message,
          oddsError: oddsError.message,
        };
      }
    }
  }

  // If Winner has too few games OR too few distinct leagues, supplement from The Odds API.
  // noOddsYet rows are 365Scores schedule placeholders with no odds — they don't count as real picks.
  const countReal = (tab) =>
    [...(tab?.sports?.football || []), ...(tab?.sports?.basketball || [])].filter(r => !r.noOddsYet).length;
  const todayCount = countReal(payload.tabs?.today);
  const tomorrowCount = countReal(payload.tabs?.tomorrow);

  function tabLeagueSet(tab) {
    const all = [...(tab?.sports?.football || []), ...(tab?.sports?.basketball || [])];
    return new Set(all.map((r) => String(r.league || "").trim().toLowerCase()).filter(Boolean));
  }
  const todayLeagues = tabLeagueSet(payload.tabs?.today);
  const tomorrowLeagues = tabLeagueSet(payload.tabs?.tomorrow);
  // Supplement when count is low OR league variety is low (e.g. only Brazil at end of European season)
  const MIN_LEAGUES = 3;
  const needsOdds = !payload.fallback && (
    todayCount < MIN_PREMIUM_ROWS_PER_DAY ||
    tomorrowCount < MIN_PREMIUM_ROWS_PER_DAY ||
    todayLeagues.size < MIN_LEAGUES ||
    tomorrowLeagues.size < MIN_LEAGUES
  );

  if (needsOdds) {
    try {
      const oddsFeed = await buildOddsApiFeed();
      const newTabs = { ...payload.tabs };
      let usedOdds = false;

      for (const [dayKey, dayCount, dayLeagues] of [
        ["today",    todayCount,    todayLeagues],
        ["tomorrow", tomorrowCount, tomorrowLeagues],
      ]) {
        const oddsTab = oddsFeed.tabs?.[dayKey];
        if (!oddsTab || !payloadMatchesIsraelDates(oddsFeed)) continue;
        const oddsCount =
          (oddsTab.sports?.football?.length || 0) +
          (oddsTab.sports?.basketball?.length || 0);

        if (dayCount < MIN_PREMIUM_ROWS_PER_DAY && oddsCount > dayCount) {
          // Too few games overall — replace the tab entirely
          newTabs[dayKey] = oddsTab;
          usedOdds = true;
        } else if (dayLeagues.size < MIN_LEAGUES && oddsCount > 0) {
          // Enough games but only 1-2 leagues — merge in games from leagues not in Winner
          const oddsRows = [
            ...(oddsTab.sports?.football || []),
            ...(oddsTab.sports?.basketball || []),
          ];
          const freshRows = oddsRows.filter((r) => {
            const league = String(r.league || "").trim().toLowerCase();
            return league && !dayLeagues.has(league);
          });
          if (freshRows.length > 0) {
            const existing = newTabs[dayKey];
            newTabs[dayKey] = {
              ...existing,
              sports: {
                football: [
                  ...(existing.sports?.football || []),
                  ...freshRows.filter((r) => Number(r.sportId) === WINNER_FOOTBALL_ID),
                ],
                basketball: [
                  ...(existing.sports?.basketball || []),
                  ...freshRows.filter((r) => Number(r.sportId) === WINNER_BASKETBALL_ID),
                ],
              },
            };
            usedOdds = true;
          }
        }
      }
      if (usedOdds) payload = { ...payload, tabs: newTabs, oddsSource: "The Odds API" };
    } catch {
      // Keep the Winner payload if Odds API is unavailable.
    }
  }

  if (!payloadMatchesIsraelDates(payload)) {
    const snapshotNorm2 = normalizeFallbackRows(SNAPSHOT);
    const snapshot = payloadMatchesIsraelDates(snapshotNorm2)
      ? snapshotNorm2
      : markStaleDatePayload(snapshotNorm2, "המקור החזיר תאריכים שלא תואמים ל-Asia/Jerusalem, לכן הטאבים הפתוחים רוקנו כדי לא להציג משחקים ישנים בתור היום.");
    payload = {
      ...snapshot,
      ok: true,
      fallback: true,
      fallbackReason: snapshot.fallbackReason || "payload date mismatch",
    };
  }
  const entry = { cachedAt: Date.now(), payload };
  await kvSet(key, entry, 24 * 60 * 60);
  return {
    ...payload,
    cache: { status: "refresh", key, cachedAt: entry.cachedAt, ttlMs: CACHE_TTL_MS.full },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
  // 30 requests per IP per minute — feed is heavily cached so this is generous
  if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;
  try {
    const force = String(req?.query?.force || "").toLowerCase() === "1";
    const payload = await buildCachedWinnerFeedPayload({ force });
    res.status(200).json(payload);
  } catch (error) {
    try {
      const cached = await kvGet(cacheKeyForToday());
      if (cached?.payload && payloadMatchesIsraelDates(cached.payload)) {
        res.status(200).json({
          ...cached.payload,
          ok: true,
          fallback: true,
          fallbackReason: "טעינת Winner נכשלה, לכן נטען cache שרת אחרון.",
          liveError: error.message,
          cache: { status: "stale", key: cacheKeyForToday(), cachedAt: cached.cachedAt },
        });
        return;
      }
      const snapshotNorm3 = normalizeFallbackRows(SNAPSHOT);
      const snapshot = payloadMatchesIsraelDates(snapshotNorm3)
        ? snapshotNorm3
        : markStaleDatePayload(snapshotNorm3, "חיבור חי ל-Winner נחסם וה-snapshot המקומי שייך לתאריך אחר, לכן לא מוצגים משחקים ישנים בתור היום.");
      res.status(200).json({
        ...snapshot,
        ok: true,
        fallback: true,
        fallbackReason: "חיבור חי ל-Winner נחסם מסביבת השרת, לכן נטען snapshot מאומת שנמשך מ-Winner.",
        liveError: error.message,
      });
    } catch (snapshotError) {
      res.status(500).json({
        ok: false,
        error: "טעינת נתוני Winner נכשלה",
        detail: error.message,
        snapshotDetail: snapshotError.message,
      });
    }
  }
};

module.exports.buildWinnerFeedPayload = buildWinnerFeedPayload;
module.exports.buildCachedWinnerFeedPayload = buildCachedWinnerFeedPayload;
module.exports.buildOddsApiFeed = buildOddsApiFeed;
module.exports.getOddsApiScores = getOddsApiScores;
module.exports.TARGET_PICKS_PER_SPORT = TARGET_PICKS_PER_SPORT;
