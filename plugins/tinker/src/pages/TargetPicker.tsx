import { React } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { icon, pushPage } from "../lib/discord";
import { preview, typeLabel } from "../lib/reflect";
import ObjectEditor from "./ObjectEditor";

const { FormRow, FormDivider } = Forms;

export type Target = { label: string; value: any };

/** Open one object straight in the editor. */
export const openTarget = (target: Target) =>
    pushPage(target.label, () => <ObjectEditor target={target.value} path={target.label} />);

export default function TargetPicker({ targets }: { targets: Target[] }) {
    return (
        <>
            {targets.map((target, index) => (
                <React.Fragment key={target.label}>
                    {index > 0 && <FormDivider />}
                    <FormRow
                        label={target.label}
                        subLabel={`${typeLabel(target.value)} · ${preview(target.value)}`}
                        trailing={FormRow.Arrow}
                        onPress={() => openTarget(target)}
                    />
                </React.Fragment>
            ))}
        </>
    );
}

/**
 * Entry point for every surface: sheets, simple context menus, the settings page.
 *
 * One candidate isn't a choice, so the picker is skipped for it. Errors are
 * caught here rather than at each call site — several of them are inside a
 * menu's onPress, where a throw takes the menu down with it.
 */
export function openTargets(targets: Target[], title = "Inspect & edit"): void {
    try {
        if (!targets.length) {
            showToast("tinker: nothing to inspect here", icon("ic_warning_24px"));
            return;
        }

        if (targets.length === 1) {
            openTarget(targets[0]);
            return;
        }

        pushPage(title, () => <TargetPicker targets={targets} />);
    } catch (err: any) {
        showToast(`Couldn't open editor: ${err?.message ?? err}`, icon("ic_warning_24px"));
    }
}
