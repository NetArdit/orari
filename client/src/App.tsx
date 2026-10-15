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

type Boot = { state: "starting" } | { state: "failed"; reason: string } | { state: "ready"; services: Omit<Services, "appearance" | "setAppearance">; appearance: Appearance };

async function boot(): Promise<Boot> {
    const repository = createRepository(await openIndexedDbStore());
    // Plans kept by the earlier single-page version on this device are brought across once, quietly.
    await migrateFromLegacy(repository, window.localStorage);
    const store = createPlanStore(repository);
    await store.load();
    // Who is signed in is asked of the server in the background: the planner does not wait for it.
    const account = createAccountStore(api);
    void account.load();
    const stored = await repository.getAppearance();
    return {
        state: "ready",
        services: { api, repository, store, account },
        // The device's cached look is what the page is already showing; storage is the record behind it.
        appearance: stored ?? readCachedAppearance(window.localStorage),
    };
}

const NAV: { route: Exclude<Route, { name: "notFound" }>; label: string; match: Route["name"][] }[] = [
    { route: { name: "today" }, label: "Today", match: ["today", "session"] },
    { route: { name: "week" }, label: "Week", match: ["week"] },
    { route: { name: "newPlan" }, label: "New plan", match: ["newPlan"] },
    { route: { name: "plans" }, label: "Plans", match: ["plans", "plan"] },
    { route: { name: "me" }, label: "Settings", match: ["me"] },
];

const TITLES: Record<Route["name"], string> = {
    today: "Today", week: "This week", newPlan: "New plan", plans: "Plans", plan: "Plan", session: "Session", me: "Settings",
    signIn: "Sign in", signUp: "Sign up", forgot: "Forgot password", reset: "New password", verify: "Confirm e-mail",
    notFound: "This page does not exist",
};

function Screen({ route }: { route: Route }) {
    const state = useStoreState();
    if (state.status === "loading") return <p role="status" className="py-8 text-muted">Loading…</p>;
    if (state.status === "failed") return <p role="alert" className="py-8 font-semibold text-bad">Your plans could not be opened on this device: {state.reason}</p>;

    // Reading screens stay in a comfortable column; the week uses the whole width.
    const wide = route.name === "week";
    return (
        <div className={`flex w-full flex-col gap-5 ${wide ? "" : "mx-auto max-w-3xl"}`}>
            <ScreenFor route={route} />
        </div>
    );
}

function ScreenFor({ route }: { route: Route }) {
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
            return <SettingsScreen />;
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
                <Empty title="This page does not exist">
                    <p className="text-muted">
                        The address <code>{route.path}</code> does not lead anywhere.
                    </p>
                    <Link to={{ name: "today" }} className={buttonClass("secondary", "self-start")}>
                        Back to Today
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

    // The look follows the setting: light mode or dark mode.
    useEffect(() => {
        applyAppearance(document.documentElement as unknown as { dataset: Record<string, string | undefined> }, appearance, false);
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
                Skip to content
            </a>
            <header className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-xl font-bold notebook:font-display blocks:tracking-tight">Orari</span>
            </header>

            <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-raised md:static md:mx-4 md:mb-4 md:flex md:gap-2 md:rounded-m md:border md:p-1">
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
                {booted.state === "starting" && <p role="status" className="py-8 text-muted">Loading…</p>}
                {booted.state === "failed" && (
                    <p role="alert" className="py-8 font-semibold text-bad">
                        Storage on this device could not be opened: {booted.reason}
                    </p>
                )}
                {services && booted.state === "ready" && (
                    <ServicesContext.Provider value={services}>
                        <Screen route={route} />
                    </ServicesContext.Provider>
                )}
            </main>
        </div>
    );
}
