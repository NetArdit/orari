import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "./api/client.ts";
import { ServicesContext, useStoreState } from "./app/services.tsx";
import type { Services } from "./app/services.tsx";
import { hrefFor } from "./router/routes.ts";
import type { Route } from "./router/routes.ts";
import { handleLinkClick, useRoute } from "./router/useRoute.ts";
import { ForgotScreen, ResetScreen, SignInScreen, SignUpScreen, VerifyScreen } from "./screens/AccountScreens.tsx";
import { NewPlanScreen } from "./screens/NewPlanScreen.tsx";
import { PlanScreen, PlansScreen, SessionScreen } from "./screens/PlansScreens.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import type { DeviceInfo } from "./screens/SettingsScreen.tsx";
import { TodayScreen } from "./screens/TodayScreen.tsx";
import { WeekScreen } from "./screens/WeekScreen.tsx";
import { applyAppearance, parseAppearance, readCachedAppearance, writeCachedAppearance } from "./settings/appearance.ts";
import type { Appearance } from "./settings/appearance.ts";
import { createAccountStore } from "./state/accountStore.ts";
import { createPlanStore } from "./state/planStore.ts";
import { openIndexedDbStore } from "./storage/idb.ts";
import { migrateFromLegacy } from "./storage/legacy.ts";
import { createRepository } from "./storage/repository.ts";
import { buttonClass, Empty, Link } from "./ui/primitives.tsx";

const api = createApiClient();

type Boot = { state: "starting" } | { state: "failed"; reason: string } | { state: "ready"; services: Omit<Services, "appearance" | "setAppearance">; device: DeviceInfo; appearance: Appearance };

async function boot(): Promise<Boot> {
    const repository = createRepository(await openIndexedDbStore());
    const migration = await migrateFromLegacy(repository, window.localStorage);
    const store = createPlanStore(repository);
    await store.load();
    // Who is signed in is asked of the server in the background: the planner does not wait for it.
    const account = createAccountStore(api);
    void account.load();
    const health = await api.health();
    const state = store.getState();
    const stored = await repository.getAppearance();
    return {
        state: "ready",
        services: { api, repository, store, account },
        device: {
            migration,
            profileName: state.status === "ready" ? (state.profile?.name ?? null) : null,
            unreadablePlans: state.status === "ready" ? state.unreadable.length : 0,
            aiConfigured: health.ok ? health.data.aiConfigured : null,
        },
        // The device's cached look is what the page is already showing; storage is the record behind it.
        appearance: stored ?? readCachedAppearance(window.localStorage),
    };
}

const NAV: { route: Exclude<Route, { name: "notFound" }>; label: string; match: Route["name"][] }[] = [
    { route: { name: "today" }, label: "Sot", match: ["today", "session"] },
    { route: { name: "week" }, label: "Orari", match: ["week"] },
    { route: { name: "newPlan" }, label: "Plan i ri", match: ["newPlan"] },
    { route: { name: "plans" }, label: "Planet", match: ["plans", "plan"] },
    { route: { name: "me" }, label: "Cilësimet", match: ["me"] },
];

const TITLES: Record<Route["name"], string> = {
    today: "Sot", week: "Orari i javës", newPlan: "Plan i ri", plans: "Planet", plan: "Plani", session: "Seanca", me: "Cilësimet",
    signIn: "Hyr", signUp: "Regjistrohu", forgot: "Fjalëkalim i harruar", reset: "Fjalëkalim i ri", verify: "Konfirmo email-in",
    notFound: "Kjo faqe nuk ekziston",
};

function Screen({ route, device }: { route: Route; device: DeviceInfo }) {
    const state = useStoreState();
    if (state.status === "loading") return <p role="status" className="py-8 text-muted">Po hapet…</p>;
    if (state.status === "failed") return <p role="alert" className="py-8 font-semibold text-bad">Plani nuk u hap nga kjo pajisje: {state.reason}</p>;

    // Reading screens stay in a comfortable column; the week uses the whole width.
    const wide = route.name === "week";
    return (
        <div className={`flex w-full flex-col gap-5 ${wide ? "" : "mx-auto max-w-3xl"}`}>
            <ScreenFor route={route} device={device} planCount={state.plans.length} />
        </div>
    );
}

