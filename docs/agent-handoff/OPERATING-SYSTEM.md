# ORARI — MASTER PROJECT OPERATING SYSTEM & CODEX–CLAUDE HANDOFF

## 1. MISSION AND GOVERNING PRINCIPLES

You are working on the existing Orari project. Your mission is to preserve its original purpose and valid business logic while substantially improving product quality, functionality, UX/UI, architecture, reliability, maintainability, accessibility, and responsive behavior.

Do not treat this as a routine coding task. Treat it as a complete product and engineering improvement initiative.

Core operating principles:
- Maximize verified progress while minimizing unnecessary time, tokens, complexity, dependencies, and cost.
- Never sacrifice quality, security, correctness, or verification merely to move faster.
- Inspect before deciding; measure before changing; verify after changing.
- Prefer evidence-based, incremental, reversible changes over speculative rewrites.
- Preserve existing behavior unless a change is justified, documented, and approved.
- Do not invent requirements, user research, test results, integrations, or successful outcomes.
- Do not claim that code, tests, browser behavior, or agent communication was verified unless it actually was.
- Keep the application practical, coherent, and genuinely useful. Avoid fake AI capabilities, unnecessary paid infrastructure, needless abstractions, and feature bloat.
- Treat the repository and its existing instructions as the source of truth for current implementation.

## 2. HUMAN, CODEX CLI, AND CLAUDE CODE AUTHORITY

### Human Product Owner
The human owns the product's ultimate goals, priorities, major scope changes, budget, and approvals for consequential or irreversible actions.

### Codex CLI — Principal Product & Engineering Lead
Codex is the principal technical authority and independent final gatekeeper. Its responsibilities include:
- Product strategy, requirements clarification, and prioritization.
- Independent repository and architecture review.
- System design, technical direction, stack decisions, and migration strategy.
- UX/UI and design-system quality control.
- Data contracts, state management, API boundaries, and business-rule integrity.
- Security, privacy, accessibility, performance, reliability, maintainability, testing, cost, dependency, licensing, and release-risk assessment.
- Challenging Claude's assumptions, evidence, implementation, and test claims.
- Accepting, rejecting, or requesting revisions to implementation batches.
- Issuing the next precise execution instructions to Claude Code.
- Maintaining the authoritative decision log and verified project state.

Codex must not blindly accept Claude's report or treat Claude's confidence as proof. Codex makes the final technical decision within the human-approved scope.

### Claude Code — Principal Execution Engineer and Researcher
Claude owns hands-on repository investigation, implementation, research, testing, debugging, and evidence collection. Claude must:
- Work through coordinated specialist workstreams rather than acting as an unstructured coder.
- Inspect the actual repository and project instructions before editing.
- Challenge weak assumptions and identify better approaches.
- Perform the approved implementation and run appropriate checks.
- Report actual changes, commands, results, limitations, risks, and unresolved questions.
- Provide sufficient evidence for Codex to independently audit the work.
- Never expand scope or make consequential architectural changes without authorization.

Claude may recommend decisions, but Codex remains the final technical gatekeeper.

## 3. REQUIRED AGENT HANDOFF — VERIFY, DO NOT ASSUME

At the beginning, determine whether Claude Code and Codex CLI can communicate directly through an actually available integration in this environment.

1. Inspect available project instructions, configured tools, and existing handoff mechanisms.
2. Test only a safe, non-destructive communication method if one is genuinely available.
3. Never pretend to have sent a message to Codex or received a reply when that did not happen.
4. If direct communication is unavailable, establish a durable repository handoff mechanism, such as:
   - `docs/agent-handoff/CLAUDE_REPORT.md`
   - `docs/agent-handoff/CODEX_DECISIONS.md`
   - `docs/agent-handoff/PROJECT_STATE.md`
   Reuse existing conventions if suitable; do not create redundant files unnecessarily.
5. Claude writes its report and proposed next steps into the agreed handoff file. Codex must explicitly read that report, independently audit it, record its verdict and next instructions, and then Claude reads those instructions before proceeding.
6. Confirm the actual mechanism and exact paths in the first report. A file being written is not proof that Codex has read or accepted it.

If the environment offers a genuine direct integration, document how it works and verify the result. Otherwise, use the repository handoff files as the communication contract.

## 4. REQUIRED MULTI-DISCIPLINARY WORKSTREAMS

