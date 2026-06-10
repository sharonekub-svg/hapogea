/**
 * Pull live Winner line and refresh api/winner-snapshot.json for Vercel fallback.
 * Run from repo root: node scripts/refresh-winner-snapshot.js
 * Falls back to The Odds API (ODDS_API_KEY) when Winner is unreachable.
 */
const fs = require("fs");
const path = require("path");

const { buildWinnerFeedPayload, buildOddsApiFeed, buildSofascoreFeed, buildPinnacleFeed } = require("../api/winner-feed");

function countRecommendations(rows = []) {
  return rows.filter((row) => row.recommended || (row.odds && !row.outsideRange)).length;
}

function summarize(payload) {
  const lines = [`generatedAt=${payload.generatedAt}`, `serverVersion=${payload.serverVersion || "-"}`, `oddsSource=${payload.oddsSource || "Winner"}`];
  for (const day of ["yesterday", "today", "tomorrow"]) {
    const tab = payload.tabs?.[day];
    for (const sport of ["football", "basketball"]) {
      const rows = tab?.sports?.[sport] || [];
      const upcoming = rows.filter((r) => r.status === "ממתין" && !["final","live","ht"].includes(r.matchPhase)).length;
      lines.push(`${day}.${sport}: rows=${rows.length}, recommended=${countRecommendations(rows)}, upcoming=${upcoming}`);
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
  const outPath = path.join(__dirname, "..", "api", "winner-snapshot.json");

  console.log("Fetching Winner line...");
  let payload = await buildWinnerFeedPayload({ withLogos: true });

  if (picksCount(payload) === 0) {
    console.log("Winner returned 0 real picks — trying SofaScore...");
    try {
      payload = await buildSofascoreFeed();
      console.log("SofaScore succeeded, picks:", picksCount(payload));
    } catch (sfErr) {
      console.warn("SofaScore fallback failed:", sfErr.message);
    }
  }
  if (picksCount(payload) === 0) {
    console.log("Trying Pinnacle...");
    try {
      payload = await buildPinnacleFeed();
      console.log("Pinnacle succeeded, picks:", picksCount(payload));
    } catch (pinErr) {
      console.warn("Pinnacle fallback failed:", pinErr.message);
    }
  }
  if (picksCount(payload) === 0) {
    if (process.env.ODDS_API_KEY) {
      console.log("Trying The Odds API...");
      try {
        payload = await buildOddsApiFeed();
        console.log("Odds API succeeded, picks:", picksCount(payload));
      } catch (oddsErr) {
        console.warn("Odds API fallback failed:", oddsErr.message);
        console.log("Keeping payload (noOddsYet rows).");
      }
    } else {
      console.warn("All sources failed — ODDS_API_KEY not set either.");
    }
  }

  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Wrote", outPath);
  console.log(summarize(payload));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
