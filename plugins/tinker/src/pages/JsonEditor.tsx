import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms, General } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { asText } from "../lib/discord";
import { safeStringify } from "../lib/reflect";
import { refresh } from "../lib/refresh";

const { FormSection, FormRow, FormInput, FormDivider } = Forms;
// Not Forms.FormText: Discord's Forms module doesn't export it on current
// builds, so it rendered as undefined and took the page down. General is
// findByProps("Button", "Text", "View"), which Vendetta itself relies on.
const { Text } = General;

export default function JsonEditor({ target, path }: { target: any; path: string }) {
    const depth = Number(storage.jsonDepth) || 4;
    const [text, setText] = React.useState(() => safeStringify(target, depth));
    const [error, setError] = React.useState<string | null>(null);

    const apply = () => {
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch (err: any) {
            setError(String(err?.message ?? err));
            return;
        }

        if (!parsed || typeof parsed !== "object") {
            setError("Top level must be an object or array");
            return;
        }

        setError(null);

        // Assign rather than replace. The store holds this exact reference, so
        // swapping in a fresh object would edit a copy nothing is looking at.
        //
        // Keys are merged, not reset: anything the serialiser dropped or
        // stubbed — functions, values past the depth limit, circular refs —
        // is left alone instead of being overwritten with the "[Object]"
        // placeholder standing in for it.
        try {
            if (Array.isArray(target) && Array.isArray(parsed)) {
                target.length = 0;
                target.push(...parsed);
            } else {
                for (const [key, value] of Object.entries(parsed)) {
                    if (typeof value === "string" && /^\[(Object|Array\(\d+\)|Circular|Function .*|undefined|Threw: .*)\]$/.test(value))
                        continue;
                    target[key] = value;
                }
            }
        } catch (err: any) {
            setError(String(err?.message ?? err));
            return;
        }

        const result = refresh(target);
        showToast(result.detail, getAssetIDByName(result.ok ? "ic_edit_24px" : "ic_warning_24px"));
    };

    return (
        <ReactNative.ScrollView style={{ flex: 1 }}>
            <FormSection title="Apply">
                <FormRow
                    label="Save JSON"
                    subLabel="Merges these keys back into the live object"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_message_retry")} />}
                    onPress={apply}
                />
                <FormDivider />
                <FormRow
                    label="Reset"
                    subLabel="Reload the text from the object"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_history_24px")} />}
                    onPress={() => {
                        setText(safeStringify(target, depth));
                        setError(null);
                    }}
                />
            </FormSection>

            {error && (
                <FormSection title="Error">
                    <Text style={{ paddingHorizontal: 16, paddingVertical: 8 }}>{error}</Text>
                </FormSection>
            )}

            <FormSection title={path}>
                <FormInput
                    value={text}
                    multiline
                    onChange={(raw: unknown) => setText(asText(raw))}
                    style={{ minHeight: 320, fontFamily: "monospace" }}
                />
                <Text style={{ paddingHorizontal: 16, paddingVertical: 8, opacity: 0.6 }}>
                    Values shown as [Object], [Circular] or [Function] were too deep or not
                    serialisable. They are skipped on save, not written back as text. Raise the
                    depth limit in settings to reach them.
                </Text>
            </FormSection>
        </ReactNative.ScrollView>
    );
}
