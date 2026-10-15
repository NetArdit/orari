/**
 * How the app looks is ONE choice for the person: light mode or dark mode (owner decision, 2026-10-15). Light mode
 * is the notebook layout in light colours; dark mode is the blocks layout in dark colours. The two stored values
 * (layoutStyle and colorMode) are kept so older stored choices still read, and always move together:
 *
 *   light = { layoutStyle: "notebook", colorMode: "light" }
 *   dark  = { layoutStyle: "blocks",   colorMode: "dark" }
 *
 * The choice lives on the device (IndexedDB, mirrored to localStorage so the page paints in the right look
 * before anything else loads).
 */

export const LAYOUT_STYLES = ["notebook", "blocks"] as const;
export const COLOR_MODES = ["light", "dark"] as const;

export type LayoutStyle = (typeof LAYOUT_STYLES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type ResolvedTheme = "light" | "dark";

export interface Appearance {
    layoutStyle: LayoutStyle;
    colorMode: ColorMode;
}

export const DEFAULT_APPEARANCE: Appearance = { layoutStyle: "notebook", colorMode: "light" };

/** The two looks. Choosing one sets both stored values together. */
export const LOOKS: Record<ColorMode, Appearance> = {
    light: { layoutStyle: "notebook", colorMode: "light" },
    dark: { layoutStyle: "blocks", colorMode: "dark" },
};

/** The words shown for the stored values. Display only: reword freely, never store these. */
export const LAYOUT_LABELS: Record<LayoutStyle, { name: string; about: string }> = {
    notebook: { name: "Light mode", about: "Warm paper, the hour in the margin like a diary, serif headings." },
    blocks: { name: "Dark mode", about: "Cool and exact, large numbers for the hours, each session in the colour of its kind." },
};

export const MODE_LABELS: Record<ColorMode, string> = { light: "Light mode", dark: "Dark mode" };

export const APPEARANCE_CACHE_KEY = "orari.appearance";

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Anything, to a usable Appearance. Only the colour mode decides: "dark" gives dark mode, anything else (including
 * the old "system" and the old layout-only choices) gives light mode.
 */
export function parseAppearance(value: unknown): Appearance {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return isOneOf(COLOR_MODES, record.colorMode) && record.colorMode === "dark" ? { ...LOOKS.dark } : { ...LOOKS.light };
}

export function resolveTheme(mode: ColorMode, _systemPrefersDark: boolean): ResolvedTheme {
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
