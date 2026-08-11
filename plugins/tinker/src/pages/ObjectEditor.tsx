import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showInputAlert } from "@vendetta/ui/alerts";
import { Forms, General } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { asText, icon, leadingIcon, pushPage, showMenu } from "../lib/discord";
import {
    coerce,
    deleteKey,
    isLeaf,
    Kind,
    kindOf,
    keysOf,
    preview,
    readKey,
    safeStringify,
    typeLabel,
    writeKey,
} from "../lib/reflect";
import { refresh } from "../lib/refresh";
import JsonEditor from "./JsonEditor";

const { FormSection, FormRow, FormInput, FormSwitchRow, FormDivider } = Forms;
// Forms.FormText is not present on every client build. General is
// findByProps("Button", "Text", "View"), which Vendetta itself relies on.
const { Text } = General;

/** Rows rendered before the "Show more" cut-off. A guild's member list is not a scroll view. */
const PAGE = 60;

const note = (message: string, ok = true) =>
    showToast(message, icon(ok ? "ic_message_retry" : "ic_warning_24px"));

/**
 * A text field for one primitive property.
 *
 * Holds its own draft state rather than reading straight off the object: a
 * controlled input fed from a value a parent re-render can replace loses the
 * cursor mid-word, and the parent re-renders on every commit.
 */
function LeafInput({
    obj,
    name,
    kind,
    onCommit,
}: {
    obj: any;
    name: string;
    kind: Kind;
    onCommit: () => void;
}) {
    const initial = React.useMemo(() => {
        const read = readKey(obj, name);
        return read.ok ? String(read.value ?? "") : "";
    }, [obj, name]);

    const [text, setText] = React.useState(initial);
    // One complaint per field, or a read-only property fires a toast on every
    // keystroke and buries the screen.
    const warned = React.useRef(false);

    return (
        <FormInput
            title={`${name}  ·  ${kind}`}
            value={text}
            multiline={text.length > 64}
            onChange={(raw: unknown) => {
                const next = asText(raw);
                setText(next);

                const parsed = coerce(next, kind);
                if (!parsed.ok) return; // half-typed number; wait for it

                const error = writeKey(obj, name, parsed.value);
                if (error) {
                    if (!warned.current) {
                        warned.current = true;
                        note(`${name}: ${error}`, false);
                    }
                    return;
                }
                onCommit();
            }}
        />
    );
}

