import { ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { FormSection, FormInput, FormSwitchRow, FormDivider } = Forms;

export default () => {
    useProxy(storage);

    return (
        <ReactNative.ScrollView style={{ flex: 1 }}>
            <FormSection title="Defaults">
                <FormInput
                    title="Default display name"
                    value={storage.defaultName}
                    placeholder="Clyde"
                    onChange={(v: string) => (storage.defaultName = v)}
                />
                <FormDivider />
                <FormInput
                    title="Default pfp"
                    value={storage.defaultPfp}
                    placeholder="clyde"
                    onChange={(v: string) => (storage.defaultPfp = v)}
                />
            </FormSection>

            <FormSection title="Appearance">
                <FormSwitchRow
                    label="Show 'Only you can see this'"
                    subLabel="Discord's ephemeral hint. Turning it off only changes how the message looks to you — it is local-only either way."
                    value={storage.showEphemeralHint}
                    onValueChange={(v: boolean) => (storage.showEphemeralHint = v)}
                />
            </FormSection>
        </ReactNative.ScrollView>
    );
};
