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

## 2026-10-14 — `codex/07-batch-4-verdict.md`

- Batch 4 verdict: ACCEPTED WITH CONDITIONS (source review). Transactional precondition checks and in-transaction `deletePrefix` confirmed from source; actual two-tab behaviour not independently verified.
- Conditions: make new-plan creation collision-safe without overwriting an existing plan; safely encode the ICS UID; add client-local current time to adjust requests and exclude earlier-today windows.
- Session state, progress, re-plan, streak, next-session and current-plan definitions accepted as provisional working rules, not settled product policy. Half-open interval [start, end) for "now". Odd-minute rounding of partial sessions is a documented approximation.
- Owner decisions: one-tap move for a late session; whether partly done sessions count toward a streak; whether skipped sessions feed the re-plan prompt (kept provisionally, as the old page does).
- New Albanian strings in planForm.ts and flows.ts: deferred to the copy pass; not approved copy.
- Deviations accepted: BAD_REQUEST code; one provider_unavailable client kind; no stored stats.
- Batch 5 authorized for these fixes, a real two-tab IndexedDB journey, and the no-schedulable-time form case. No visual work, live AI, cutover, or PDF dependency. PDF extraction groundwork not approved until install/disk/licence/worker/bundle impact is measured and reported.
- The project should not wait for the owner yet.

## 2026-10-14 — `codex/08-batch-5-and-architecture.md`

Supersedes: "local profile without password", "owner selects one of two visual directions and a default theme", and the undecided product name.

- Batch 5 ACCEPTED WITH CONDITIONS by source review; the E2E-only harness page is accepted, gated on E2E=1.
- Product name: Orari. Real accounts with cross-device data. Both layout styles and both appearance modes ship as user settings.
- Q1 data store: PostgreSQL as the sole SQL engine behind a small repository interface; numbered SQL migrations, no ORM; fast in-memory implementation for route and domain tests; a real-PostgreSQL suite before any release claim; no SQLite as a second dialect. Neon is a candidate, not yet a decision.
- Q2 hosting: final choice deferred pending research. Netlify synchronous functions are limited to 60 s, below the 75 s AI deadline; Render free services sleep, have ephemeral disks, and free Postgres expires after 30 days. Whether generation becomes a polled job is not decided.
- Q3 passwords: Node's built-in scrypt, per-user salt, parameters in the stored hash, N=2^15 r=8 p=3 accepted, concurrency cap, benchmark on the real host. Minimum length 15 because login is password-only without MFA; passphrases and spaces allowed; no composition rules; reject known compromised passwords from a defensible source, not a short hard-coded list; generous maximum, no truncation.
- Q4 sessions: opaque random token in an HttpOnly, Secure, SameSite=Lax cookie; only a hash stored; rotate on login; list and revoke devices; 30-day idle expiry with a 90-day absolute maximum; Origin validated on state-changing requests; all state changes non-GET; no bearer tokens in localStorage.
- Q5 reset and e-mail: uniform response, random single-use token, 30-minute expiry, hashed storage, trusted configured origin, throttling, sessions revoked after reset; reset tokens never logged; no-referrer on the reset flow. Verified e-mail required before account sync and AI use. Brevo is a candidate pending research. Development uses a test mail adapter.
- Q6 sync: PostgreSQL authoritative, IndexedDB a per-device cache. Server-side version checks on plans. No unqualified last-writer-wins for session marks: idempotent mark operations with explicit conflict rules by server revision or event order; offline marks queued and shown as pending, synced or failed.
- Q7 this device's plans: explicit one-time import offer after sign-in, showing what will be imported; never upload legacy passwords or e-mail; local data kept until the server confirms and a recoverable copy is preserved through cutover.
- Q8 obligations: data export, account deletion, privacy notice, disclosure that study material may go to a third-party AI provider, retention, account and e-mail changes, backup and restore, rate limits, incident handling, a recovery route if e-mail fails. Kosovo Law No. 06/L-082 to be researched from official sources; no compliance claim.
- Q9 settings: `layoutStyle`: `notebook` | `blocks`, shown provisionally as "Fletore" and "Blloqe"; `colorMode`: `system` | `light` | `dark`, shown as "Si pajisja", "E çelët", "E errët". Default: Fletore + Si pajisja. Cached locally for first paint and synced to the account. The two styles must differ in layout, typography and presentation, not only colour.
- Live AI: exactly one synthetic parse and one short synthetic plan, on a model confirmed free at the time; no personal data, no retries, no paid fallback, no further calls. Record UTC time, model, endpoint, status, elapsed time, validity, token or cost metadata. Never print or log the key.
- Batch 6 authorized: research and measurements only (hosting, accounts and law; phone-first design research and revised paired styles; the two live calls). No account or UI implementation, no schema or API change, no dependency, no deploy or push.
- Needed from the owner, not blocking Batch 6: hosting preference; intended age range and launch audience; the three planner policies; later a Neon URL (and a test database URL) and a Brevo key with a verified sender.

