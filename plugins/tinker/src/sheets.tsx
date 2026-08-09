import { findByProps } from "@vendetta/metro";
import { React, NavigationNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

import { typeLabel, preview } from "./lib/reflect";
import ObjectEditor from "./pages/ObjectEditor";

const { FormRow, FormDivider } = Forms;

const LazyActionSheet = findByProps("openLazy", "hideActionSheet");

/** Sheets worth touching when "every sheet" is off. */
const KNOWN_SHEETS = [
    "MessageLongPressActionSheet",
    "UserProfileActionSheet",
    "ChannelLongPressActionSheet",
    "GuildLongPressActionSheet",
    "MessageReactionsActionSheet",
];

const unpatchers: Array<() => void> = [];

type Target = { label: string; value: any };

/**
 * Pull the editable objects out of whatever the sheet was opened with.
 *
 * openLazy's third argument is the sheet's props, and its shape is entirely
 * per-sheet — `{ message, channel }` here, `{ user, guildId }` there, nothing
 * at all somewhere else. So the well-known names are checked by hand and the
 * whole props bag is offered as a last entry, which covers every sheet this
 * doesn't have a name for.
 */
function targetsFrom(props: any): Target[] {
    const out: Target[] = [];
    if (!props || typeof props !== "object") return out;

    for (const name of ["message", "user", "channel", "guild", "member", "role", "emoji", "sticker", "attachment"]) {
        const value = props[name];
        if (value && typeof value === "object") out.push({ label: name, value });
    }

    // A message sheet usually doesn't pass the author separately, and it's the
    // single most-edited object here, so it's promoted to a top-level entry.
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
                        trailing={<FormRow.Arrow />}
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
    // Read inside the row rather than passed in: the action sheet renders
    // within the navigator, so this resolves to the stack the sheet is sitting
    // on top of and the pushed page lands where the user expects.
    const navigation = NavigationNative.useNavigation();

    const open = () => {
        try {
            LazyActionSheet.hideActionSheet();

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
            showToast(`Couldn't open editor: ${err?.message ?? err}`, getAssetIDByName("ic_warning_24px"));
        }
    };

    return (
        <>
            <FormDivider />
            <FormRow
                label="Inspect & edit"
                subLabel={targets.map((t) => t.label).join(", ")}
                leading={<FormRow.Icon source={getAssetIDByName("ic_edit_24px")} />}
                trailing={<FormRow.Arrow />}
                onPress={open}
            />
        </>
    );
}

/**
 * Append the row to a rendered sheet.
 *
 * There is no shared row container across sheets, so the first attempt looks
 * for any node whose children array already holds row-ish elements and pushes
 * onto it — that lands the entry inline with the sheet's own options. When the
 * shape isn't recognised the row is wrapped onto the end of the tree instead,
 * which is uglier but always works, and an unrecognised sheet is exactly the
 * case where an entry point is most wanted.
 */
function injectRow(tree: any, targets: Target[]): void {
    const row = <InspectRow targets={targets} key="tinker-inspect" />;

    const container = findInReactTree(tree, (node: any) => {
        if (!Array.isArray(node?.props?.children)) return false;
        return node.props.children.some((child: any) => {
            const name = child?.type?.name ?? child?.type?.displayName;
            return typeof name === "string" && /Row|Button|Item/.test(name);
        });
    });

    if (container) {
        container.props.children.push(row);
        return;
    }

    const root = findInReactTree(tree, (node: any) => node?.props?.children !== undefined) ?? tree;
    root.props.children = (
        <>
            {root.props.children}
            {row}
        </>
    );
}

export function patchActionSheets(): void {
    unpatchers.push(
        before("openLazy", LazyActionSheet, ([component, key, props]: [any, string, any]) => {
            if (typeof component?.then !== "function") return;
            if (!storage.allSheets && !KNOWN_SHEETS.includes(key)) return;

            const targets = targetsFrom(props);
            if (!targets.length) return;

            component
                .then((instance: any) => {
                    if (typeof instance?.default !== "function") return;

                    const unpatch = after("default", instance, (_args: unknown[], result: any) => {
                        // The module object is shared and cached, so this patch
                        // would otherwise stack once per open. Drop it the
                        // moment it fires.
                        unpatch();
                        if (!result) return result;

                        try {
                            injectRow(result, targets);
                        } catch {
                            // A sheet whose shape defeats both strategies should
                            // still open normally.
                        }
                        return result;
                    });

                    // Some sheets are prefetched and never rendered. Without
                    // this the patch above sits on the module forever, firing
                    // against a stale props bag the next time that sheet opens.
                    setTimeout(unpatch, 10_000);
                })
                .catch(() => {});
        })
    );
}

export function unpatchAll(): void {
    unpatchers.forEach((unpatch) => unpatch());
    unpatchers.length = 0;
}
