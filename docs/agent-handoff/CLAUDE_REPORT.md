# CLAUDE REPORT 11 — Batch 10: polled plan jobs end to end, outbox claims corrected, non-text contrast, copy self-review

Date: 2026-10-14. Author: Claude Code. Scope: `codex/12-batch-9-verdict.md` "Next batch". Earlier reports: `reports/` (Batch 9 is `reports/10-batch-9-local-only.md`). Nothing was committed or pushed.

## 1. Status: COMPLETE for the safe, host-independent scope. Restart durability is NOT implemented (memory adapter only).

| Item | State |
|---|---|
| Job lifecycle, server | Reviewed line by line and hardened (below). `lib/jobs.js`, routes in `lib/app.js` |
| Client on jobs | `createPlan` / `adjustPlan` of the API client now start, poll and cancel a job; same `ApiResult<PlanAnswer>`, so flows, screens and their tests are unchanged. `/api/create-plan`, `/api/adjust-plan`, `/api/parse` still exist; `parse` stays direct (ruled) |
| Outbox restart claims | Corrected in `service.js`, `memoryRepository.js`, `server.js` (they already said "lost on restart" in the working tree when this batch began; re-read, nothing implies survival). The outbox contract (add / claim with lease / done / fail with schedule) is the one the PostgreSQL adapter implements; durability remains unimplemented |
| Non-text contrast 3:1 | Extended and two real defects fixed (below) |
| Albanian copy self-review | `docs/agent-handoff/albanian-copy-self-review.md`: candidates only, no string changed |

## 2. Findings from the review and what was done

1. **Same idempotency key, different request, answered with the first job (defect).** The store returned the existing job for any reuse of a key. Now the request is fingerprinted (kind + body); a mismatch is `400 BAD_REQUEST` and the first job is not returned. Tests: store and HTTP.
2. **Cancelled job's life extended (defect).** The late end of the aborted work overwrote `finishedAt`, so a cancelled job outlived its TTL. Fixed; test.
3. **No global bound on kept jobs (gap).** Per-owner limits existed, owners are unbounded within the TTL. Added `maxKept` (500) → `BUSY`. Test.
4. **Cancel really reaches the AI call.** VERIFIED by an HTTP test: the signal given to `generateStudyPlan` is aborted by `POST /api/jobs/:id/cancel`, and the late answer does not change the job (it stays `cancelled`, no result).
5. **Client:** a missing or malformed job answer is a `server` failure, never a plan; a lost start is repeated once with the same key; up to three lost polls are tolerated; every call is bounded by the whole job's deadline; abort and timeout ask the server to cancel (best effort, not awaited).
6. **Non-text contrast (WCAG 1.4.11), found and fixed:**
   - Notebook style, "next session" card: the focus ring (accent) was drawn on an accent-filled card, so the ring was invisible. Inside that card the ring is now `on-accent` (class `accent-surface`, rule in `styles.css`).
   - Toggle chips (day chips, marks): the pressed state was a wash plus text colour with the border removed. The border now stays in `accent`/`ok` and a check mark is added, so the state is not carried by colour alone.
   - Tests added: `ok`, `bad` against the four surfaces, `accent`/`ok`/`bad` against their washes, and text at the `opacity-80/90` the next-session card uses, in all four palettes.

## 3. Evidence (all executed on 2026-10-14)

- `npm test`: 303 of 303 (was 295; 8 new in `test/jobs.test.js`, 18 in that file). VERIFIED.
- `npm run check` clean; `npm audit`: 0 vulnerabilities. VERIFIED.
- `npm run client:typecheck` clean; `npm run client:test`: 372 of 372 (was 310; 10 job-client tests, 52 contrast checks added). VERIFIED.
- `npm run client:build`: 368.75 kB JS, 109.28 kB gzip (budget 200 kB). VERIFIED.
- Journey `e2e/app-screens.mjs` in headless Edge against the built client and a running server: 23 of 23, no console errors, 24 screen/look combinations at two sizes. VERIFIED. No AI route was called.
- Not run this batch: `e2e/app-accounts.mjs`, `app-two-tabs.mjs`, `app-foundation.mjs`, `legacy-create.mjs`. NOT TESTED (the changes do not touch them; not proof).
- A job started from the real browser client against a real server was NOT exercised end to end (no AI call is authorised); the client was tested against a fake job server and the server routes against a fake generator. The two meet only through the shared contract. The next authorised live plan call is the first real test of the pair.

