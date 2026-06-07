/**
 * Debug: show today's Winner basketball lines with actual odds.
 * Run: node scripts/debug-basketball.js
 */
const crypto = require("crypto");
const WINNER_BASKETBALL_ID = 227;

function israelDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}
const decimal = p => { const n = Number(p); return n > 1 ? n : null; };
const clean = t => String(t || "").replace(/[‎‏]/g, "").trim();

function headers(extra = {}) {
  return {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.winner.co.il",
    "Referer": "https://www.winner.co.il/",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "RequestId": crypto.randomUUID(),
    "DeviceId": crypto.randomUUID(),
    "UserAgentData": JSON.stringify({ devicemodel:"",deviceos:"windows",deviceosversion:"10",appversion:"2.6.1",apptype:"desktop",originId:15,isAccessibility:false }),
    "appVersion": "2.6.1",
    ...extra,
  };
}

async function main() {
  const today = israelDate(0);
  console.log("Today:", today);

  // Step 1: get hashes
  const hashMsg = JSON.stringify({ prevCurrentVersion: null, reason: "Initiated" });
  const hashRes = await fetch("https://api.winner.co.il/v2/publicapi/GetCMobileHashes", {
    headers: headers({ HashesMessage: hashMsg }),
  });
  if (!hashRes.ok) { console.error("Hashes failed:", hashRes.status); return; }
  const hashes = await hashRes.json();

  // Step 2: get full line
  const lineMsg = JSON.stringify({ prevCurrentVersion: null, newCurrentVersion: hashes.currentVersion, lineNewHash: hashes.lineChecksum, reason: "Hashes not equal" });
  const lineRes = await fetch(`https://api.winner.co.il/v2/publicapi/GetCMobileLine?lineChecksum=${encodeURIComponent(hashes.lineChecksum)}`, {
    headers: headers({ HashesMessage: lineMsg }),
  });
  if (!lineRes.ok) { console.error("Line failed:", lineRes.status); return; }
  const line = await lineRes.json();
  const markets = (line.markets || []).filter(m => Number(m.sId) === WINNER_BASKETBALL_ID);

  // Group by event
  const events = new Map();
  for (const m of markets) {
    const date = m.e_date ? m.e_date.slice(0, 10) : "";
    if (date !== today) continue;
    if (!events.has(m.eId)) events.set(m.eId, { desc: m.desc, markets: [] });
    events.get(m.eId).markets.push(m);
  }
  console.log(`Basketball events today: ${events.size}\n`);

  for (const [, ev] of events) {
    const primary = ev.markets.find(m => /מנצח|1X2/i.test(clean(m.mp))) || ev.markets[0];
    if (!primary) continue;
    const odds = (primary.outcomes || [])
      .map(o => ({ d: clean(o.desc), v: decimal(o.price) }))
      .filter(o => o.v)
      .sort((a, b) => a.v - b.v);
    if (!odds.length) continue;
    const maxOpp = Math.max(...odds.map(o => o.v));
    const gate = maxOpp >= 2.6 ? "✅" : maxOpp >= 2.0 ? `⚠️ ` : `❌`;
    console.log(`${gate} ${ev.desc}  →  ${odds.map(o => `${o.d}: ${o.v}`).join("  |  ")}`);
  }
}

main().catch(console.error);
