// /api/results-ai
// Receives today's Winner picks, asks Gemini (with Google Search grounding)
// to find their final scores, returns structured פגע/נפל/ממתין per game.
// The browser (admin panel) handles saving results to Supabase.
//
// Required env var: GEMINI_API_KEY

const GEMINI_KEY = process.env.GEMINI_API_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }

  if (!GEMINI_KEY) {
    res.status(500).json({ ok: false, error: "GEMINI_API_KEY not configured in Vercel env vars" });
    return;
  }

  const { games } = req.body || {};
  if (!Array.isArray(games) || !games.length) {
    res.status(400).json({ ok: false, error: "games[] array required in body" });
    return;
  }

  const today = new Date().toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric",
  });

  const gameList = games.map((g, i) => {
    const sp = String(g.sport || "");
    const sport = sp.includes("סל") || sp.includes("basket") || sp === "227" ? "כדורסל" : "כדורגל";
    const pick = g.pickTeam || (g.pick === "draw" ? "תיקו" : g.pick === "home" ? g.home : g.pick === "away" ? g.away : "?");
    return `${i + 1}. ${g.home} מול ${g.away} (${sport}) — הימור: ${pick}`;
  }).join("\n");

  const prompt = `אתה עוזר תוצאות ספורט. היום ${today}.
חפש באינטרנט ומצא את התוצאות הסופיות של המשחקים הבאים (חפש בעברית ובאנגלית):

${gameList}

עבור כל משחק ציין:
- האם הסתיים (finished: true/false)
- תוצאה (score: "X:Y" — ביתי:אורח, ריק אם לא נגמר)
- גולים/נקודות קבוצת הבית (home_score: מספר, null אם לא ידוע)
- גולים/נקודות קבוצת חוץ (away_score: מספר, null אם לא ידוע)

בסוף, החזר **רק** מערך JSON (ללא כל טקסט אחר):
[{"index":1,"finished":true,"score":"2:1","home_score":2,"away_score":1},{"index":2,"finished":false,"score":"","home_score":null,"away_score":null},...]`;

  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
        }),
        signal: AbortSignal.timeout(28_000),
      }
    );

    if (!gemRes.ok) {
      const errText = await gemRes.text().catch(() => "");
      res.status(502).json({ ok: false, error: `Gemini ${gemRes.status}`, detail: errText.slice(0, 300) });
      return;
    }

    const gData = await gemRes.json();
    const rawText = (gData?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "").join("");

    // Extract the JSON array from the response (Gemini sometimes wraps with prose)
    const match = rawText.match(/\[[\s\S]*\]/);
    if (!match) {
      res.status(502).json({ ok: false, error: "No JSON array in Gemini response", raw: rawText.slice(0, 400) });
      return;
    }

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) {
      res.status(502).json({ ok: false, error: "JSON parse failed", raw: match[0].slice(0, 300) });
      return;
    }

    // Determine פגע/נפל/ממתין for each result
    const results = parsed.map(r => {
      const g = games[(r.index || 0) - 1];
      if (!g) return null;

      let status = "ממתין";
      if (r.finished && r.home_score != null && r.away_score != null) {
        const hs = Number(r.home_score), as = Number(r.away_score);
        if      (g.pick === "home") status = hs > as  ? "פגע" : "נפל";
        else if (g.pick === "away") status = as > hs  ? "פגע" : "נפל";
        else if (g.pick === "draw") status = hs === as ? "פגע" : "נפל";
      }

      return {
        home:   g.home,
        away:   g.away,
        sport:  g.sport,
        pick:   g.pick,
        status,
        score:  r.score || "",
        finished: !!r.finished,
      };
    }).filter(Boolean);

    res.status(200).json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