## 4. What the memory adapter can and cannot verify

- Can: the lifecycle (running → done | failed | cancelled), ownership isolation, limits, idempotency, expiry, abort propagation, HTTP shape, client polling behaviour.
- Cannot: survival of a job, result or key across a restart (they are lost; a poll then answers 404 and the client reports a retryable failure); sharing between several instances; the outbox surviving a restart; the PostgreSQL adapter's behaviour; real mail; timing on the real storage and HTTP path. All of these stay NOT TESTED / unimplemented.
- Owner identity: a job belongs to the account id, or to the address when there is no account. If a person signs in or out while a job runs, the job is unreachable to them and the client shows the retryable "not found". Account-owned isolation through HTTP is covered by the store test (owner strings), not by an HTTP test with two real accounts. NOT TESTED over HTTP.

## 5. Deviations and open points

- Jobs are not counted by the concurrent-AI limiter (stated in code); the store's own `maxRunning` (4) equals the limiter's cap. If those are tuned separately they can disagree.
- Idempotent retry after a **cancel** returns the cancelled job (same key, same request). The client uses a fresh key per attempt, so this is only visible to another client.
- Copy: 5 probable defects, 5 gender/register items, 5 consistency items and 2 possibly outdated notices are listed; one is a VERIFIED contradiction (`SettingsScreen.tsx:79` says accounts "come later"). Owner decision needed on each; none applied.
- Disk: free space about 3.1 GB after the owner cleared the npm cache; the client build ran.

## 6. Git state

Branch `main`, all Batch 9 and 10 work uncommitted (the working tree already held Batch 9 changes). User work intact; nothing reset or discarded. New: `lib/jobs.js`, `test/jobs.test.js`, the copy review, this report.

## 7. Open

Owner: host and database, real-PostgreSQL suite, mail provider and sender, native Albanian review, three planner policies. Technical: one authorised live plan through the job path; durable job state and outbox in PostgreSQL; account-level HTTP isolation test; commit the batch when the owner allows.

## 8. Handoff status

Files: `docs/agent-handoff/requests/13-batch-10-report.md` (this message), reply to `docs/agent-handoff/codex/13-batch-10-verdict.md`. Codex has read nothing until the reply file exists.

---

# CLAUDE REPORT 12 — Batch 10 conditions from `codex/13-batch-10-verdict.md`

Date: 2026-10-14. Nothing committed or pushed. Scope: the "next safe batch" of `codex/13`, nothing else.

## Status: COMPLETE for the three items, plus one gap found while testing them. The live plan call is NOT made (see 4).

| Item | State |
|---|---|
| Cancel while the start is unanswered | The start request is no longer cut off by the caller's signal (it is short and bounded). If the caller gives up first, the call returns `aborted` at once and cancels the job on the server the moment its id arrives. Test: `cancelling while the start is still unanswered ...` |
| Fingerprint | Computed from the validated body (`CreatePlanBody` / `AdjustPlanBody` output) through `canonicalJson` (sorted keys); an invalid body falls back to itself. Tests: reordered properties give the same job, another kind is refused, `canonicalJson` unit test |
| Account isolation over HTTP | 4 tests in `test/accounts-http.test.js` ("plan jobs with accounts"): anonymous 401 and unconfirmed 403 with `EMAIL_NOT_VERIFIED`; account B gets the identical answer for A's job id and an unknown id on read and cancel, and A's work is not aborted; separate running slots, cancelling one leaves the other; foreign-origin cancel refused |
| Gap found: Origin check | `originGuard` covered only `/api/account` and `/api/sync`; the AI routes and the job routes (start, cancel) had none, against the Q4 ruling. Now first in `requireVerifiedAccount` (reads pass). Tests: foreign origin gets 403 on `/api/jobs/*`, `/api/create-plan`, `/api/parse`, and no work starts. Only active when accounts are on |

