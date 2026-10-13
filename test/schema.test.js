import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    ParsedRequestSchema,
    PlanResponseSchema,
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

    test("times must be zero-padded HH:MM", () => {
        const withWindow = (start, end) => {
            const body = minimalCreate();
            body.structured.weeklyAvailability = [{ day: "mon", windows: [{ start, end }] }];
            return ok(CreatePlanBody, body);
        };
        assert.equal(withWindow("09:00", "10:00"), true);
        assert.equal(withWindow("9:00", "10:00"), false);
        assert.equal(withWindow("09:00", "24:00"), false);
    });

    test("fields the schema does not know are dropped, not rejected", () => {
        const body = minimalCreate();
        body.structured.extra = "x";
        const parsed = CreatePlanBody.parse(body);
        assert.equal("extra" in parsed.structured, false);
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

describe("KNOWN DEFECTS, to be reversed in Phase 1", () => {
    test("KNOWN DEFECT P0-3: the date shape check accepts dates that do not exist", () => {
        const body = minimalCreate();
        body.structured.startDate = "2026-02-31";
        assert.equal(ok(CreatePlanBody, body), true);
    });

    test("KNOWN DEFECT P0-5: the number of commitments is unbounded", () => {
        const body = minimalCreate();
        body.structured.commitments = Array.from({ length: 5000 }, () => ({ label: "a", start: "09:00", end: "10:00" }));
        assert.equal(ok(CreatePlanBody, body), true);
    });
});
