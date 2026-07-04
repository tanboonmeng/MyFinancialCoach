# My Financial Coach

A gamified financial-coaching web app for young Singaporeans (aged 19–29)
entering the workforce, grounded in the official **MAS Basic Financial
Planning Guide** benchmarks. Built by **Team Alpha Minds** for module **C240**.

> Educational coaching grounded in published MAS benchmarks — not regulated
> financial advice.

**Live site:** https://tanboonmeng.github.io/MyFinancialCoach/ *(enable GitHub
Pages — see below)*

---

## What it is

A branded, responsive single-page site that presents a strict, sequential
**4-level coaching path** and embeds the team's already-built tools:

1. **Level 1 — Emergency fund & money management** · 3–6 months of expenses
2. **Level 2 — Insurance protection** · 9x / 4x annual income cover
3. **Level 3 — Investing** · ≥10% of take-home pay
4. **Level 4 — Home & retirement** · plan with official calculators

Each level unlocks only after the previous one is complete, mirroring the MAS
planning sequence.

## The four pillars (integration)

The website is the shell that embeds these pieces (see
`AlphaMinds_Integration_Handoff.txt`):

| Pillar | Owner | Where it plugs in |
|--------|-------|-------------------|
| Botpress RAG coach | Sammi | `#mfc-webchat` mount + embed placeholder in the Coach chat section |
| Gemini number-extraction | Sammi / Ryan | runs inside Botpress |
| `app.js` calculations + UI state | Ryan | `window.MFC` mount point in `site.js`; listens for `mfc:dashboard-ready` |
| n8n + Telegram + Sheets loop | Rainie | Telegram deep link in the onboarding flow |
| Onboarding / dashboard UI | Ezann | 3-step Connect-Telegram flow |

## Project structure

```
index.html   — the single page (7 sections + sticky nav)
style.css    — brand tokens (:root) + all custom styling
site.js      — UI behaviour only (nav, journey hints, onboarding steps)
             — exposes window.MFC as the mount point for Ryan's app.js
TEAMMATE_SETUP.md — clone + git workflow guide for the team
```

No build step, no framework — vanilla HTML/CSS/JS with Tailwind via CDN.
Deploys as static files.

## Run it locally

Just open `index.html` in a browser (double-click it). For live-reload while
editing, use VS Code's **Live Server** extension.

## Deploy to GitHub Pages

1. On GitHub, go to the repo **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
4. Wait ~1 minute; the site publishes at
   `https://tanboonmeng.github.io/MyFinancialCoach/`.

## Placeholders to fill before the demo

- **Sammi** — paste the Botpress embed snippet at the marked block in the Coach
  chat section of `index.html`.
- **Ezann** — replace `BOT_USERNAME_PLACEHOLDER` in the Telegram deep link with
  the real bot username from Rainie.
- **Ryan** — add `app.js` with the MAS calculation logic (mount point is ready).
