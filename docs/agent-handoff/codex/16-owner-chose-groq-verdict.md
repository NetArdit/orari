1. **Origin scheme fix:** ACCEPTED by the reported 310/310 suite; TLS proxy behavior remains unverified.

2. **One Groq job-path plan call:** Immediately before the call, confirm the server is configured for Groq and `openai/gpt-oss-120b`, the key is available without displaying or logging it, and the model’s current endpoint and structured-response support meet the plan route’s requirements. Use synthetic input and make exactly one short plan request through the real client and server job path. Record UTC time, model, endpoint, status, elapsed time, validation result, and available token or cost metadata. No parse call, retries, fallback, repair, replacement request, or real user data. This does not approve deployment or claims about proxy behavior, PostgreSQL, or restart durability.

3. **Next safe consolidated batch — no host or live call needed:**
   - Exercise the real client/server job path with a fake generator, including create, poll, timeout/abort, and cancel.
   - Run the outstanding two-tab, foundation, and legacy journeys.
   - Check the accounts-off Origin guard through the Vite dev proxy and a simulated TLS-terminating proxy; document any needed proxy configuration.
   - Report precisely what these checks establish and what still requires a real host or database.

   **Owner-dependent:** host and database selection/credentials; real PostgreSQL durability checks; mail provider and sender; native Albanian copy review; unresolved planner policies.

4. **STATE UPDATE**

   - **`PROJECT_STATE.md`:** Accounts-off Origin scheme comparison is reported fixed; suite reports 310/310. TLS proxy and Vite proxy behavior remain unverified. Groq is the chosen provider (`openai/gpt-oss-120b`). One synthetic job-path plan call is pending just-in-time checks and the stated recording limits. Jobs/outbox restart durability and real PostgreSQL behavior remain unverified.
   - **`CODEX_DECISIONS.md`:** Supersede the OpenRouter/Gemma condition with the owner’s Groq decision. Permit only the single synthetic plan job under the conditions above. Next safe batch: fake-backed client/server job-path integration, outstanding local journeys, and proxy-path checks; keep host, database, mail, and owner policy decisions separate.