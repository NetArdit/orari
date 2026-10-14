import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.ts";
import type { StoredPlan } from "../storage/model.ts";
import { downloadPlans, uploadPlans } from "./accountSync.ts";

const session = { id: "s1", status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë", goal: "", tasks: [] as string[], material: null, difficulty: "medium" } satisfies StoredPlan["sessions"][number];
const plan = (id: string): StoredPlan => ({ id, createdAt: "2026-10-14T10:00:00.000Z", subject: "Matematikë", startDate: "2026-10-15", endDate: "2026-10-20", planMode: "general", strategy: "", explanations: [], warnings: [], structured: {}, sessions: [session] });

function api(remote: unknown[], createResult: { ok: boolean; kind?: string } = { ok: true }) {
    const createPlan = vi.fn(async () => (createResult.ok ? { ok: true, data: { plan: {} } } : { ok: false, kind: createResult.kind ?? "server", message: "gabim" }));
    const client = { sync: { listPlans: async () => ({ ok: true, data: { plans: remote } }), createPlan } } as unknown as ApiClient;
    return { client, createPlan };
}

describe("uploadPlans", () => {
    it("sends only the plans the account does not have and never touches the others", async () => {
        const { client, createPlan } = api([{ id: "a" }]);
        const outcome = await uploadPlans(client, [plan("a"), plan("b")]);
        expect(outcome).toEqual({ ok: true, report: { sent: 1, alreadyThere: 1, failed: 0 } });
        expect(createPlan).toHaveBeenCalledTimes(1);
    });

    it("stops and says so when the session or the e-mail confirmation is missing", async () => {
        const { client } = api([], { ok: false, kind: "unverified" });
        expect((await uploadPlans(client, [plan("b")])).ok).toBe(false);
    });

    it("counts a plan the server refuses as failed and carries on", async () => {
        const { client } = api([], { ok: false, kind: "invalid" });
        expect(await uploadPlans(client, [plan("a"), plan("b")])).toEqual({ ok: true, report: { sent: 0, alreadyThere: 0, failed: 2 } });
    });
});

describe("downloadPlans", () => {
    it("adds only plans missing here, skips what cannot be read, and never overwrites", async () => {
        const { client } = api([{ ...plan("a"), revision: 3 }, plan("b"), { id: "broken", subject: "" }]);
        const added: string[] = [];
        const outcome = await downloadPlans(client, new Set(["a"]), async (p) => (added.push(p.id), p.id));
        expect(outcome).toEqual({ ok: true, report: { added: 1, alreadyHere: 1, unreadable: 1 } });
        expect(added).toEqual(["b"]);
    });

    it("reports a plan the device could not keep", async () => {
        const { client } = api([plan("b")]);
        expect(await downloadPlans(client, new Set(), async () => null)).toEqual({ ok: true, report: { added: 0, alreadyHere: 0, unreadable: 1 } });
    });
});
