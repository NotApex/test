import { React } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";

import { logger } from "@vendetta";

import { LazyActionSheet, icon, leadingIcon, pushPage } from "./lib/discord";
import { preview, typeLabel } from "./lib/reflect";
import { currentChannel, currentGuild, getChannel, getGuild, getMember, getMessage, getUser } from "./lib/stores";
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

/** Names a sheet might hand the object under, in the order worth offering them. */
const DIRECT = ["message", "user", "channel", "guild", "member", "role", "emoji", "sticker", "attachment"];

/** Sub-objects of a message worth promoting past the drill-in. */
const MESSAGE_PARTS = ["author", "interaction", "messageReference", "stickerItems", "stickers", "embeds", "attachments"];

/** Both spellings of every id a sheet might identify its subject by. */
const ID_PROPS = {
    channel: ["channelId", "channel_id"],
    guild: ["guildId", "guild_id"],
    user: ["userId", "user_id", "targetUserId"],
    message: ["messageId", "message_id"],
};

const firstId = (props: any, names: string[]): unknown => {
    for (const name of names) {
        const value = props[name];
        if (typeof value === "string" || typeof value === "number") return value;
    }
    return undefined;
};

/**
 * Pull the editable objects out of whatever the sheet was opened with.
 *
 * openLazy's third argument is the sheet's props, and the shape is entirely
 * per-sheet: `{ message, channel }` here, `{ user }` there, `{ channelId }`
 * somewhere else, and a fair number pass nothing at all. Only the first of
 * those was handled, so a sheet identifying its subject by id got a row with
 * nothing useful behind it, and a sheet with no props got no row whatsoever —
 * the channel menu among them.
 *
 * So: named objects first, then ids resolved through the stores, then the parts
 * of a message worth promoting, then the raw props bag, and finally whatever is
 * on screen. That last fallback is what guarantees an unrecognised sheet still
 * gets an entry point, which is exactly where one is most wanted.
 */
function targetsFrom(props: any): Target[] {
    const out: Target[] = [];

    const add = (label: string, value: any) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value) && value.length === 0) return; // every message has `embeds: []`
        if (out.some((target) => target.value === value)) return; // same object under two names
        out.push({ label, value });
    };

    if (props && typeof props === "object") {
        for (const name of DIRECT) add(name, props[name]);

        // Ids into objects. Done after the direct names so a sheet passing both
        // the record and its id doesn't list the same object twice.
        const channelId = firstId(props, ID_PROPS.channel);
        const guildId = firstId(props, ID_PROPS.guild);
        const userId = firstId(props, ID_PROPS.user);
        const messageId = firstId(props, ID_PROPS.message);

        add("message", getMessage(channelId, messageId));
        add("channel", getChannel(channelId));
        add("guild", getGuild(guildId));
        add("user", getUser(userId));
        add("member", getMember(guildId, userId));

        const message = out.find((target) => target.label === "message")?.value;
        if (message) for (const name of MESSAGE_PARTS) add(`message.${name}`, message[name]);

        add("sheet props", props);
    }

    // Always something to open, even for a sheet that says nothing about itself.
    add("current channel", currentChannel());
    add("current guild", currentGuild());

    return out;
}

const openTarget = (target: Target) =>
    pushPage(target.label, () => <ObjectEditor target={target.value} path={target.label} />);

function TargetPicker({ targets }: { targets: Target[] }) {
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

/** The row appended to the sheet. */
function InspectRow({ targets }: { targets: Target[] }) {
    const open = () => {
        try {
            LazyActionSheet?.hideActionSheet?.();

            // One candidate isn't a choice — skip the picker.
            if (targets.length === 1) {
                openTarget(targets[0]);
                return;
            }

            pushPage("Inspect & edit", () => <TargetPicker targets={targets} />);
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

/**
 * Guards patches registered from the `openLazy` promise.
 *
 * That `.then` can resolve after the plugin is unloaded, and a patch installed
 * then would miss `unpatchAll` entirely — the row would keep appearing on a
 * disabled plugin, with no handle left to remove it.
 */
let live = false;

export function patchActionSheets(): void {
    if (!LazyActionSheet?.openLazy) {
        showToast("tinker: action sheet module not found", icon("ic_warning_24px"));
        return;
    }

    live = true;

    unpatchers.push(
        before("openLazy", LazyActionSheet, ([component, key, props]: [any, string, any]) => {
            currentTargets =
                !storage.allSheets && !KNOWN_SHEETS.includes(key) ? [] : targetsFrom(props);

            // The prop names are the whole story when a sheet comes up without
            // the row, or with less on it than expected: they say what the sheet
            // was opened with and therefore what there was to work from.
            logger.log(
                `[tinker] sheet ${key}: props {${props && typeof props === "object" ? Object.keys(props).join(", ") : typeof props}} ` +
                    `-> ${currentTargets.length ? currentTargets.map((t) => t.label).join(", ") : "no targets"}`
            );

            if (typeof component?.then !== "function") return;

            component
                .then((instance: any) => {
                    if (!live) return;
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
    live = false;
    unpatchers.forEach((unpatch) => unpatch());
    unpatchers.length = 0;
    currentTargets = [];
}
