import { useEffect, useState } from "react";
import { createApiClient } from "./api/client.ts";
import { hrefFor } from "./router/routes.ts";
import type { Route } from "./router/routes.ts";
import { handleLinkClick, useRoute } from "./router/useRoute.ts";
import { openIndexedDbStore } from "./storage/idb.ts";
import { migrateFromLegacy } from "./storage/legacy.ts";
import type { MigrationOutcome } from "./storage/legacy.ts";
import { createRepository } from "./storage/repository.ts";

/**
 * Foundation only. This page proves that the pieces work together in a real browser: storage opens,
 * the old page's data is copied once, addresses lead to screens, the server answers. The planner's
 * screens are built on top of this after the owner has chosen a design direction.
 */

type Startup =
    | { state: "starting" }
    | { state: "failed"; reason: string }
    | { state: "ready"; migration: MigrationOutcome; profileName: string | null; plans: number; unreadablePlans: number; aiConfigured: boolean | null };

const api = createApiClient();

async function start(): Promise<Startup> {
    const repository = createRepository(await openIndexedDbStore());
    const migration = await migrateFromLegacy(repository, window.localStorage);
    const profile = await repository.getProfile();
    const { plans, unreadable } = await repository.listPlans();
    const health = await api.health();
    return {
        state: "ready",
        migration,
        profileName: profile?.name ?? null,
        plans: plans.length,
        unreadablePlans: unreadable.length,
        aiConfigured: health.ok ? health.data.aiConfigured : null,
    };
}

const NAV: { route: Exclude<Route, { name: "notFound" }>; label: string }[] = [
    { route: { name: "today" }, label: "Sot" },
    { route: { name: "week" }, label: "Orari" },
    { route: { name: "newPlan" }, label: "Plan i ri" },
    { route: { name: "me" }, label: "Unë" },
];

const SCREEN_NAMES: Record<Route["name"], string> = {
    today: "Sot",
    week: "Orari",
    newPlan: "Plan i ri",
    plans: "Planet",
    plan: "Një plan",
    session: "Një seancë",
    me: "Unë",
    notFound: "Kjo faqe nuk ekziston",
};

function migrationText(outcome: MigrationOutcome): string {
    switch (outcome.status) {
        case "migrated":
            return `Të dhënat nga versioni i vjetër u kopjuan: ${outcome.plans} plane.`;
        case "already_set_up":
            return "Të dhënat janë tashmë në këtë pajisje.";
        case "nothing_to_migrate":
            return "Nuk ka të dhëna nga versioni i vjetër.";
        case "choose":
            return "Në këtë pajisje ka disa llogari të vjetra. Duhet zgjedhur njëra.";
        case "unreadable":
            return "Të dhënat e versionit të vjetër nuk mund të lexohen.";
    }
}

export function App() {
    const route = useRoute();
    const [startup, setStartup] = useState<Startup>({ state: "starting" });

    useEffect(() => {
        let cancelled = false;
        start()
            .then((result) => {
                if (!cancelled) setStartup(result);
            })
            .catch((error: unknown) => {
                if (!cancelled) setStartup({ state: "failed", reason: error instanceof Error ? error.message : String(error) });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        document.title = `${SCREEN_NAMES[route.name]} · Planifikuesi`;
    }, [route.name]);

    return (
        <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-4 text-neutral-900">
            <nav aria-label="Kryesore" className="flex flex-wrap gap-2">
                {NAV.map(({ route: target, label }) => (
                    <a
                        key={target.name}
                        href={hrefFor(target)}
                        onClick={handleLinkClick}
                        aria-current={route.name === target.name ? "page" : undefined}
                        className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 font-medium aria-[current=page]:border-neutral-900 aria-[current=page]:bg-neutral-900 aria-[current=page]:text-white"
                    >
                        {label}
                    </a>
                ))}
            </nav>

            <main className="flex flex-col gap-4">
                <h1 className="text-2xl font-semibold" data-testid="screen">
                    {SCREEN_NAMES[route.name]}
                </h1>

                {route.name === "notFound" ? (
                    <p>
                        Adresa <code>{route.path}</code> nuk të çon askund. <a className="underline" href={hrefFor({ name: "today" })} onClick={handleLinkClick}>Kthehu te Sot</a>
                    </p>
                ) : (
                    <p className="text-neutral-600">Ky ekran ndërtohet pasi të zgjidhet pamja. Versioni i tanishëm është te <a className="underline" href="/">faqja kryesore</a>.</p>
                )}

                <section aria-live="polite" className="rounded-lg border border-neutral-300 p-4" data-testid="status" data-state={startup.state}>
                    <h2 className="mb-2 font-semibold">Gjendja e themelit</h2>
                    {startup.state === "starting" && <p>Po hapet…</p>}
                    {startup.state === "failed" && <p role="alert">Ruajtja në këtë pajisje nuk u hap: {startup.reason}</p>}
                    {startup.state === "ready" && (
                        <ul className="list-disc pl-5">
                            <li data-testid="migration" data-status={startup.migration.status}>{migrationText(startup.migration)}</li>
                            <li data-testid="profile">Profili: {startup.profileName ?? "ende pa profil"}</li>
                            <li data-testid="plans">Plane në këtë pajisje: {startup.plans}{startup.unreadablePlans > 0 ? ` (${startup.unreadablePlans} nuk lexohen)` : ""}</li>
                            <li data-testid="server">
                                Serveri: {startup.aiConfigured === null ? "nuk përgjigjet" : startup.aiConfigured ? "gati, me AI" : "gati, pa çelës AI"}
                            </li>
                        </ul>
                    )}
                </section>
            </main>
        </div>
    );
}
