import { useServices } from "../app/services.tsx";
import { LOOKS } from "../settings/appearance.ts";
import { ScreenTitle } from "../ui/primitives.tsx";
import { AccountPanel, LogOutButton } from "./AccountScreens.tsx";

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

/** Account first, then the look, and log out last. */
export function SettingsScreen() {
    const { appearance, setAppearance } = useServices();
    const dark = appearance.colorMode === "dark";

    return (
        <>
            <ScreenTitle title="Settings" />

            <AccountPanel />

            <section aria-label="Appearance" className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Appearance</h2>
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

            <LogOutButton />
        </>
    );
}
