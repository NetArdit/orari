import { useState } from "react";
import { useServices } from "../app/services.tsx";
import { LOOKS } from "../settings/appearance.ts";
import { ScreenTitle } from "../ui/primitives.tsx";
import { AccountPanel, LogOutButton } from "./AccountScreens.tsx";
import { RemindersPanel } from "./Reminders.tsx";

function SunIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
    );
}

const TABS = [
    ["account", "Account"],
    ["reminders", "Reminders"],
    ["appearance", "Appearance"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Three groups instead of one long page: the account, the reminders, the look. Log out stays last. */
export function SettingsScreen() {
    const { appearance, setAppearance } = useServices();
    const dark = appearance.colorMode === "dark";
    const [tab, setTab] = useState<Tab>("account");

    const onKey = (e: React.KeyboardEvent) => {
        const i = TABS.findIndex(([id]) => id === tab);
        const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
        if (next < 0) return;
        e.preventDefault();
        const id = TABS[next]![0];
        setTab(id);
        document.getElementById(`settings-tab-${id}`)?.focus();
    };

    return (
        <>
            <ScreenTitle title="Settings" />

            <div role="tablist" aria-label="Settings" onKeyDown={onKey} className="grid grid-cols-3 gap-1 rounded-m bg-sunk p-1">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        id={`settings-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        aria-controls={`settings-panel-${id}`}
                        tabIndex={tab === id ? 0 : -1}
                        onClick={() => setTab(id)}
                        className="min-h-11 rounded-s px-2 text-sm font-semibold text-muted aria-selected:bg-raised aria-selected:text-ink aria-selected:shadow-raised focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" hidden={tab !== "account"} className="flex flex-col gap-3">
                <AccountPanel />
            </div>
            <div id="settings-panel-reminders" role="tabpanel" aria-labelledby="settings-tab-reminders" hidden={tab !== "reminders"} className="flex flex-col gap-3">
                <RemindersPanel />
            </div>
            <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={tab !== "appearance"} className="flex flex-col gap-3">
                <section aria-label="Appearance" className="flex flex-col gap-3 rounded-m border border-line bg-raised p-4">
                    <h2 className="text-base font-semibold">Appearance</h2>
                    <p className="text-sm text-muted">Light mode is the warm notebook look. Dark mode is the cool blocks look.</p>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={dark}
                        aria-label="Dark mode"
                        data-testid="theme-toggle"
                        onClick={() => setAppearance(dark ? LOOKS.light : LOOKS.dark)}
                        className="flex min-h-11 w-fit items-center gap-3 rounded-full border border-control bg-raised px-4 font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
                    >
                        {dark ? <MoonIcon /> : <SunIcon />}
                        <span>{dark ? "Dark mode" : "Light mode"}</span>
                    </button>
                </section>
            </div>

            <LogOutButton />
        </>
    );
}
