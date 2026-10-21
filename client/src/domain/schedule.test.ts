import { describe, expect, test } from "vitest";
import { applyProposal, COOLDOWN_MS, freeSpans, placeSession, proposalToShow, proposeReschedule, signatureOf } from "./schedule.ts";
import { reviewWeek, suggestionsFrom } from "./review.ts";
import { DEFAULT_CAPACITY, validatePlan } from "./validate.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

const s = (id: string, date: string, start: string, end: string, status: StoredSession["status"] = "pending"): StoredSession => ({
    id, status, date, startTime: start, endTime: end, type: "learning", title: id, goal: "", tasks: [], material: null, difficulty: "medium",
});
// Monday 2026-10-19 .. Sunday 2026-11-01
const plan = (sessions: StoredSession[], structured: Record<string, unknown> = {}): StoredPlan => ({
    id: "p", createdAt: "x", subject: "JS", startDate: "2026-10-19", endDate: "2026-11-01", planMode: "general", strategy: "", explanations: [], warnings: [], structured, sessions, state: "published",
});
const NOW = new Date("2026-10-21T12:00:00"); // Wednesday noon
const evenings = { weeklyAvailability: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, off: false, windows: [{ start: "17:00", end: "20:00" }] })) };

describe("free spans", () => {
  test("windows minus busy time minus fixed sessions; a closed day and an excluded date have none", () => {
    const p = plan([], { weeklyAvailability: [{ day: "wed", off: false, windows: [{ start: "09:00", end: "13:00" }] }, { day: "thu", off: true, windows: [] }], commitments: [{ days: ["wed"], start: "10:00", end: "11:00" }], excludedDates: ["2026-10-28"] });
    expect(freeSpans(p, "2026-10-21", [s("x", "2026-10-21", "12:00", "12:30")])).toEqual([{ start: 540, end: 600 }, { start: 660, end: 720 }, { start: 750, end: 780 }]);
    expect(freeSpans(p, "2026-10-22", [])).toEqual([]);
    expect(freeSpans(p, "2026-10-28", [])).toEqual([]);
    expect(freeSpans(plan([]), "2026-10-21", [])).toEqual([{ start: 420, end: 1380 }]);
  });
  test("a commitment past midnight cuts the evening and the early morning", () => {
    const p = plan([], { commitments: [{ days: null, start: "22:00", end: "06:00" }] });
    expect(freeSpans(p, "2026-10-21", [])).toEqual([{ start: 420, end: 1320 }]);
  });
});

describe("placing", () => {
  test("earliest slot, rest kept after a long session, limits respected, null when nothing fits", () => {
    const p = plan([], evenings);
    expect(placeSession(p, [], 60, { date: "2026-10-21", minute: 0 }, "2026-10-30", DEFAULT_CAPACITY)).toEqual({ date: "2026-10-21", startTime: "17:00", endTime: "18:00" });
    const after = placeSession(p, [s("a", "2026-10-21", "17:00", "18:00")], 45, { date: "2026-10-21", minute: 0 }, "2026-10-30", DEFAULT_CAPACITY);
    expect(after).toEqual({ date: "2026-10-21", startTime: "18:10", endTime: "18:55" });
    const full = [s("a", "2026-10-21", "17:00", "19:00")];
    expect(placeSession(p, full, 30, { date: "2026-10-21", minute: 0 }, "2026-10-21", DEFAULT_CAPACITY)).toBeNull(); // daily limit 120 reached
    expect(placeSession(p, [], 60, { date: "2026-10-21", minute: 19 * 60 + 30 }, "2026-10-21", DEFAULT_CAPACITY)).toBeNull();
  });
});

