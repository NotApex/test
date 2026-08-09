import { ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { FormSection, FormInput, FormSwitchRow, FormDivider } = Forms;

export default () => {
    useProxy(storage);

    return (
        <ReactNative.ScrollView style={{ flex: 1 }}>
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
                    onChange={(v: string) => {
                        const depth = parseInt(v, 10);
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