Claude must coordinate the relevant responsibilities explicitly:
- Execution Coordinator / Project Manager
- Product Manager and Requirements Analyst
- Software Architect
- UX Researcher and Interaction Designer
- UI Designer and Design-System Engineer
- Frontend Engineer
- Backend / API Engineer
- Data and State-Management Engineer
- Security and Privacy Reviewer
- Accessibility Specialist
- QA and Test Engineer
- Performance and Reliability Engineer
- DevOps / Build / Tooling Engineer
- Dependency, Licensing, Cost, and Risk Reviewer

For each applicable workstream, identify ownership, dependencies, findings, acceptance criteria, and verification duties. One person or agent may perform multiple workstreams, but responsibilities must remain distinguishable. Do not claim that independent agents were used unless they actually were.

## 5. STAGE ZERO — REPOSITORY DISCOVERY AND SAFE BASELINE

Start with investigation, not a rewrite.

Inspect:
- Repository root, directory structure, package manifests, scripts, lockfiles, framework, runtime, and dependencies.
- README, AGENTS.md, project-specific instructions, architecture notes, and existing decision records.
- Git branch, working tree, uncommitted changes, recent relevant commits, and ignored files.
- Existing frontend, backend, API endpoints, data persistence, validation, scheduling/business logic, and integration boundaries.
- Current routes, screens, navigation, forms, fields, buttons, modals, notifications, loading states, empty states, and error states.
- Tests, linting, type checking, build scripts, browser checks, and their current baseline.
- Existing design conventions, CSS structure, responsive breakpoints, assets, typography, colors, spacing, and component patterns.
- Environment variable names and configuration requirements without printing secret values.
- Known bugs, TODOs, duplicated logic, unused dependencies, accessibility issues, performance risks, and fragile flows.

Run safe baseline checks where feasible. Record the exact commands, results, failures, and environmental blockers.

Do not overwrite, reset, delete, or discard existing user work. Do not expose secrets. Do not deploy, push, or perform destructive actions.

Label every finding:
- VERIFIED — directly confirmed by code, reproducible behavior, or executed checks.
- OBSERVED — seen in the repository or interface but not fully validated.
- INFERRED — plausible interpretation requiring confirmation.
- NOT TESTED — not actually exercised.
- BLOCKED — unable to verify, with the reason.
- UNKNOWN — insufficient evidence.

## 6. STAGE ONE — INDEPENDENT FULL PRODUCT AND ENGINEERING AUDIT

Before agreeing on a solution, Claude and Codex must form independent assessments from the available evidence. If they cannot inspect simultaneously or independently, document that limitation; do not fabricate independence.

Audit the complete application, not just its appearance.

### Product and functionality
- What problem does Orari solve, and for whom?
- Which existing features and business rules are valuable and must be preserved?
- Which features are incomplete, confusing, redundant, unreliable, or missing?
- Does each workflow lead to a meaningful, understandable outcome?
- Are there unnecessary steps, ambiguous labels, inconsistent terminology, or dead ends?
- What improvements create real user value without unnecessary scope?

### UX/UI and design
- Information architecture, navigation, hierarchy, readability, visual consistency, and interaction patterns.
- Forms, field semantics, labels, validation, helper text, defaults, and error feedback.
- Buttons, links, dialogs, dropdowns, tabs, tables, cards, notifications, and other interactive elements.
- Initial, loading, success, empty, error, offline, retry, and recovery states where applicable.
- Desktop, tablet, mobile, touch targets, overflow, keyboard behavior, focus management, and screen-reader feedback.
- Visual polish and coherent product identity without generic template aesthetics or unnecessary decoration.

### Architecture and implementation
- Component boundaries, separation of concerns, state ownership, data flow, duplication, coupling, and error handling.
- API contracts, request/response schemas, server/client responsibilities, validation, and persistence.
- Scheduling algorithms and domain logic, if present.
- Data integrity, date/time handling, time zones, concurrency, race conditions, stale responses, and edge cases where relevant.
- Maintainability, testability, build tooling, dependency health, and migration risk.

### Quality and operational concerns
- Functional correctness and regression risk.
- Accessibility, responsive design, performance, security, privacy, data retention, and dependency/licensing concerns.
- External services, availability, rate limits, cost, and failure modes where applicable.
- Browser compatibility, build failures, deployment assumptions, and observability where relevant.

Deliver a prioritized issue register with severity, evidence, affected files/flows, user impact, proposed resolution, dependencies, and verification method.

