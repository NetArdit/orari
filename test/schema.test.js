import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    ParsedRequestSchema,
    PlanResponseSchema,
    fieldErrors,
    LIMITS,
    ParseRequestBody,
    CreatePlanBody,
    AdjustPlanBody,
} from "../lib/schema.js";

const minimalCreate = () => ({
    profile: { name: "Arta" },
    structured: { startDate: "2026-10-14", endDate: "2026-10-20", subject: "Matematikë" },
});

const ok = (schema, value) => schema.safeParse(value).success;

describe("ParseRequestBody", () => {
    test("text must be 3 to 2000 characters", () => {
        assert.equal(ok(ParseRequestBody, { text: "ab" }), false);
        assert.equal(ok(ParseRequestBody, { text: "abc" }), true);
        assert.equal(ok(ParseRequestBody, { text: "a".repeat(2000) }), true);
        assert.equal(ok(ParseRequestBody, { text: "a".repeat(2001) }), false);
        assert.equal(ok(ParseRequestBody, {}), false);
        assert.equal(ok(ParseRequestBody, { text: 5 }), false);
    });
});

describe("ParsedRequestSchema (what the model returns for free text)", () => {
    test("an empty object gets every default", () => {
        assert.deepEqual(ParsedRequestSchema.parse({}), {
            startDate: null,
            endDate: null,
            subject: null,
            materialAmount: null,
            goal: null,
            planMode: null,
            weeklyAvailability: [],
            commitments: [],
            sessionPreferenceMinutes: null,
            energy: null,
            difficulty: null,
            clarifyingQuestions: [],
        });
    });

    test("a commitment gets type other and null days and dates by default", () => {
        const parsed = ParsedRequestSchema.parse({ commitments: [{ label: "Punë", start: "09:00", end: "17:00" }] });
        assert.deepEqual(parsed.commitments[0], { label: "Punë", type: "other", days: null, dates: null, start: "09:00", end: "17:00" });
    });

    test("at most three clarifying questions", () => {
        assert.equal(ok(ParsedRequestSchema, { clarifyingQuestions: ["a", "b", "c"] }), true);
        assert.equal(ok(ParsedRequestSchema, { clarifyingQuestions: ["a", "b", "c", "d"] }), false);
    });

    test("unknown weekday, plan mode and time shapes are rejected", () => {
        assert.equal(ok(ParsedRequestSchema, { weeklyAvailability: [{ day: "monday" }] }), false);
        assert.equal(ok(ParsedRequestSchema, { planMode: "holiday" }), false);
        assert.equal(ok(ParsedRequestSchema, { weeklyAvailability: [{ day: "mon", windows: [{ start: "24:00", end: "25:00" }] }] }), false);
        assert.equal(ok(ParsedRequestSchema, { startDate: "14.10.2026" }), false);
    });
});

describe("PlanResponseSchema (what the model returns for a plan)", () => {
    const session = { date: "2026-10-14", startTime: "08:00", endTime: "09:00", type: "learning", title: "Hyrje" };

    test("a session gets defaults for goal, tasks, material and difficulty", () => {
        const parsed = PlanResponseSchema.parse({ sessions: [session] });
        assert.deepEqual(parsed.sessions[0], { ...session, goal: "", tasks: [], material: null, difficulty: "medium" });
        assert.deepEqual([parsed.strategy, parsed.explanations, parsed.warnings], ["", [], []]);
    });

    test("session type must be one of the six allowed", () => {
        for (const type of ["learning", "practice", "recall", "revision", "assessment", "project"]) {
            assert.equal(ok(PlanResponseSchema, { sessions: [{ ...session, type }] }), true, type);
        }
        assert.equal(ok(PlanResponseSchema, { sessions: [{ ...session, type: "break" }] }), false);
    });

    test("limits: title 120, six tasks, five explanations, five warnings", () => {
        assert.equal(ok(PlanResponseSchema, { sessions: [{ ...session, title: "a".repeat(121) }] }), false);
        assert.equal(ok(PlanResponseSchema, { sessions: [{ ...session, title: "" }] }), false);
        assert.equal(ok(PlanResponseSchema, { sessions: [{ ...session, tasks: Array(7).fill("x") }] }), false);
        assert.equal(ok(PlanResponseSchema, { explanations: Array(6).fill("x") }), false);
        assert.equal(ok(PlanResponseSchema, { warnings: Array(6).fill("x") }), false);
    });
});

