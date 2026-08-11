import { logger } from "@vendetta";
import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";

import { clearPending, pendingFor, readKey } from "./reflect";

// Only used to report what a dispatch actually did. Wrapped because a store
// name that no longer resolves must not stop the refresh itself.
let MessageStore: any;
try {
    MessageStore = findByStoreName("MessageStore");
} catch {
    MessageStore = null;
}

/** What the store holds for a message right now, or undefined if unknowable. */
function storedMessage(channelId: unknown, id: unknown): any {
    try {
        return MessageStore?.getMessage?.(channelId, id);
    } catch {
        return undefined;
    }
}

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
 * Dispatch with the edited records rolled back to what the store last painted.
 *
 * The payloads are built first, so they carry the new values; then the records
 * themselves are put back to their pre-edit state, so a merging reducer has an
 * actual difference to notice and emit on. The rollback lasts exactly as long
 * as the dispatch, which is synchronous, and the `finally` restores the new
 * values whether the reducer replaced the record or merged into it.
 *
 * Without this the edit is already present on both sides of the comparison and
 * the store stays silent — the "only shows after leaving the channel" case,
 * where the row list gets rebuilt from the mutated object anyway.
 */
function dispatchAsChange(objs: any[], dispatch: () => void): void {
    const restore: Array<[any, Map<string, unknown>]> = [];

    for (const obj of objs) {
        const previous = pendingFor(obj);
        if (!previous?.size) continue;

        const current = new Map<string, unknown>();
        for (const key of previous.keys()) {
            const read = readKey(obj, key);
            if (read.ok) current.set(key, read.value);
        }

        for (const [key, value] of previous) {
            try {
                obj[key] = value;
            } catch {}
        }

        restore.push([obj, current]);
    }

    try {
        dispatch();
    } finally {
        for (const [obj, current] of restore) {
            for (const [key, value] of current) {
                try {
                    obj[key] = value;
                } catch {}
            }
            clearPending(obj);
        }
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
            case "message": {
                const author = obj.author && typeof obj.author === "object" ? obj.author : null;

                // Payloads built before the rollback, so they carry the edit.
                const message = reidentify(obj);
                const user = author ? reidentify(author) : null;

                // Both spellings, because the reducer reads one of them to find
                // the channel whose message list to invalidate, and which one
                // depends on the build. A record carrying only the camelCase
                // form against a reducer reading the snake_case one is a silent
                // no-op — the update is accepted and applied to nothing.
                const channelId = obj.channel_id ?? obj.channelId;
                if (channelId != null) {
                    message.channel_id ??= channelId;
                    message.channelId ??= channelId;
                }

                const before = storedMessage(channelId, obj.id);

                dispatchAsChange([obj, author].filter(Boolean), () => {
                    // The author goes out first and separately. A message row
                    // reads the BOT tag, the display name and the avatar off the
                    // author record, which is shared and memoized on its own, so
                    // editing message.author.bot dispatches nothing the chat
                    // listens to — which is why the tag never appeared.
                    if (user) FluxDispatcher.dispatch({ type: "USER_UPDATE", user });

                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message,
                        // Top-level as well as on the payload: this is the shape
                        // MESSAGE_CREATE is dispatched with in the sibling
                        // plugin, where the chat does repaint immediately.
                        channelId,
                        // Suppresses the "(edited)" marker the reducer would
                        // otherwise stamp on, which is a lie about local state.
                        log_edit: false,
                    });
                });

                // Says plainly whether the store took the update. "same record"
                // means the reducer merged into what it already had and nothing
                // downstream was told, which is the signature of an edit that
                // only appears after leaving the channel.
                const after = storedMessage(channelId, obj.id);
                if (before !== undefined || after !== undefined) {
                    logger.log(
                        `[tinker] MESSAGE_UPDATE on ${channelId}/${obj.id}: ` +
                            (before === after
                                ? "store returned the same record — reducer saw no change"
                                : "store swapped in a new record") +
                            (after && after !== obj ? "; editor is now holding a stale copy, reopen the sheet" : "")
                    );
                }

                return { ok: true, detail: "Message refreshed" };
            }

            case "user": {
                // Note this is client-wide: the user record is shared, so the
                // edit shows up everywhere that user is rendered, not just in
                // the message you opened.
                const user = reidentify(obj);
                dispatchAsChange([obj], () => FluxDispatcher.dispatch({ type: "USER_UPDATE", user }));
                return { ok: true, detail: "User refreshed (client-wide)" };
            }

            case "channel": {
                const channel = reidentify(obj);
                dispatchAsChange([obj], () =>
                    FluxDispatcher.dispatch({ type: "CHANNEL_UPDATES", channels: [channel] })
                );
                return { ok: true, detail: "Channel refreshed" };
            }

            case "guild": {
                const guild = reidentify(obj);
                dispatchAsChange([obj], () => FluxDispatcher.dispatch({ type: "GUILD_UPDATE", guild }));
                return { ok: true, detail: "Guild refreshed" };
            }

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
