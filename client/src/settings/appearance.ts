/**
 * How the app looks is two independent choices the person makes, kept as stable values apart from
 * the words shown for them (Codex ruling of 2026-10-14):
 *
 *   layoutStyle: "notebook" | "blocks"        how time and sessions are drawn, not only their colours
 *   colorMode:   "system" | "light" | "dark"  "system" follows each device's own setting
 *
 * Today they live on the device (IndexedDB, mirrored to localStorage so the page paints in the right
 * look before anything else loads). Accounts will sync them; the values and their meaning do not change.
 */

export const LAYOUT_STYLES = ["notebook", "blocks"] as const;
export const COLOR_MODES = ["system", "light", "dark"] as const;

export type LayoutStyle = (typeof LAYOUT_STYLES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type ResolvedTheme = "light" | "dark";

export interface Appearance {
    layoutStyle: LayoutStyle;
    colorMode: ColorMode;
}

export const DEFAULT_APPEARANCE: Appearance = { layoutStyle: "notebook", colorMode: "system" };

/** The words shown for the stored values. Display only: reword freely, never store these. */
export const LAYOUT_LABELS: Record<LayoutStyle, { name: string; about: string }> = {
    notebook: { name: "Fletore", about: "Letër e ngrohtë, ora në margjinë si në ditar, tituj me shkronja serif." },
    blocks: { name: "Blloqe", about: "Pamje e ftohtë dhe e saktë, orët me numra të mëdhenj, çdo seancë me ngjyrën e llojit të vet." },
};

export const MODE_LABELS: Record<ColorMode, string> = { system: "Si pajisja", light: "E çelët", dark: "E errët" };

export const APPEARANCE_CACHE_KEY = "orari.appearance";

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/** Anything, to a usable Appearance: each field falls back to its default on its own, so one bad field costs only itself. */
export function parseAppearance(value: unknown): Appearance {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
        layoutStyle: isOneOf(LAYOUT_STYLES, record.layoutStyle) ? record.layoutStyle : DEFAULT_APPEARANCE.layoutStyle,
        colorMode: isOneOf(COLOR_MODES, record.colorMode) ? record.colorMode : DEFAULT_APPEARANCE.colorMode,
    };
}

export function resolveTheme(mode: ColorMode, systemPrefersDark: boolean): ResolvedTheme {
    if (mode === "system") return systemPrefersDark ? "dark" : "light";
    return mode;
}

type CacheStorage = Pick<Storage, "getItem" | "setItem">;

/** The device's last choice, or the defaults. Never throws: storage can be blocked or hold junk. */
export function readCachedAppearance(storage: CacheStorage | null): Appearance {
    try {
        const raw = storage?.getItem(APPEARANCE_CACHE_KEY);
        return raw ? parseAppearance(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE };
    } catch {
        return { ...DEFAULT_APPEARANCE };
    }
}

export function writeCachedAppearance(storage: CacheStorage | null, appearance: Appearance): void {
    try {
        storage?.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
    } catch {
        /* blocked or full: the choice still holds for this visit and is kept in IndexedDB */
    }
}

/** Puts the look on the page as two attributes on <html>, which the stylesheet reads. */
export function applyAppearance(root: { dataset: Record<string, string | undefined> }, appearance: Appearance, systemPrefersDark: boolean): ResolvedTheme {
    const theme = resolveTheme(appearance.colorMode, systemPrefersDark);
    root.dataset.style = appearance.layoutStyle;
    root.dataset.theme = theme;
    return theme;
}
