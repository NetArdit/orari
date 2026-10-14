import { BackupFile, SCHEMA_VERSION, StoredMeta, StoredPlan, StoredProfile } from "./model.ts";
import type { SessionStatus } from "./model.ts";
import type { KeyValueStore, Write } from "./store.ts";

const META = "meta";
const PROFILE = "profile";
const PLAN = "plan:";

export class StorageTooNewError extends Error {
    constructor(public readonly found: number) {
        super("storage_newer_than_app");
    }
}

/** A plan in storage that no longer passes the checks. It is reported and left where it is, never deleted. */
export interface UnreadablePlan {
    key: string;
    reason: string;
}

export interface ImportSummary {
    plansImported: number;
    plansRejected: number;
}

/**
 * Everything the app reads and writes on the device goes through here.
 * Rules: what is read is validated; a write either happens completely or not at all;
 * nothing is deleted except by an explicit delete or a confirmed restore.
 */
export function createRepository(store: KeyValueStore, now: () => Date = () => new Date()) {
    async function readMeta(): Promise<StoredMeta | null> {
        const raw = await store.get(META);
        if (raw === undefined) return null;
        const meta = StoredMeta.parse(raw);
        // Data written by a newer version of the app must not be reinterpreted by an older one.
        if (meta.schemaVersion > SCHEMA_VERSION) throw new StorageTooNewError(meta.schemaVersion);
        return meta;
    }

    const newMeta = (migratedFromLegacyAt: string | null): StoredMeta => ({ schemaVersion: SCHEMA_VERSION, createdAt: now().toISOString(), migratedFromLegacyAt });

    const planWrites = (plans: StoredPlan[]): Write[] => plans.map((plan) => ({ key: PLAN + plan.id, value: plan }));

    return {
        readMeta,

        /** True once a profile exists on this device. */
        async isSetUp(): Promise<boolean> {
            return (await readMeta()) !== null && (await store.get(PROFILE)) !== undefined;
        },

        async getProfile(): Promise<StoredProfile | null> {
            const raw = await store.get(PROFILE);
            return raw === undefined ? null : StoredProfile.parse(raw);
        },

        /** First set-up of this device: profile and any plans, in one write. Refuses if a profile already exists. */
        async initialise(profile: StoredProfile, plans: StoredPlan[], options: { fromLegacy: boolean }): Promise<void> {
            if ((await store.get(PROFILE)) !== undefined) throw new Error("already_set_up");
            await store.commit([
                { key: META, value: newMeta(options.fromLegacy ? now().toISOString() : null) },
                { key: PROFILE, value: StoredProfile.parse(profile) },
                ...planWrites(plans.map((p) => StoredPlan.parse(p))),
            ]);
        },

        async saveProfile(profile: StoredProfile): Promise<void> {
            await store.commit([{ key: PROFILE, value: StoredProfile.parse(profile) }]);
        },

        /** Newest first. Plans that fail the checks are returned separately and stay in storage. */
        async listPlans(): Promise<{ plans: StoredPlan[]; unreadable: UnreadablePlan[] }> {
            const plans: StoredPlan[] = [];
            const unreadable: UnreadablePlan[] = [];
            for (const key of await store.keys(PLAN)) {
                const parsed = StoredPlan.safeParse(await store.get(key));
                if (parsed.success) plans.push(parsed.data);
                else unreadable.push({ key, reason: parsed.error.issues[0]?.path.join(".") || "shape" });
            }
            plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            return { plans, unreadable };
        },

        async getPlan(id: string): Promise<StoredPlan | null> {
            const parsed = StoredPlan.safeParse(await store.get(PLAN + id));
            return parsed.success ? parsed.data : null;
        },

        async savePlan(plan: StoredPlan): Promise<void> {
            await store.commit([{ key: PLAN + plan.id, value: StoredPlan.parse(plan) }]);
        },

        async deletePlan(id: string): Promise<void> {
            await store.commit([{ key: PLAN + id, delete: true }]);
        },

        /** Marks one session. Returns the updated plan, or null if the plan or the session is not there. */
        async setSessionStatus(planId: string, sessionId: string, status: SessionStatus): Promise<StoredPlan | null> {
            const plan = await this.getPlan(planId);
            const session = plan?.sessions.find((s) => s.id === sessionId);
            if (!plan || !session) return null;
            session.status = status;
            await this.savePlan(plan);
            return plan;
        },

        /** Everything on the device as one object, to be saved as a file by the person. */
        async exportBackup(): Promise<BackupFile> {
            const profile = await this.getProfile();
            if (!profile) throw new Error("nothing_to_export");
            const { plans } = await this.listPlans();
            return { format: "planifikues-kopje", schemaVersion: SCHEMA_VERSION, exportedAt: now().toISOString(), profile, plans };
        },

        /**
         * Replaces what is on the device with a backup. The file is checked completely before anything is
         * touched; plans in it that fail the checks are skipped and counted. The removal of the old plans
         * and the writing of the new ones are one write.
         */
        async restoreBackup(file: unknown): Promise<ImportSummary> {
            const backup = BackupFile.parse(file);
            if (backup.schemaVersion > SCHEMA_VERSION) throw new StorageTooNewError(backup.schemaVersion);

            const plans: StoredPlan[] = [];
            let rejected = 0;
            for (const raw of backup.plans) {
                const parsed = StoredPlan.safeParse(raw);
                if (parsed.success) plans.push(parsed.data);
                else rejected++;
            }

            const existing = await readMeta();
            const stale = (await store.keys(PLAN)).filter((key) => !plans.some((p) => PLAN + p.id === key));
            await store.commit([
                { key: META, value: existing ?? newMeta(null) },
                { key: PROFILE, value: backup.profile },
                ...stale.map((key): Write => ({ key, delete: true })),
                ...planWrites(plans),
            ]);
            return { plansImported: plans.length, plansRejected: rejected };
        },
    };
}

export type Repository = ReturnType<typeof createRepository>;
