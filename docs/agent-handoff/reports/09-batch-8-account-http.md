# CLAUDE REPORT 09 — Batch 8: account HTTP layer, mail outbox, account screens (non-production)

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**PARTIALLY COMPLETE.** The account HTTP layer, the mail outbox, the account screens and the browser journey are built and verified. The PostgreSQL adapter was **not written**. The authorised extra live plan call produced nothing usable (429). Everything here is **non-production**: accounts live in memory and are lost on restart; mail goes to a file, not to a provider.

| Item in your Batch 8 scope | State |
|---|---|
| HTTP layer over the in-memory repository, cookie, Origin guard, rate limits | **Done**, mounted only with `ACCOUNTS_MODE=memory` |
| Sign-in, sign-up, forgot, reset, verify screens | **Done**, against the real in-memory server (not a fake) |
| Expiry-checked atomic token consumption | **Done** (`useToken(id, usedAt)` rejects an expired token inside the repository call) |
| Durable mark idempotency beyond 200 ids | **Not changed.** Still the last 200 per plan (`LIMITS.appliedOpsKept`). See section 5. |
| Mail that survives a failed send | **Done** as an outbox with retry 1/5/15/60/240 min, giving up after 5 and dropping the link |
| Verification gates sync and AI, not sign-in | **Done** server-side (`requireVerifiedAccount` on the AI route and the sync router) |
| Marking restored in the wide blocks week view (your Batch 7 condition) | **Done**; contrast **not verified** (section 6) |
| PostgreSQL adapter, unconnected | **Not done** |
| Client plan sync | **Not done**; the screens say plans are still stored on this device only |
| One extra synthetic plan call | **Done once, refused with 429**, not retried |

## 2. Live AI, third attempt

`evidence/batch-6/live-ai-attempt-3-plan-only.json`: one plan request on `google/gemma-4-31b-it:free`, no retry, fallback or repair. **429.** So across three attempts plan generation has never completed; there is still no evidence of plan JSON validity or latency. The polled-job design stays, as you ruled.

## 3. What was built

- `lib/accounts/http.js`: routes for sign-up, verify, resend, sign-in, sign-out, forgot, reset, me, device list, revoke one/others, change password, export, delete; sync router for plans, plan by id, delete, marks. Cookie `__Host-orari_session` (HttpOnly, Secure, SameSite=Lax, Path=/, 90 d); the non-Secure `orari_session` exists only with `ORARI_INSECURE_COOKIES=1`. Origin guard for state-changing requests with a `Sec-Fetch-Site` fallback. Per-address and per-account attempt limiters. `Cache-Control: no-store`. Reset and verify tokens travel in the URL fragment and are removed from the address bar on load.
- `lib/accounts/service.js`: outbox methods, `dispatchMail` every 60 s; `lib/accounts/testMail.js` writes `dev-mail/outbox.jsonl` (git-ignored).
- `server.js`: `ACCOUNTS_PWNED_CHECK=off` (memory mode only) so automated runs do not call the leaked-password service.
- Client: `screens/AccountScreens.tsx`, `state/accountStore.ts`, `ui/forms.tsx`, routes `/app/hyr`, `/app/regjistrohu`, `/app/harrova`, `/app/reset`, `/app/verify`, account panel in Settings. States: loading, server unreachable, accounts off, signed out, signed in.

## 4. Evidence

| Check | Result | Label |
|---|---|---|
| `npm test` (server) | 271 of 271 pass | VERIFIED |
| `npm run client:test` | 193 of 193 pass | VERIFIED |
| `npm run client:typecheck`, `npm run check` | clean | VERIFIED |
| `npm audit` | 0 vulnerabilities | VERIFIED |
| `e2e/app-accounts.mjs` | 30 of 30 | VERIFIED (headless Edge 155, memory-mode server) |
| `e2e/app-screens.mjs` | 23 of 23 (twice, after a race in the check itself was fixed) | VERIFIED |
| `e2e/app-foundation.mjs` / `legacy-create.mjs` / replan journey | 26 / 24 / 16 of same | VERIFIED |
| Mutation checks | 17 account-logic mutants and 10 HTTP-layer mutants all caught by tests | VERIFIED |
| Timing resistance of sign-in, sign-up, reset | **not measured** | NOT TESTED |
| Persistence, real mail, host | none exist | — |

The account journey covers: refusals beside fields, the third-party check disclosure, the same answer for a known and an unknown address, verification link from the outbox, token removed from the address bar, a used link refused, identical sign-in refusals, persistence across reload, the cookie not readable by page script, device list, sign-out, uniform forgot-password answers, a reset where a weak password does not consume the link and a success does not sign in, and no console errors.

## 5. Known gaps and what I will not claim

- The mark-idempotency window is still 200 ids per plan. Because each mark also carries the session's base revision, I **infer** an evicted replay is refused as a conflict rather than applied twice, but I did not test that case. Your ruling is wanted on whether a durable store must keep ids for a stated retry window instead.
- Decoy hash is now computed eagerly at start, but sign-up and reset still do different repository work for known and unknown addresses. Enumeration resistance rests on uniform answers and rate limits, **not** on measured timing.
- Accounts are lost on restart; mail is a file. There is no persistence claim.
- The Albanian copy has not been reviewed by a native speaker.
- The design is engineering judgment. No competitor in-app research is claimed. The owner has approved the visual direction in `docs/design/index.html`; that is taste approval, not evidence.
- The not-signed-in and not-verified failures on the New plan and Today screens do not yet link to sign-in.

## 6. Open items

1. Contrast verification for both styles in all three modes (not done).
2. PostgreSQL adapter, unconnected (not done).
3. Owner inputs unchanged: three planner policies, Albanian copy review, Brevo limits (for you to research), in-app screens from a free account, host and database credentials later.