function ScreenFor({ route, device, planCount }: { route: Route; device: DeviceInfo; planCount: number }) {
    switch (route.name) {
        case "today":
            return <TodayScreen />;
        case "week":
            return <WeekScreen />;
        case "newPlan":
            return <NewPlanScreen />;
        case "plans":
            return <PlansScreen />;
        case "plan":
            return <PlanScreen planId={route.planId} />;
        case "session":
            return <SessionScreen planId={route.planId} sessionId={route.sessionId} />;
        case "me":
            return <SettingsScreen device={device} planCount={planCount} />;
        case "signIn":
            return <SignInScreen />;
        case "signUp":
            return <SignUpScreen />;
        case "forgot":
            return <ForgotScreen />;
        case "reset":
            return <ResetScreen />;
        case "verify":
            return <VerifyScreen />;
        case "notFound":
            return (
                <Empty title="Kjo faqe nuk ekziston">
                    <p className="text-muted">
                        Adresa <code>{route.path}</code> nuk të çon askund.
                    </p>
                    <Link to={{ name: "today" }} className={buttonClass("secondary", "self-start")}>
                        Kthehu te Sot
                    </Link>
                </Empty>
            );
    }
}

export function App() {
    const route = useRoute();
    const [booted, setBooted] = useState<Boot>({ state: "starting" });
    const [appearance, setAppearanceState] = useState<Appearance>(() => readCachedAppearance(window.localStorage));
    const mainRef = useRef<HTMLElement>(null);
    const first = useRef(true);

    useEffect(() => {
        let cancelled = false;
        boot()
            .then((result) => {
                if (cancelled) return;
                setBooted(result);
                if (result.state === "ready") setAppearanceState(result.appearance);
            })
            .catch((error: unknown) => {
                if (!cancelled) setBooted({ state: "failed", reason: error instanceof Error ? error.message : String(error) });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // The look follows the setting, and "system" follows the device as it changes.
    useEffect(() => {
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = () => applyAppearance(document.documentElement as unknown as { dataset: Record<string, string | undefined> }, appearance, query.matches);
        apply();
        query.addEventListener("change", apply);
        return () => query.removeEventListener("change", apply);
    }, [appearance]);

    const setAppearance = useCallback(
        (next: Appearance) => {
            const clean = parseAppearance(next);
            setAppearanceState(clean);
            writeCachedAppearance(window.localStorage, clean);
            if (booted.state === "ready") void booted.services.repository.saveAppearance(clean).catch(() => undefined);
        },
        [booted]
    );

    const services = useMemo<Services | null>(() => (booted.state === "ready" ? { ...booted.services, appearance, setAppearance } : null), [booted, appearance, setAppearance]);

    useEffect(() => {
        document.title = `${TITLES[route.name]} · Orari`;
        // After a screen change, move focus to the page so keyboard and screen-reader users start at the top of it.
        if (first.current) {
            first.current = false;
            return;
        }
        mainRef.current?.focus();
    }, [route]);

    return (
        <div className="mx-auto flex min-h-dvh max-w-6xl flex-col pb-24 md:pb-8">
            <a href="#main" className="sr-only focus:not-sr-only focus:m-2 focus:rounded-m focus:bg-raised focus:p-3">
                Kalo te përmbajtja
            </a>
            <header className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-xl font-bold notebook:font-display blocks:tracking-tight">Orari</span>
            </header>

            <nav aria-label="Kryesore" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-raised md:static md:mx-4 md:mb-4 md:flex md:gap-2 md:rounded-m md:border md:p-1">
                {NAV.map(({ route: target, label, match }) => {
                    const current = match.includes(route.name);
                    return (
                        <a
                            key={target.name}
                            href={hrefFor(target)}
                            onClick={handleLinkClick}
                            aria-current={current ? "page" : undefined}
                            className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-muted aria-[current=page]:text-accent md:min-h-11 md:flex-1 md:flex-row md:rounded-s md:text-sm md:aria-[current=page]:bg-accent-wash"
                        >
                            <span aria-hidden="true" className="h-[3px] w-[18px] rounded-sm bg-transparent md:hidden" data-current={current} style={current ? { background: "var(--accent)" } : undefined} />
                            {label}
                        </a>
                    );
                })}
            </nav>

            <main id="main" ref={mainRef} tabIndex={-1} className="flex flex-1 flex-col gap-5 px-4 pb-6 outline-none">
                {booted.state === "starting" && <p role="status" className="py-8 text-muted">Po hapet…</p>}
                {booted.state === "failed" && (
                    <p role="alert" className="py-8 font-semibold text-bad">
                        Ruajtja në këtë pajisje nuk u hap: {booted.reason}
                    </p>
                )}
                {services && booted.state === "ready" && (
                    <ServicesContext.Provider value={services}>
                        <Screen route={route} device={booted.device} />
                    </ServicesContext.Provider>
                )}
            </main>
        </div>
    );
}
