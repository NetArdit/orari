# Project state

Updated 2026-10-14 by Claude Code. The repository and test results outrank this summary.

## Purpose
StudyFlow (folder `orari-main`): an Albanian-language study planner. The server computes free time windows deterministically, a language model places study sessions inside them, the browser stores plans and tracks progress.

## Roles
Owner: goals, scope, money, publishing. Codex CLI: technical authority and gate, read-only. Claude Code: investigation, implementation, tests, evidence, records.

## Handoff
`codex exec --sandbox read-only --skip-git-repo-check -c model_reasoning_effort='"high"' -o docs/agent-handoff/codex/NN-<name>.md -`, message piped from `docs/agent-handoff/requests/NN-<name>.md`. Latest Claude report: `docs/agent-handoff/CLAUDE_REPORT.md`. Decisions: `CODEX_DECISIONS.md`. Owner's rules: `OPERATING-SYSTEM.md`.

## Stack (verified)
Node 24.20, Express 5.2.1 (app built by `createApp` in `lib/app.js`), zod 3.25.76, openai 7.5.0 (pointed at OpenRouter free models), dotenv. Frontend: one HTML page, plain JS and CSS. Data: browser localStorage only. No lint, types or build.

## Git
Local repository, branch `main`, no remote. Baseline of the untouched project: `b68ef0e`.

## Gate
Batches 0, 1 and 2 accepted by Codex; all conditions met. Batch 3 (client foundation: `client/` with Vite, React, Tailwind, strict TypeScript, Vitest; typed API client; versioned IndexedDB storage with migration from the old data, no password; router; build served at `/app`, old page stays at `/`) is authorized and not started. Two static design directions (`docs/design/index.html`, twelve screens each: six on the phone, six on a wide screen, light and dark) were reviewed by Codex, corrected as it required, and are with the owner for a choice. No broad UI is built before that choice.

## Approved direction (Codex, 2026-10-14)
- `client/` with Vite, React, Tailwind, strict TypeScript, types inferred from the Zod schemas; Express, API contracts and business rules stay; new client built beside the old one after the safety net, one cutover after parity and storage migration.
- Phases: safety net; server correctness and reliability; client foundation and migration of existing flows; flashcards and quizzes; accessibility, performance, copy, release readiness.
- Flashcards and quizzes are Phase 4: PDF text extracted in the browser, bounded chunks, source pointer on each card, editable cards, IndexedDB, deterministic review scheduling, no OCR in the first version, honest notice that text goes to a third-party model.
- Working assumption for accounts until the owner decides: local profile without password, with export and import.
- Two static visual directions for the owner to choose from, before broad client UI.

## Verification available
`npm test`: 134 tests (node:test), none pinning a known defect any more; the model walk, repair loop, deadline and cancellation in `lib/ai.js` are covered against a fake client. `npm run check`: syntax of application files. `npm audit`: 0 vulnerabilities. Browser scripts (headless Edge, no dependencies): `docs/agent-handoff/evidence/batch-0/browser-baseline.mjs` (21 screens, keyboard, corrupted storage) and `docs/agent-handoff/evidence/batch-2/replan-journey.mjs` (re-plan and parse request on the old page, 14 checks). The old page's script has no unit tests. Nothing AI-backed has ever been run live.

## Fixed in Batch 2
Impossible dates; duplicate session ids; overlapping and too-short sessions; misleading "adjusted" warning and empty plans; overnight commitments on the wrong day; `9:00` rejected and silent validation errors; minutes-long requests with no deadline; unprotected AI quota and missing security headers; server-clock "today"; re-plan on the old page (it saved nothing, and its merge rule would have deleted today's completed sessions).

## Still open from the audit
P0-2 plaintext passwords and fake login (goes with the local-profile redesign); P1-7 AI-read availability not editable; P1-8 clarifying questions dead end; P1-9 no plan management or backup; P1-10 fragile storage; P1-11 accessibility; P1-12 alert() feedback; P1-15 phone layout; P1-2 long plans (unmeasured); all P2 and P3 items.

## Owner inputs
- 2026-10-14: wants study material (text, for example from a PDF) turned by AI into flashcards and quizzes for exam preparation. Codex ruled it in as Phase 4.
- Standing: zero cost; no push or deploy without the owner; natural Kosovo Albanian; engineering standard, not "it runs".

## Open with the owner
- Design direction: A (Fletore) or B (Tabelë); default theme light or dark.
- D1 accounts: local profile without password, or real accounts.
- D2 product name: Orari or StudyFlow.
- D3 a free OpenRouter key in `.env`, entered by the owner. Until then no AI behaviour can be tested live.

## Blockers
- No API key: all AI-backed behaviour untested.
- Machine: about 4 GB RAM, about 2 GB free disk.