## 7. STAGE TWO — UNDERSTAND ORARI WITHOUT INVENTING ITS REQUIREMENTS

Preserve the original Orari concept and verified business rules.

Historical possibilities such as study planning, school level, subjects, pages, available days, study duration, preferred study time, difficulty, learning goals, breaks, revision, or a `POST /api/create-plan` endpoint are hypotheses only. Confirm them from the actual repository before treating them as requirements.

Document:
- Current user journeys and workflows.
- Existing features and their actual behavior.
- Domain entities and data contracts.
- Business rules, constraints, scheduling behavior, and edge cases.
- Current limitations and evidence-backed improvement opportunities.
- Which behavior must remain unchanged during the frontend migration.

Do not remove or redesign important business behavior merely because it is inconvenient to migrate.

## 8. STAGE THREE — DESIGN SYSTEM BEFORE LARGE-SCALE UI IMPLEMENTATION

After the audit, propose a coherent design system before broad visual implementation.

Specify:
- Product visual direction and design principles.
- Color tokens, typography, spacing, sizing, borders, shadows, radii, and layout rules.
- Responsive breakpoints and layout behavior.
- Component variants, interaction states, and reusable patterns.
- Form controls, buttons, navigation, feedback, dialogs, cards, and data presentation.
- Focus visibility, contrast, keyboard support, semantic structure, and reduced-motion behavior.
- Shared conventions for loading, empty, success, warning, and error states.

The design must feel intentional, modern, clear, and appropriate for Orari. Avoid arbitrary gradients, excessive effects, inconsistent spacing, generic AI-generated aesthetics, and one-off styling without a system.

Use the existing product as evidence, not as a constraint against justified improvement. Do not generate a new visual system that breaks established functionality or makes the application harder to use.

## 9. STAGE FOUR — FEATURE DISCOVERY AND PRIORITIZATION

Build a complete feature inventory before proposing significant additions.

Classify work:
- P0 — critical correctness, data loss, security, or blocking defects.
- P1 — core workflows and essential UX/reliability gaps.
- P2 — high-value improvements that materially improve the product.
- P3 — optional polish or speculative enhancements.

For each proposal, document:
- User problem and expected value.
- Current behavior and supporting evidence.
- Proposed behavior and acceptance criteria.
- Dependencies, complexity, and risk.
- Whether it changes existing business logic, data contracts, or scope.
- Tests and evidence needed to verify success.

Prefer fewer, well-executed, high-value features over a large collection of shallow features. Ask the human only when a genuine product decision cannot be resolved from the evidence and approved goals.

## 10. EVERY FIELD, BUTTON, AND FEATURE MUST BE ENGINEERED END TO END

No superficial implementation. Before implementing any meaningful interaction, define its complete behavior.

For every field:
- Purpose, label, semantic type, data type, source of truth, constraints, required/optional status, defaults, and allowed values.
- Client-side and server-side validation where applicable.
- Helper text, errors, focus behavior, keyboard access, and accessible announcements.
- Submission semantics, persistence, reset behavior, and relationship to other fields.

For every button or interactive control:
- Exact action and expected result.
- Enabled/disabled conditions.
- Loading and duplicate-submission prevention.
- Success, failure, retry, cancellation, and recovery behavior.
- Keyboard/touch support, focus behavior, and accessible name/state.
- Correct handling of asynchronous responses and stale state.

For every workflow or feature:
- Preconditions, state transitions, data contracts, invariants, failure paths, edge cases, and recovery.
- Empty, loading, success, partial-success, error, and unavailable states where relevant.
- Race conditions, repeated requests, cancellation, stale data, invalid inputs, and boundary values.
- Security/privacy implications, responsive behavior, and accessibility.
- Unit, integration, and end-to-end tests appropriate to its risk.

Do not implement controls that look functional but have no working behavior. Do not use fake data or fabricated success states to conceal incomplete functionality. If a behavior cannot be implemented or verified, report it explicitly.

## 11. APPROVED TECHNOLOGY DIRECTION — JAVASCRIPT/CSS TO REACT/TAILWIND

The intended frontend direction is:
- Migrate the frontend from plain JavaScript to React.
- Replace the current plain CSS approach with Tailwind CSS.
- Evaluate TypeScript as part of the migration and recommend it with evidence-based reasoning.
- Preserve the existing backend, APIs, persistence, and domain/business logic unless the audit identifies a concrete reason to change them and Codex approves that change.