export default function ObjectEditor({ target, path }: { target: any; path: string }) {
    useProxy(storage);

    const [tick, bump] = React.useReducer((n: number) => n + 1, 0);
    const [query, setQuery] = React.useState("");
    const [limit, setLimit] = React.useState(PAGE);

    // Recomputed on every commit on purpose: adding or deleting a key has to
    // show immediately, and these objects are mutated in place, so there is no
    // new reference to key a memo off.
    const keys = React.useMemo(
        () => keysOf(target, !!storage.showGetters),
        [target, tick, storage.showGetters]
    );

    const needle = query.trim().toLowerCase();
    const visible = keys.filter((key) => {
        if (needle && !key.toLowerCase().includes(needle)) return false;
        if (!storage.showFunctions) {
            const read = readKey(target, key);
            if (read.ok && typeof read.value === "function") return false;
        }
        return true;
    });

    const commit = () => {
        bump();
        if (storage.autoRefresh) refresh(target);
    };

    const rowMenu = (key: string, value: unknown) =>
        showMenu(key, [
            {
                label: "Copy value",
                onPress: () => {
                    clipboard.setString(
                        isLeaf(kindOf(value))
                            ? String(value)
                            : safeStringify(value, Number(storage.jsonDepth) || 4)
                    );
                    note("Copied value");
                },
            },
            {
                label: "Copy path",
                onPress: () => {
                    clipboard.setString(`${path}.${key}`);
                    note("Copied path");
                },
            },
            {
                label: "Set to null",
                onPress: () => {
                    const error = writeKey(target, key, null);
                    error ? note(error, false) : commit();
                },
            },
            {
                label: "Set to empty text",
                onPress: () => {
                    const error = writeKey(target, key, "");
                    error ? note(error, false) : commit();
                },
            },
            {
                label: "Delete key",
                isDestructive: true,
                onPress: () => {
                    const error = deleteKey(target, key);
                    error ? note(error, false) : commit();
                },
            },
        ]);

    const addField = () =>
        showInputAlert({
            title: "Add field",
            placeholder: "key",
            confirmText: "Add",
            cancelText: "Cancel",
            onConfirm: (key: string) => {
                if (!key.trim()) return;
                const error = writeKey(target, key.trim(), "");
                if (error) throw new Error(error); // shown inline by the alert
                commit();
            },
        });

    return (
        <ReactNative.ScrollView style={{ flex: 1 }}>
            <FormSection title={typeLabel(target)}>
                <Text style={{ paddingHorizontal: 16, paddingBottom: 8, opacity: 0.6 }}>
                    {path} · {keys.length} keys
                </Text>
                <FormInput
                    title="Filter keys"
                    value={query}
                    placeholder="author, content, flags…"
                    onChange={(raw: unknown) => {
                        setQuery(asText(raw));
                        setLimit(PAGE);
                    }}
                />
            </FormSection>

            <FormSection title="Actions">
                <FormRow
                    label="Apply changes"
                    subLabel="Tell the store to repaint with the current values"
                    leading={leadingIcon("ic_message_retry")}
                    onPress={() => {
                        const result = refresh(target);
                        note(result.detail, result.ok);
                    }}
                />
                <FormDivider />
                <FormRow
                    label="Edit as JSON"
                    subLabel="Bulk-edit this object in one text field"
                    leading={leadingIcon("ic_progress_wrench_24px")}
                    trailing={FormRow.Arrow}
                    onPress={() => pushPage("Edit as JSON", () => <JsonEditor target={target} path={path} />)}
                />
                <FormDivider />
                <FormRow label="Add field" leading={leadingIcon("ic_add_24px")} onPress={addField} />
                <FormDivider />
                <FormRow
                    label="Copy as JSON"
                    leading={leadingIcon("copy", "toast_copy_link")}
                    onPress={() => {
                        clipboard.setString(safeStringify(target, Number(storage.jsonDepth) || 4));
                        note("Copied to clipboard");
                    }}
                />
            </FormSection>

            <FormSection title={needle ? `Matches (${visible.length})` : "Properties"}>
                {visible.slice(0, limit).map((key, index) => {
                    const read = readKey(target, key);

                    if (!read.ok) {
                        return (
                            <React.Fragment key={key}>
                                {index > 0 && <FormDivider />}
                                <FormRow label={key} subLabel={`threw: ${read.error}`} disabled />
                            </React.Fragment>
                        );
                    }

                    const value = read.value;
                    const kind = kindOf(value);
                    let row: JSX.Element;

                    if (kind === "boolean") {
                        row = (
                            <FormSwitchRow
                                label={key}
                                subLabel="boolean"
                                value={value as boolean}
                                onValueChange={(next: boolean) => {
                                    const error = writeKey(target, key, next);
                                    error ? note(`${key}: ${error}`, false) : commit();
                                }}
                            />
                        );
                    } else if (kind === "string" || kind === "number" || kind === "bigint") {
                        row = <LeafInput obj={target} name={key} kind={kind} onCommit={commit} />;
                    } else if (kind === "object" || kind === "array") {
                        row = (
                            <FormRow
                                label={key}
                                subLabel={preview(value)}
                                trailing={FormRow.Arrow}
                                onPress={() =>
                                    pushPage(key, () => <ObjectEditor target={value} path={`${path}.${key}`} />)
                                }
                                onLongPress={() => rowMenu(key, value)}
                            />
                        );
                    } else {
                        // null / undefined / function / symbol — nothing to type
                        // into, so the row is a handle for the actions menu.
                        row = (
                            <FormRow
                                label={key}
                                subLabel={preview(value)}
                                onPress={() => rowMenu(key, value)}
                                onLongPress={() => rowMenu(key, value)}
                            />
                        );
                    }

                    return (
                        <React.Fragment key={key}>
                            {index > 0 && <FormDivider />}
                            {row}
                        </React.Fragment>
                    );
                })}

                {visible.length > limit && (
                    <>
                        <FormDivider />
                        <FormRow
                            label={`Show ${Math.min(PAGE, visible.length - limit)} more`}
                            subLabel={`${visible.length - limit} hidden`}
                            onPress={() => setLimit(limit + PAGE)}
                        />
                    </>
                )}

                {visible.length === 0 && (
                    <FormRow label="No matching keys" subLabel="Try a different filter" disabled />
                )}
            </FormSection>
        </ReactNative.ScrollView>
    );
}
