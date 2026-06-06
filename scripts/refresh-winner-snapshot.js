/**
 * Pull live odds and refresh api/winner-snapshot.json for Vercel fallback.
 * Run from repo root: node scripts/refresh-winner-snapshot.js
 * Requires ODDS_API_KEY environment variable.
 */
const fs = require("fs");
const path = require("path");

const { buildOddsApiFeed } = require("../api/winner-feed");

function countRecommendations(rows = []) {
  return rows.filter((row) => row.recommended || (row.odds && !row.outsideRange)).length;
}

function summarize(payload) {
  const lines = [`generatedAt=${payload.generatedAt}`, `serverVersion=${payload.serverVersion || "-"}`, `oddsSource=${payload.oddsSource || "The Odds API"}`];
  for (const day of ["yesterday", "today", "tomorrow"]) {
    const tab = payload.tabs?.[day];
    for (const sport of ["football", "basketball"]) {
      const rows = tab?.sports?.[sport] || [];
      lines.push(`${day}.${sport}: rows=${rows.length}, recommended=${countRecommendations(rows)}`);
    }
  }
  return lines.join("\n");
}

function picksCount(payload) {
  let n = 0;
  for (const day of ["today", "tomorrow"]) {
    const tab = payload.tabs?.[day];
    for (const sport of ["football", "basketball"]) {
      n += (tab?.sports?.[sport] || []).filter((r) => r.odds && !r.noOddsYet).length;
    }
  }
  return n;
}

async function main() {
  if (!process.env.ODDS_API_KEY) {
    console.error("ODDS_API_KEY is not set — cannot refresh snapshot.");
    process.exit(1);
  }

  const outPath = path.join(__dirname, "..", "api", "winner-snapshot.json");

  console.log("Fetching odds from The Odds API...");
  const payload = await buildOddsApiFeed();
  const picks = picksCount(payload);
  console.log("Odds API succeeded, picks:", picks);

  if (picks === 0) {
    console.warn("0 real picks returned — snapshot will be written but may show no games.");
  }

  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote", outPath);
  console.log(summarize(payload));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
