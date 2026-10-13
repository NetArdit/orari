# Project state

Updated 2026-10-14 by Claude Code. The repository and test results outrank this summary.

## Purpose
StudyFlow (folder `orari-main`): an Albanian-language study planner. The server computes free time windows deterministically, a language model places study sessions inside them, the browser stores plans and tracks progress.

## Roles
Owner: goals, scope, money, publishing. Codex CLI: technical authority and gate, read-only. Claude Code: investigation, implementation, tests, evidence, records.

## Handoff
`codex exec --sandbox read-only --skip-git-repo-check -c model_reasoning_effort='"high"' -o docs/agent-handoff/codex/NN-<name>.md -`, message piped from `docs/agent-handoff/requests/NN-<name>.md`. Latest Claude report: `docs/agent-handoff/CLAUDE_REPORT.md`. Decisions: `CODEX_DECISIONS.md`. Owner's rules: `OPERATING-SYSTEM.md`.

## Stack (verified)
Node 24.20, Express 5.2.1, zod 3.25.76, openai 7.5.0 (pointed at OpenRouter free models), dotenv. Frontend: one HTML page, plain JS and CSS. Data: browser localStorage only. No tests, lint, types or build.

## Git
Local repository, branch `main`, no remote. Baseline of the untouched project: `b68ef0e`.

## Gate
Batch 0 (baseline and audit comparison) delivered, awaiting Codex's verdict. No application code changed. No migration approved.

## Owner inputs
- 2026-10-14: wants study material (text, for example from a PDF) turned by AI into flashcards and quizzes for exam preparation. Not yet ruled on by Codex.
- Standing: zero cost; no push or deploy without the owner; natural Kosovo Albanian; engineering standard, not "it runs".

## Open with the owner
- D1 accounts: local profile without password, or real accounts.
- D2 product name: Orari or StudyFlow.
- D3 a free OpenRouter key in `.env`, entered by the owner. Until then no AI behaviour can be tested live.

## Blockers
- No API key: all AI-backed behaviour untested.
- Machine: about 4 GB RAM, about 2 GB free disk.