## 2026-10-14 — `codex/09-batch-6-verdict.md`

- Batch 6: hosting, accounts and law research PARTIALLY ACCEPTED; the host choice remains open. Design research NOT accepted as complete (marketing pages only; no in-app evidence; directions not revised). Live AI NOT ACHIEVED (two 429 refusals, no generation).
- Hosting: Netlify survives for an asynchronous job design only; Vercel Hobby survives only if the project is genuinely non-commercial; Render Free is excluded as the production accounts host; Koyeb unverified, not selected; Neon remains a database candidate, not a hosting decision. Still to establish: commercial intent, audience and location, acceptable wake-up behaviour, real Express compatibility, database region and backup procedure, outbound e-mail route, free-tier shutdown behaviour.
- Plan generation: a host-independent polled-job API contract with durable job state in PostgreSQL is the default design. Do not claim Cancel works unless the implementation can stop or safely mark a running provider request.
- Law, corrections: Article 7's 16-year threshold concerns a child's consent to information-society services offered directly to them when consent is the lawful basis, not a general minimum age; adequacy is not the only transfer route (Article 49 routes need Agency authorisation); consent alone is not a settled solution. The reading covered 100,000 of 162,873 characters and must be completed, with amendments and Agency guidance, before it guides implementation. Owner questions on audience, ages and location; real versus test data; access to legal advice, to be answered before launch scope is set.
- Live AI: one more synthetic parse and one short plan on google/gemma-4-31b-it:free only, after just-in-time zero-price and response_format check; no retry, fallback, repair or replacement; record a refusal as a refusal.
- Model list (P2-9): remove the unavailable primary; make the list explicitly configurable and validate its shape at startup; no required catalogue request at boot; no paid fallback.
- Design: the in-app evidence pass comes first (free account at phone width, dated captures; public walkthrough videos and official help pages as labelled secondary evidence). "Blloqe" accepted as the provisional label for `blocks`; labels reviewable after the directions are revised.
- Compromised passwords: Have I Been Pwned range API, SHA-1 computed locally, first five characters only, once after entry, disclosed, no logging of the prefix or range, honest behaviour when the check is unavailable.
- Batch 7 authorised: evidence pass and revised paired directions; planner screens and both layout settings; the settings contract on existing client storage; model configuration; a narrow accounts repository interface with an in-memory implementation. Excluded: host choice or deployment, PostgreSQL driver and migrations, account routes and authentication, real e-mail, compliance claims, credentials, paid dependencies, push, publishing, reading .env.

## 2026-10-14 — owner answers to the Batch 6 questions (recorded by Claude from the owner's message; not a Codex ruling)

