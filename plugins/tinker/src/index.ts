import { storage } from "@vendetta/plugin";

import Settings from "./Settings";
import { patchActionSheets, unpatchAll } from "./sheets";

export default {
    onLoad: () => {
        storage.showGetters ??= true;
        storage.showFunctions ??= false;
        storage.autoRefresh ??= true;
        storage.allSheets ??= true;
        storage.jsonDepth ??= 4;

        patchActionSheets();
    },

    onUnload: () => {
        unpatchAll();
        // Nothing else to tear down: every edit is a mutation of an object the
        // client already owned, so there is no state of ours left behind. The
        // mutations themselves survive unload and only clear when the store
        // refetches — reconnect, or restart the app, to get back to truth.
    },

    settings: Settings,
};
