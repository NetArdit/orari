import { useServices } from "../app/services.tsx";
import { COLOR_MODES, LAYOUT_LABELS, LAYOUT_STYLES, MODE_LABELS } from "../settings/appearance.ts";
import { ScreenTitle } from "../ui/primitives.tsx";
import type { MigrationOutcome } from "../storage/legacy.ts";

export interface DeviceInfo {
    migration: MigrationOutcome;
    profileName: string | null;
    unreadablePlans: number;
    aiConfigured: boolean | null;
}

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

export function SettingsScreen({ device, planCount }: { device: DeviceInfo; planCount: number }) {
    const { appearance, setAppearance } = useServices();

    return (
        <>
            <ScreenTitle title="Cilësimet" />

            <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-lg font-semibold">Stili</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                    {LAYOUT_STYLES.map((style) => (
                        <label key={style} className="flex cursor-pointer flex-col gap-1 rounded-m border border-line bg-raised p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-wash has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-accent">
                            <span className="flex items-center gap-2 font-semibold">
                                <input type="radio" name="layoutStyle" value={style} checked={appearance.layoutStyle === style} onChange={() => setAppearance({ ...appearance, layoutStyle: style })} className="size-4 accent-[var(--accent)]" />
                                {LAYOUT_LABELS[style].name}
                            </span>
                            <span className="text-[13px] text-muted">{LAYOUT_LABELS[style].about}</span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-lg font-semibold">Pamja</legend>
                <div className="flex flex-wrap gap-2">
                    {COLOR_MODES.map((mode) => (
                        <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-raised px-4 font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent-wash has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-accent">
                            <input type="radio" name="colorMode" value={mode} checked={appearance.colorMode === mode} onChange={() => setAppearance({ ...appearance, colorMode: mode })} className="size-4 accent-[var(--accent)]" />
                            {MODE_LABELS[mode]}
                        </label>
                    ))}
                </div>
                <p className="text-[13px] text-muted">"Si pajisja" ndjek cilësimin e secilës pajisje, kështu që telefoni dhe kompjuteri mund të dalin ndryshe.</p>
            </fieldset>

            <section aria-label="Të dhënat në këtë pajisje" className="flex flex-col gap-2 rounded-m bg-sunk p-4" data-testid="status" data-state="ready">
                <h2 className="text-lg font-semibold">Të dhënat në këtë pajisje</h2>
                <ul className="list-disc pl-5 text-sm">
                    <li data-testid="migration" data-status={device.migration.status}>
                        {migrationText(device.migration)}
                    </li>
                    <li data-testid="profile">Profili: {device.profileName ?? "ende pa profil"}</li>
                    <li data-testid="plans">
                        Plane në këtë pajisje: {planCount}
                        {device.unreadablePlans > 0 ? ` (${device.unreadablePlans} nuk lexohen)` : ""}
                    </li>
                    <li data-testid="server">Serveri: {device.aiConfigured === null ? "nuk përgjigjet" : device.aiConfigured ? "gati, me AI" : "gati, pa çelës AI"}</li>
                </ul>
                <p className="text-[13px] text-muted">Plani yt ruhet vetëm në këtë pajisje. Llogaritë, për ta hapur edhe në telefon, vijnë më vonë.</p>
            </section>
        </>
    );
}
