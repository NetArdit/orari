# Project state

Updated 2026-10-14 by Claude Code. The repository and test results outrank this summary.

## Purpose
StudyFlow (folder `orari-main`): an Albanian-language study planner. The server computes free time windows deterministically, a language model places study sessions inside them, the browser stores plans and tracks progress.

## Roles
Owner: goals, scope, money, publishing. Codex CLI: technical authority and gate, read-only. Claude Code: investigation, implementation, tests, evidence, records.

## Handoff
`codex exec --sandbox read-only --skip-git-repo-check -c model_reasoning_effort='"high"' -o docs/agent-handoff/codex/NN-<name>.md -`, message piped from `docs/agent-handoff/requests/NN-<name>.md`. Latest Claude report: `docs/agent-handoff/CLAUDE_REPORT.md`. Decisions: `CODEX_DECISIONS.md`. Owner's rules: `OPERATING-SYSTEM.md`.

## Stack (verified)
Node 24.20, Express 5.2.1 with helmet and express-rate-limit (app built by `createApp` in `lib/app.js`), zod 3.25.76, openai 7.5.0 (pointed at OpenRouter free models), dotenv. Frontend: one HTML page, plain JS and CSS. Data: browser localStorage only. No lint, types or build.

## Git
Local repository, branch `main`, no remote. Baseline of the untouched project: `b68ef0e`.

## Gate
Batches 0 to 3 accepted by Codex. Batch 4 ACCEPTED WITH CONDITIONS; its domain rules are approved as provisional working rules. Batch 5 (collision-safe plan creation, safe calendar UIDs, re-plan clipped to the current local time, a real two-tab storage journey, the no-schedulable-time form case; no UI) is in progress. The two design directions (`docs/design/index.html`) are with the owner together with three other questions (default theme, product name, accounts); no answer yet, and no screen may be built before the choice. JavaScript budget: 200 kB gzip (now 87 kB).

## Approved direction (Codex, 2026-10-14)
- `client/` with Vite, React, Tailwind, strict TypeScript, types inferred from the Zod schemas; Express, API contracts and business rules stay; new client built beside the old one after the safety net, one cutover after parity and storage migration.
- Phases: safety net; server correctness and reliability; client foundation and migration of existing flows; flashcards and quizzes; accessibility, performance, copy, release readiness.
- Flashcards and quizzes are Phase 4: PDF text extracted in the browser, bounded chunks, source pointer on each card, editable cards, IndexedDB, deterministic review scheduling, no OCR in the first version, honest notice that text goes to a third-party model.
- Working assumption for accounts until the owner decides: local profile without password, with export and import.
- Two static visual directions for the owner to choose from, before broad client UI.

## Verification available
`npm run test:all`: server tests (148, node:test), client type-check (TypeScript, strict), client tests (162, Vitest). `npm run check`, `npm audit` (0 vulnerabilities). Browser journeys in headless Edge with no dependencies, against a running server: `e2e/legacy-create.mjs` (old page, plan creation, 24 checks), `docs/agent-handoff/evidence/batch-2/replan-journey.mjs` (old page, re-plan, 15), `e2e/app-foundation.mjs` (new client: storage, migration, addresses, 26; needs `npm run client:build`), `docs/agent-handoff/evidence/batch-0/browser-baseline.mjs` (old page, 21 screens). Nothing AI-backed has ever been run live.

## New client (Batch 3)
`client/`: Vite 8, React 19, Tailwind 4, TypeScript 7 strict, Vitest 5. Types inferred from `lib/schema.js`. API client returning typed results with failure kinds. Storage: IndexedDB behind a key-value interface, schema version 1, backup and restore. One-time copy of the old page's profile and plans without password or e-mail; the old keys are never touched. Router without a dependency. Served by Express at `/app` when `client/dist` exists; the old page stays at `/`. Only a status page exists; no planner screens. Since Batch 4 also: `client/src/domain/` (session states, progress, streak, next session, re-plan merge, plan form state and validation, calendar export) and `client/src/state/` (plan store with optimistic marking and rollback; parse, create and re-plan flows), all without React and not yet used by any screen. Every server error body carries a stable `code` (`ERROR_CODES` in `lib/schema.js`).

## Fixed in Batch 2
Impossible dates; duplicate session ids; overlapping and too-short sessions; misleading "adjusted" warning and empty plans; overnight commitments on the wrong day; `9:00` rejected and silent validation errors; minutes-long requests with no deadline; unprotected AI quota and missing security headers; server-clock "today"; re-plan on the old page (it saved nothing, and its merge rule would have deleted today's completed sessions).

## Still open from the audit
P0-2 plaintext passwords and fake login (goes with the local-profile redesign); P1-7 AI-read availability not editable; P1-8 clarifying questions dead end; P1-9 no plan management or backup; P1-10 fragile storage; P1-11 accessibility; P1-12 alert() feedback; P1-15 phone layout; P1-2 long plans (unmeasured); all P2 and P3 items.

## Owner inputs
- 2026-10-14: wants study material (text, for example from a PDF) turned by AI into flashcards and quizzes for exam preparation. Codex ruled it in as Phase 4.
- Standing: zero cost; no push or deploy without the owner; natural Kosovo Albanian; engineering standard, not "it runs".

## Open with the owner
- Product rules: whether a partly done session counts toward the streak; whether a late session gets a one-tap "move to later today"; whether skipped sessions should prompt re-planning.
- Design direction: A (Fletore) or B (Tabelë); default theme light or dark.
- D1 accounts: local profile without password, or real accounts.
- D2 product name: Orari or StudyFlow.
- D3 a free OpenRouter key in `.env`, entered by the owner. Until then no AI behaviour can be tested live.

## Blockers
- No API key: all AI-backed behaviour untested.
- Machine: about 4 GB RAM, about 2 GB free disk.