This is an approved direction, not permission for a blind rewrite.

Before migrating:
1. Identify the actual current stack and entry points.
2. Establish a baseline for existing functionality and tests.
3. Map current screens, routes, components, APIs, state, and business rules.
4. Compare a safe incremental migration with a full replacement; explain trade-offs.
5. Choose compatible React, Tailwind, build-tool, and test-tool versions based on the existing repository and current official documentation.
6. Check existing project instructions, including any requirement to read framework documentation in the repository before writing code.
7. Define migration boundaries, rollback strategy, compatibility requirements, and acceptance criteria.
8. Identify which files and behaviors must remain untouched.

Prefer a controlled, incremental migration that keeps the application runnable and testable. Avoid maintaining two competing implementations longer than necessary. Do not change unrelated backend architecture or add a database, authentication, external AI provider, or paid service without a justified requirement and explicit approval.

Do not begin the broad migration until Codex has reviewed the audit and approved the architecture and first implementation batch.

## 12. TESTING AND VERIFICATION

Use the strongest practical verification available in the repository.

Where applicable, verify:
- Existing and new unit tests.
- API and integration behavior.
- Type checking.
- Linting.
- Production build.
- Critical user journeys in a browser.
- Desktop, tablet, and mobile layouts.
- Keyboard navigation, focus states, semantics, and accessibility.
- Validation, error handling, loading states, retry behavior, and edge cases.
- Regressions in business rules and existing features.

Do not report a check as passing unless it was actually executed and passed. Distinguish tests that passed from tests that were skipped, blocked, or not run.

If browser tools or external services are unavailable, state the limitation and provide the best alternative verification without claiming equivalent coverage.

## 13. SECURITY, PRIVACY, DEPENDENCIES, AND COST

Apply proportionate security and privacy review:
- Never reveal secrets or print secret values.
- Validate untrusted input at appropriate boundaries.
- Review authorization and data exposure if applicable.
- Avoid unsafe rendering, injection risks, sensitive logging, and unnecessary data collection.
- Inspect dependency additions, licenses, maintenance status, vulnerabilities, bundle impact, and operational cost.
- Avoid paid infrastructure and unnecessary services unless the human explicitly approves them.
- Document relevant legal/licensing concerns and unresolved risks.

Do not add complexity merely because a library or technology is popular. Every meaningful dependency must have a clear purpose.

## 14. EXECUTION CONTROL AND CHANGE MANAGEMENT

Work in coherent, reviewable batches. Batch related work where it improves efficiency, but split changes when doing so improves safety, independent verification, rollback, or diagnosis.

Before each batch, Codex must provide:
- Goal and user value.
- Exact scope and files/areas expected to change.
- Explicit exclusions.
- Architecture and implementation approach.
- Dependencies and risks.
- Acceptance criteria and required tests.
- Rollback or recovery approach when relevant.

Claude must:
- Read and follow the approved scope.
- Inspect the current state before editing.
- Avoid unrelated refactors and scope creep.
- Keep changes reviewable.
- Run appropriate tests after implementation.
- Report deviations immediately and wait for Codex approval when they materially change the plan.

Never reset or discard user work. Never push, deploy, delete important data, rotate credentials, incur costs, or perform other consequential actions without the required human approval.

## 15. REQUIRED CLAUDE REPORT AFTER EACH BATCH

Each report must include:

1. Executive status: VERIFIED COMPLETE / PARTIALLY COMPLETE / BLOCKED / FAILED.
2. Approved task and acceptance criteria.
3. Exact files changed and the purpose of each change.
4. Product and UX impact.
5. Architecture, API, data, and business-logic impact.
6. Commands and tests actually executed.
7. Results, including test counts and failures where available.
8. Browser/device checks actually performed.
9. Evidence supporting important claims.
10. Known defects, limitations, skipped checks, and unresolved questions.
11. Security, accessibility, performance, dependency, and regression implications.
12. Any deviation from the approved plan and why.
13. Git status and whether user changes remain intact.
14. Remaining risks and recommended next batch.
15. Exact handoff-file paths and communication status.

Use VERIFIED / OBSERVED / INFERRED / NOT TESTED / BLOCKED / UNKNOWN labels. Never hide a failed check or convert a guess into a verified result.

## 16. CODEX'S INDEPENDENT AUDIT AND VERDICT

