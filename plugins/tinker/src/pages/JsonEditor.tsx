import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms, General } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { asText } from "../lib/discord";
import { isPlainData, readKey, safeStringify } from "../lib/reflect";
import { refresh } from "../lib/refresh";

const { FormSection, FormRow, FormInput, FormDivider } = Forms;
// Not Forms.FormText: Discord's Forms module doesn't export it on current
// builds, so it rendered as undefined and took the page down. General is
// findByProps("Button", "Text", "View"), which Vendetta itself relies on.
const { Text } = General;

const PLACEHOLDER = /^\[(Object|Array\(\d+\)|Circular|Function .*|undefined|Threw: .*)\]$/;

/** Cheap structural compare, good enough to tell "user edited this" from "user didn't". */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function JsonEditor({ target, path }: { target: any; path: string }) {
    const depth = Number(storage.jsonDepth) || 4;
    const [text, setText] = React.useState(() => safeStringify(target, depth));
    const [error, setError] = React.useState<string | null>(null);
    const [note, setNote] = React.useState<string | null>(null);

    // What the text field started as. Anything still matching this was not
    // touched, so it is left alone rather than written back — writing a key
    // back is never free, and for the ones the serialiser flattened it is
    // actively destructive.
    const baseline = React.useRef<any>(null);
    if (baseline.current === null) {
        try {
            baseline.current = JSON.parse(safeStringify(target, depth));
        } catch {
            baseline.current = {};
        }
    }

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
        // Three classes of key are skipped rather than written:
        //
        //  - placeholders, standing in for something the serialiser could not
        //    represent (functions, past the depth limit, circular);
        //  - keys identical to what the editor opened with, i.e. untouched;
        //  - keys whose live value is a class instance — a moment timestamp, a
        //    UserRecord — which JSON.parse would replace with a lookalike that
        //    has no methods, crashing the renderer the moment it repaints.
        //
        // The last two are why this used to take the chat view down: every key
        // was written back on save, so an untouched `timestamp` was quietly
        // downgraded from a moment to a plain object.
        const skipped: string[] = [];

        try {
            if (Array.isArray(target) && Array.isArray(parsed)) {
                target.length = 0;
                target.push(...parsed);
            } else {
                for (const [key, value] of Object.entries(parsed)) {
                    if (typeof value === "string" && PLACEHOLDER.test(value)) continue;
                    if (same(value, baseline.current?.[key])) continue;

                    const read = readKey(target, key);
                    if (read.ok && !isPlainData(read.value)) {
                        skipped.push(key);
                        continue;
                    }

                    target[key] = value;
                }
            }
        } catch (err: any) {
            setError(String(err?.message ?? err));
            return;
        }

        // Re-baseline so a second save doesn't re-apply what just landed.
        try {
            baseline.current = JSON.parse(safeStringify(target, depth));
        } catch {}

        setNote(
            skipped.length
                ? `Left alone: ${skipped.join(", ")} — live object${skipped.length > 1 ? "s" : ""}, not plain data. Drill into the field to edit it.`
                : null
        );

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
                        const fresh = safeStringify(target, depth);
                        setText(fresh);
                        try {
                            baseline.current = JSON.parse(fresh);
                        } catch {}
                        setError(null);
                        setNote(null);
                    }}
                />
            </FormSection>

            {error && (
                <FormSection title="Error">
                    <Text style={{ paddingHorizontal: 16, paddingVertical: 8 }}>{error}</Text>
                </FormSection>
            )}

            {note && (
                <FormSection title="Skipped">
                    <Text style={{ paddingHorizontal: 16, paddingVertical: 8 }}>{note}</Text>
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
