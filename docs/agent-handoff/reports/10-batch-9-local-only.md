# CLAUDE REPORT 10 — Batch 9: local-only boundary, repository fixes, adapter, sync, contrast

Date: 2026-10-14. Author: Claude Code. Earlier reports: `reports/`.

## 1. Status: COMPLETE for the scope in `codex/11-batch-8-verdict.md`, except real-PostgreSQL verification (not possible: no database)

| Item | State |
|---|---|
| Memory mode only on loopback, refused in production, insecure cookie only there | Done: `lib/accounts/localOnly.js`, `server.js` exits with a reason; server binds `127.0.0.1` in that mode |
| Outbox schedule | Corrected: first send + retries at 1/5/15/60 min = 5 attempts, then give up and drop the link. Still in memory, not durable across restart (stated in code) |
| Mark replay after identity reuse | Deleted plan ids are retired (`PLAN_EXISTS` forever); a session that leaves a plan and returns continues from its last revision |
| PostgreSQL adapter, unconnected | Written: `lib/accounts/postgres/{repository.js,schema.sql}`; atomic single-statement `useToken`, revision CAS `replacePlan`, retired ids, `SKIP LOCKED` claim |
| Client plan sync | Done as two explicit buttons in Settings (send / fetch), verified accounts only; never overwrites or deletes; demo limitation stated beside them |
| Contrast review | Done as a test: 20 text/background pairs x 4 palettes (both styles, light and dark; system resolves to one of them), all at least 4.5:1 |
| Sign-in / confirm-email links on New plan and Today failures | Done (`AccountRecovery`) |

## 2. Evidence

- Server `npm test`: 282 of 282 (incl. 4 new rule tests and 7 adapter-contract tests). VERIFIED.
- Client: typecheck clean, 278 of 278 tests (80 contrast, 5 sync). VERIFIED.
- Journeys: accounts 31/31 (now includes sync), screens 23/23, foundation 26/26, legacy 24/24, replan 16/16. VERIFIED.
- `npm run check` clean; `npm audit` 0.
- Mutants: removing the retired-id check, the revision continuation, or fixing the give-up count each fails its test. VERIFIED.
- NOT TESTED / not claimed: the adapter against a real PostgreSQL (the contract tests use a recording fake and prove only statement shape and interface parity); timing resistance; durable outbox; real mail; the Albanian copy; contrast of non-token colours (focus rings, borders) and non-text 3:1 contrast; the plan generation (three 429s, no further calls per your ruling).
- Sync merges nothing: a plan on both sides is left as is on each; marks made on both sides are not reconciled.

## 3. Open
Owner: three planner policies, Albanian copy review, dated in-app screens, host and database later. Technical: real-PostgreSQL suite, job-based plan generation (build and measure on its own terms), durable outbox with a real adapter, timing measurement through the real path.
