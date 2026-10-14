# Albanian copy: self-review (Batch 10)

Author: Claude Code, 2026-10-14. Status: **candidates only, not approved copy.** No string was changed in this batch. The owner's native review follows this list (Codex ruling `codex/12`). A machine reading of the source cannot judge naturalness; this list records what reads inconsistent or wrong to the eye, with the place, so the owner can accept or reject each.

Scope read: screens, shared UI, flows, plan form messages, `text.ts`, account screens, and the server messages in `lib/app.js` that reach the screen. Not read line by line: `lib/ai.js` prompts (they instruct the model, the owner does not see them), e-mail bodies.

## A. Likely defects (wrong form for some value; fix is mechanical once the wording is chosen)

| # | Where | What | Candidate |
|---|---|---|---|
| A1 | `AccountScreens.tsx:100,173`, `NewPlanScreen.tsx:87,141` | "Provo përsëri pas {n} sekondash." is wrong for n = 1 | "pas 1 sekonde" / "pas {n} sekondash" |
| A2 | `PlansScreens.tsx:21` | "{n} plan nuk lexohet": the verb and noun do not change with n | "1 plan nuk lexohet" / "{n} plane nuk lexohen" |
| A3 | `AccountScreens.tsx:420,423` | "U dërguan {n} plane" for n = 1 | "U dërgua 1 plan" / "U dërguan {n} plane" |
| A4 | `PlansScreens.tsx:95`, `TodayScreen.tsx:49` | "{n} nga {m} seanca të kryera": with m = 1 "1 seancë" | check the plural for 1 |
| A5 | `AccountScreens.tsx:184,335` | "Të paktën 15 shkronja": the rule counts characters (spaces, digits), not letters | "Të paktën 15 karaktere" |

## B. Gender and register

| # | Where | What | Candidate |
|---|---|---|---|
| B1 | `NewPlanScreen.tsx:78,190`, `TodayScreen.tsx:25` | "kur je e lirë" and "Kur je e lirë" assume a woman | "Kur ke kohë të lirë" |
| B2 | `NewPlanScreen.tsx:239` | "Kohët kur je e zënë", same assumption | "Kur ke angazhime" |
| B3 | `NewPlanScreen.tsx:69`, `TodayScreen.tsx:68`, `PlansScreens.tsx:75` | default profile name "Nxënës" (masculine, and the person is a university student or 16+) | a neutral default, or "Student/e", or no name sent |
| B4 | `AccountScreens.tsx:488` | "Pajisjet ku je i/e kyçur" uses a slash form; nowhere else does | "Pajisjet ku ke hyrë" |
| B5 | `AccountScreens.tsx:488,495` | "kyçur" against "hyrë më …" and "Hyr": two verbs for the same act | one verb for signing in |

## C. Consistency

| # | Where | What | Candidate |
|---|---|---|---|
| C1 | `text.ts:54`, `TodayScreen.tsx:135`, `NewPlanScreen.tsx:124` | contracted "S'e bëra", "S'ka", "s'është" beside "nuk" everywhere else | one register; the contraction is friendly, "nuk" is neutral |
| C2 | `text.ts:43,53` | "Përgjysmë" for a partly done session | "Pjesërisht" |
| C3 | many | "email-i" (with hyphen and definite ending) against "adresa", "e-mail" elsewhere in notes | one spelling |
| C4 | many | "AI" against "inteligjencës artificiale" in the same screen (`NewPlanScreen.tsx:108`, `AccountScreens.tsx:205`) | one term after the first use |
| C5 | `PlansScreens.tsx:41` | "{n} përpara" for sessions still ahead is terse and reads like a direction | "{n} të mbetura" |

## D. Possibly outdated (verify with the owner, then keep or remove)

| # | Where | What |
|---|---|---|
| D1 | `SettingsScreen.tsx:79` | "Llogaritë, për ta hapur edhe në telefon, vijnë më vonë." VERIFIED from source: the line is unconditional (`SettingsScreen.tsx:79`), so it shows even where accounts exist (memory mode, account screens) and contradicts them |
| D2 | `AccountScreens.tsx:59,477` | the memory-mode demonstration notices are accurate for this build (accounts lost on restart); they must be removed or reworded when a database exists |

## E. Not judged

Tone (how formal, how warm), whether "seancë" suits students, headings such as "Si e ndërtuam", the names "Fletore" / "Blloqe", and every string the model writes (strategy, explanations, session titles), which vary per call and cannot be reviewed as fixed copy.

## Method and limits

Read from source with a search for user-facing strings; every row cites a line that existed on this date. NOT TESTED in a browser. Not verified by a native speaker.
