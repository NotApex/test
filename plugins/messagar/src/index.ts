import { registerCommand } from "@vendetta/commands";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import Settings from "./Settings";

const { createBotMessage } = findByProps("createBotMessage");
const SelectedChannelStore = findByProps("getChannelId", "getLastSelectedChannelId");
const IconUtils = findByProps("getUserAvatarURL");
const UserStore = findByStoreName("UserStore");

const EPHEMERAL = 64; // MessageFlags.EPHEMERAL
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Sentinel prefix stuffed into author.avatar to smuggle a full URL past the
 * CDN path builder. Real avatar hashes are hex, optionally "a_"-prefixed, so
 * this can never collide with a genuine one.
 */
const AVATAR_URL = "fakemsg:";

/**
 * Resolve a cached user's avatar to a CDN URL.
 *
 * Deliberately built by hand rather than by calling IconUtils.getUserAvatarURL,
 * because that function is patched below — going direct keeps the two paths
 * from tangling. Returns null if the user isn't in cache; see the note in the
 * `id` option about why this doesn't fall back to a fetch.
 */
function avatarUrlForId(userId: string): string | null {
    const user = UserStore.getUser(userId);
    if (!user) return null;

    if (!user.avatar) {
        // No custom avatar — derive the default from the discriminator (legacy)
        // or the id (post-pomelo accounts).
        const idx =
            user.discriminator && user.discriminator !== "0"
                ? Number(user.discriminator) % 5
                : Number((BigInt(user.id) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }

    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

// author id -> avatar URL, for authors whose pfp was given as an http(s) link.
//
// Only ever holds *synthetic* ids. Real snowflakes are handled via AVATAR_URL
// instead — see the note where the entry would otherwise be written.
const fakeAvatars = new Map<string, string>();

const patches: Array<() => void> = [];
let unregister: (() => void) | undefined;

function fakeIdFor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) {
        h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
    }
    return `99${Math.abs(h)}`.padEnd(18, "0").slice(0, 18);
}

export default {
    onLoad: () => {
        storage.defaultName ??= "Clyde";
        storage.defaultPfp ??= "clyde";
        // Renamed from showEphemeralHint deliberately: the old key is already
        // persisted as true on existing installs, so `??=` would never reach a
        // new default. A fresh key starts clean at false.
        storage.defaultEphemeral ??= false;

        // author.avatar is interpreted as a CDN hash, not a URL — the client
        // builds cdn.discordapp.com/avatars/{id}/{avatar}.png from it, so a raw
        // link dropped in that field just 404s. Intercepting the resolver is
        // the only way to point an author at an arbitrary image.
        //
        // Two routes in, because author.id can now be a real snowflake:
        //   - the AVATAR_URL sentinel, which travels on one author object and
        //     so only affects the record it was written to;
        //   - fakeAvatars, keyed by id, which is consulted for *every* render
        //     and is therefore restricted to synthetic ids no account can hold.
        patches.push(
            after("getUserAvatarURL", IconUtils, ([user], ret) => {
                const hash = user?.avatar;
                if (typeof hash === "string" && hash.startsWith(AVATAR_URL)) {
                    return hash.slice(AVATAR_URL.length);
                }
                return (user?.id && fakeAvatars.get(user.id)) || ret;
            })
        );

        unregister = registerCommand({
            name: "message",
            displayName: "message",
            description: "Render a message in this channel, visible only to you",
            displayDescription: "Render a message in this channel, visible only to you",
            type: 1,        // ApplicationCommandType.CHAT
            inputType: 1,   // BUILT_IN — handled locally, never hits Discord's API
            applicationId: "-1",
            options: [
                {
                    name: "name",
                    displayName: "name",
                    description: "Display name (defaults to the id's name, else the one in settings)",
                    displayDescription: "Display name (defaults to the id's name, else the one in settings)",
                    type: 3,    // STRING
                    required: false,
                },
                {
                    name: "pfp",
                    displayName: "pfp",
                    description: "Image URL, or a built-in asset name such as 'clyde'",
                    displayDescription: "Image URL, or a built-in asset name such as 'clyde'",
                    type: 3,
                    required: false,
                },
                {
                    name: "id",
                    displayName: "id",
                    description: "Author id — also supplies the pfp and name (pfp:/name: win if given)",
                    displayDescription: "Author id — also supplies the pfp and name (pfp:/name: win if given)",
                    type: 3,
                    required: false,
                },
                {
                    name: "message",
                    displayName: "message",
                    description: "Message content",
                    displayDescription: "Message content",
                    type: 3,
                    required: false,
                },
                {
                    name: "bot",
                    displayName: "bot",
                    description: "Show the BOT tag (default: on)",
                    displayDescription: "Show the BOT tag (default: on)",
                    type: 5,    // BOOLEAN
                    required: false,
                },
                {
                    name: "ephemeral",
                    displayName: "ephemeral",
                    description: "Show the 'only you can see this' hint (default: off)",
                    displayDescription: "Show the 'only you can see this' hint (default: off)",
                    type: 5,    // BOOLEAN
                    required: false,
                },
            ],
            execute: (args, ctx) => {
                const arg = (n: string) => args.find((a) => a.name === n)?.value;

                const content = String(arg("message") ?? "").trim();
                if (!content) return; // nothing to render

                // A well-formed snowflake is used as the author id verbatim, so
                // the rendered message resolves to that account — profile
                // popout, mention colouring, avatar caching all follow from it.
                // Anything else (a username, a typo) falls back to the
                // name-derived synthetic id as before.
                const idArg = String(arg("id") ?? "").trim();
                const realId = SNOWFLAKE.test(idArg) ? idArg : null;
                const cached = realId ? UserStore.getUser(realId) : null;

                const name = String(
                    arg("name") ||
                        cached?.globalName ||
                        cached?.global_name ||
                        cached?.username ||
                        storage.defaultName ||
                        "Clyde"
                );
                const isBot = arg("bot") ?? true;

                const channelId = ctx?.channel?.id ?? SelectedChannelStore.getChannelId();
                if (!channelId) return;

                const message = createBotMessage({ channelId, content });
                const id = realId ?? fakeIdFor(name);

                message.author.id = id;
                message.author.username = name;
                message.author.global_name = name; // newer clients render this first
                message.author.discriminator = cached?.discriminator ?? "0000";
                message.author.bot = Boolean(isBot);

                // Precedence: explicit pfp: > id: lookup > stored default.
                const explicitPfp = String(arg("pfp") ?? "").trim();

                if (!explicitPfp && cached?.avatar) {
                    // Real user, no override asked for: hand the client their
                    // actual hash and let it build the URL itself. Nothing is
                    // intercepted on this path, so sizing and gifs behave.
                    fakeAvatars.delete(id);
                    message.author.avatar = cached.avatar;
                } else {
                    let pfp = explicitPfp;
                    if (!pfp && realId) pfp = avatarUrlForId(realId) ?? "";
                    if (!pfp) pfp = String(storage.defaultPfp || "clyde");

                    if (/^https?:\/\//i.test(pfp)) {
                        if (realId) {
                            // Must not go in fakeAvatars: that map is keyed by
                            // id and is checked on every avatar render, so an
                            // entry filed under a real snowflake would repaint
                            // that person's avatar everywhere in the client
                            // until unload. The sentinel stays on this record.
                            message.author.avatar = AVATAR_URL + pfp;
                        } else {
                            fakeAvatars.set(id, pfp);
                            message.author.avatar = "clyde"; // placeholder; the patch wins
                        }
                    } else {
                        fakeAvatars.delete(id);
                        message.author.avatar = pfp;     // built-in asset name
                    }
                }

                // createBotMessage sets EPHEMERAL for us, but set it both ways
                // rather than only stripping — that stays correct if the helper
                // ever stops setting it.
                const ephemeral = Boolean(arg("ephemeral") ?? storage.defaultEphemeral);
                if (ephemeral) message.flags |= EPHEMERAL;
                else message.flags &= ~EPHEMERAL;

                // Injects straight into the local message store. Nothing is
                // transmitted; no other client learns this happened.
                FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId, message });
            },
        });
    },

    onUnload: () => {
        unregister?.();
        unregister = undefined;
        patches.forEach((unpatch) => unpatch());
        patches.length = 0;
        fakeAvatars.clear();
    },

    settings: Settings,
};