## Evidence (executed 2026-10-14)

- `npm test`: 309 of 309 (was 303). `npm run check` clean. VERIFIED.
- `npm run client:typecheck` clean; `npm run client:test`: 373 of 373 (was 372). VERIFIED.
- `npm run client:build`: 369.03 kB, 109.37 kB gzip. VERIFIED.
- Journeys in headless Edge: `app-screens` 23/23 (run before these three items; CSS and screens unchanged since), `app-accounts` 31/31 after them (needs `ORARI_BASE_URL=http://127.0.0.1:3987` when the journey's default address is used; with the server's default `localhost` origin it fails at the first sign-up with 403, which is the origin check working, not a regression). VERIFIED.
- NOT TESTED: a live job through the real client and server; restart durability; PostgreSQL; the two-tab, foundation and legacy journeys.

## Changed in this round

`lib/jobs.js` (`canonicalJson`, header text), `lib/app.js` (fingerprint), `lib/accounts/http.js` (origin guard on the verified-account chain), `client/src/api/client.ts` (start/abort), tests in `test/jobs.test.js`, `test/accounts-http.test.js`, `client/src/api/client.test.ts`.

## Deviations and notes

- One existing client test asserted that the start fetch is aborted by the caller; it now asserts the intended new behaviour (the start is not cut off). Reason above.
- The live-call discrepancy in `codex/13` (two Groq calls, plan on `openai/gpt-oss-120b`, evidence `evidence/batch-10/live-ai-groq-2.json`) predates this session's work; I did not make a live AI call in Batch 10 or in this round, and I did not read `.env`. The default server key still resolves from `.env` when a server starts (health says `aiConfigured: true` even with an empty variable); no AI route was called by the journeys.

## 4. Live plan call through the job path: not run

It is authorised under conditions (Gemma free model, zero price and response-format check immediately before, one request, full record). It spends the owner's quota and uses the key from `.env`; the earlier calls went past the recorded approval, so I am holding it for the owner's word.

## Addendum to report 12 — Origin scope for deployments without accounts (`codex/14`)

Done: `sameOriginGuard` in `lib/app.js` is the caller check when accounts are off (state-changing AI and job requests: `Origin` host must equal `Host`, else `Sec-Fetch-Site` must be same-origin or none; a request with neither passes; reads pass). The job read and cancel routes now use the same chain as start. Test in `test/jobs.test.js`: four AI/job routes and cancel refused from another origin, `Sec-Fetch-Site: cross-site` and `Origin: null` refused, own origin and no-header requests accepted, reads never blocked.
Evidence: `npm test` 310 of 310; `npm run check` clean; journey `legacy-create` 24 of 24 (it replaces fetch inside the page, so it does NOT reach the guard on a real route: not proof for the old page's real calls). NOT TESTED: the guard behind a reverse proxy (Host header handling depends on `trust proxy` and the proxy; to be checked on the real host), and the Vite dev proxy path.

## Addendum 2 — codex/15: scheme in the Origin comparison
`sameOriginGuard` now compares the whole origin (`req.protocol` + host), not the host only. Test added (same host, other scheme refused). `npm test` 310 of 310 (the case sits inside an existing test), `npm run check` clean. NOT TESTED: behind a TLS-terminating proxy (needs `trust proxy`); live job-path plan call (held for the owner).

# CLAUDE REPORT 13 — safe batch of `codex/16-owner-chose-groq-verdict.md` (owner chose Groq, `openai/gpt-oss-120b`)

Date: 2026-10-14. Nothing committed or pushed. No live AI call, `.env` not read.

- Real client against the real Express app with a fake generator (`test/client-server-jobs.test.js`, the TS client runs unchanged): plan arrives (start, poll, done); failing generator is a named failure; abort mid-run returns `aborted` and the generator's signal is aborted; foreign origin refused with zero work started. VERIFIED.
- Simulated TLS proxy: with trust proxy set the public https origin passes, http and foreign fail; without it the forwarded scheme is ignored and the https origin is refused (fails closed). VERIFIED in test. Gap found: nothing set `trust proxy`. Added `TRUST_PROXY=<hops 0..5>` to `server.js` (invalid value stops start). Not exercised through a real proxy: NOT TESTED.
- Vite dev proxy: real defect found. Through the proxy a browser POST was refused (403): Origin is the Vite address, Host the server's. Fixed in `client/vite.config.ts` (changeOrigin plus the server's own Origin, dev only). Verified with curl on a running pair: 202. Side effect: in dev the proxy overwrites any Origin, so the guard is not exercised through Vite; production does not use Vite.
- Journeys, headless Edge, against a running server: app-two-tabs 8/8, app-foundation 26/26, legacy-create 24/24. VERIFIED. (The harness build was replaced by the normal build afterwards.)
- Tests: `npm test` 316/316, `npm run check` clean, client typecheck clean, client tests 373/373.
- Still NOT TESTED: real provider call, a real reverse proxy, restart durability, PostgreSQL.