describe("CreatePlanBody", () => {
    test("the minimal body is accepted and gets defaults", () => {
        const parsed = CreatePlanBody.parse(minimalCreate());
        assert.equal(parsed.structured.planMode, "general");
        assert.equal(parsed.structured.difficulty, "medium");
        assert.deepEqual(parsed.structured.weeklyAvailability, []);
        assert.deepEqual(parsed.structured.commitments, []);
        assert.deepEqual(parsed.structured.unavailableDates, []);
    });

    test("name, subject and both dates are required", () => {
        for (const remove of [["profile", "name"], ["structured", "subject"], ["structured", "startDate"], ["structured", "endDate"]]) {
            const body = minimalCreate();
            delete body[remove[0]][remove[1]];
            assert.equal(ok(CreatePlanBody, body), false, remove.join("."));
        }
        const emptyName = minimalCreate();
        emptyName.profile.name = "";
        assert.equal(ok(CreatePlanBody, emptyName), false);
    });

    test("session length must be a whole number from 10 to 240, or absent", () => {
        const withLength = (value) => {
            const body = minimalCreate();
            body.structured.sessionPreferenceMinutes = value;
            return ok(CreatePlanBody, body);
        };
        assert.equal(withLength(10), true);
        assert.equal(withLength(240), true);
        assert.equal(withLength(null), true);
        assert.equal(withLength(9), false);
        assert.equal(withLength(241), false);
        assert.equal(withLength(45.5), false);
    });

    const withWindow = (start, end) => {
        const body = minimalCreate();
        body.structured.weeklyAvailability = [{ day: "mon", windows: [{ start, end }] }];
        return CreatePlanBody.safeParse(body);
    };

    test("P1-6: one-digit hours are accepted and stored zero-padded", () => {
        const parsed = withWindow(" 9:00", "10:30 ");
        assert.equal(parsed.success, true);
        assert.deepEqual(parsed.data.structured.weeklyAvailability[0].windows, [{ start: "09:00", end: "10:30" }]);

        const body = minimalCreate();
        body.structured.commitments = [{ label: "Punë", start: "8:00", end: "16:00" }];
        assert.deepEqual(
            CreatePlanBody.parse(body).structured.commitments.map((c) => [c.start, c.end]),
            [["08:00", "16:00"]]
        );
    });

    test("times that are not times are rejected", () => {
        for (const bad of ["24:00", "09:60", "9", "09.00", "nine", ""]) {
            assert.equal(withWindow(bad, "23:00").success, false, bad);
        }
    });

    test("P1-6: a free window must end after it starts; a commitment may cross midnight", () => {
        assert.equal(withWindow("20:00", "08:00").success, false);
        assert.equal(withWindow("9:00", "09:00").success, false);
        assert.equal(withWindow("9:00", "10:00").success, true);

        const body = minimalCreate();
        body.structured.commitments = [{ label: "Ndërrimi i natës", start: "22:00", end: "06:00" }];
        assert.equal(ok(CreatePlanBody, body), true);
    });

    test("dates that do not exist are rejected everywhere a date is accepted", () => {
        const start = minimalCreate();
        start.structured.startDate = "2026-02-31";
        assert.equal(ok(CreatePlanBody, start), false);

        const unavailable = minimalCreate();
        unavailable.structured.unavailableDates = ["2026-04-31"];
        assert.equal(ok(CreatePlanBody, unavailable), false);

        assert.equal(ok(AdjustPlanBody, { ...minimalCreate(), progress: { today: "2026-06-31" } }), false);
        assert.equal(ok(ParsedRequestSchema, { endDate: "2026-02-30" }), false);
        assert.equal(ok(PlanResponseSchema, { sessions: [{ date: "2026-02-30", startTime: "08:00", endTime: "09:00", type: "learning", title: "x" }] }), false);
    });

    test("fields the schema does not know are dropped, not rejected", () => {
        const body = minimalCreate();
        body.structured.extra = "x";
        const parsed = CreatePlanBody.parse(body);
        assert.equal("extra" in parsed.structured, false);
    });
});

