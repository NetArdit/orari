# Project state

Updated 2026-10-14 by Claude Code. The repository and test results outrank this summary.

## Purpose
StudyFlow (folder `orari-main`): an Albanian-language study planner. The server computes free time windows deterministically, a language model places study sessions inside them, the browser stores plans and tracks progress.

## Roles
Owner: goals, scope, money, publishing. Codex CLI: technical authority and gate, read-only. Claude Code: investigation, implementation, tests, evidence, records.

## Handoff
`codex exec --sandbox read-only --skip-git-repo-check -c model_reasoning_effort='"high"' -o docs/agent-handoff/codex/NN-<name>.md -`, message piped from `docs/agent-handoff/requests/NN-<name>.md`. Latest Claude report: `docs/agent-handoff/CLAUDE_REPORT.md` (reports 11 and 12); earlier ones in `reports/`. Decisions: `CODEX_DECISIONS.md`. Owner's rules: `OPERATING-SYSTEM.md`.

## Stack (verified)
Node 24.20, Express 5.2.1 with helmet and express-rate-limit (app built by `createApp` in `lib/app.js`), zod 3.25.76, openai 7.5.0 (pointed at OpenRouter free models), dotenv. Frontend: one HTML page, plain JS and CSS. Data: browser localStorage only. No lint, types or build.

## Git
Local repository, branch `main`, no remote. Baseline of the untouched project: `b68ef0e`.

## Gate
Batches 0 to 4 accepted by Codex. Batch 5 ACCEPTED WITH CONDITIONS. Codex has ruled on the accounts architecture (see `CODEX_DECISIONS.md`, entry for `codex/08`). Batch 7 ACCEPTED WITH CONDITIONS (see CODEX_DECISIONS). Batch 9 ACCEPTED WITH CONDITIONS (codex/12). Batch 10 ACCEPTED WITH CONDITIONS (codex/13): polled plan jobs end to end on the memory adapter (server store, client polling and cancel, HTTP isolation tests), non-text 3:1 contrast, Albanian self-review (`albanian-copy-self-review.md`, candidates only). Restart durability of jobs and outbox is NOT implemented; PostgreSQL unverified against a real database; no live job-path call yet (one authorised, conditions in CODEX_DECISIONS, held for the owner). Conditions of codex/13 closed (codex/14): abort-during-start race, canonical fingerprint, account isolation over HTTP; Origin check on AI and job routes in both account modes (`sameOriginGuard` without accounts; untested behind a proxy). Disk: about 3 GB free after the owner cleared the npm cache.

## Owner decisions, 2026-10-14 (these supersede earlier working assumptions)
- Name: **Orari**.
- **Real accounts**: sign-up, login, forgot password, the same data on laptop and phone. Supersedes "local profile without password".
- **Both visual styles and both modes are user settings**; the owner does not choose one. They are to be renamed (the owner suggests colour names such as kafe / blu, and e çelët / e errët).
- **Design from research of real products**; must not look like generic AI output; good performance; a genuinely satisfying tool for students.
- An OpenRouter key is in `.env` (ignored by git; never to be printed, committed or read out). Live AI calls still need Codex's authorisation.
- Engineering before implementation; roles between Codex and Claude to be kept.

## Approved direction (Codex, 2026-10-14)
- `client/` with Vite, React, Tailwind, strict TypeScript, types inferred from the Zod schemas; Express, API contracts and business rules stay; new client built beside the old one after the safety net, one cutover after parity and storage migration.
- Phases: safety net; server correctness and reliability; client foundation and migration of existing flows; flashcards and quizzes; accessibility, performance, copy, release readiness.
- Flashcards and quizzes are Phase 4: PDF text extracted in the browser, bounded chunks, source pointer on each card, editable cards, IndexedDB, deterministic review scheduling, no OCR in the first version, honest notice that text goes to a third-party model.
- (Superseded 2026-10-14 by the owner: accounts are real. The earlier working assumption was a local profile without password.)
- Two static visual directions for the owner to choose from, before broad client UI.

## Verification available
`npm run test:all`: server tests (348, node:test, incl. real PostgreSQL), client type-check (TypeScript, strict), client tests (373, Vitest). `npm run check`, `npm audit` (0 vulnerabilities). Browser journeys in headless Edge with no dependencies, against a running server: `e2e/legacy-create.mjs` (old page, plan creation, 24 checks), `docs/agent-handoff/evidence/batch-2/replan-journey.mjs` (old page, re-plan, 15), `e2e/app-foundation.mjs` (new client: storage, migration, addresses, 26; needs `npm run client:build`), `docs/agent-handoff/evidence/batch-0/browser-baseline.mjs` (old page, 21 screens). Nothing AI-backed has ever been run live.

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
- Answered 2026-10-14: audience is university students or anyone 16 and over, starting in Kosovo; a portfolio project now, to be ready to become a published product later; no hosting preference (any free option); Brevo free plan believed to be up to 300 e-mails a day (unverified; Codex to research).
- Still needed when accounts work reaches them: a database connection (the owner creates it and enters it in `.env` themselves), an e-mail sending key and sender for password reset.

## Blockers
- Hosting facts are unknown: whether any free host can hold a 75-second AI request, or plan generation must become a job that is polled.
- Machine: about 4 GB RAM; free disk fell to about 250 MB on 2026-10-14 (the user-level npm cache is 2.9 GB; clearing it needs the owner's word).
- Real model latency and JSON validity against a live free model are unknown.
- Owner questions on audience and ages (Kosovo law sets digital consent at 16) and on whether Orari is a portfolio piece or a product.
