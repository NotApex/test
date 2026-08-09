import { findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";

const { FormRow } = Forms;

/**
 * Action sheets.
 *
 * `showSimpleActionSheet` is Discord's, not Vendetta's. There is no
 * `@vendetta/ui/sheets` module — the Vendetta object only exposes
 * ui.{components,toasts,alerts,assets} plus the colour helpers, so importing
 * from it yields undefined and blows up at the call site. Vendetta's own
 * Developer page pulls it the way it is pulled here.
 */
const ActionSheetModule = findByProps("showSimpleActionSheet");
export const LazyActionSheet = findByProps("openLazy", "hideActionSheet");

export interface SheetOption {
    label: string;
    isDestructive?: boolean;
    onPress: () => void;
}

export function showMenu(title: string, options: SheetOption[]): void {
    ActionSheetModule?.showSimpleActionSheet?.({
        key: "TinkerRowMenu",
        header: {
            title,
            onClose: () => LazyActionSheet?.hideActionSheet?.(),
        },
        options,
    });
}

/**
 * First asset name that actually resolves.
 *
 * getAssetIDByName returns undefined for a name that isn't registered, and the
 * registry differs between client builds — so every call site passes a chain
 * ending in a name Vendetta itself uses, and callers must tolerate undefined.
 */
export function icon(...names: string[]): number | undefined {
    for (const name of names) {
        const id = getAssetIDByName(name);
        if (id) return id;
    }
    return undefined;
}

/** FormRow.Icon that renders nothing rather than an empty box when the asset is missing. */
export function leadingIcon(...names: string[]): JSX.Element | undefined {
    const id = icon(...names);
    return id ? <FormRow.Icon source={id} /> : undefined;
}

/**
 * Normalise a FormInput change payload.
 *
 * Depending on the client build, onChange hands back either the string or an
 * object shaped `{ text }`. Vendetta's own InputAlert branches on exactly this,
 * and without it a field silently becomes "[object Object]" on first keystroke.
 */
export function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof (value as any).text === "string") {
        return (value as any).text;
    }
    return String(value ?? "");
}
