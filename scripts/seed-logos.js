#!/usr/bin/env node
/**
 * Scrapes logos for all teams and leagues in the current Winner line.
 * Searches TheSportsDB → Wikipedia → Wikidata for each name.
 * Outputs results to scripts/logos-seed.json and optionally upserts to Supabase.
 *
 * Usage:
 *   node scripts/seed-logos.js
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/seed-logos.js --upsert
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jgcmtrlviuivbtimtqjq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const DO_UPSERT = process.argv.includes("--upsert");
const OUTPUT_FILE = path.join(__dirname, "logos-seed.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanText(value) {
  return String(value || "")
    .replace(/[‪-‮‬‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLogoName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(מכבי|הפועל|בני|עירוני|ביתר|אף\.קיי|בי\.סי|פ\.ק|fc|f\.c|cf|bc|bk|club|women|basketball|basket)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, options = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 120)}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1000 * attempt);
    }
  }
}

function winnerHeaders() {
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
  };
}

async function getWinnerLine() {
  const hashMessage = JSON.stringify({ prevCurrentVersion: null, reason: "Initiated" });
  const hashes = await fetchJson("https://api.winner.co.il/v2/publicapi/GetCMobileHashes", {
    headers: winnerHeaders(),
  });
  const line = await fetchJson(
    `https://api.winner.co.il/v2/publicapi/GetCMobileLine?lineChecksum=${encodeURIComponent(hashes.lineChecksum)}`,
    { headers: winnerHeaders() }
  );
  return line.markets || [];
}

function splitTeams(match) {
  const [home, away] = cleanText(match).split(" - ").map(cleanText);
  return { home: home || cleanText(match), away: away || "" };
}

async function sportsDbSearch(kind, term) {
  const value = cleanText(term);
  if (!value || value.length < 3) return null;
  const endpoint = kind === "league" ? "search_all_leagues.php" : "searchteams.php";
  const param = kind === "league" ? "l" : "t";
  const url = `https://www.thesportsdb.com/api/v1/json/3/${endpoint}?${param}=${encodeURIComponent(value)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const data = await fetchJson(url, { signal: controller.signal }).catch(() => null);
  clearTimeout(timeout);
  const rows = kind === "league" ? (data?.countries || data?.leagues) : data?.teams;
  if (!Array.isArray(rows) || !rows.length) return null;
  const normalized = value.toLowerCase();
  const exact = rows.find((r) => cleanText(r.strTeam || r.strLeague).toLowerCase() === normalized);
  const row = exact || rows[0];
  const logo = row.strBadge || row.strLogo || row.strFanart1 || "";
  return logo ? { name: cleanText(row.strTeam || row.strLeague || value), logo_url: logo, source: "TheSportsDB" } : null;
}

async function wikipediaLogoSearch(name) {
  const value = cleanText(name);
  if (!value || value.length < 3) return null;
  for (const lang of ["he", "en"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const data = await fetchJson(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(value)}`,
      { headers: { "User-Agent": "HapogeaLogoBot/1.0" }, signal: controller.signal }
    ).catch(() => null);
    clearTimeout(timeout);
    const logo = data?.thumbnail?.source || data?.originalimage?.source || "";
    if (logo) return { name: cleanText(data.title || value), logo_url: logo, source: `Wikipedia ${lang}` };
  }
  return null;
}

async function wikidataLogoSearch(name) {
  const value = cleanText(name);
  if (!value || value.length < 3) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  const search = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=he&format=json&limit=1&search=${encodeURIComponent(value)}`,
    { headers: { "User-Agent": "HapogeaLogoBot/1.0" }, signal: controller.signal }
  ).catch(() => null);
  clearTimeout(timeout);
  const id = search?.search?.[0]?.id;
  if (!id) return null;
  const entity = await fetchJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`,
    { headers: { "User-Agent": "HapogeaLogoBot/1.0" } }
  ).catch(() => null);
  const claims = entity?.entities?.[id]?.claims || {};
  const image = claims.P154?.[0]?.mainsnak?.datavalue?.value || claims.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!image) return null;
  return {
    name: value,
    logo_url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=160`,
    source: "Wikidata",
  };
}

async function resolveLogoFromSources(name, kind) {
  const terms = [
    cleanText(name),
    normalizeLogoName(cleanText(name)),
  ].filter((t, i, arr) => t && t.length >= 2 && arr.indexOf(t) === i);

  for (const term of terms) {
    const results = await Promise.allSettled([
      sportsDbSearch(kind, term),
      wikipediaLogoSearch(term),
      wikidataLogoSearch(term),
    ]);
    const found = results.find((r) => r.status === "fulfilled" && r.value?.logo_url)?.value;
    if (found) return found;
    await sleep(120);
  }
  return null;
}

async function supabaseUpsert(table, rows) {
  if (!SUPABASE_ANON_KEY) {
    console.warn(`  [skip] No SUPABASE_ANON_KEY — not upserting ${rows.length} rows to ${table}`);
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase upsert ${table} failed: ${response.status} ${text.slice(0, 200)}`);
  console.log(`  ✔ Upserted ${rows.length} rows into ${table}`);
}

async function main() {
  console.log("Fetching Winner line...");
  let markets;
  try {
    markets = await getWinnerLine();
    console.log(`Got ${markets.length} markets`);
  } catch (err) {
    console.error("Failed to fetch Winner line:", err.message);
    process.exit(1);
  }

  const SPORT_IDS = new Set([240, 227]);
  const teamNames = new Set();
  const leagueNames = new Set();

  for (const market of markets) {
    if (!SPORT_IDS.has(Number(market.sId))) continue;
    const league = cleanText(market.league);
    if (league) leagueNames.add(league);
    const { home, away } = splitTeams(market.desc);
    if (home) teamNames.add(home);
    if (away) teamNames.add(away);
  }

  console.log(`Unique teams: ${teamNames.size}, leagues: ${leagueNames.size}`);

  const teamResults = [];
  const leagueResults = [];

  const teamsArr = [...teamNames];
  for (let i = 0; i < teamsArr.length; i++) {
    const name = teamsArr[i];
    process.stdout.write(`  Team [${i + 1}/${teamsArr.length}] ${name}... `);
    const result = await resolveLogoFromSources(name, "team");
    const entry = { name_he: name, name: normalizeLogoName(name), slug: normalizeLogoName(name).replace(/\s+/g, "-"), logo_url: result?.logo_url || null, source: result?.source || null };
    teamResults.push(entry);
    console.log(result ? `✔ ${result.source}` : "✗ not found");
  }

  const leaguesArr = [...leagueNames];
  for (let i = 0; i < leaguesArr.length; i++) {
    const name = leaguesArr[i];
    process.stdout.write(`  League [${i + 1}/${leaguesArr.length}] ${name}... `);
    const result = await resolveLogoFromSources(name, "league");
    const entry = { name_he: name, name: normalizeLogoName(name), slug: normalizeLogoName(name).replace(/\s+/g, "-"), logo_url: result?.logo_url || null, source: result?.source || null };
    leagueResults.push(entry);
    console.log(result ? `✔ ${result.source}` : "✗ not found");
  }

  const foundTeams = teamResults.filter((r) => r.logo_url).length;
  const foundLeagues = leagueResults.filter((r) => r.logo_url).length;
  console.log(`\nResults: ${foundTeams}/${teamsArr.length} teams, ${foundLeagues}/${leaguesArr.length} leagues found logos`);

  const output = { generatedAt: new Date().toISOString(), teams: teamResults, leagues: leagueResults };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Saved to ${OUTPUT_FILE}`);

  if (DO_UPSERT) {
    console.log("\nUpserting to Supabase...");
    const teamsToUpsert = teamResults.filter((r) => r.logo_url);
    const leaguesToUpsert = leagueResults.filter((r) => r.logo_url);
    if (teamsToUpsert.length) await supabaseUpsert("teams", teamsToUpsert);
    if (leaguesToUpsert.length) await supabaseUpsert("leagues", leaguesToUpsert);
  } else {
    console.log("\nRun with --upsert and SUPABASE_ANON_KEY= to push to database.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
