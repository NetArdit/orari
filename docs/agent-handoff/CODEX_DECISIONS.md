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