describe("a reschedule proposal", () => {
  const missedPlan = () => plan([s("done", "2026-10-19", "17:00", "18:00", "completed"), s("m1", "2026-10-20", "17:00", "18:00"), s("m2", "2026-10-21", "09:00", "10:00"), s("later", "2026-10-24", "17:00", "18:00")], evenings);
  test("moves only what was missed, keeps everything else, and the result passes the validator", () => {
    const p = missedPlan();
    const proposal = proposeReschedule(p, NOW)!;
    expect(proposal.moves.map((m) => m.sessionId)).toEqual(["m1", "m2"]);
    expect(proposal.unplaced).toEqual([]);
    for (const m of proposal.moves) expect(`${m.to.date}T${m.to.startTime}` > "2026-10-21T12:00").toBe(true);
    const applied = applyProposal(p, proposal)!;
    expect(applied.sessions.find((x) => x.id === "later")).toEqual(p.sessions.find((x) => x.id === "later"));
    expect(applied.sessions.find((x) => x.id === "done")).toEqual(p.sessions.find((x) => x.id === "done"));
    expect(validatePlan(applied).violations).toEqual([]);
    expect(proposeReschedule(p, NOW)).toEqual(proposal); // deterministic
  });
  test("nothing missed, nothing proposed; the proposal is stale once the plan changes", () => {
    expect(proposeReschedule(plan([s("a", "2026-10-25", "17:00", "18:00")], evenings), NOW)).toBeNull();
    const p = missedPlan();
    const proposal = proposeReschedule(p, NOW)!;
    const changed = { ...p, sessions: p.sessions.map((x) => (x.id === "m1" ? { ...x, status: "skipped" as const } : x)) };
    expect(signatureOf(changed)).not.toBe(proposal.signature);
    expect(applyProposal(changed, proposal)).toBeNull();
  });
  test("what cannot be placed is said, with the end date that would let it fit", () => {
    const tight = { ...plan([s("m", "2026-10-20", "17:00", "19:00")], { weeklyAvailability: [{ day: "mon", off: false, windows: [{ start: "17:00", end: "19:00" }] }] }), endDate: "2026-10-23" };
    const proposal = proposeReschedule(tight, NOW)!;
    expect(proposal.moves).toEqual([]);
    expect(proposal.unplaced[0]).toMatchObject({ sessionId: "m", fitsIfEndDate: "2026-10-26" });
    expect(applyProposal(tight, proposal)).toBeNull();
  });
  test("one proposal at a time, and a dismissal silences it for a day", () => {
    const p = missedPlan();
    expect(proposalToShow(p, NOW, DEFAULT_CAPACITY, { dismissedAt: {} })).not.toBeNull();
    expect(proposalToShow(p, NOW, DEFAULT_CAPACITY, { dismissedAt: { p: NOW.getTime() - 3600_000 } })).toBeNull();
    expect(proposalToShow(p, NOW, DEFAULT_CAPACITY, { dismissedAt: { p: NOW.getTime() - COOLDOWN_MS - 1 } })).not.toBeNull();
  });
  test("a published schedule is never changed by computing a proposal", () => {
    const p = missedPlan();
    const before = JSON.stringify(p);
    proposeReschedule(p, NOW);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("the weekly review uses recorded facts only", () => {
  const p = plan([s("a", "2026-10-19", "17:00", "18:00", "completed"), s("b", "2026-10-20", "17:00", "18:30", "completed"), s("c", "2026-10-21", "09:00", "10:00", "partial"), s("d", "2026-10-21", "10:00", "11:00", "skipped"), s("e", "2026-10-20", "19:00", "20:00"), s("f", "2026-10-23", "17:00", "18:00"), s("other", "2026-10-27", "17:00", "18:00", "completed")]);
  test("planned, completed, partly, skipped, not marked, upcoming; minutes only from completed", () => {
    const r = reviewWeek([p], "2026-10-19", NOW);
    expect(r).toMatchObject({ planned: 6, completed: 2, partial: 1, skipped: 1, unmarked: 1, upcoming: 1, confirmedMinutes: 150 });
    expect(r.perPlan).toEqual([{ planId: "p", subject: "JS", completed: 2, planned: 6 }]);
  });
  test("a draft counts for nothing", () => {
    expect(reviewWeek([{ ...p, state: "draft" }], "2026-10-19", NOW).planned).toBe(0);
  });
  test("suggestions only with enough data, with their evidence in numbers, and none that act by themselves", () => {
    expect(suggestionsFrom(reviewWeek([plan([s("a", "2026-10-19", "17:00", "18:00", "completed")])], "2026-10-19", NOW))).toEqual([]);
    const sug = suggestionsFrom(reviewWeek([p], "2026-10-19", NOW));
    expect(sug.map((x) => x.id)).toContain("reschedule-unmarked");
    expect(sug[0]!.evidence).toBe("2 of 5 sessions marked completed, 1 partly, 1 skipped, 1 not marked");
    expect(JSON.stringify(sug)).not.toMatch(/master|understand|learned|lazy|failed/i);
  });
});
