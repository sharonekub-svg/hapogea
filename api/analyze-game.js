// /api/analyze-game
// Accepts POST { home, away, sport, league, odds1, oddsX, odds2, handicap }
// Calls Anthropic Claude (claude-haiku-4-5-20251001) and returns Hebrew prediction.
// Required env var: ANTHROPIC_API_KEY

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }

  if (!ANTHROPIC_KEY) {
    res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { home, away, sport, league, odds1, oddsX, odds2, handicap } = req.body || {};

  if (!home || !away) {
    res.status(400).json({ ok: false, error: "home and away team names required" });
    return;
  }

  const sportLabel = buildSportLabel(sport);
  const oddsBlock = buildOddsBlock(home, away, odds1, oddsX, odds2, handicap);

  const prompt = `אתה אנליסט ספורט מקצועי. נתח את המשחק הבא בעברית ותן המלצת הימור קצרה וממוקדת.

**משחק:** ${home} נגד ${away}
**ספורט:** ${sportLabel}
**ליגה:** ${league || "לא ידוע"}
${oddsBlock}

**הנחיות:**
- כתוב 3-4 משפטים בלבד בעברית
- הזכר יתרון ביתי, כוח יחסי של הקבוצות, וערך ביחס
- ציין מי אתה ממליץ להמר עליו ולמה
- אם היחסים מעידים על אי-וודאות גבוהה, ציין זאת
- אל תמציא נתוני פציעות ספציפיים — הסתמך רק על היחסים שניתנו
- הפורמט: שורת המלצה → שורת נימוק → שורת ערך ביחס

כתוב בגוף ראשון, ישיר, כאילו אתה מספר לחבר.`;

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      res.status(502).json({ ok: false, error: `Claude API ${response.status}`, detail: errText.slice(0, 300) });
      return;
    }

    const data = await response.json();
    const text = (data?.content || []).map(c => c.text || "").join("").trim();

    if (!text) {
      res.status(502).json({ ok: false, error: "Empty response from Claude" });
      return;
    }

    res.status(200).json({ ok: true, analysis: text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

function buildSportLabel(sport) {
  if (!sport) return "ספורט";
  const s = String(sport).toLowerCase();
  if (s.includes("סל") || s.includes("basket") || s === "227") return "כדורסל";
  if (s.includes("כדורגל") || s.includes("soccer") || s.includes("football") || s === "240") return "כדורגל";
  return sport;
}

function buildOddsBlock(home, away, odds1, oddsX, odds2, handicap) {
  const lines = [];
  if (odds1) lines.push(`**יחס ניצחון ${home}:** ${odds1}`);
  if (oddsX) lines.push(`**יחס תיקו:** ${oddsX}`);
  if (odds2) lines.push(`**יחס ניצחון ${away}:** ${odds2}`);
  if (handicap) lines.push(`**הנחת נקודות (הנדיקאפ):** ${handicap}`);
  return lines.length ? lines.join("\n") : "**יחסים:** לא סופקו";
}
