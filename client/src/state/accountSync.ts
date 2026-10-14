import { z } from "zod";
import type { ApiClient } from "../api/client.ts";
import { StoredPlan } from "../storage/model.ts";

/**
 * Moving plans between this device and the account, only when the person asks for it.
 *
 * Neither direction changes or deletes anything that already exists on the other side: upload sends the plans
 * the account does not have, download adds the plans the device does not have (under their own id, or a new
 * one if that id is taken here). Marks made on both sides are not merged: a plan present on both sides is left
 * as it is on each. This is a demonstration against in-memory accounts; the server forgets everything on restart.
 */
export interface SyncReport {
    sent: number;
    alreadyThere: number;
    failed: number;
}

export interface DownloadReport {
    added: number;
    alreadyHere: number;
    unreadable: number;
}

export type SyncOutcome<T> = { ok: true; report: T } | { ok: false; message: string };

export async function uploadPlans(api: ApiClient, local: StoredPlan[]): Promise<SyncOutcome<SyncReport>> {
    const listed = await api.sync.listPlans();
    if (!listed.ok) return { ok: false, message: listed.message };
    const onServer = new Set(listed.data.plans.map((p) => p.id));
    const report: SyncReport = { sent: 0, alreadyThere: 0, failed: 0 };
    for (const plan of local) {
        if (onServer.has(plan.id)) {
            report.alreadyThere++;
            continue;
        }
        const result = await api.sync.createPlan(plan);
        if (result.ok) report.sent++;
        else if (result.kind === "unauthenticated" || result.kind === "unverified") return { ok: false, message: result.message };
        else report.failed++;
    }
    return { ok: true, report };
}

export async function downloadPlans(
    api: ApiClient,
    localIds: ReadonlySet<string>,
    addLocal: (plan: StoredPlan) => Promise<string | null>,
): Promise<SyncOutcome<DownloadReport>> {
    const listed = await api.sync.listPlans();
    if (!listed.ok) return { ok: false, message: listed.message };
    const report: DownloadReport = { added: 0, alreadyHere: 0, unreadable: 0 };
    for (const raw of listed.data.plans) {
        const id = z.object({ id: z.string() }).safeParse(raw);
        if (id.success && localIds.has(id.data.id)) {
            report.alreadyHere++;
            continue;
        }
        const parsed = StoredPlan.safeParse(raw);
        if (!parsed.success) {
            report.unreadable++;
            continue;
        }
        if ((await addLocal(parsed.data)) === null) report.unreadable++;
        else report.added++;
    }
    return { ok: true, report };
}
