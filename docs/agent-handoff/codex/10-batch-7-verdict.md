# Batch 7 verdict

**ACCEPTED WITH CONDITIONS.** The planner screens, appearance settings, AI model configuration, and account domain logic were delivered. The in-app research pass was **not achieved**, so the screens are provisional engineering work, not research-derived designs. I reviewed the source and the four supplied captures; I did not run tests or a browser.

- **In-app design evidence — NOT ACHIEVED.** The added help-page attempts did not produce usable in-app evidence.
- **Planner screens — ACCEPTED WITH CONDITIONS.** The screens are implemented in both styles and fit the supplied phone and desktop captures. They remain subject to the engineering-judgment label and copy review.
- **Appearance settings — ACCEPTED.** `notebook | blocks` and `system | light | dark` are stable stored values with a first-paint cache. Settings are local to the device for now; account sync does not exist.
- **Two styles — ACCEPTED WITH A FIX REQUIRED.** The captures and source show differences in layout, typography, time treatment, cards, and color—not just palette. In the wide blocks week view, mark controls disappear. Restore a way to mark sessions there, or make that affordance clear without relying on users to discover the session screen.
- **AI model configuration — ACCEPTED WITH CONDITIONS.** The stale primary is gone; the list is configurable, limited to `:free` IDs, and does not require a network call at startup. The reported parse succeeded, but plan generation still has no successful evidence.
- **Accounts — ACCEPTED WITH CONDITIONS AS A DOMAIN LAYER.** The in-memory service covers most of the ruled behavior. It is not an HTTP authentication implementation, durable storage, or release-ready account system.
- **Verification — NOT INDEPENDENTLY CONFIRMED.** Claude reports passing tests and journeys. I have not rerun them, as instructed. No HTTP layer, PostgreSQL adapter, real email delivery, or deployment is present.

# Account logic

The service is a useful basis for account routes, subject to the following amendments and enforcement at the HTTP and persistence layers.

- **Password policy and compromise checks:** The 15–128 character policy, scrypt parameters, hash upgrades, concurrency cap, local SHA-1 computation, five-character HIBP prefix, padding, and fail-closed `unavailable` result match the rulings. The auth screens still need to disclose the third-party check and provide an honest unavailable state.
- **Sessions:** Opaque token values are hashed in storage; sign-in creates a new session; 30-day idle and 90-day absolute expiry, touch throttling, device listing, and revocation are represented. Routes still need the ruled HttpOnly, Secure, SameSite=Lax cookie and Origin checks.
- **Reset:** The response is uniform; tokens are random, hashed, single-use, and 30-minute; the token is in the URL fragment; weak passwords do not consume the token; reset revokes sessions and does not sign in automatically. The un-awaited mail calls are not a durable delivery queue. A failed or interrupted send can strand a valid token; production needs a recoverable mail/outbox path.
- **Verification:** Unverified users may sign in, as ruled. The `canUseSyncAndAi` helper captures the restriction, but every future sync and AI route must enforce it server-side.
- **Age:** The `confirmsAge16 === true` declaration implements the owner’s 16+ product policy. It is a declaration, not age verification or proof. Do not present this as a universal legal minimum established by the cited law.
- **Plans and marks:** Ownership is scoped through user-ID repository methods. Plan updates use server revisions, preserve current marks during re-plan, and a stale mark is refused with the current session status and revision. Marks use no client clock.
- **Repository contract:** A PostgreSQL adapter can implement `replacePlan` with a conditional update or transaction that compares the stored revision and returns the current row on conflict. `useToken` must be an atomic conditional consume. It should also reject a token whose expiry has passed at consumption time; today the service checks expiry before password checking, then the repository only checks `usedAt`, leaving an expiry race.
- **Idempotency:** The service keeps only the most recent 200 operation IDs per plan. An old operation replayed after eviction can be applied again. Preserve idempotency for the supported retry window in durable storage, or specify and enforce a bounded retry window.
- **Enumeration:** Login, sign-up, and reset return the same public result for known and unknown addresses, and a known-address sign-up does not overwrite the account. The decoy hash and queued, un-awaited mail do **not** prove timing resistance. The first unknown login lazily computes the decoy hash; sign-up and reset also do different repository work for known and unknown addresses. Rate limits are required, and the routes should be measured for timing differences with the real adapter. The different notice is sent only to the submitted address, but the mail queue itself can lose delivery on process exit.

# Design evidence

**Use the owner-provided evidence path:** the owner creates a free account in one or two comparable planner products and shares dated phone-width screens or interaction notes. Do not register on the owner’s behalf.

Until that evidence is reviewed, the existing screens may proceed as **engineering judgment**. They must not claim that in-app competitor research supports their layout, interaction patterns, student outcomes, or product advantage. Marketing-page observations must remain labelled as such.

# Styles

**Yes, the styles differ enough to offer as settings.** The captures show the notebook style’s serif headings and ruled diary layout versus the blocks style’s sans headings, monospaced time, card treatment, and wide seven-column week board.

Change the blocks week view so marking is available there at wide widths. Then use the copy pass to review the style names and descriptions, and verify contrast for both styles and modes as part of the next visual evidence review.

# Live AI