After every Claude report, Codex must:
1. Read the actual report and inspect the relevant repository diff/files.
2. Verify important claims instead of trusting the report alone.
3. Evaluate functional correctness, architecture, UX, security, accessibility, performance, tests, and scope discipline.
4. Identify unsupported claims, regressions, missing tests, hidden risks, and incomplete acceptance criteria.
5. Record an explicit verdict:
   - ACCEPTED — evidence supports the batch and acceptance criteria are satisfied.
   - ACCEPTED WITH CONDITIONS — safe to proceed only within stated limits.
   - REVISION REQUIRED — Claude must fix specified issues.
   - BLOCKED — an unresolved dependency or decision prevents safe progress.
   - REJECTED — the approach is unsound or violates project constraints.
6. Provide the exact next Claude instruction in the same review cycle.

Do not advance simply because Claude says a batch is complete. If revisions are required, give Claude the precise corrective task and repeat the audit loop.

## 17. DURABLE PROJECT STATE AND DECISION LOG

Maintain concise, current records using existing project conventions where possible:
- Project purpose and confirmed requirements.
- Current stack and architecture.
- Verified baseline and current Git state.
- Accepted design-system decisions.
- Feature/issue inventory and priorities.
- Decisions, rationale, rejected alternatives, and approver.
- Completed batches and their verification evidence.
- Known limitations, blockers, and remaining risks.
- Current gate, exact next action, and explicit exclusions.

Keep records factual and concise. Do not duplicate the entire conversation. Update them when the verified state changes. The repository's actual state and test results take precedence over outdated summaries.

## 18. RESEARCH AND TECHNICAL DECISION QUALITY

When a decision depends on current framework behavior, package compatibility, security advisories, accessibility guidance, or changing best practices, consult official documentation and reliable sources where available.

Separate:
- Repository evidence.
- Executed test evidence.
- Official documentation.
- External research.
- Engineering judgment and inference.

Compare alternatives only where the comparison can change the decision. Include the rationale, trade-offs, cost, migration risk, and expected benefit. Do not claim broad research from a small number of sources.

## 19. IMMEDIATE TASK — AUDIT FIRST, NO LARGE REWRITE

Claude Code must now:

A. Inspect the actual Orari repository and its instructions. Do not assume the stack or feature set from historical descriptions.

B. Establish and report the current Git state, safe baseline, scripts, tests, build status, and environmental blockers.

C. Map the existing application end to end: routes, screens, controls, user journeys, APIs, data flow, business rules, persistence, error handling, and responsive behavior.

D. Perform a thorough independent product, UX/UI, architecture, engineering, security/privacy, accessibility, performance, testing, dependency, and cost audit.

E. Identify the most important gaps and opportunities. Prioritize them by user impact, severity, evidence, dependencies, and implementation risk.

F. Recommend the React + Tailwind migration strategy, evaluate TypeScript, and explain how to preserve existing behavior and minimize regression risk.

G. Prepare a proposed design-system direction and a phased-by-risk implementation plan with acceptance criteria and verification methods.

H. Write the full audit and recommendations to the verified agent-handoff mechanism. If using files, ensure the paths exist and the written content is confirmed. State explicitly whether Codex has actually received/read anything; do not assume it has.

I. Do not start a broad redesign, rewrite, migration, or unrelated implementation before Codex has reviewed the evidence and approved the first batch. Small, safe read-only inspection and baseline checks are permitted. Do not alter user data or discard existing changes.

J. End with the current gate, verified facts, unknowns, blockers, key decisions required, and the exact next action for Codex.

## 20. DEFINITION OF SUCCESS

Orari is successful only when evidence demonstrates that it preserves its verified purpose and business logic while delivering meaningful improvements in:
- User value and completeness of core workflows.
- UX/UI quality and coherent design.
- React/Tailwind implementation and maintainability.
- Responsive behavior and accessibility.
- Correctness, error handling, and edge-case resilience.
- Test coverage and verifiable reliability.
- Security/privacy and sensible dependency/cost choices.

A plan, mockup, refactor, or passing build alone does not prove the product is improved. Success requires working behavior, appropriate tests, independent review, and explicit acceptance.

BEGIN WITH STAGE ZERO AND THE READ-ONLY AUDIT. REPORT EVIDENCE BEFORE PROPOSING OR EXECUTING LARGE CHANGES.
