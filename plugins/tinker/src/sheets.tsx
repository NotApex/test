import { React, NavigationNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

import { LazyActionSheet, icon, leadingIcon } from "./lib/discord";
import { preview, typeLabel } from "./lib/reflect";
import ObjectEditor from "./pages/ObjectEditor";

const { FormRow, FormDivider } = Forms;

/** Sheets touched when "every menu" is off. */
const KNOWN_SHEETS = [
    "MessageLongPressActionSheet",
    "UserProfileActionSheet",
    "ChannelLongPressActionSheet",
    "GuildLongPressActionSheet",
    "MessageReactionsActionSheet",
];

const ROW_KEY = "tinker-inspect";

const unpatchers: Array<() => void> = [];

/**
 * Modules already carrying the render patch.
 *
 * The previous version registered a fresh `after` inside every `openLazy`
 * call, which is where the duplicate rows came from: sheet modules are cached,
 * so opening the same sheet twice stacked two patches on one module and both
 * fired on the next render. One patch per module, installed once and left in
 * place, is the fix — a WeakSet keeps it from pinning modules in memory.
 */
const patchedModules = new WeakSet<object>();

/**
 * Targets for whichever sheet renders next.
 *
 * Module-level rather than captured in the patch closure, because the patch
 * now outlives any single open. `before("openLazy")` always runs immediately
 * before the sheet renders, so this is current by the time the row is built.
 */
let currentTargets: Target[] = [];

type Target = { label: string; value: any };

/**
 * Pull the editable objects out of whatever the sheet was opened with.
 *
 * openLazy's third argument is the sheet's props, and the shape is per-sheet —
 * `{ message, channel }` here, `{ user }` there, nothing at all elsewhere. So
 * the well-known names are checked by hand and the whole props bag is offered
 * last, which covers every sheet this doesn't have a name for.
 */
function targetsFrom(props: any): Target[] {
    const out: Target[] = [];
    if (!props || typeof props !== "object") return out;

    for (const name of ["message", "user", "channel", "guild", "member", "role", "emoji", "sticker", "attachment"]) {
        const value = props[name];
        if (value && typeof value === "object") out.push({ label: name, value });
    }

    // Message sheets don't pass the author separately, and it's the most-edited
    // object here, so it gets promoted to a top-level entry.
    const author = props.message?.author;
    if (author && typeof author === "object") out.push({ label: "message.author", value: author });

    out.push({ label: "sheet props", value: props });
    return out;
}

function TargetPicker({ targets }: { targets: Target[] }) {
    const navigation = NavigationNative.useNavigation();

    return (
        <>
            {targets.map((target, index) => (
                <React.Fragment key={target.label}>
                    {index > 0 && <FormDivider />}
                    <FormRow
                        label={target.label}
                        subLabel={`${typeLabel(target.value)} · ${preview(target.value)}`}
                        trailing={FormRow.Arrow}
                        onPress={() =>
                            navigation.push("VendettaCustomPage", {
                                title: target.label,
                                render: () => <ObjectEditor target={target.value} path={target.label} />,
                            })
                        }
                    />
                </React.Fragment>
            ))}
        </>
    );
}

/** The row appended to the sheet. */
function InspectRow({ targets }: { targets: Target[] }) {
    // Read inside the row, not passed in: the sheet renders within the
    // navigator, so this resolves to the stack underneath it and the pushed
    // page lands where the user expects.
    const navigation = NavigationNative.useNavigation();

    const open = () => {
        try {
            LazyActionSheet?.hideActionSheet?.();

            // One candidate isn't a choice — skip the picker.
            if (targets.length === 1) {
                navigation.push("VendettaCustomPage", {
                    title: targets[0].label,
                    render: () => <ObjectEditor target={targets[0].value} path={targets[0].label} />,
                });
                return;
            }

            navigation.push("VendettaCustomPage", {
                title: "Inspect & edit",
                render: () => <TargetPicker targets={targets} />,
            });
        } catch (err: any) {
            showToast(`Couldn't open editor: ${err?.message ?? err}`, icon("ic_warning_24px"));
        }
    };

    return (
        <>
            <FormDivider />
            <FormRow
                label="Inspect & edit"
                subLabel={targets.map((t) => t.label).join(", ")}
                leading={leadingIcon("ic_progress_wrench_24px", "ic_more_24px")}
                trailing={FormRow.Arrow}
                onPress={open}
            />
        </>
    );
}

/**
 * Append the row to a rendered sheet.
 *
 * Sheets share no row container, so the first attempt looks for any node whose
 * children array already holds row-ish elements — that lands the entry inline
 * with the sheet's own options. Otherwise the row is wrapped onto the end of
 * the returned tree, which is uglier but always works, and an unrecognised
 * sheet is exactly where an entry point is most wanted.
 *
 * The fallback returns a new tree rather than assigning to `props.children`:
 * React element props are frozen under a development build, so the assignment
 * would be a silent no-op there and a crash under `use strict`.
 */
function inject(tree: any): any {
    const targets = currentTargets;
    if (!tree || !targets.length) return tree;

    try {
        const row = <InspectRow targets={targets} key={ROW_KEY} />;

        const container = findInReactTree(tree, (node: any) => {
            if (!Array.isArray(node?.props?.children)) return false;
            return node.props.children.some((child: any) => {
                const name = child?.type?.name ?? child?.type?.displayName;
                return typeof name === "string" && /Row|Button|Item/.test(name);
            });
        });

        if (container) {
            const children = container.props.children;
            // Belt and braces against the duplicate: a sheet can return a
            // children array React holds across re-renders, and this patch is
            // permanent, so an unconditional push stacks a row per render.
            if (!children.some((child: any) => child?.key === ROW_KEY)) children.push(row);
            return tree;
        }

        return (
            <>
                {tree}
                {row}
            </>
        );
    } catch {
        // A sheet whose shape defeats both strategies should still open.
        return tree;
    }
}

export function patchActionSheets(): void {
    if (!LazyActionSheet?.openLazy) {
        showToast("tinker: action sheet module not found", icon("ic_warning_24px"));
        return;
    }

    unpatchers.push(
        before("openLazy", LazyActionSheet, ([component, key, props]: [any, string, any]) => {
            currentTargets =
                !storage.allSheets && !KNOWN_SHEETS.includes(key) ? [] : targetsFrom(props);

            if (typeof component?.then !== "function") return;

            component
                .then((instance: any) => {
                    if (typeof instance?.default !== "function") return;
                    if (patchedModules.has(instance)) return;

                    patchedModules.add(instance);
                    unpatchers.push(after("default", instance, (_args: unknown[], result: any) => inject(result)));
                })
                .catch(() => {});
        })
    );
}

export function unpatchAll(): void {
    unpatchers.forEach((unpatch) => unpatch());
    unpatchers.length = 0;
    currentTargets = [];
}
