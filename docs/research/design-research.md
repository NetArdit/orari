# Batch 6, deliverable 2: design research

Collected 2026-10-14, about 01:11 UTC, in headless Edge at a 1280 px viewport, from the public home pages of six products. Screenshots of three are kept in `docs/research/shots/`.

## 0. What this evidence is, and is not

**This is thin, and it should be read as a first pass.** What was captured is marketing home pages, which show how products present themselves, not how they behave. No in-app screen was seen, no interaction was exercised, and nothing was measured on a phone width. Several captures were unusable. The patterns below are therefore labelled OBSERVED (visible in a capture), STATED (written in a page's own text) or INFERRED (my reading); no pattern is presented as proven to work for students.

| Product | Capture | Usable? |
|---|---|---|
| MyStudyLife (mystudylife.com) | home page | yes |
| Shovel (shovelapp.io) | home page | yes |
| Todoist (todoist.com) | home page | yes (a general task app, not student-specific) |
| Structured (structured.app) | hero is a full-screen lifestyle video; no product visible | no |
| Tiimo (tiimoapp.com) | a cookie-consent wall covered the page | no |
| Quizlet (quizlet.com/features/flashcards) | 30 KB capture, effectively blank | no |

The next step for this research is in-app evidence: each product's help-centre articles and public demo videos, which show the real screens, and a recorded walk through a free account of one or two of them at phone width.

## 1. What was observed

**MyStudyLife** (`shots/mystudylife.png`). STATED: "The free student planner that keeps school life organised"; classes, homework, exams and revision in one calendar; rotating and block timetables; reminders before classes, deadlines and exams; web, iPhone and Android synced; "Scout", an AI study coach. Onboarding is stated as three steps: create a free account, add your timetable ("type your classes or snap a photo"), get reminders. OBSERVED: calm blue and white, one accent, large plain headline, device mock-ups showing a schedule list on the phone and a table on the desktop; a cookie banner whose first sentence is that the company never sells user data.

**Shovel** (`shots/shovel.png`). STATED: "Upload your PDF syllabus. Set up your semester in seconds"; sync with Canvas, Brightspace, Moodle, Google Classroom; "Turn DUE dates into DO dates"; "Enough Cushion", a feature that keeps slack in the schedule; "Me Time" blocks. OBSERVED: illustrated, pastel, playful; the product picture shows a week grid with a task chip ("Read Chapter 3, 45m") being dragged onto a free slot, and a phone with a day view.

**Todoist** (`shots/todoist.png`). STATED: capture tasks "at the speed of thought" in "easy-flowing, natural language"; sort into Today, Upcoming or custom filters; voice capture. OBSERVED: a Today list is the first screen shown; very low density; one red accent; example task text "Write agenda for Monday's meeting tomorrow #Website Update +Paul" being parsed into a date, a project and a person.

## 2. Patterns worth considering for Orari

Each with its basis and its honest limit.

1. **Today is the first screen, and it shows one next thing.** OBSERVED in Todoist and in both MyStudyLife and Shovel's phone mock-ups. Orari already has `nextSession` and `todayAgenda`. Limit: I have not seen how these products handle "nothing today" or "behind schedule".
2. **Say how much slack there is.** STATED by Shovel ("Enough Cushion"). It matches Orari's own prompt rule of not filling every free minute, and gives a way to explain why the timetable is not packed. Limit: how Shovel computes or shows it was not visible.
3. **Natural-language capture with the parse visible.** Todoist shows its parse; Orari's confirm step already does this and goes further by making free and busy time editable. INFERRED: this is a strength worth keeping prominent.
4. **A syllabus or PDF as an input.** STATED by Shovel as a new feature. This is the owner's request of 2026-10-14 (Phase 4); the capture confirms there is demand in the category. Limit: no evidence on accuracy or how errors are corrected.
5. **A phone-first day view and a table-like week on a wide screen**, as both MyStudyLife and Shovel's mock-ups show. Orari's mock-ups already do this.
6. **Sign-up in a few steps, with the timetable as step two.** STATED by MyStudyLife. For Orari the equivalent is: account, then the first plan, with nothing else in between.

## 3. Patterns to avoid, with reasons

- **Illustration-heavy pastel hero art** (Shovel). INFERRED: it is the look the owner calls generic. The product is the interesting part of a planner; show it.
- **Statistics and press-logo strips as the main persuasion** (MyStudyLife, Todoist). Orari has no audience numbers and should not imitate the form.
- **Consent walls and video heroes that hide the product** (Tiimo, Structured, as captured). They cost load time and told this research nothing; the first view should show the product.
- **Reminders as a headline feature.** All three promise them. Real push reminders on the web need a service worker and a push service; that is feasible at zero cost but is its own piece of work with consent and delivery problems, so it should be decided, not assumed.

## 4. Accessibility and performance implications

- Both styles must keep the contrast and 44 px target rules already in the mock-ups; the Fletore colours were computed to AA by Codex, Blloqe's were chosen by eye and still need computing.
- A first-load budget is proposed in section 6.

## 5. How this relates to the two existing directions

Nothing observed argues for dropping either direction, and the evidence is too thin to justify redesigning them from it. What it does suggest:

- **Fletore**: add the "slack" statement to Today; keep the ruled time margin, which none of the captured products have and which is the most distinctive thing in either direction.
- **Blloqe**: its coloured blocks resemble the week grid in Shovel's picture; the point of difference is monospaced, tabular time and the large next-start time, so keep those and avoid pastel fills.
- **Both**: a visible "N minutes of slack today" line; the parse preview as the way into planning; no illustration.

**The mock-ups were not rebuilt in this batch.** The evidence above would change them very little, and rebuilding them on it would give the appearance of research that did not happen. Recommendation: do the in-app evidence pass (section 0) first, then revise both directions once, from that.

## 6. Settings, names and the first-load budget

- Stored values (Codex ruling): `layoutStyle: notebook | blocks`, `colorMode: system | light | dark`. Default: notebook and system.
- Display names: the owner suggested colour names ("kafe", "blu"). My recommendation: **layout: "Fletore" and "Tabelë"** (they describe how time is drawn, which is what differs), **mode: "Si pajisja", "E çelët", "E errët"**. Codex proposed "Blloqe" for the second; "Tabelë" is more accurate to the monospaced-time-board design, and the owner's own word for it in conversation was "tabelë". Either is a display string only.
- **First-load budget (proposal)**: on a mid-range phone over a throttled 4G profile (about 1.6 Mbps down, 150 ms latency), the Today screen interactive in 2.5 s or less on a cold cache and 1 s or less on a warm one, with at most 200 kB gzip of JavaScript (Codex's ruling) and no font over 40 kB blocking first paint (system fonts first). Measured by a CDP journey with network throttling in headless Edge, run in `e2e/`. Not yet built; the current bundle is 87 kB gzip.
