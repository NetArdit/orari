## 1. Batch 5 verdict

**ACCEPTED WITH CONDITIONS, by source review.** I read the requested handoff sections, recent history and implementation areas. The history shows the three reported Batch 5 commits, followed by the report commit. The code supports the main claims:

- [`repository.ts`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/client/src/storage/repository.ts) checks for an existing plan in the write transaction; [`planStore.ts`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/client/src/state/planStore.ts) retries with a new ID and returns the ID actually stored.
- [`ics.ts`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/client/src/domain/ics.ts) encodes unsafe UID characters one-to-one, preventing line injection.
- [`planForm.ts`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/client/src/domain/planForm.ts) counts possible study dates and catches the definite zero-date case.
- [`lib/plan.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/plan.js), [`lib/time.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/time.js) and [`lib/schema.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/schema.js) pass validated client-local time into the re-planning calendar and clip earlier-today windows.
- The Vite config includes the harness page only when `E2E=1`; the harness calls the real storage adapter, and the two-tab journey exercises it.

**The E2E-only harness deviation is accepted.** It is a reasonable way to exercise real IndexedDB from two tabs without adding test hooks to the normal app. Keep its inclusion explicitly gated on `E2E=1`; the report’s claim that normal output contains no harness is Claude’s check, not one I reran.

The report’s test and browser results remain **Claude-reported, not independently verified here**. I did not run tests, build, browser, or live AI calls.

## 2. Accounts architecture rulings

The owner’s real-account decision approves authentication and cross-device data as product scope. It does **not** approve implementation before the research and data-contract work below is complete.

### Q1. Data store — **Accept, with a release gate**

Use **PostgreSQL as the sole SQL engine**, behind a small repository interface. Keep SQL migrations numbered and explicit; no ORM for now. Exercise route and domain logic against a fast in-memory implementation, but run a separate PostgreSQL integration suite before claiming release readiness. Do not introduce SQLite for local development if that would create a second production dialect.

The owner’s existing Neon account makes this a practical candidate, not an automatic deployment decision. Confirm current free-tier limits, backups/retention, regions and connection behavior in the next batch.

### Q2. Hosting and 75-second AI calls — **Defer the final choice pending research**

Do not select a host or convert generation to jobs based on a guess. Current official docs establish a material constraint: Netlify synchronous functions have a 60-second execution limit, below this app’s 75-second AI deadline; Netlify documents background functions up to 15 minutes on its credit-based Free plan. Render’s free Node services sleep after 15 idle minutes, take about a minute to wake, have ephemeral filesystems, and do not get persistent disks; its free Postgres expires after 30 days. [Netlify function limits](https://docs.netlify.com/build/functions/configuration/), [Netlify background functions](https://docs.netlify.com/build/functions/background-functions/), [Render free services](https://render.com/docs/free)

These facts rule out a direct, 75-second synchronous Netlify request and rule out a Render local file as durable account storage. They **do not** settle whether Orari should use a durable, polled job, nor whether a zero-cost production host meets the owner’s needs. Measure the actual model latency and compare viable host and database combinations before deciding. A polled job may improve resilience when a phone sleeps, but it adds persistent job state and recovery behavior that must be justified.

### Q3. Password hashing — **Accept scrypt; amend password policy**

Use Node’s built-in `scrypt`, with a per-user random salt and parameters in the stored hash so cost can be raised later. The proposed `N=2^15, r=8, p=3` is one of OWASP’s listed scrypt configurations; impose a concurrency cap and benchmark the actual host memory/CPU before release. [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

Amend the proposed **8-character minimum**: Orari is planned as password-only login, without MFA. Current OWASP guidance says passwords shorter than 15 characters are weak without MFA. Permit passphrases and spaces, impose no composition rules, reject known compromised passwords using a maintained or otherwise defensible source, and set a generous maximum without truncation. Do not rely on a short hard-coded “common password” list as the main blocklist. [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

### Q4. Sessions and CSRF — **Accept, with lifetime and request-boundary amendments**

Use opaque random session tokens in `HttpOnly`, `Secure`, `SameSite=Lax` cookies; store only a fast hash of the high-entropy token. Rotate on login and support listing and revoking devices. Use a 30-day idle expiry with a 90-day absolute maximum, then require sign-in again. Validate `Origin` on state-changing requests, with a deliberate same-origin fallback where appropriate; `SameSite` alone is not the CSRF policy. Ensure all state-changing endpoints use non-GET methods. Do not put bearer tokens in `localStorage`.

### Q5. Password reset and e-mail — **Accept, with verification and operational requirements**

Accept the uniform response, random single-use token, short expiry, hashed token storage, trusted configured reset origin, throttling and session revocation after reset. A 30-minute expiry is a reasonable starting value. Do not log reset tokens or credentials; set a no-referrer policy on the reset flow. These measures align with OWASP’s guidance. [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

Require verified e-mail before enabling account sync and AI use, while allowing an unverified user to reach the verification and recovery flow. Brevo remains a candidate, not an approved dependency yet: research its current free limits, sender/domain verification, data handling and zero-cost conditions. The owner must supply credentials and sender details directly when implementation reaches that point. Development must use a test mail adapter, not log real reset links or tokens.

### Q6. Cross-device sync — **Accept the server as source of truth; amend conflict handling**

PostgreSQL is authoritative; IndexedDB remains a local cache for quick startup and offline reading. Plan revisions need server-side version checks. Do **not** use unqualified last-writer-wins for session marks: client clocks and delayed offline writes can silently overwrite a newer action. Define idempotent mark operations and explicit conflict rules using server revisions or event ordering. Queue offline marks and show whether they are pending, synced or failed. Plan creation and AI adjustment require a connection unless later product research justifies another path.

### Q7. Existing plans on this device — **Accept, with import protections**

Offer an explicit, one-time import of eligible local plans after sign-in. Never upload legacy passwords or e-mail copied from local storage. Show the user what will be imported; handle ID collisions deliberately and report counts. Keep local data intact until the server confirms the import, then preserve a recoverable local/export copy through the cutover. Do not silently merge or replace account plans.

### Q8. Account obligations — **Accept; expand the release scope**

Plan for data export and account deletion, privacy notice and clear disclosure that study material may be sent to a third-party AI provider. Also define retention, account/email changes, backup and restore, rate limits, security incident handling, and what support/recovery route exists if e-mail delivery fails.

Kosovo’s official 2019 Law No. 06/L-082 applies to public and private data processing and says it is in line with the GDPR. That confirms the legal question is real; it does not establish the complete current obligations for Orari. Research the official law and any amendments or relevant guidance, including cross-border transfers and student/minor users, before release. This is engineering research, not a legal-compliance sign-off. [Official Gazette: Law No. 06/L-082](https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=18616&lang=en)

### Q9. Styles and appearance settings — **Accept both; set neutral stored values and a provisional default**

Both styles and both color modes ship as independent user settings. Use stable internal values separate from Albanian display labels:

- `layoutStyle`: `notebook` or `blocks`, displayed provisionally as **Fletore** and **Blloqe**.
- `colorMode`: `system`, `light` or `dark`, displayed as **Si pajisja**, **E çelët** or **E errët**.

Default to **Fletore + Si pajisja**. Cache settings locally for first paint and sync the user’s choices to their account; `system` resolves against each device’s OS preference. The two styles must differ in layout/typography/presentation, not only color. Design research may refine the display labels, but should not change the stable setting contract without review.

## 3. What survives from accepted work

The accepted React + Vite + Tailwind + strict TypeScript direction survives, as do the API client, schema-derived types, route structure, stable error codes, server correctness fixes and domain rules. The Batch 4/5 storage work also survives: IndexedDB remains useful as a per-device cache, with its atomic writes and backup/import machinery adapted to account sync.

Some work changes role:

- The old-page localStorage migration becomes an **explicit import offer** into an account.
- Local backup/restore becomes account export and recovery groundwork, with its exact behavior redesigned for server-authoritative data.
- The two-tab storage journey remains useful for local-cache integrity, but account sync requires separate cross-device conflict tests.
- The two design directions become candidate **user-selectable styles**, not options for the owner to choose between.

Supersede the local-profile-without-password assumption, the owner-picks-one-style/default-theme decision, and the undecided product name. The name is now **Orari**. The old “plaintext passwords and fake login goes with the local-profile redesign” item should become an account authentication/security workstream. No accounts code has been written, and none is authorized in this batch.

## 4. Design research and the existing directions

Do phone-first research of real, currently shipped study planners, calendar/task tools and flashcard products. Cover how they present today and a week, mark study sessions, onboard users, and handle empty/loading/error states. Inspect actual products and their official product/help pages; record what was observed and when. Use primary sources or direct product observation as evidence. Label inferences separately. Avoid design galleries, AI-generated mockups and affiliate listicles as the core evidence.

Deliver a research report with product/source links, dated screenshots or precise interaction descriptions, observed patterns, patterns to avoid and why, and explicit mapping to Orari’s real capabilities. Include accessibility and performance implications, with a proposed first-load budget and measurement method alongside the existing 200 kB gzip JavaScript budget.

Revise **both** directions using the findings; do not presume either existing direction should survive unchanged. Compare the resulting styles and their four combinations with light/dark/system appearance across the same realistic planner flows. The owner does not select one direction: both are product settings. Claude should recommend names and explain the rationale for review.

## 5. Live AI calls

**Authorized with strict bounds:** one synthetic parse request and one short synthetic plan request, using only a model confirmed to be free at the time of the call. No personal data, paid fallback, retries, repeated prompts or extra calls. If zero cost cannot be confirmed, do not call.

Record UTC time, model ID, endpoint, status, elapsed time, response validity/shape, returned token/cost metadata if available, and any error. Keep prompts synthetic and summarize them rather than recording sensitive content. Never print, copy or log the key or include it in a report. This authorizes those two calls only; it does not authorize additional AI experiments.

## 6. Next batch: Batch 6 — research and measurements, no code

**Goal and user value:** establish evidence for hosting, account architecture, visual direction and real model latency before choosing backend contracts. Give the owner concrete, zero-cost-informed decisions instead of building on assumptions.

**Scope and expected deliverables:** create separate research deliverables for hosting/accounts, design, and live AI timing. Include a concise architecture decision record addressing Q1–Q9 and the conditions still open.

- Hosting/accounts: compare Netlify and at least two plausible zero-cost options using current official documentation. Record request duration, background/job behavior, sleep/cold start, durable storage, database limits/expiry, RAM/CPU, HTTPS/custom domain, outbound e-mail constraints, billing/usage caps and shutdown behavior. Include dates and direct sources. Evaluate options against account data and zero-cost constraints. Research Kosovo law from official sources, identify the unknowns and any owner/legal questions, and do not give a compliance claim.
- Design: produce the research and revised paired directions described above. Both styles must cover comparable phone-first planner flows and work in all required appearance modes.
- Live AI: perform exactly the two authorized calls. Verify model IDs/pricing before calling and record the bounded evidence specified above.

**Exclusions:** no account implementation, schema/API changes, visual application code, dependency installation, live deploy/push, paid service, secret inspection, or broader AI calls.

**Acceptance criteria:** sources support every hosting/legal claim; comparisons expose zero-cost and durability tradeoffs; actual model latency is recorded without exposing secrets; design observations are distinguished from inference; both revised styles and proposed labels/defaults are documented; unresolved questions and next gates are explicit. No tests or builds are required for this research batch.

**Risk and recovery:** this batch changes documentation only. If a source or product cannot be accessed, mark it unknown and continue with independent deliverables; do not fill gaps with guesses.

## 7. What the owner must provide, and what it blocks

- **Hosting preference, if any:** useful for the hosting comparison; not blocking research. If the owner chooses Netlify, confirm which account plan applies before architecture is locked.
- **Neon database URL:** owner supplies it directly when PostgreSQL integration implementation begins. A separate test database URL is needed for the real-PostgreSQL release suite; neither is needed for Batch 6.
- **Brevo key and verified sender/domain:** owner supplies these only when e-mail integration is authorized. They block real password-reset delivery, not the reset flow’s interface or fake-backed tests.
- **Intended age range and launch audience/location:** needed for the legal/privacy research and before account collection or public launch, especially if minors are in scope.
- **Three open planner policies:** one-tap move for a late session; whether partial study counts toward a streak; whether skipped sessions prompt re-planning. These block final UX/copy and the affected planner behavior, not hosting or account research.
- **Zero-cost constraint and no push/deploy without owner:** already confirmed; remain hard gates.

## 8. STATE UPDATE

I could not edit repository records in this read-only workspace. Copy-ready updates:

**`PROJECT_STATE.md`**

> Owner decisions (2026-10-14): product name Orari; real accounts with cross-device data; both layout styles and appearance modes are user settings. These supersede local-profile/no-password and owner-selects-one-design assumptions. Batch 5: accepted with conditions by source review; reported test/browser results not independently rerun. IndexedDB remains a per-device cache candidate; PostgreSQL is the proposed sole authoritative store, pending hosting research. No account implementation is authorized until Batch 6 research and architecture review complete. Two bounded synthetic live AI calls are authorized under the zero-cost limits in the Batch 6 verdict.

**`CODEX_DECISIONS.md`**

> Supersedes: “local profile without password,” owner selects one of two visual directions/default theme, and undecided product name. Orari uses real accounts; both styles and both appearance modes ship as settings. Batch 5 accepted with conditions by source review; harness deviation accepted because it is included only in `E2E=1` builds. PostgreSQL is accepted as the sole-engine architecture direction; hosting/job decision remains open pending research. Batch 6 authorized for hosting/legal research, phone-first product design research and revised paired styles, and exactly one synthetic parse plus one short synthetic plan call after zero-price model verification. No account or UI implementation, tests/build, deployment or push authorized in Batch 6.

**Checks and source limits:** I did not open `.env`. I did not run tests, build, browser or AI calls. The Netlify, Render, OWASP and Kosovo legal references above are current-source research; hosting terms and pricing must be rechecked in Batch 6 before a final deployment decision.