# CLAUDE REPORT 14 — production path: PostgreSQL connected, SMTP mail, deploy config (owner demo to a company)

Date: 2026-10-14. Owner instruction: everything must work (sign-up, sign-in, saved accounts, forgot password, saved plans), deploy with Neon/Supabase. Groq key is in `.env` (owner arranged it; I did not read it).

- `lib/accounts/postgres/connect.js` (pool, TLS for non-local hosts, `migrate`), `ACCOUNTS_MODE=postgres` in `server.js` (requires `DATABASE_URL`, `SMTP_URL`, `MAIL_FROM`, `ORARI_BASE_URL`; https enforced unless localhost; schema applied at start; outbox dispatch every 30 s; SIGTERM closes the pool; `TRUST_PROXY`).
- `lib/accounts/smtpMail.js`: nodemailer, plain text Albanian messages, refusals throw so the outbox retries.
- Client: status `postgres` is a mode; the "demo, lost on restart" notices show only in memory mode; settings text no longer says accounts "come later".
- Deploy: `render.yaml`, `.env.example`, README section. Netlify/Vercel not used: long-running process with in-memory job store.
- Evidence (executed): PostgreSQL 18 (embedded-postgres, real server) — repository contract 11 behaviours on memory AND PostgreSQL (concurrency: 10 sign-ups one wins, 20 token uses one wins, 6 concurrent writers one wins, 6 dispatchers never overlap); full HTTP journey on PostgreSQL with restart (sign-up, verify, login, plan, mark, forgot, reset, session survives a restart, mail waiting at stop is sent by the next process); SMTP over a real socket (delivery, refusal, unreachable); `e2e/postgres-smoke.mjs` runs `server.js` itself in postgres mode with a SMTP sink: 9 of 9 (SIGTERM check skipped on Windows). `npm test` 344/344, `npm run check` clean, client typecheck clean, client tests 373/373, build 369 kB, `npm audit` 0.
- NOT TESTED: a real Neon/Supabase database (pooler, cold start, connection limits), a real SMTP provider (delivery, spam, sender domain), the host's reverse proxy, graceful SIGTERM (no signals on Windows), the browser UI in postgres mode (UI logic is mode-agnostic; only the notices differ), a live Groq call through the job path.

## Addendum to report 14 — conditions of `codex/17-production-path-verdict.md`
1. Queued links: sealed with AES-256-GCM (`lib/accounts/postgres/sealedOutbox.js`, key from `OUTBOX_SECRET`, message id as associated data); test reads the raw row: no token, no link; wrong key gives the message up.
2. SMTP: off loopback `requireTLS` and certificate verification. Defect found while testing: the options were passed as defaults of `createTransport(url, defaults)` and were NOT applied (timeouts included); now `createTransport({url, ...})`, asserted on `transporter.options`.
3. Render plan is `starter` (no sleep); `OUTBOX_SECRET` generated by the Blueprint.
4. Database TLS: sslmode disable/allow/prefer/no-verify refused off loopback; ssl parameters removed from the URL, verification is explicit. Pool max 5 per instance (noted for the provider limit).
5. Test helper: embedded PostgreSQL starts take turns across test processes (parallel starts stalled once). `npm test` 348/348, `npm run check` clean, smoke 9/9. Still NOT TESTED: real Neon/Supabase, real SMTP provider, host proxy.
