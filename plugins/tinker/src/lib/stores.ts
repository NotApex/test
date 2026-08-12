import { findByProps, findByStoreName } from "@vendetta/metro";

/**
 * Store lookups, for turning the ids a sheet was opened with into objects.
 *
 * Plenty of sheets are handed `{ channelId }` or nothing at all rather than the
 * record itself — that is why the row never appeared on the channel menu and
 * several others. Resolving through the stores gets the same object the client
 * is rendering from, which is the one worth editing.
 *
 * Every lookup is wrapped: a store name that no longer resolves, or a getter
 * that throws on an id the store has never seen, must cost one missing entry
 * rather than the whole row.
 */
function store(name: string): any {
    try {
        return findByStoreName(name);
    } catch {
        return null;
    }
}

const ChannelStore = store("ChannelStore");
const GuildStore = store("GuildStore");
const UserStore = store("UserStore");
const MessageStore = store("MessageStore");
const GuildMemberStore = store("GuildMemberStore");

let SelectedChannelStore: any;
let SelectedGuildStore: any;
try {
    SelectedChannelStore = findByProps("getChannelId", "getLastSelectedChannelId");
} catch {
    SelectedChannelStore = null;
}
try {
    SelectedGuildStore = findByProps("getLastSelectedGuildId") ?? store("SelectedGuildStore");
} catch {
    SelectedGuildStore = null;
}

const call = (fn: unknown, ...args: unknown[]): any => {
    if (typeof fn !== "function") return undefined;
    try {
        const value = (fn as (...a: unknown[]) => unknown)(...args);
        return value && typeof value === "object" ? value : undefined;
    } catch {
        return undefined;
    }
};

export const getChannel = (id: unknown) => (id == null ? undefined : call(ChannelStore?.getChannel, id));
export const getGuild = (id: unknown) => (id == null ? undefined : call(GuildStore?.getGuild, id));
export const getUser = (id: unknown) => (id == null ? undefined : call(UserStore?.getUser, id));

export const getMessage = (channelId: unknown, id: unknown) =>
    channelId == null || id == null ? undefined : call(MessageStore?.getMessage, channelId, id);

export const getMember = (guildId: unknown, userId: unknown) =>
    guildId == null || userId == null ? undefined : call(GuildMemberStore?.getMember, guildId, userId);

/** The channel currently on screen, for sheets that say nothing about what they belong to. */
export function currentChannel(): any {
    let id: unknown;
    try {
        id = SelectedChannelStore?.getChannelId?.() ?? SelectedChannelStore?.getLastSelectedChannelId?.();
    } catch {
        return undefined;
    }
    return getChannel(id);
}

/** The logged-in account's own user record. */
export function currentUser(): any {
    return call(UserStore?.getCurrentUser);
}

/** The server currently on screen. Undefined in DMs, which is correct rather than a failure. */
export function currentGuild(): any {
    let id: unknown;
    try {
        id = SelectedGuildStore?.getGuildId?.() ?? SelectedGuildStore?.getLastSelectedGuildId?.();
    } catch {
        return undefined;
    }
    return getGuild(id);
}
