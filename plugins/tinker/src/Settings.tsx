// React is imported, not taken from the global: the JSX here compiles to
// React.createElement, and a plugin bundle is eval'd with only `vendetta` in
// scope. It happened to work off window.React, which is not something to lean on.
import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { asText, icon, leadingIcon } from "./lib/discord";
import { currentChannel, currentGuild, currentUser } from "./lib/stores";
import { openTarget } from "./pages/TargetPicker";

const { FormSection, FormRow, FormInput, FormSwitchRow, FormDivider } = Forms;

/**
 * Somewhere to start that does not depend on a menu existing.
 *
 * Not every surface is a menu this plugin can reach: a settings screen has no
 * action sheet to append to, and some context menus come from components that
 * never call into the sheet modules at all. These rows work from wherever the
 * client currently is, so there is always a way in.
 */
function OpenRow({ label, subLabel, resolve }: { label: string; subLabel: string; resolve: () => any }) {
    return (
        <FormRow
            label={label}
            subLabel={subLabel}
            leading={leadingIcon("ic_progress_wrench_24px", "ic_more_24px")}
            trailing={FormRow.Arrow}
            onPress={() => {
                const value = resolve();
                if (!value) {
                    showToast(`Nothing to open for "${label}" right now`, icon("ic_warning_24px"));
                    return;
                }
                openTarget({ label, value });
            }}
        />
    );
}

export default () => {
    useProxy(storage);

    return (
        <ReactNative.ScrollView style={{ flex: 1 }}>
            <FormSection title="Open now">
                <OpenRow
                    label="current channel"
                    subLabel="The channel last on screen, editable from anywhere"
                    resolve={currentChannel}
                />
                <FormDivider />
                <OpenRow
                    label="current server"
                    subLabel="The server last on screen — use this for server settings"
                    resolve={currentGuild}
                />
                <FormDivider />
                <OpenRow label="me" subLabel="Your own user record" resolve={currentUser} />
            </FormSection>

            <FormSection title="What to show">
                <FormSwitchRow
                    label="Include derived properties"
                    subLabel="Prototype getters like isPrivate or hasFlag. Some of these throw when read; those rows say so instead of a value."
                    value={storage.showGetters}
                    onValueChange={(v: boolean) => (storage.showGetters = v)}
                />
                <FormDivider />
                <FormSwitchRow
                    label="Include methods"
                    subLabel="Functions can't be edited — off keeps the list to fields you can change."
                    value={storage.showFunctions}
                    onValueChange={(v: boolean) => (storage.showFunctions = v)}
                />
            </FormSection>

            <FormSection title="Behaviour">
                <FormSwitchRow
                    label="Refresh as you type"
                    subLabel="Repaint the message or profile on every edit. Turn off if typing feels slow, then use Apply changes."
                    value={storage.autoRefresh}
                    onValueChange={(v: boolean) => (storage.autoRefresh = v)}
                />
                <FormDivider />
                <FormSwitchRow
                    label="Add the row to every menu"
                    subLabel="Off limits it to message, profile, channel and server menus."
                    value={storage.allSheets}
                    onValueChange={(v: boolean) => (storage.allSheets = v)}
                />
                <FormDivider />
                <FormInput
                    title="JSON depth"
                    value={String(storage.jsonDepth ?? 4)}
                    placeholder="4"
                    keyboardType="numeric"
                    onChange={(raw: unknown) => {
                        // asText for the same reason every other field uses it:
                        // some builds hand back { text } rather than a string,
                        // and parseInt on that is NaN, so the field silently
                        // snapped back to 4 on every keystroke.
                        const depth = parseInt(asText(raw), 10);
                        // Clamped rather than trusted: these objects reference
                        // stores that reference the whole client, so a depth of
                        // 30 serialises most of the app and freezes the thread.
                        storage.jsonDepth = Number.isNaN(depth) ? 4 : Math.min(Math.max(depth, 1), 12);
                    }}
                />
            </FormSection>
        </ReactNative.ScrollView>
    );
};
