## Verdict: ACCEPTED WITH CONDITIONS

The source extraction is a move, not a behavior rewrite. I compared the baseline `server.js` with `lib/app.js`, `lib/plan.js`, and the new `server.js`. The route handlers, validation, response shapes, messages, ID formats, and session logic are preserved. The substitutions reported—dependency injection, static-directory resolution, and the injected clock—match what I found in the source.

The tests’ names match their assertions. The **16 `KNOWN DEFECT` tests** explicitly assert the current broken behavior; they don’t hide it. In particular, the re-plan test eventually asserts that separate adjustments both return `a1`. The reported test runs and mutation checks remain Claude’s evidence: I did not run tests.

The Batch 1 application changes stay within scope. The additional `engines.node >=22` entry and `npm run check` script are limited deviations; the latter is useful, but the README currently overstates its coverage: the script checks application files, not the test files.

Conditions for the record: amend that README wording or expand the check script, and retain the Node 22 minimum only as an intentional runtime support policy. The engine minimum is not needed just to use `node:test`.

## Rulings for Phase 1

- **Session IDs:** Yes. UUID-based IDs may replace the current format as long as the API continues to return a string `id`. Preserve IDs already stored by the client.
- **Validation errors:** Yes. Add `fields: [{ path, message }]` while retaining the existing `error` string and status code.
- **Parse and adjust dates:** Yes. Add optional client-local date and IANA timezone fields. Validate both; retain server-clock behavior when older clients omit them.
- **Rate limits and headers:** Use `express-rate-limit` and `helmet`, plus a small in-process concurrency cap. This keeps the implementation focused while using established middleware. The limiter’s memory store is process-local, so document that it resets on restart and does not coordinate multiple server instances. Configure Helmet for the existing page’s Google Fonts, and avoid development-hostile HSTS or CSP directives. The libraries’ maintainers document the in-memory limiter and Helmet’s header and CSP behavior. ([express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), [Helmet](https://github.com/helmetjs/helmet))
- **Injectable OpenAI client:** Yes. Make the client injectable in `lib/ai.js` and test model fallback, retries, repair, and abort behavior with fakes; make no live provider calls.
- **Interim `public/script.js` fix:** Yes. Patch re-planning so it preserves every non-pending session and replaces only pending sessions from today onward. Verify it with the proposed headless-browser journey, including a completed session from today and a pending session from today. The journey is required evidence because this file has no test harness.

## Batch 2 — Phase 1 correctness and reliability

**Goal and user value:** Correct the server defects that can shift dates, mis-handle sessions or commitments, lose progress, give misleading success responses, or consume the shared AI quota without limits.

**Scope and expected files:** `lib/time.js`, `lib/schema.js`, `lib/plan.js`, `lib/app.js`, `lib/ai.js`, `public/script.js`, relevant `test/*.test.js`, and `package.json`/`package-lock.json` for the approved middleware. Update the handoff report and state records.

Make one focused commit per item, keeping the suite green between commits:

1. P0-3: reject impossible dates.
2. P0-1: issue UUID-based server session IDs.
3. P1-3: sort sessions, reject overlaps, and enforce the 20-minute minimum.
4. P1-4: report dropped sessions accurately; return an error for zero kept sessions or zero capacity; give finished plans a clear response.
5. P1-5: apply overnight commitments to the correct dates.
6. P1-6: accept and normalize one-digit-hour times; return field-level validation details.
7. P1-1: add an overall AI deadline and abort propagation; inject the OpenAI client and cover fallback/repair.
8. P0-5/P2-11: add per-IP rate limiting, a global concurrency cap, array limits, and security headers.
9. P1-13: accept optional client-local date/timezone fields for parse and adjust.
10. Interim P0-1 client fix: preserve today’s completed/non-pending sessions during re-plan.

**Exclusions:** No broad UI work, React migration, account/password redesign, live AI calls, changes to unrelated API behavior, deployment, or push. Long-plan limits remain out of scope pending provider evidence.

**Approach:** For each defect, first demonstrate the existing behavior with the named known-defect test, then reverse its expectation alongside the fix. Keep additive request/response fields backward compatible. Keep policy constants and array bounds explicit and tested.

**Dependencies and risks:** The two middleware packages add dependency and lockfile changes. CSP and rate-limit settings can disrupt local use or block legitimate users if misconfigured. UUIDs change the visible ID format but preserve `id: string`. Date/timezone inputs must be validated and old clients must continue to work.

**Acceptance criteria and required evidence:**

- Each known-defect expectation is reversed by its corresponding passing test.
- Tests cover request cancellation/deadline, fake OpenAI fallback and repair, rate-limit responses, concurrency caps, headers, validation paths, and optional date/timezone behavior.
- The headless-browser re-plan journey confirms that today’s completed sessions remain and pending sessions are replaced.
- Report exact test counts, syntax/check results, audit results, and browser evidence. No AI-backed claim is tested live.

**Rollback:** Revert the individual focused commit that introduced a regression. If the combined result is unstable, revert the Batch 2 commits in reverse order; preserve the safety-net baseline and handoff history.

The nine server items can remain one review cycle with a separate commit per item. The client patch is a separate commit in that same batch so it can be reverted independently.

## Design directions (D6)

Produce the two static directions **in parallel with Batch 2**. Keep them as reviewable design artifacts; do not start broad client UI implementation until the owner selects one. Beyond the recorded constraints, make both directions show the same realistic planner tasks and comparable screens so the owner can judge the designs directly. Include representative empty and error states, keep the light/dark themes coherent, and avoid settling the product name before D2 is decided.

## STATE UPDATE

I could not edit the records in this read-only workspace. Suggested entries:

**`PROJECT_STATE.md`**

```text
Gate: Batch 1 ACCEPTED WITH CONDITIONS. Conditions: correct the README’s “every source file” check-script claim or expand the script; keep Node >=22 as an intentional support policy. Batch 2 authorized as specified in the Codex verdict.

Verified by Codex from source: server.js route and plan logic was moved into lib/app.js and lib/plan.js with only the reported dependency substitutions; no other Batch 1 app behavior change found. Test names and assertions align; 16 KNOWN DEFECT tests explicitly pin defects. Test execution and mutation evidence are Claude-reported, not independently rerun.
```

**`CODEX_DECISIONS.md`**

```text
2026-10-14 — Batch 1 ACCEPTED WITH CONDITIONS. UUID-based session IDs allowed with id:string preserved; validation errors may add fields; parse/adjust may accept optional validated client-local date and IANA timezone. Use express-rate-limit and Helmet with configuration compatible with local use, plus an in-process concurrency cap. OpenAI client injection approved for fake-backed tests. Interim legacy-client re-plan fix approved, with headless-browser journey evidence. Batch 2: Phase 1 items in focused commits, plus the client fix in a separately revertible commit. Two static design directions may be produced in parallel; owner selection precedes broad client UI.
```