The reported parse is useful evidence for **one input**: it took 17.1 seconds and passed app validation. The plan call was refused with 429, so it gives no plan-output or plan-latency evidence. It does not justify switching back to a held request; retain the previously ruled **durable polled-job design**. One parse is not enough to decide the job-versus-request architecture.

I authorize **one additional plan request only**, using `google/gemma-4-31b-it:free`. OpenRouter currently lists it as free and supporting `response_format`, while noting free endpoints are rate-limited. Recheck the zero price immediately before the call; use synthetic input and exactly one provider request, with no retry, fallback, repair, or replacement if it fails. [OpenRouter model page](https://openrouter.ai/google/gemma-4-31b-it%3Afree)

# Disk

**Yes, Claude may ask the owner to clear the 2.9 GB npm cache.** Do not clear it directly. With about 250 MB free, avoid installs, cache-heavy package operations, builds, large test artifacts, browser-profile work, and regenerating screenshot sets until space is recovered. Do not delete the Edge profile or project data as a substitute.

# Next batch — Batch 8

**Goal and user value:** Build reviewable account HTTP and sign-in/sign-up/reset flows while keeping them explicitly non-production until persistent storage and email delivery are available.

**Scope:** Add the HTTP layer over the in-memory repository, plus sign-in, sign-up, and reset screens wired to a test fake. Refine the repository contract for expiry-checked token consumption and durable mark idempotency. A PostgreSQL adapter may be written behind the repository interface but must remain unconnected.

**Expected areas:** Account route and cookie handling in `lib/app.js` or a focused `lib/accounts/http.js`; `client/src` account screens and routing; repository interface and memory implementation under `lib/accounts/`; focused route, repository, and client tests.

**Approach:** Keep authentication checks server-side. Use the ruled cookie, Origin validation for state-changing requests, and rate limits on sign-in, sign-up, verification, and reset. Keep fake account responses test-only; do not present fake success as working accounts. The PostgreSQL adapter must use atomic token consumption and revision-checked plan replacement.

**Explicit exclusions:** No host choice, database connection, migrations against a live database, real email provider, public exposure, deployment, paid dependency, credential entry, push, or publishing. Do not read `.env`. Do not change the product’s plan/mark policies.

**Dependencies and risks:** The in-memory repository loses accounts and sessions on restart, so this batch cannot support a persistence claim or public account service. Defer dependency installation and large builds until disk space is recovered. Keep the design evidence and Albanian copy caveats visible.

**Acceptance and checks:** HTTP responses must not expose account existence; Origin and cookie behavior must be covered by focused tests; reset tokens must not appear in logs or referrers; verification must gate sync and AI, not sign-in; screens must cover loading, invalid input, unavailable mail/check, and recovery states without fabricated success. Report exact focused test results and the actual repository implementation status.

**Rollback:** Keep the account routes and UI isolated so they can be disabled independently; preserve the domain service and in-memory tests.

**Owner inputs needed:** Host and PostgreSQL provider research before connection or deployment; verified Brevo limits and terms before real mail; fluent Kosovo Albanian copy review; and dated phone-width in-app evidence for the design research. The owner’s three planner policy decisions—late-session move, partial-session streak counting, and whether skipped sessions feed re-planning—remain open for the relevant product-policy work.

# STATE UPDATE

The workspace is read-only, so these are copy-ready updates; I did not edit the records.

**`PROJECT_STATE.md`**

> Batch 7: ACCEPTED WITH CONDITIONS. Planner screens and both appearance settings are implemented. In-app design evidence was not achieved; screens are engineering judgment and must not be described as research-derived. Captures show meaningful layout, type, and presentation differences; restore a marking affordance in the wide blocks week view. AI configuration is host-independent; one synthetic parse succeeded in 17.1 s and the plan call received 429. One additional synthetic plan call is authorized on `google/gemma-4-31b-it:free`, after immediate zero-price verification, with no retry/fallback/replacement. Accounts domain logic is accepted with conditions; no HTTP routes, durable repository, or real mail exist. Batch 8 may add a non-production HTTP layer over memory, test-fake account screens, and an unconnected PostgreSQL adapter after repository contract fixes. No `.env` read, deployment, push, or publishing.

**`CODEX_DECISIONS.md`**

> Batch 7 verdict: ACCEPTED WITH CONDITIONS. Design evidence remains incomplete; the owner should share dated phone-width screens or interaction notes from one or two free planner accounts. Until then, designs may proceed only as engineering judgment and must not claim competitor in-app research or outcomes. Both styles qualify as settings by layout, typography, and presentation, but Batch 8 must restore marking in the wide blocks week view and verify contrast. Account service matches most Q3–Q6 domain rules: sign-in may be unverified; verified email must gate sync and AI; 16+ is a product declaration, not proof or a universal legal conclusion; marks conflict by server revision and return current status/revision without client time. Amend repository token consumption to check expiry atomically and preserve mark idempotency beyond the 200-ID eviction risk. Decoy hash and queued un-awaited mail do not establish timing-safe enumeration or reliable delivery. One additional synthetic plan call is authorized on `google/gemma-4-31b-it:free` after immediate zero-price verification, one provider request only, no retry/fallback/repair/replacement. Keep the durable polled-job design. Batch 8 scope and exclusions are in the Batch 7 verdict. The owner may be asked to clear the npm cache; do not clear it directly. Host, provider limits, copy review, design evidence, and three planner policies remain open as applicable.