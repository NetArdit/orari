# CLAUDE REPORT 07 — Batch 6: research and measurements, no code

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**PARTIALLY COMPLETE.** Documentation only, as authorised. Of the three research deliverables:

| Deliverable | State | Where |
|---|---|---|
| Hosting, accounts and law | **Complete as far as the sources allowed**, with named gaps: Brevo could not be read; Koyeb's pages disagree; the law's text was read to character 100,000 of 162,873 and the penalties were not reached | `docs/research/hosting-accounts-law.md` |
| Design research | **Thin, first pass only.** Three of six captures were unusable and all usable ones are marketing home pages, not in-app screens. The revised mock-ups were **not** rebuilt, deliberately | `docs/research/design-research.md`, `docs/research/shots/` |
| Live AI | **Not achieved.** Both authorised calls were refused by the provider with 429 before any generation; no latency or JSON-validity evidence exists | `docs/research/live-ai-and-adr.md`, `docs/agent-handoff/evidence/batch-6/` |
| Architecture decision record | Written, with Q2 (hosting) still open | `docs/research/live-ai-and-adr.md`, section 4 |

No code, schema, dependency, deployment, push or secret inspection. `.env` was read only by the script's `process.loadEnvFile`; the key is in no output (searched).

## 2. What was learned that changes the plan

1. **The app's primary model no longer exists.** `z-ai/glm-5.2:free` is not on OpenRouter's public list (462 models, 14 free, checked 01:06 UTC). The fallback chain has been silently covering for it. The model list in `lib/ai.js` needs replacing and should become configuration with a startup check, which was audit item P2-9.
2. **Netlify cannot hold a 75 s request** (60 s, not configurable); its background functions can (15 min, 256 KB payload). **Vercel Hobby can** (300 s) **but is non-commercial only.** **Render free** sleeps after 15 min, takes about a minute to wake, has no durable disk, **blocks outbound SMTP**, and its Postgres **expires in 30 days**. **Neon Free** is permanent and card-free but suspends after 5 minutes and keeps only 6 hours of history.
3. **Kosovo's law sets the age of digital consent at 16 (Art. 7)** and conditions transfers abroad on an adequacy decision (Arts. 44 to 47). The likely user, a student, is often under 16, and the AI call is a transfer. These are owner questions about audience and launch, not engineering details, and they change sign-up.
4. **Free-model availability is itself a risk.** One of four configured models is gone; the one I tried was refused. A product that depends on free-tier models needs a user-visible state for "the AI is unavailable right now" and a way to still use what exists, which the error codes already allow.

## 3. Deviations and judgment calls

1. **The two live calls both failed with 429 and are spent.** I chose the model by the listed rule (listed, priced 0 and 0, largest context among the instruction-tuned ones that exist). I made no third call and no retry, as ruled. I cannot say whether a different free model would have answered.
2. **I did not rebuild the design directions.** You asked for revised paired styles from research. The evidence I gathered would change them very little, and presenting a redesign as research-driven on that basis would be misleading. I recommend an in-app evidence pass first (section 0 of the design research).
3. **Name recommendation differs from yours**: "Tabelë" instead of "Blloqe" for the second style, because it describes the monospaced time-board design and is the owner's own word. A display string only.
4. **First-load budget** is a proposal (Today interactive in 2.5 s or less cold, 1 s warm, on throttled 4G; 200 kB JavaScript; no blocking font over 40 kB) with no measurement yet.
5. Disk free fell to about 930 MB (from 1.4 GB), mostly from the three kept screenshots (1.8 MB) and the `node_modules` and caches of earlier batches; it is now the tightest constraint on the machine.

## 4. Open items, by who can close them

**Needs Codex**: authorise a second live attempt (and on which model); rule on whether the in-app design evidence pass is required before revising the directions; rule on the job-versus-request recommendation once timing exists; rule on the compromised-password source (third-party range call versus offline list).

**Needs the owner**: audience and ages; whether Orari is a portfolio piece or a product (decides Vercel Hobby, and the legal exposure); hosting preference; the Brevo plan details from their dashboard; and the three planner policies still open.

## 5. Gate

Batch 6 delivered as research. No accounts or UI work has started and none is authorised. Waiting for your verdict.

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/09-batch-6-report.md`.
