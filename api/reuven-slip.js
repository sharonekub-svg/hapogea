const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const { buildWinnerFeedPayload } = require("./winner-feed.js");
const { rateLimit, sanitizeInput } = require("./_rate-limit");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

function compactWinnerContext(feed) {
  const rows = (feed?.reuvenSchedule || []).slice(0, 90);
  return rows.map((row) => {
    const markets = (row.markets || []).slice(0, 4).map((market) => {
      const outcomes = (market.outcomes || [])
        .filter((outcome) => outcome.odds)
        .slice(0, 5)
        .map((outcome) => `${outcome.label || outcome.desc}: ${Number(outcome.odds).toFixed(2)}`)
        .join(", ");
      return `${market.title}: ${outcomes}`;
    }).join(" | ");
    return `${row.day} ${row.time || ""} | ${row.sport} | ${row.league} | ${row.match} | ${markets}`;
  }).join("\n");
}

async function callVision({ image, note, winnerContext }) {
  const prompt = `You are AI Sports Analyst, a sharp sports and statistical analyst.

Mandatory framing:
AI Sports Analyst provides sports and statistical analysis only. This is not betting advice, not an instruction to stake money, and not a guarantee of results or profit.

Task:
1. Read the uploaded image. Extract all visible games, markets, odds, stake, and total odds if visible, only as market context.
2. Compare any recognizable games/markets against the provided Winner context when possible.
3. Analyze the sports/statistical strengths, weaknesses, uncertainty, and market context. Do not pretend certainty. If text is unreadable, say exactly what is unreadable.
4. Rate the statistical edge/risk profile from 1 to 10.
5. Give a clear bottom line about statistical quality only. Do not tell the user whether to place it, avoid it, stake money, or change it as a betting instruction.
6. If the user wrote Hebrew, answer Hebrew. If English, answer English. Default Hebrew.

Important:
- Do not invent teams, odds, injuries, or markets that are not visible.
- Winner odds are the bookmaker source. If the image odds differ from current Winner context, mention it.
- For multi-leg forms, be extra strict: one weak leg can damage the statistical profile.
- Explain which leg has the weakest statistical support and why, without giving instructions to bet.
- Never use phrases like "place it", "bet on", "my pick", "best bet", "tip", or Hebrew equivalents such as "שים על" / "הייתי מהמר".

User note:
${cleanText(note) || "No extra note."}

Current Winner context:
${winnerContext || "Winner context unavailable."}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Vision API ${response.status}: ${text.slice(0, 220)}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || "לא התקבלה תשובה מהניתוח.";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  // 5 requests per IP per minute — vision API is the most expensive call
  if (rateLimit(req, res, { max: 5, windowMs: 60_000 })) return;

  const image = parseDataUrl(req.body?.image);
  const note = sanitizeInput(req.body?.note, 500);
  if (!image) {
    res.status(400).json({ ok: false, answer: "לא הצלחתי לקרוא את קובץ התמונה. תעלה PNG/JPG/WebP ברור של הטופס." });
    return;
  }
  if (!ANTHROPIC_API_KEY) {
    res.status(200).json({
      ok: false,
      answer: "קיבלתי את התמונה, אבל ניתוח תמונה עדיין לא מופעל בשרת כי חסר ANTHROPIC_API_KEY. אני לא אנחש מה כתוב בתמונה. בינתיים תעתיק לי את המשחקים והיחסים, ואני אתן ניתוח ספורטיבי וסטטיסטי בלבד מול נתוני Winner.",
    });
    return;
  }

  try {
    let winnerContext = "";
    try {
      const feed = await buildWinnerFeedPayload({ withLogos: false });
      winnerContext = compactWinnerContext(feed);
    } catch (error) {
      winnerContext = `Winner context failed: ${error.message}`;
    }
    const answer = await callVision({ image, note, winnerContext });
    res.status(200).json({ ok: true, answer });
  } catch (error) {
    console.error("Reuven slip error:", error);
    res.status(200).json({
      ok: false,
      answer: `לא הצלחתי לנתח את התמונה כרגע: ${error.message}. אם זה דחוף, תעתיק לי את המשחקים והנתונים בטקסט ואני אנתח אותם מבחינה ספורטיבית וסטטיסטית.`,
    });
  }
};
