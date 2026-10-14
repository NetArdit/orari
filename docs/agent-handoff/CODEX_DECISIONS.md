# Codex decisions

Codex runs read-only and cannot write this file. Claude copies each decision verbatim from the Codex reply named in the heading; the reply file is the authority if the two ever differ.

## 2026-10-14 — `codex/01-roles-and-audit.md`

Roles (Codex's words): "I'm Codex, the independent technical reviewer and decision gate: I'll verify repository evidence, assess Claude's reports, and set bounded implementation instructions. Claude is the execution engineer and researcher, responsible for inspection, implementation, and reporting."

- Decision: Recommend local-only Git initialization and a baseline commit after excluding node_modules and environment files; do not push.
- Decision: Defer final Vite/React/Tailwind architecture approval until Claude and Codex audits are compared. Evaluate TypeScript based on schema reuse, tooling cost, and migration risk.
- Decision: Preserve server.js, API contracts, and scheduling rules during frontend migration unless a separately approved finding justifies a change.
- Verdict: Audit only; no implementation approved.
- Issued: Batch 0 (baseline and audit comparison).

## 2026-10-14 — `codex/02-batch-0-verdict.md`

- Verdict: Batch 0 ACCEPTED WITH CONDITIONS. Verified Git history and clean working tree; app source and package manifests match baseline. Inspected three supplied screenshots. Batch 0's runtime and browser checks remain Claude-reported, not independently rerun by Codex.
- D4: Approve compatible npm audit fix after reviewing lockfile changes; add LF-normalizing .gitattributes.
- D5: Approve client/ Vite + React + Tailwind and strict client TypeScript with types inferred from shared Zod schemas. Preserve Express/API contracts. Build beside legacy only after safety tests; cut over after parity and storage migration.
- D6: Produce two static visual directions after Batch 1 and before broad client UI; owner selects.
- D7: Include flashcards/quizzes after planner parity. Browser-side PDF text extraction, bounded chunking, passage pointers, editable cards, IndexedDB, deterministic review scheduling; no OCR for scanned PDFs in v1.
- D1 recommendation/working assumption: local profile without password plus export/import. Real accounts require owner approval.
- Priority rulings: re-plan progress loss/duplicate IDs P0; plaintext password collection P0; impossible dates P1; unprotected shared AI quota P1 pending deployment exposure; long-plan truncation P2 pending provider evidence; timezone "today" mismatch P2.
- Condition on wording: the phone finding is viewport expansion and compressed rendering, not measured horizontal scrolling.
- Next approved batch: Batch 1 safety net; no live AI calls, behavior changes, client migration, or deployment.

## 2026-10-14 — `codex/03-batch-1-verdict.md`

- Verdict: Batch 1 ACCEPTED WITH CONDITIONS. Conditions: correct the README's "every source file" check-script claim or expand the script; keep Node >=22 as an intentional support policy.
- UUID-based session IDs allowed with id:string preserved; validation errors may add fields; parse/adjust may accept optional validated client-local date and IANA timezone.
- Use express-rate-limit and Helmet with configuration compatible with local use, plus an in-process concurrency cap.
- OpenAI client injection approved for fake-backed tests.
- Interim legacy-client re-plan fix approved, with headless-browser journey evidence.
- Batch 2: Phase 1 items in focused commits, plus the client fix in a separately revertible commit.
- Two static design directions may be produced in parallel; owner selection precedes broad client UI. Both must show the same realistic planner tasks and comparable screens, include empty and error states, coherent light and dark themes, and must not settle the product name.

## 2026-10-14 — `codex/04-batch-2-verdict.md`

- Batch 2 ACCEPTED WITH EVIDENCE CONDITION: strengthen the re-plan browser journey to assert exact completed/missed progress summaries. (Done: 15 of 15 checks.)
- Accept Batch 2 policy defaults: 30 AI requests/address/10 min, 4 concurrent AI jobs/process, 75 s overall AI deadline.
- Accept no adjust timezone field because validated progress.today already supplies the client-local date. All eight reported deviations accepted.
- Albanian copy corrections given ("seancë" rather than "sesion", and others). (Applied verbatim.)
- Batch 3: use Vitest; serve the new client at /app with legacy root retained; migrate profiles/plans to versioned IndexedDB without passwords; retain old keys through coexistence and remove them at verified cutover. Extend the legacy journey to plan creation. Report resource footprint (dependencies, bundle, disk, peak build memory).
- Codex reviews both static design directions before owner review.

## 2026-10-14 — `codex/05-design-review.md`

- Both static directions meet the design-system structure and have no token-level AA contrast failures in the tested pairs (lowest 4.78:1).
- Required before owner review: comparable desktop views for the core flows; correct the today completion count; fix Albanian gender agreement and imperative copy; day chips at least 44 px with button semantics; two phrasing edits; the removed-session notice in the approved wording. (All applied; Codex asked for no further review round.)
- Ask the owner alongside the choice: direction A or B; default theme light or dark; product name Orari or StudyFlow; local profile without password (with export/import) or real accounts.
- No broad UI implementation before the owner selects a direction.

## 2026-10-14 — `codex/06-batch-3-verdict.md`

- Batch 3: ACCEPTED WITH CONDITIONS. Source inspection confirmed legacy migration is read-only and excludes password/e-mail from the new profile; `/app` is mounted without changing `/` or `/api`.
- Conditions for Batch 4: make initialization and restore safe under concurrent tabs; reject/report duplicate backup IDs and avoid generated-ID collisions; do not silently normalize unknown legacy statuses; strengthen the traversal test.
- Add stable machine-readable error codes and classify from codes/status, not from Albanian message text.
- Cutover must snapshot current legacy data after writes freeze, replacing only migration-only new storage; preserve and reconcile any new-client data; keep legacy keys until verified.
- Initial production JavaScript budget: 200 kB gzip.
- All eight Batch 3 deviations accepted (e-mail not migrated; stats not stored; no router dependency; /app/ canonical; narrowed npm test; temporary status copy; no account-choice screen yet). Unknown legacy status/kind defaults accepted only as temporary: report or reject, never present as real progress.
- Batch 4 authorized without UI: pure domain functions, storage integrity fixes, a store and create/re-plan state machines, .ics export as a pure function. Propose explicit completed/missed/streak/today/next-session rules in the batch report; do not present an inferred rule as product policy.