describe("fieldErrors", () => {
    const errorsFor = (schema, value) => fieldErrors(schema.safeParse(value).error);

    test("names each field with an Albanian message", () => {
        const body = minimalCreate();
        delete body.structured.subject;
        body.structured.startDate = "2026-02-31";
        body.structured.weeklyAvailability = [{ day: "mon", windows: [{ start: "20:00", end: "08:00" }, { start: "abc", end: "10:00" }] }];
        body.structured.sessionPreferenceMinutes = 500;
        body.profile.name = "";

        assert.deepEqual(errorsFor(CreatePlanBody, body), [
            { path: "profile.name", message: "Vlera është shumë e shkurtër ose shumë e vogël." },
            { path: "structured.startDate", message: "Data nuk është e vlefshme." },
            { path: "structured.subject", message: "Kjo fushë mungon." },
            { path: "structured.weeklyAvailability.0.windows.0.end", message: "Ora e mbarimit duhet të jetë pas orës së fillimit." },
            { path: "structured.weeklyAvailability.0.windows.1.start", message: "Ora duhet të shkruhet si 08:30." },
            { path: "structured.sessionPreferenceMinutes", message: "Vlera është shumë e gjatë ose shumë e madhe." },
        ]);
    });

    test("never passes zod's English through, and stops at ten", () => {
        const body = minimalCreate();
        body.structured.planMode = "holiday";
        body.structured.unavailableDates = Array(15).fill("nope");
        const errors = errorsFor(CreatePlanBody, body);
        assert.equal(errors.length, 10);
        assert.deepEqual(errors[0], { path: "structured.planMode", message: "Vlera nuk është e vlefshme." });
        for (const e of errors) assert.doesNotMatch(e.message, /Invalid|Required|Expected/);
    });
});

describe("AdjustPlanBody", () => {
    test("needs progress.today; summaries default to empty and are capped at 50", () => {
        assert.equal(ok(AdjustPlanBody, minimalCreate()), false);
        const body = { ...minimalCreate(), progress: { today: "2026-10-16" } };
        const parsed = AdjustPlanBody.parse(body);
        assert.deepEqual(parsed.progress.completedSessionSummaries, []);
        assert.deepEqual(parsed.progress.missedSessionSummaries, []);
        body.progress.missedSessionSummaries = Array(51).fill("x");
        assert.equal(ok(AdjustPlanBody, body), false);
    });
});

describe("P0-5: list sizes are bounded", () => {
    const commitment = { label: "a", start: "09:00", end: "10:00" };
    const window = { start: "09:00", end: "10:00" };
    const withStructured = (extra) => ok(CreatePlanBody, { ...minimalCreate(), structured: { ...minimalCreate().structured, ...extra } });

    test("the limits are the documented ones", () => {
        assert.deepEqual(LIMITS, { windowsPerDay: 8, commitments: 40, datesPerCommitment: 60, unavailableDates: 180, sessions: 600 });
    });

    test("each list is accepted at its limit and refused one over", () => {
        assert.equal(withStructured({ commitments: Array(40).fill(commitment) }), true);
        assert.equal(withStructured({ commitments: Array(41).fill(commitment) }), false);

        assert.equal(withStructured({ weeklyAvailability: [{ day: "mon", windows: Array(8).fill(window) }] }), true);
        assert.equal(withStructured({ weeklyAvailability: [{ day: "mon", windows: Array(9).fill(window) }] }), false);

        assert.equal(withStructured({ weeklyAvailability: Array(7).fill({ day: "mon" }) }), true);
        assert.equal(withStructured({ weeklyAvailability: Array(8).fill({ day: "mon" }) }), false);

        assert.equal(withStructured({ unavailableDates: Array(180).fill("2026-10-14") }), true);
        assert.equal(withStructured({ unavailableDates: Array(181).fill("2026-10-14") }), false);

        assert.equal(withStructured({ commitments: [{ ...commitment, dates: Array(60).fill("2026-10-14") }] }), true);
        assert.equal(withStructured({ commitments: [{ ...commitment, dates: Array(61).fill("2026-10-14") }] }), false);
        assert.equal(withStructured({ commitments: [{ ...commitment, days: Array(8).fill("mon") }] }), false);
    });

    test("the AI's answers are bounded too", () => {
        const session = { date: "2026-10-14", startTime: "08:00", endTime: "09:00", type: "learning", title: "x" };
        assert.equal(ok(PlanResponseSchema, { sessions: Array(600).fill(session) }), true);
        assert.equal(ok(PlanResponseSchema, { sessions: Array(601).fill(session) }), false);
        assert.equal(ok(ParsedRequestSchema, { commitments: Array(41).fill(commitment) }), false);
    });
});
