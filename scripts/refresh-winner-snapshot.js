/**
 * Pull live Winner line and refresh api/winner-snapshot.json for Vercel fallback.
 * Run from repo root: node scripts/refresh-winner-snapshot.js
 * Falls back to The Odds API (ODDS_API_KEY) when Winner is unreachable.
 */
const fs = require("fs");
const path = require("path");

const { buildWinnerFeedPayload, buildOddsApiFeed } = require("../api/winner-feed");

function countRecommendations(rows = []) {
  return rows.filter((row) => row.recommended || (row.odds && !row.outsideRange)).length;
}

function summarize(payload) {
  const lines = [`generatedAt=${payload.generatedAt}`, `serverVersion=${payload.serverVersion || "-"}`, `oddsSource=${payload.oddsSource || "Winner"}`];
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
    n += (tab?.sports?.football?.length || 0) + (tab?.sports?.basketball?.length || 0);
  }
  return n;
}

async function main() {
  const outPath = path.join(__dirname, "..", "api", "winner-snapshot.json");

  console.log("Fetching Winner line...");
  let payload = await buildWinnerFeedPayload({ withLogos: true });

  if (picksCount(payload) === 0 && process.env.ODDS_API_KEY) {
    console.log("Winner returned 0 picks for today/tomorrow — falling back to The Odds API...");
    payload = await buildOddsApiFeed();
  }

  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote", outPath);
  console.log(summarize(payload));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
