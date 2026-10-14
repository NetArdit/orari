## Batch 9 verdict

- **Local-only boundary — accepted by source review.** Memory mode checks the bind address and production mode before starting; the insecure-cookie option is confined to that mode.
- **Outbox retry schedule — accepted.** Five total attempts and the stated delays match the code. The outbox remains in memory.
- **Plan and session identity reuse — accepted by source review.** Deleted plan IDs are retired, and returning sessions retain their revision.
- **PostgreSQL adapter — implemented, verification incomplete.** It remains unconnected; fake contract tests do not establish behavior against real PostgreSQL.
- **Plan sync — accepted as a memory-mode demonstration.** It preserves existing plans, but does not merge same-ID plans or reconcile marks on both devices.
- **Contrast — partial.** Text-token pairs are checked at 4.5:1; non-text contrast at 3:1 and other non-token colours remain unchecked.
- **New plan and Today recovery links — accepted by source review.**
- **Batch verdict: ACCEPTED WITH CONDITIONS.** Claude reports its tests and journeys passed; I did not run them.

## Source that breaks a ruling

The outbox comments in `service.js` and `memoryRepository.js`, and the server restart comment, imply pending mail survives a process restart. The memory adapter loses it on restart; `dev-mail/` does not restore the outbox. Correct those claims in the next batch.

## Next batch

**Safe before a host is chosen:** one consolidated, host-independent batch to design and implement the polled-job lifecycle and durable-outbox contract using the memory adapter, clearly marking restart durability as unimplemented; complete non-text contrast review at 3:1 across both styles and modes; and self-review the Albanian copy, recording candidates for the owner’s later native review. Include focused tests and report exactly what the memory adapter can and cannot verify.

**Owner-dependent:** host and database selection/credentials, a real-PostgreSQL suite, and a real mail provider/sender. The owner’s native Albanian review follows the self-review. Keep timing claims pending measurement through the real storage and HTTP path.

## STATE UPDATE

- **`PROJECT_STATE.md`:** Batch 9 accepted with conditions: local-only safeguards, retry schedule, retired plan IDs, sync demo, and recovery links are implemented by source review. PostgreSQL remains unverified against a real database; sync does not merge same-ID plans or marks; non-text 3:1 contrast and Albanian review remain open. Outbox is memory-only; source comments incorrectly imply restart recovery. Claude-reported checks were not independently run by Codex.
- **`CODEX_DECISIONS.md`:** Record the Batch 9 verdict and conditions above. Authorize the consolidated host-independent polled-job/outbox work with the memory adapter, non-text contrast review, and Albanian self-review. Keep real PostgreSQL, real mail, and timing verification dependent on owner-provided infrastructure; no host choice or connection is authorized.