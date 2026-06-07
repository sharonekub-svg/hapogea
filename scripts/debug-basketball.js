/**
 * Debug: show today's Winner basketball lines with actual odds.
 * Run: node scripts/debug-basketball.js
 */
const WINNER_BASKETBALL_ID = 227;

function israelDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}
const decimal = p => { const n = Number(p); return n > 1 ? n : null; };
const clean = t => String(t || "").replace(/[‎‏]/g, "").trim();

async function main() {
  const today = israelDate(0);
  console.log("Today:", today);

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.winner.co.il",
    "Referer": "https://www.winner.co.il/",
    "x-device-type": "desktop",
  };

  const res = await fetch("https://www.winner.co.il/api/v2/publicapi/GetOpenMarkets", {
    method: "POST",
    headers,
    body: JSON.stringify({ sportId: WINNER_BASKETBALL_ID, leagueIds: [], date: today }),
  });

  if (!res.ok) { console.error("Failed:", res.status, await res.text()); return; }
  const data = await res.json();
  const markets = data?.markets || [];

  const events = new Map();
  for (const m of markets) {
    if (!events.has(m.eId)) events.set(m.eId, { desc: m.desc, markets: [] });
    events.get(m.eId).markets.push(m);
  }
  console.log(`Events: ${events.size}\n`);

  for (const [, ev] of events) {
    const primary = ev.markets.find(m => /מנצח|1X2/i.test(clean(m.mp))) || ev.markets[0];
    if (!primary) continue;
    const odds = (primary.outcomes || [])
      .map(o => ({ d: clean(o.desc), v: decimal(o.price) }))
      .filter(o => o.v);
    if (!odds.length) continue;
    const maxOpp = Math.max(...odds.map(o => o.v));
    const gate = maxOpp >= 2.6 ? "✅ 2.6" : maxOpp >= 2.0 ? `⚠️  max=${maxOpp.toFixed(2)}` : `❌ max=${maxOpp.toFixed(2)}`;
    console.log(`${gate}  ${ev.desc}`);
    console.log(`       ${odds.map(o => `${o.d}: ${o.v}`).join("  |  ")}`);
  }
}

main().catch(console.error);
