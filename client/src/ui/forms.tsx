import { useId } from "react";
import type { ReactNode } from "react";

export const INPUT = "min-h-11 w-full rounded-m border border-line bg-raised px-3 text-ink aria-[invalid=true]:border-bad";

/**
 * A labelled control. The label is a real <label for>, the hint and the error are tied to the control
 * with aria-describedby, and the control is marked invalid when there is an error.
 */
export function Field({
    label,
    hint,
    errors,
    children,
}: {
    label: string;
    hint?: string | undefined;
    errors?: string[] | undefined;
    children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean }) => ReactNode;
}) {
    const id = useId();
    const describedBy = [hint ? `${id}-hint` : null, errors?.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="font-semibold">
                {label}
            </label>
            {children({ id, "aria-describedby": describedBy, "aria-invalid": Boolean(errors?.length) })}
            {hint && (
                <p id={`${id}-hint`} className="text-[13px] text-muted">
                    {hint}
                </p>
            )}
            {errors?.length ? (
                <p id={`${id}-error`} className="text-[13px] font-semibold text-bad">
                    {errors.join(" ")}
                </p>
            ) : null}
        </div>
    );
}
