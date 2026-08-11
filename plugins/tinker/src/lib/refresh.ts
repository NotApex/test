import { logger } from "@vendetta";
import { FluxDispatcher } from "@vendetta/metro/common";

export type EntityKind = "message" | "user" | "channel" | "guild" | "unknown";

/**
 * A shallow copy that keeps the prototype.
 *
 * Dispatching the very object the store already holds is a no-op as far as
 * React is concerned: the chat row and the profile header are memoized on the
 * record reference, so an identical reference means "nothing changed" and the
 * edit sits in the store unpainted. That is the "changes don't apply" case —
 * the write landed, the repaint never happened.
 *
 * Object.create keeps the prototype so the record's getters and methods survive
 * (Object.assign copies own enumerable properties only, so prototype accessors
 * are not flattened into data). The result is the same data behind a reference
 * React has not seen before.
 */
function reidentify<T extends object>(obj: T): T {
    try {
        return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj);
    } catch {
        return obj;
    }
}

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
                // The author goes out first and separately. A message row reads
                // the BOT tag, the display name and the avatar off the author
                // record, and that record is shared and memoized on its own —
                // so editing message.author.bot without this dispatches nothing
                // the chat is listening to, which is why the tag never appeared.
                if (obj.author && typeof obj.author === "object") {
                    FluxDispatcher.dispatch({ type: "USER_UPDATE", user: reidentify(obj.author) });
                }

                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: reidentify(obj),
                    // Suppresses the "(edited)" marker the reducer would
                    // otherwise stamp on, which is a lie about local state.
                    log_edit: false,
                });
                return { ok: true, detail: "Message refreshed" };

            case "user":
                // Note this is client-wide: the user record is shared, so the
                // edit shows up everywhere that user is rendered, not just in
                // the message you opened.
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: reidentify(obj) });
                return { ok: true, detail: "User refreshed (client-wide)" };

            case "channel":
                FluxDispatcher.dispatch({ type: "CHANNEL_UPDATES", channels: [reidentify(obj)] });
                return { ok: true, detail: "Channel refreshed" };

            case "guild":
                FluxDispatcher.dispatch({ type: "GUILD_UPDATE", guild: reidentify(obj) });
                return { ok: true, detail: "Guild refreshed" };

            default:
                // Flux stores expose emitChange; plain payload objects don't.
                if (typeof obj?.emitChange === "function") {
                    obj.emitChange();
                    return { ok: true, detail: "Store notified" };
                }
                logger.log(`[tinker] no refresh strategy for this object; keys: ${Object.keys(obj ?? {}).join(", ")}`);
                return { ok: false, detail: "Edited, but nothing to refresh — reopen the view" };
        }
    } catch (err: any) {
        // Logged as well as toasted: the toast truncates, and a reducer that
        // rejects a payload throws inside Flux where the stack is the only
        // thing that says which dispatch was at fault.
        logger.error(`[tinker] refresh(${kind}) failed`, err);
        return { ok: false, detail: `Refresh failed: ${err?.message ?? err}` };
    }
}
