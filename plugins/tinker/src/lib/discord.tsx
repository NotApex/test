import { findByName, findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { ErrorBoundary, Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

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
export const ActionSheetModule = findByProps("showSimpleActionSheet");
export const LazyActionSheet = findByProps("openLazy", "hideActionSheet");

/** Key used by this plugin's own menus, so patches can tell them apart from Discord's. */
export const OWN_MENU_KEY = "TinkerRowMenu";

export interface SheetOption {
    label: string;
    isDestructive?: boolean;
    onPress: () => void;
}

export function showMenu(title: string, options: SheetOption[]): void {
    ActionSheetModule?.showSimpleActionSheet?.({
        key: OWN_MENU_KEY,
        header: {
            title,
            onClose: () => LazyActionSheet?.hideActionSheet?.(),
        },
        options,
    });
}

/**
 * Navigation.
 *
 * Not `NavigationNative.useNavigation()` + `navigation.push("VendettaCustomPage")`,
 * which is what this used to do and where the "undefined is not a function"
 * came from. That route is registered by Vendetta's `patchPanels`, which patches
 * Discord's *settings* `getScreens` module — so `VendettaCustomPage` only exists
 * inside the user-settings navigator. A message or channel long-press sheet is
 * rendered in the main app, where the nearest navigation object is not that
 * stack: it has no such route, and on many builds no `push` at all, so the call
 * lands on undefined.
 *
 * Discord's own imperative navigation module works from anywhere, which is how
 * every page-from-a-sheet plugin does it. `Navigator` + `screens` is the shape
 * it expects to be handed.
 */
const Navigation = findByProps("push", "pushLazy", "pop");
const Navigator = findByName("Navigator") ?? findByProps("Navigator")?.Navigator;
const modalCloseButton =
    findByProps("getRenderCloseButton")?.getRenderCloseButton ??
    findByProps("getHeaderCloseButton")?.getHeaderCloseButton;

/**
 * Open a page from anywhere — a sheet, another page, a toast handler.
 *
 * `render` is used as a component, not called, so it may use hooks. The
 * ErrorBoundary is the one `VendettaCustomPage` would have provided: without it
 * a throw inside an editor takes the whole client down rather than the page.
 */
export function pushPage(title: string, render: () => JSX.Element): void {
    if (typeof Navigation?.push !== "function" || !Navigator) {
        showToast("tinker: this build has no pushable navigator", icon("ic_warning_24px"));
        return;
    }

    const Page = () => (
        <ErrorBoundary>
            {render()}
        </ErrorBoundary>
    );

    Navigation.push(() => (
        <Navigator
            initialRouteName="TinkerPage"
            goBackOnBackPress
            screens={{
                TinkerPage: {
                    title,
                    headerLeft: modalCloseButton?.(() => Navigation.pop()),
                    render: Page,
                },
            }}
        />
    ));
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
