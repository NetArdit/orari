## Verdict

- **Start/cancel race — CLOSED.** `runJob` races the caller’s signal against the start, returns promptly if aborted, and cancels the job when a late start answer supplies its ID. The start request is deliberately independent of the caller’s signal and remains bounded by the job deadline.
- **Validated canonical fingerprint — CLOSED.** The job route fingerprints the validated schema output with `canonicalJson`; invalid input falls back to the raw body. The kind is included in the fingerprint.
- **Account isolation over HTTP — CLOSED.** Tests cover foreign and unknown IDs returning the same response, foreign cancellation not aborting work, and separate running slots for two accounts.
- **Origin guard — PARTLY CLOSED.** With accounts enabled, placing `originGuard` first in `requireVerifiedAccount` is appropriate: it covers parse, direct plan routes, and job start/cancel; reads pass through. The parse tests show no break there. **Batch verdict: the three named conditions are closed; the Origin change leaves a scope condition.**

## Ruling issue

The source only installs this guard through `accounts.requireVerifiedAccount`. When accounts are off, `aiRoute` and `jobRoute` omit it, so foreign-origin requests to state-changing AI/job routes are not checked. That conflicts with Q4 if “every state-changing request” applies in no-account deployments too. The relevant conditional wiring is in [app.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/app.js:118) and [app.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/app.js:467); the guard itself is in [http.js](/C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/http.js:165). A safe follow-up is to make the guard available at the app route layer and cover accounts-on and accounts-off behavior. The current source does not establish that broader scope.

## Next consolidated batch

**Safe without a host:** close and test the Origin scope in both account modes; retain the in-memory job/outbox checks. This cannot establish restart durability or real database behavior.

**Owner-dependent:** I still recommend the single live plan through the job path as the next integration check, once the owner confirms the call after the earlier excess usage. Confirm which existing key to use without exposing it, that the provider setting is **OpenRouter** rather than Groq, and that the exact model is **`google/gemma-4-31b-it:free`**. Then verify zero price and response-format support immediately before the call and keep to the existing one-request limit and full recording conditions. Host/database selection, PostgreSQL durability, and real mail remain separately owner-dependent.

## STATE UPDATE

- **`PROJECT_STATE.md`:** The three `codex/13` conditions are closed: start cancellation race, fingerprint from validated canonical input, and account isolation over HTTP. Origin checks cover AI/job routes when accounts are enabled, including parse; they are not applied when accounts are off, so Q4’s all-state-changing-request scope remains to resolve. Jobs and outbox remain in-memory; host/database and live job-path behavior remain unverified.
- **`CODEX_DECISIONS.md`:** Accept closure of the three conditions. Record the Origin scope gap for accounts-off deployments; next safe batch is app-level Origin enforcement and tests in both account modes. Keep the authorized live plan pending owner confirmation of key, OpenRouter provider, and `google/gemma-4-31b-it:free` model, followed by just-in-time checks and the existing single-request recording limits.