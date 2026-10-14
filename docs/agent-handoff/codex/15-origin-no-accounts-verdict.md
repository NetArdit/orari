1. **Origin scope — PARTLY CLOSED:** `callerAccess` applies `sameOriginGuard` to state-changing AI and job routes when accounts are off; job reads pass. Requests with neither `Origin` nor `Sec-Fetch-Site` pass by design. That is acceptable for the stated non-browser-client policy, though it means the guard relies on browsers sending at least one of those headers.

   **Bypass to close:** when `Origin` is present, the guard compares only `URL.host` with `Host`, ignoring the scheme. A request from a different scheme on the same host can pass. Compare the full effective origin, accounting for the deployment’s proxy setup.

2. **Old page and proxy — NO direct `/` break found:** the guard is on API requests; `/` remains served by `express.static`, and same-origin browser calls should pass. A proxy that rewrites the public `Host` to an internal host could cause legitimate API calls to get 403. Proxy behavior is unverified; the app does not configure `trust proxy`.

**Batch verdict: PARTLY CLOSED** until the scheme comparison is fixed. The requested verdict file is [14-batch-10-conditions-verdict.md](</C:/Users/Promotech/OneDrive/Desktop/claude projects/orari-main/docs/agent-handoff/codex/14-batch-10-conditions-verdict.md>); it records the prior scope gap and owner confirmation requirements.

**Next consolidated batch**

- **Safe without a host:** fix full-origin comparison and add coverage for scheme differences and both account modes.
- **Owner-dependent:** verify behavior behind the chosen reverse proxy; run the one live job-path plan only after the owner confirms which existing key to use (without revealing it), provider setting (`openrouter` vs `groq`), and model (`google/gemma-4-31b-it:free`). Check price and response-format support immediately before the single call and retain the required full record.

**STATE UPDATE**

- **`PROJECT_STATE.md`:** Accounts-off Origin enforcement is wired to AI/job routes; scheme comparison remains incomplete. No-header requests pass by design. Proxy behavior and live job-path behavior remain unverified.
- **`CODEX_DECISIONS.md`:** Close Origin scope after full-origin comparison and tests in both account modes. Keep the one-plan call pending the owner confirmations and just-in-time checks above.