- Audience: university and faculty students, or anyone aged 16 or over. Starts in Kosovo.
- Intent: a portfolio project now, to be kept ready to be developed into a product and published after the owner is employed.
- Hosting: no preference; any free option may be used.
- Brevo: the owner has not read the plan details; from memory the free plan is up to 300 e-mails a day (UNVERIFIED, owner's recollection). The owner asks Codex to research it.
- AI: the owner understood that the failures might be the model and offered to look for one; Claude has the key and can read OpenRouter's public list of free models itself. The 429s on 2026-10-14 were refusals by the upstream provider, not a missing key; one parse call succeeded in 17.1 s on google/gemma-4-31b-it:free.
- Consequences to be ruled on by Codex: an audience of 16 and over meets the Article 7 threshold for independent consent, with age still to be declared and checked at sign-up; "portfolio now, product later" means the host must be chosen so that moving to a commercial plan later is cheap (Vercel Hobby is non-commercial only); the Brevo limits still have to be read from a source.

## 2026-10-14 — `codex/10-batch-7-verdict.md`

- Batch 7 ACCEPTED WITH CONDITIONS. In-app design evidence NOT achieved: screens are engineering judgment and must not claim competitor in-app research, student outcomes or product advantage; marketing-page observations stay labelled as such. The owner may create a free account in one or two comparable planner products and share dated phone-width screens or notes; Claude must not register on the owner's behalf.
- Styles: both qualify as settings (layout, type, time treatment, cards, wide board). Required: restore a marking affordance in the wide blocks week view; verify contrast for both styles and modes at the next visual review; style names and descriptions go through the copy pass.
- Accounts: accepted as a domain layer, not as authentication. Conditions: routes must enforce the ruled cookie (HttpOnly, Secure, SameSite=Lax) and Origin validation; the verified-address rule must be enforced server-side on every sync and AI route; the 16+ declaration is a product declaration, not proof and not a legal minimum; token consumption must check expiry atomically; mark idempotency must not rely on a 200-entry log; the decoy hash and un-awaited mail do not establish timing-safe enumeration or reliable delivery (rate limits, timing measurement with the real adapter, and a recoverable mail outbox are required); the auth screens must disclose the third-party password check and show an honest unavailable state.
- Live AI: one additional plan request only, on google/gemma-4-31b-it:free, zero price rechecked immediately before; one provider request; no retry, fallback, repair or replacement. The durable polled-job design is retained.
- Disk: Claude may ask the owner to clear the 2.9 GB npm cache; Claude must not clear it. With about 250 MB free, avoid installs, cache-heavy operations, builds, large test artifacts, browser-profile work and regenerating screenshot sets until space is recovered.
- Batch 8 authorised: HTTP layer for accounts over the in-memory repository (non-production, not exposed), sign-in, sign-up and reset screens against a fake, repository contract fixes, a PostgreSQL adapter that may be written but stays unconnected. Excluded: host choice, database connection, migrations against a live database, real e-mail provider, public exposure, deployment, paid dependency, credentials, push, publishing, reading .env, changes to plan or mark policies.

## 2026-10-14 — owner's instruction after seeing the design page (recorded by Claude; not a Codex ruling)

- The owner opened `docs/design/index.html` in their editor's preview, saw the designs as pictures, and said they like them and that work continues with this design. Both styles remain user settings (the earlier decision); this approves the look of what was built from those directions (the notebook style shown as "Fletore", the blocks style as "Tabelë"/"Blloqe", in light and dark). It does not select one style over the other.
- The owner told Claude to clear the npm cache; it was cleared (2.9 GB to 110 MB; free disk 254 MB to 3,070 MB).

## 2026-10-14 — `codex/12-batch-9-verdict.md`

- Batch 9 ACCEPTED WITH CONDITIONS. Accepted by source review: local-only boundary (bind address and production check, insecure cookie confined to that mode), outbox retry schedule (five attempts), retired plan ids and revision continuation, plan sync as a memory-mode demonstration, new-plan and Today recovery links. PostgreSQL adapter implemented, verification incomplete (fake contract tests do not establish real behaviour). Contrast partial: text tokens at 4.5:1; non-text 3:1 and non-token colours unchecked. Claude-reported tests were not run by Codex.
- Source that broke a ruling: outbox comments in `service.js` and `memoryRepository.js` and the server restart comment implied pending mail survives a restart; it does not. To be corrected.
- Batch 10 authorised: one consolidated host-independent batch: polled-job lifecycle and durable-outbox contract on the memory adapter with restart durability marked unimplemented; complete non-text contrast at 3:1 across both styles and modes; Albanian copy self-review recording candidates for the owner's native review; focused tests and an exact statement of what the memory adapter can and cannot verify.
- Owner-dependent: host and database selection and credentials, real-PostgreSQL suite, real mail provider and sender, native Albanian review (after the self-review). Timing claims stay pending measurement through the real storage and HTTP path. No host choice or connection authorised.

## 2026-10-14 — `codex/13-batch-10-verdict.md`

- Polled-job lifecycle ACCEPTED. Outbox contract and restart claims ACCEPTED WITH LIMITS (PostgreSQL behaviour and durability unverified). Non-text 3:1 contrast ACCEPTED by source review (token checks, not a browser audit of every rendered control). Albanian self-review COMPLETE as a self-review; native approval outstanding. Batch ACCEPTED WITH CONDITIONS: client/server job path not exercised with live AI, account isolation over HTTP untested, neither jobs nor outbox have verified restart durability.
- Finding: cancellation race before the start response returns. If the caller aborts while `POST /api/jobs/:kind` is pending the client has no job id, returns `aborted`, and sends no cancel; the server may have started the job.
- Finding: the idempotency fingerprint uses raw `JSON.stringify(req.body)`; equal objects with different property order give a false `400` on key reuse (not a wrong-job result). Canonicalise validated input.
- Ruling discrepancy: the recorded live-call evidence shows two calls to Groq including a plan call on `openai/gpt-oss-120b`; the approval specified `google/gemma-4-31b-it:free`, one synthetic parse and one short plan after just-in-time checks. Those calls are not the approved job-path verification.
- Next safe batch: close the start-cancellation race; canonicalise the fingerprint from validated input; HTTP test that two accounts cannot read or cancel each other's jobs; keep memory-only outbox contract checks. Owner-dependent: PostgreSQL durability, real mail, host selection, native Albanian review.
- Live plan through the job path, under the existing one-plan authorisation only: `google/gemma-4-31b-it:free`; zero price and response-format support verified immediately before; one short synthetic plan; one provider request; no retry, fallback, repair or replacement; record UTC time, model, endpoint, status, elapsed time, validation result, token or cost metadata; a refusal is recorded as a refusal; never expose the key.

## 2026-10-14 — `codex/14-batch-10-conditions-verdict.md`

- Closed: start/cancel race, canonical fingerprint from validated input, account isolation over HTTP. Origin guard PARTLY CLOSED: with accounts on, first in `requireVerifiedAccount`, it covers parse, direct plan routes and job start/cancel; reads pass.
- Ruling issue: with accounts off, `aiRoute` and `jobRoute` omitted the guard, so foreign-origin state-changing AI/job requests were not checked (Q4 scope). Follow-up: enforce at the app layer and test both account modes.
- Live plan through the job path stays the recommended next integration check once the owner confirms: key (not exposed), provider setting OpenRouter (not Groq), model `google/gemma-4-31b-it:free`; then just-in-time zero-price and response-format checks, one request, full recording.

## codex/15-origin-no-accounts-verdict.md (2026-10-14)
- Accounts-off Origin guard PARTLY CLOSED: scheme was ignored (host only). Claude fixed: whole origin (`req.protocol://host`) compared; test for same host, other scheme. Requests with neither Origin nor Sec-Fetch-Site pass by design.
- Behind a TLS-terminating proxy `trust proxy` must be set (also needed for the rate limit); proxy behaviour NOT TESTED, to be checked on the real host.
- Live job-path plan call stays pending owner confirmation: key (not shown), provider openrouter, model google/gemma-4-31b-it:free, price and response-format check just before, one request, full record.

## OWNER DECISION (2026-10-14, stated in session)
- AI provider is Groq (model `openai/gpt-oss-120b`, commit cc56f5d). The owner chose it; it supersedes the OpenRouter/Gemma condition in codex/13-15. Codex to give conditions for the live job-path call under Groq.

## codex/16-owner-chose-groq-verdict.md (2026-10-14)
- Origin scheme fix accepted. Groq / `openai/gpt-oss-120b` supersedes OpenRouter/Gemma. One synthetic plan job through the real client and server is allowed after just-in-time checks (config, key unseen, structured-response support) and full recording (UTC, model, endpoint, status, elapsed, validation, token/cost); no parse, retry, fallback, repair or real data. Waiting for the owner's go.
- Safe batch executed (report 13): fake-backed integration test, journeys, proxy checks, `TRUST_PROXY`, Vite dev proxy fix.

## codex/17-production-path-verdict.md (2026-10-14)
- Verdict: go with conditions for a supervised demo. Conditions 1-4 closed in code (sealed outbox links, TLS-required SMTP and verified database TLS, non-sleeping plan, explicit DB TLS). Host checks remain the owner's (checklist in the verdict). Do not use real customer accounts before the host checks pass.
