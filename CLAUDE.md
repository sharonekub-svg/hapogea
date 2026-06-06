# Instructions for Claude

This repository has one website only: Hapogea, the Winner odds site.

Do not create or restore any old mobile app, backend app, Next.js app, Vite app, or duplicate website. Do not create a second output folder.

Use these files:

- `hapogea-preview/index.html` - the website UI. Edit this file directly.
- `api/winner-feed.js` - live Winner data, odds model, basketball/football feed.
- `api/winner-snapshot.json` - fallback snapshot.
- `scripts/refresh-winner-snapshot.js` - refreshes the snapshot.
- `vercel.json` - deploys `hapogea-preview` and rewrites `/api/*`.

Vercel project:

- Existing project name: `hit`
- Production alias used by Codex: `https://hit-alpha.vercel.app`
- Canonical GitHub repo: `https://github.com/sharonekub-svg/hapogea`
- Do not create a new Vercel project.
- Do not deploy a separate preview-only app as the source of truth.

Important workflow:

```bash
git fetch origin
git checkout codex/winner-live-details
git pull --rebase origin codex/winner-live-details
```

Before pushing:

```bash
node --check api/winner-feed.js
npm run check
git status -sb
```

Current product requirements:

- Basketball includes all Winner basketball leagues, not only NBA.
- Use real Winner pre-match odds only.
- Show exactly what was picked in the `הימרנו` section.
- Show odds under each team; for handicap, include the line.
- If the pick is draw, show `תיקו` clearly in the center.
- Closed results show `נסגר`; settled tracked picks show `נתפס` or `לא נתפס`.
- Public cards should stay compact and should not show the score meter.

---

## Current State (updated 2026-06-06)

### Active branch
`claude/exciting-einstein-3q5MN` — not yet merged to main.

### Features already built (do NOT rebuild these)

| Feature | Where |
|---|---|
| Landing page with hero, features, CTA | `index.html` — `.lp-*` classes |
| App mode (football / basketball / world cup tabs) | `index.html` — `state.sportTab`, `enterApp()` |
| Today's games quick-access widget | landing page, `.today-widget` |
| הפוגע AI chat (React, in-page) | `#ai-section`, `#ai-root` — uses Gemini via `/api/recommendation-bot` |
| AI chat history sidebar (removed — now New Chat button in topbar) | removed in commit `c90512c` |
| Premium modal + gate | `openPremiumModal()`, `/api/premium-*` |
| Auth (Supabase) + header avatar | `HapAuth`, `#authHeaderBtn` |
| Privacy policy modal | `.lp-privacy-modal` |
| Winner feed (live + snapshot fallback) | `api/winner-feed.js`, `api/winner-snapshot.json` |
| GitHub Actions cron to refresh snapshot | `.github/workflows/` |
| World Cup section | `state.wcOpen`, `.wc-*` classes |
| Mobile bottom navigation | `#mobileBottomNav` |
| Skeleton loading cards | `.skeleton-card`, `.skeleton-line` |
| Full-screen first-load overlay | `#loadingOverlay` |

### UI components added (vanilla JS/CSS, not React)

All in `hapogea-preview/index.html`, commit `237915f`:

- **BeamsBackground** — `<canvas id="beamsCanvas">` fixed overlay with animated indigo/cyan beam streaks. JS at bottom of file `(function() { ... beamsCanvas ... })()`.
- **GooeyLoader** — SVG filter `#gooey-filter` + `.gooey-loader-el` div inside `#loadingOverlay`, below the stats row. Animated gooey blobs.
- **BackButton** — `.lp-home-btn` (⌂ בית button in the app topbar) enhanced with sliding arrow animation on hover. Uses `.btn-label` + `.btn-arrow-wrap` child elements.
- **NotFound CSS** — `.not-found-wrap`, `.not-found-num`, `.not-found-icon`, `.not-found-title`, `.not-found-desc` — ready to use for empty/error states, not yet wired to any specific empty state.

### What's NOT done yet / open tasks

- NotFound component is CSS-only — not yet used in actual empty-state slots in the UI.
- BeamsBackground canvas is behind all content (z-index: 0, fixed) — further visual tuning possible.
- User asked to integrate components "into the website itself" (exact meaning unclear — follow up if needed).
