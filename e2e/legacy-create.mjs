/**
 * Journey on the existing page (public/): creating a plan, by the guided form and by free text.
 * It records what the page sends and stores today, so the new client can be held to the same behaviour.
 *
 *   PORT=3987 OPENROUTER_API_KEY= node server.js        (in another terminal)
 *   node e2e/legacy-create.mjs [baseUrl]
 *
 * fetch for the AI routes is replaced inside the page by canned answers: no AI is called and the
 * server's AI routes are not reached. Result: e2e/results/legacy-create.json. Exit code 1 on any failure.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser, isoDay, sleep } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const START = isoDay(1);
const END = isoDay(8);

const user = {
    id: "user-create-1", name: "Testuese", email: "create@example.test", password: "synthetic",
    educationLevel: "university", school: "", plans: [], createdAt: new Date().toISOString(),
};

const session = (id, dayOffset, startTime, endTime, title) => ({
    id, status: "pending", date: isoDay(dayOffset), startTime, endTime, type: "learning", title, goal: "Qëllimi", tasks: ["Detyra 1"], material: null, difficulty: "medium",
});

const PLAN_ANSWER = {
    profile: { name: "Testuese" }, subject: "Matematikë", startDate: START, endDate: END, planMode: "exam",
    strategy: "Strategjia", explanations: ["Sepse"], warnings: ["Kujdes"],
    stats: { totalSessions: 2, totalMinutes: 120, totalHours: 2 },
    sessions: [session("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, "08:00", "09:00", "E para"), session("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2, "08:00", "09:00", "E dyta")],
};

const PARSED = {
    startDate: START, endDate: END, subject: "JavaScript", materialAmount: "Kapitujt 1-3", goal: "Bazat", planMode: "skill",
    weeklyAvailability: [{ day: "mon", off: false, windows: [{ start: "08:00", end: "10:00" }] }, { day: "sun", off: true, windows: [] }],
    commitments: [{ label: "Puna", type: "work", days: ["mon", "tue"], dates: null, start: "10:00", end: "18:00" }],
    sessionPreferenceMinutes: 45, energy: { morning: "high", afternoon: null, evening: "low" }, difficulty: "hard",
    clarifyingQuestions: ["A ke pushim dreke?"],
};

// Runs in the page before its own script.
const PAGE_STUBS = `
    window.__sent = { create: [], parse: [] };
    window.__alerts = [];
    window.__createAnswer = { status: 200, body: ${JSON.stringify(PLAN_ANSWER)} };
    window.alert = (message) => { window.__alerts.push(String(message)); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
        const path = String(url);
        const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        if (path.endsWith("/api/create-plan")) {
            window.__sent.create.push(JSON.parse(options.body));
            return json(window.__createAnswer.status, window.__createAnswer.body);
        }
        if (path.endsWith("/api/parse")) {
            window.__sent.parse.push(JSON.parse(options.body));
            return json(200, { parsed: ${JSON.stringify(PARSED)} });
        }
        return realFetch(url, options);
    };
`;

const browser = await openBrowser({ debugPort: 9353, initScript: PAGE_STUBS });
const { evaluate, goto, waitFor, check } = browser;

const storedPlans = () => evaluate(`JSON.parse(localStorage.getItem("studyflow_current_user")).plans`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setValue = (id, value) => evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);

await browser.run(async () => {
    browser.result.base = BASE;
    await goto(BASE + "/");
    const seeded = JSON.stringify(user);
    await evaluate(`localStorage.setItem("studyflow_users", ${JSON.stringify("[" + seeded + "]")}); localStorage.setItem("studyflow_current_user", ${JSON.stringify(seeded)});`);
    await goto(BASE + "/");
    await evaluate(`document.querySelector('.nav-item[data-page="planner"]').click()`);
    await sleep(200);

    /* ---------- 1. Guided form ---------- */
    await evaluate(`document.getElementById("modeToggleForm").click()`);
    await setValue("f_subject", "  Matematikë  ");
    await setValue("f_material", "Kapitujt 3-5");
    await setValue("f_planMode", "exam");
    await setValue("f_difficulty", "hard");
    await setValue("f_startDate", START);
    await setValue("f_endDate", END);
    await setValue("f_sessionLength", "50");
    await setValue("f_energyMorning", "high");
    await setValue("f_energyEvening", "low");
    await evaluate(`(() => {
        const row = (day) => document.querySelector('#availabilityGrid .availability-row[data-day="' + day + '"]');
        row("mon").querySelector(".avail-windows").value = "08:00-10:00, 20:00-21:00";
        row("tue").querySelector(".avail-windows").value = "nonsense, 18:00-19:00";
        row("sun").querySelector(".avail-off").checked = true;
        const commitment = document.querySelector("#commitmentsList .commitment-row");
        commitment.querySelector(".c-days").value = "mon, TUE, xyz";
        document.getElementById("addCommitmentButton").click();
        const second = document.querySelectorAll("#commitmentsList .commitment-row")[1];
        second.querySelector(".c-label").value = "Gjysmë i plotësuar";
    })()`);
    await evaluate(`document.getElementById("plannerForm").requestSubmit()`);
    await waitFor(`window.__sent.create.length === 1`, "the create request from the form");
    await waitFor(`!document.getElementById("aiResult").classList.contains("hidden")`, "the result panel");

    const formRequest = await evaluate(`window.__sent.create[0]`);
    const expectedStructured = {
        startDate: START, endDate: END, subject: "Matematikë",
        materialAmount: "Kapitujt 3-5", goal: "Kapitujt 3-5", // the form writes one field into both
        planMode: "exam",
        weeklyAvailability: [
            { day: "mon", off: false, windows: [{ start: "08:00", end: "10:00" }, { start: "20:00", end: "21:00" }] },
            { day: "tue", off: false, windows: [{ start: "18:00", end: "19:00" }] }, // "nonsense" is dropped without a word
            { day: "sun", off: true, windows: [] },
        ],
        commitments: [{ label: "Punë/Shkollë", type: "work", days: ["mon", "tue"], dates: null, start: "09:00", end: "17:00" }], // "xyz" dropped; the half-filled row is dropped
        unavailableDates: [], sessionPreferenceMinutes: 50,
        energy: { morning: "high", afternoon: null, evening: "low" },
        difficulty: "hard",
    };
    check("form: the request carries the profile name and education level", same(formRequest.profile, { name: "Testuese", educationLevel: "university" }), formRequest.profile);
    check("form: the request's plan inputs are exactly what was entered", same(formRequest.structured, expectedStructured), { sent: formRequest.structured, expected: expectedStructured });

    let plans = await storedPlans();
    check("form: one plan is stored", plans.length === 1, plans.length);
    const saved = plans[0] ?? {};
    check("form: the stored plan keeps the inputs it was made from", same(saved.structured, expectedStructured), saved.structured);
    check("form: the stored plan holds the server's answer", saved.subject === "Matematikë" && saved.strategy === "Strategjia" && same(saved.stats, PLAN_ANSWER.stats) && same(saved.warnings, ["Kujdes"]), saved);
    check("form: the plan gets its own id and creation time", typeof saved.id === "string" && saved.id.length > 10 && !Number.isNaN(Date.parse(saved.createdAt)), { id: saved.id, createdAt: saved.createdAt });
    check("form: sessions are stored as sent, pending", same(saved.sessions, PLAN_ANSWER.sessions), saved.sessions);
    check("form: the result shows the subject and both sessions", await evaluate(`document.getElementById("resultSubjectTitle").textContent === "Orari yt - Matematikë" && document.querySelectorAll("#schedule .schedule-card").length === 2`));
    check("form: the warning is shown", await evaluate(`document.getElementById("warningsBox").textContent.includes("Kujdes")`));
    check("form: no alert", (await evaluate(`window.__alerts.length`)) === 0, await evaluate(`window.__alerts`));
    check("form: the button is usable again with its label back", await evaluate(`!document.getElementById("createPlanButton").disabled && document.getElementById("createPlanText").textContent.trim() === "Krijo plan me AI"`));

    /* ---------- 2. A refused request stores nothing ---------- */
    await evaluate(`window.__createAnswer = { status: 400, body: { error: "Datat e planit nuk janë valide.", fields: [{ path: "structured.endDate", message: "Data nuk është e vlefshme." }] } }`);
    await evaluate(`document.getElementById("plannerForm").requestSubmit()`);
    await waitFor(`window.__alerts.length === 1`, "the error message");
    check("refused: the server's message is shown", (await evaluate(`window.__alerts[0]`)) === "Datat e planit nuk janë valide.", await evaluate(`window.__alerts`));
    check("refused: no plan is added", (await storedPlans()).length === 1);
    check("refused: what was typed is still in the form", (await evaluate(`document.getElementById("f_subject").value`)) === "  Matematikë  ");
    await evaluate(`window.__createAnswer = { status: 200, body: ${JSON.stringify(PLAN_ANSWER)} }; window.__alerts = [];`);

    /* ---------- 3. Free text, then confirm ---------- */
    await evaluate(`document.getElementById("modeToggleAi").click()`);
    await setValue("nlInput", "Du me msu JavaScript");
    await evaluate(`document.getElementById("parseButton").click()`);
    await waitFor(`!document.getElementById("confirmPanel").classList.contains("hidden")`, "the confirmation panel");

    const parseRequest = await evaluate(`window.__sent.parse[0]`);
    check("text: the parse request carries the text, the user's date and time zone", parseRequest.text === "Du me msu JavaScript" && parseRequest.clientDate === isoDay(0) && typeof parseRequest.timeZone === "string", parseRequest);

    const shown = await evaluate(`({
        subject: document.getElementById("confirmSubject").value, mode: document.getElementById("confirmPlanMode").value,
        start: document.getElementById("confirmStartDate").value, end: document.getElementById("confirmEndDate").value,
        difficulty: document.getElementById("confirmDifficulty").value, length: document.getElementById("confirmSessionLength").value,
        goal: document.getElementById("confirmGoal").value, summary: document.getElementById("confirmSummary").textContent,
        questionsShown: !document.getElementById("clarifyPanel").classList.contains("hidden"),
    })`);
    check("text: the confirmation is filled from what the AI read", same([shown.subject, shown.mode, shown.start, shown.end, shown.difficulty, shown.length, shown.goal], ["JavaScript", "skill", START, END, "hard", "45", "Bazat"]), shown);
    check("text: availability and commitments are summarised", shown.summary.includes("E hënë: 08:00-10:00") && shown.summary.includes("E diel: pushim") && shown.summary.includes("Puna (Punë): 10:00-18:00, E hënë, E martë"), shown.summary);
    check("text: KNOWN GAP, the AI's question is not shown when dates were found", shown.questionsShown === false, shown.questionsShown);

    await setValue("confirmSubject", "JavaScript bazë");
    await setValue("confirmGoal", "");
    await evaluate(`document.getElementById("confirmCreateButton").click()`);
    await waitFor(`window.__sent.create.length === 3`, "the create request from the confirmation");

    const textRequest = await evaluate(`window.__sent.create[2]`);
    const expectedFromText = {
        startDate: START, endDate: END, subject: "JavaScript bazë",
        materialAmount: "Kapitujt 1-3", goal: null, // goal comes from the confirmation field, material from the AI
        planMode: "skill", weeklyAvailability: PARSED.weeklyAvailability, commitments: PARSED.commitments,
        unavailableDates: [], sessionPreferenceMinutes: 45, energy: PARSED.energy, difficulty: "hard",
    };
    check("text: the request combines the edited fields with what the AI read", same(textRequest.structured, expectedFromText), { sent: textRequest.structured, expected: expectedFromText });
    plans = await storedPlans();
    check("text: a second plan is stored with those inputs", plans.length === 2 && same(plans[1].structured, expectedFromText), plans.length);
    check("text: the two plans have different ids", plans.length === 2 && plans[0].id !== plans[1].id);

    /* ---------- 4. What the rest of the page shows ---------- */
    await evaluate(`document.querySelector('.nav-item[data-page="dashboard"]').click()`);
    await sleep(200);
    check("dashboard: counts both plans", (await evaluate(`document.getElementById("totalPlans").textContent`)) === "2");
    check("both storage keys hold the same plans", await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem("studyflow_users"))[0].plans) === JSON.stringify(JSON.parse(localStorage.getItem("studyflow_current_user")).plans)`));
    check("no errors in the browser console", browser.result.consoleErrors.length === 0, browser.result.consoleErrors);
}, (mkdirSync(path.join(HERE, "results"), { recursive: true }), path.join(HERE, "results", "legacy-create.json")));
