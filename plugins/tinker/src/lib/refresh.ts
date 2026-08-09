import { FluxDispatcher } from "@vendetta/metro/common";

export type EntityKind = "message" | "user" | "channel" | "guild" | "unknown";

/**
 * Guess what an object is from its shape.
 *
 * Deliberately duck-typed rather than `instanceof`: the record classes aren't
 * exported anywhere stable, and half of what shows up in an action sheet is a
 * plain object deserialised straight off the gateway rather than a record at
 * all. Order matters — a message has `author` *and* `channel_id`, so it has to
 * be tested before the looser user and channel checks.
 */
export function detect(obj: any): EntityKind {
    if (!obj || typeof obj !== "object") return "unknown";

    if (obj.id && obj.author && (obj.channel_id ?? obj.channelId)) return "message";
    if (obj.id && (obj.username || obj.globalName || obj.global_name)) return "user";
    if (obj.id && obj.type !== undefined && (obj.guild_id !== undefined || obj.guildId !== undefined || obj.recipients))
        return "channel";
    if (obj.id && (obj.ownerId || obj.owner_id || obj.roles)) return "guild";

    return "unknown";
}

/**
 * Nudge the store that owns `obj` so the UI repaints.
 *
 * The mutation has already happened — these objects are the same references
 * the stores hold, so editing a field edits what the store has. What's missing
 * is the change event: React has no idea anything moved. Each dispatch below is
 * chosen to be the cheapest one that ends in an emitChange for that store.
 *
 * Every dispatch is wrapped, because a payload that a reducer doesn't like
 * throws *inside* Flux, and an exception there can wedge the dispatcher for
 * everything else in the client. A failed refresh should cost a toast, not the
 * session.
 */
export function refresh(obj: any): { ok: boolean; detail: string } {
    const kind = detect(obj);

    try {
        switch (kind) {
            case "message":
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: obj,
                    // Suppresses the "(edited)" marker the reducer would
                    // otherwise stamp on, which is a lie about local state.
                    log_edit: false,
                });
                return { ok: true, detail: "Message refreshed" };

            case "user":
                // Note this is client-wide: the user record is shared, so the
                // edit shows up everywhere that user is rendered, not just in
                // the message you opened.
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: obj });
                return { ok: true, detail: "User refreshed (client-wide)" };

            case "channel":
                FluxDispatcher.dispatch({ type: "CHANNEL_UPDATES", channels: [obj] });
                return { ok: true, detail: "Channel refreshed" };

            case "guild":
                FluxDispatcher.dispatch({ type: "GUILD_UPDATE", guild: obj });
                return { ok: true, detail: "Guild refreshed" };

            default:
                // Flux stores expose emitChange; plain payload objects don't.
                if (typeof obj?.emitChange === "function") {
                    obj.emitChange();
                    return { ok: true, detail: "Store notified" };
                }
                return { ok: false, detail: "Edited, but nothing to refresh — reopen the view" };
        }
    } catch (err: any) {
        return { ok: false, detail: `Refresh failed: ${err?.message ?? err}` };
    }
}
