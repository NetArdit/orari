# Batch 8 verdict: REVISION REQUIRED

The batch is **partially complete**, and the HTTP layer is acceptable for local review only after its “not exposed” boundary is enforced in code. The source does not enforce that boundary today. I reviewed the source and handoff documents; **I did not run tests or a browser**. The test and journey results below are Claude-reported, not independently confirmed.

| Item | Verdict |
|---|---|
| Account HTTP routes and cookie | Implemented. The cookie uses `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and a 90-day maximum. The `__Host-` name is used with Secure cookies. **Revision required:** `ORARI_INSECURE_COOKIES=1` disables Secure without checking that this is a local development run. |
| Origin guard and sync routes | Source applies the guard to every account and sync router request. It checks Origin when present; otherwise it accepts `Sec-Fetch-Site: same-origin` or `none`, rejects other values, and permits requests with neither header only when they carry no session cookie. All sync mutations are POSTs and pass through the guard. |
| Verified account gate | With accounts enabled, the shared AI middleware covers `/api/parse`, `/api/create-plan`, and `/api/adjust-plan`; the sync router gates all routes. Unverified users can sign in. **Caveat:** if `accounts` is absent, the AI middleware intentionally omits authentication. |
| Enumeration, tokens, and headers | Sign-up and login use uniform public failures; forgot-password always returns `{ok:true}`. Reset and verification links put tokens in URL fragments. Account routes do not log request bodies, and the app’s Helmet policy supplies `Referrer-Policy: no-referrer`. The dev mail adapter writes links to a local JSONL file. **Timing resistance is unmeasured.** |
| Mail outbox | Retry and give-up behavior exists in the **in-memory repository**, and the code drops a link on expiry or give-up. This is not durable across process restart; `testMail`’s JSONL file is not used to restore the outbox. There is also a schedule mismatch: the code gives up after five failed sends, so the configured 240-minute delay is never used. That means four retries, at 1, 5, 15, and 60 minutes, after the initial send. |
| `useToken` | The memory adapter atomically marks a token used only when unused and unexpired at the supplied consumption time. This closes the expiry race identified in Batch 7. A durable adapter must implement the same as a conditional atomic consume. |
| Mark idempotency | The 200-operation log can be acceptable for the in-memory store when session revisions remain monotonic and session identities are never reused. The current code permits plan/session IDs to be reused with revision reset, so the “evicted replay can never apply again” guarantee has an ABA edge case. Fix that identity/revision rule. |
| PostgreSQL adapter | **Not done.** It may be written unconnected, as authorized. |
| Client plan sync | **Not done.** The screens still say plans are stored on this device only. |
| Contrast review | **Not done.** This remains an outstanding Batch 7 condition for both styles and all three appearance modes. |
| New plan / Today sign-in links | **Not done.** |
| Live AI | The third plan call returned 429, with no valid output or latency evidence. |
| Screens and reported verification | Account screens are implemented against the real memory-mode server rather than a fake; that is a contained deviation, with the demo limitation visible. Claude reports the tests and journeys passed, but I did not run them. |

## HTTP layer ruling

**Amend before treating this as a safe non-production layer.** The main source paths are [http.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/http.js:153), [server.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/server.js:56), and [app.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/app.js:115).

The cookie attributes and router-level Origin behavior match the rulings, and no account response body or explicit account-route log line exposes the raw token. The outbox’s local test file does contain development links; it must stay out of production and out of logs. `Referrer-Policy: no-referrer` is supplied by Helmet and reportedly asserted in Claude’s test, but I did not execute that test.

The blocking issue is **exposure**: setting `ACCOUNTS_MODE=memory` mounts the routes, while `app.listen(PORT)` does not bind to loopback. The source therefore does not enforce the report’s “not exposed” claim. Also, `ORARI_INSECURE_COOKIES=1` removes `Secure` without a local-only check. Before further account work, enforce that memory mode and insecure cookies cannot be enabled on a public/non-development bind. Keep account mode off outside local development until persistence and mail are real.

## Idempotency window

For the **in-memory store**, 200 IDs per plan is acceptable only if each session’s revision never resets and its identity cannot be reused. Otherwise an old operation with a base revision that becomes valid again could be applied after eviction. Change the plan/session lifecycle so a deleted and recreated session has a fresh, non-reusable identity or monotonically preserved revision.

A durable store must keep each operation ID and its outcome for the **enforced client retry window**. If clients may retry or replay offline marks indefinitely, retain receipts indefinitely; otherwise define and enforce a maximum replay age. Beyond that window, stale operations must conflict rather than apply. The persistence update for a mark must atomically record the operation receipt, advance the session revision, and compare the expected revision.

## Enumeration and timing

Do not claim timing resistance from uniform response bodies or the decoy hash. Before any public claim, measure known versus unknown addresses through the **actual PostgreSQL adapter and full HTTP path**, covering login failures, sign-up, and password reset. Use synthetic addresses, control rate-limit state, and compare repeated timing distributions (including median and tail latency) under the configured password check and outbox behavior. Keep addresses and passwords out of measurement logs. Until then, the supported claim is only that the intended public answers are uniform and routes are rate-limited in-process; neither the timing behavior nor distributed rate limiting is established.

## Live AI

No further plan calls are worthwhile before a host and reliable free-model capacity exist. Three refusals provide no plan validity or latency evidence. Keep the durable polled-job design as the default and build/measure its job lifecycle and failure semantics independently. Revisit live model measurement when the provider can complete a bounded synthetic request without a paid fallback or repeated speculative calls.

## Next batch — Batch 9

**Goal and user value:** Enforce the local-only account boundary, close the repository correctness gaps, and finish the host-independent account usability work so the current demo cannot be mistaken for a persistent service.

**Scope:** Memory-mode exposure and insecure-cookie safeguards; clarify/fix the outbox retry count and accurately label its durability; prevent mark replay through session identity reuse; write an unconnected PostgreSQL adapter; client plan sync against the memory server with explicit demo limitations; contrast review; add sign-in links to the New plan and Today authentication failures.

**Expected areas:** `server.js`, `lib/accounts/http.js`, `lib/accounts/service.js`, `lib/accounts/memoryRepository.js`, PostgreSQL repository/migration area, account and sync client state/screens, New plan and Today failure UI, design tokens/styles, and focused tests.

**Approach:** Keep the database adapter pool-injected and unconnected, with no credential or host selection. Implement atomic token consumption, plan revision compare-and-swap, operation receipt/revision updates, and outbox persistence semantics in the adapter contract. Client sync must preserve local plans until an explicit, recoverable import/sync decision is confirmed. Every account/sync screen must continue to disclose that memory data disappears on restart.

**Explicit exclusions:** No `.env` read, database connection, real mail provider, host decision, public exposure, deployment, push, publishing, paid service, live AI call, or claim of durable storage. No plan/mark policy changes.

**Dependencies and risks:** The adapter cannot be validated against PostgreSQL without a database; mock/injected-pool tests do not substitute for the required real-PostgreSQL suite. Memory-mode UI sync demonstrates API behavior only and must not imply cross-restart persistence. The contrast review must cover both styles in system, light, and dark modes.

**Acceptance and checks:** Add focused tests for rejecting non-local memory mode and insecure-cookie use, every state-changing Origin/fallback path including sync, verification gates, outbox expiry/retry/give-up/link-drop behavior, token expiry at atomic consumption, mark replay after eviction and identity reuse, and PostgreSQL adapter SQL/transaction contracts. Verify client sync/import preserves a recoverable local copy; verify contrast ratios and the New plan/Today sign-in recovery links. Report tests actually run and identify that real PostgreSQL verification remains outstanding.

**Rollback:** Keep the adapter unconnected and account UI/routes separable; disable memory accounts to restore the existing local-only planner behavior.

These items are safe to do before the host is decided, provided the adapter remains unconnected and sync is clearly presented as a memory-mode demonstration. No owner decision is needed for that bounded work.

## STATE UPDATE

The workspace is read-only, so these are copy-ready entries; I did not edit either file.

**`PROJECT_STATE.md`**

> Batch 8: PARTIALLY COMPLETE; Codex verdict REVISION REQUIRED. Account routes, account screens, and mark/token logic exist, but review found that memory accounts are not prevented from binding publicly, and `ORARI_INSECURE_COOKIES=1` is not restricted to local development. The outbox retries in memory only; the configured 240-minute delay is unused, and it does not survive process restart. `useToken` is atomic and expiry-checked in the memory adapter. The 200-operation mark window requires non-reusable session identity and non-resetting revisions. PostgreSQL adapter, client plan sync, contrast review, and New plan/Today sign-in links remain incomplete. No tests or browser were run by Codex; Claude’s reported results were not independently verified. Batch 9 scope and exclusions are in the Codex verdict.

**`CODEX_DECISIONS.md`**

> 2026-10-14 — Batch 8 verdict: REVISION REQUIRED. The cookie attributes, account/sync Origin guard, shared AI verification middleware (when accounts are enabled), token-fragment links, uniform public answers, and memory-adapter atomic expiry-checked `useToken` are confirmed by source. Memory mode is not enforced as local-only: `server.js` mounts it from an environment flag and listens without a loopback bind; `ORARI_INSECURE_COOKIES=1` is not restricted to development. Fix both before treating the HTTP layer as safely isolated. The mail outbox is in-memory, not durable; its 240-minute retry delay is unreachable because it gives up on the fifth failed send. Either correct the schedule or report four retries (1/5/15/60 minutes) plus the initial attempt. The 200-ID mark window is acceptable only with non-reused session identities and non-resetting revisions; durable storage must retain operation receipts for the enforced retry window and atomically apply receipt plus revision change. No timing-resistance claim before measurement through the actual PostgreSQL and HTTP path. No more live AI calls before a host/provider path exists; build and measure the polled-job design on its own terms. Batch 9 is authorized within the scope and exclusions above; no database connection, public exposure, deploy, push, live mail, or paid service.