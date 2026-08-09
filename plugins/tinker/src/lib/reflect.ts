export type Kind =
    | "string"
    | "number"
    | "boolean"
    | "bigint"
    | "symbol"
    | "null"
    | "undefined"
    | "function"
    | "array"
    | "object";

export function kindOf(value: unknown): Kind {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value as Kind;
}

/** Kinds that get an inline editor rather than a drill-in row. */
export function isLeaf(kind: Kind): boolean {
    return kind !== "object" && kind !== "array";
}

/**
 * List the keys worth showing for an object.
 *
 * Object.keys alone is not enough here. Discord's records (MessageRecord,
 * UserRecord, ChannelRecord) put a lot of the interesting surface on the
 * prototype as getters — `message.content` may be an own property while
 * `channel.isPrivate` is not — so the prototype chain is walked for accessors
 * too. Own keys keep their insertion order, which mirrors the wire payload and
 * is usually the order the user is looking for; the derived getters are sorted
 * and appended after them.
 */
export function keysOf(obj: unknown, includeGetters: boolean): string[] {
    if (!obj || typeof obj !== "object") return [];

    const own = Object.keys(obj as object);
    if (!includeGetters) return own;

    const seen = new Set(own);
    const getters: string[] = [];

    let proto = Object.getPrototypeOf(obj);
    while (proto && proto !== Object.prototype && proto !== Array.prototype) {
        for (const key of Object.getOwnPropertyNames(proto)) {
            if (key === "constructor" || seen.has(key)) continue;
            const desc = Object.getOwnPropertyDescriptor(proto, key);
            if (desc?.get) {
                seen.add(key);
                getters.push(key);
            }
        }
        proto = Object.getPrototypeOf(proto);
    }

    getters.sort((a, b) => a.localeCompare(b));
    return [...own, ...getters];
}

/**
 * Read a property without letting it take the screen down.
 *
 * Getters on Discord records routinely assume a context that isn't there
 * (a store that hasn't loaded, a guild the user left) and throw when read
 * cold. A throwing key should render as "threw", not blank the whole page.
 */
export function readKey(obj: any, key: string): { ok: boolean; value?: unknown; error?: string } {
    try {
        return { ok: true, value: obj[key] };
    } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
    }
}

/**
 * Write a property, returning an error string or null on success.
 *
 * Two failure modes, both quiet: a getter-only property throws under strict
 * mode but is a silent no-op under sloppy mode, and a frozen object swallows
 * the write either way. So the value is read back and compared rather than
 * trusting that no exception means it landed.
 */
export function writeKey(obj: any, key: string, value: unknown): string | null {
    try {
        obj[key] = value;
    } catch (err: any) {
        return String(err?.message ?? err);
    }

    const readback = readKey(obj, key);
    if (!readback.ok) return null; // wrote fine, just can't verify
    if (readback.value !== value && !(Number.isNaN(value) && Number.isNaN(readback.value as number))) {
        return Object.isFrozen(obj) ? "object is frozen" : "property is read-only";
    }
    return null;
}

export function deleteKey(obj: any, key: string): string | null {
    try {
        delete obj[key];
        return key in obj ? "property is not configurable" : null;
    } catch (err: any) {
        return String(err?.message ?? err);
    }
}

/** One-line summary for a collapsed row. */
export function preview(value: unknown, max = 48): string {
    const kind = kindOf(value);

    switch (kind) {
        case "string": {
            const str = value as string;
            return str.length > max ? `"${str.slice(0, max)}…"` : `"${str}"`;
        }
        case "array":
            return `Array(${(value as unknown[]).length})`;
        case "object": {
            const name = (value as any)?.constructor?.name;
            const count = Object.keys(value as object).length;
            return name && name !== "Object" ? `${name} · ${count} keys` : `{${count} keys}`;
        }
        case "function":
            return `ƒ ${(value as any).name || "anonymous"}()`;
        case "bigint":
            return `${value}n`;
        case "undefined":
            return "undefined";
        default:
            return String(value);
    }
}

export function typeLabel(value: unknown): string {
    const kind = kindOf(value);
    if (kind === "object") return (value as any)?.constructor?.name || "object";
    return kind;
}

/**
 * JSON with the sharp edges filed off: cycles, functions, bigints and
 * throwing getters all survive as placeholder strings.
 *
 * `seen` is unwound on the way back up rather than left to accumulate. A
 * WeakSet that only ever grows would flag the second and third references to a
 * shared object as circular, which they aren't — a message's author appearing
 * in two places is a diamond, not a loop.
 */
export function safeStringify(value: unknown, maxDepth = 4): string {
    const seen = new Set<object>();

    const walk = (val: any, depth: number): any => {
        if (typeof val === "function") return `[Function ${val.name || "anonymous"}]`;
        if (typeof val === "bigint") return `${val}n`;
        if (typeof val === "symbol") return String(val);
        if (typeof val === "undefined") return "[undefined]";
        if (val === null || typeof val !== "object") return val;

        if (seen.has(val)) return "[Circular]";
        if (depth >= maxDepth) return Array.isArray(val) ? `[Array(${val.length})]` : "[Object]";

        seen.add(val);
        try {
            if (Array.isArray(val)) return val.map((item) => walk(item, depth + 1));

            const out: Record<string, unknown> = {};
            for (const key of Object.keys(val)) {
                const read = readKey(val, key);
                out[key] = read.ok ? walk(read.value, depth + 1) : `[Threw: ${read.error}]`;
            }
            return out;
        } finally {
            seen.delete(val);
        }
    };

    return JSON.stringify(walk(value, 0), null, 2);
}

/** Turn editor text back into the kind the field started as. */
export function coerce(text: string, kind: Kind): { ok: boolean; value?: unknown } {
    switch (kind) {
        case "number": {
            if (text.trim() === "") return { ok: false };
            const num = Number(text);
            return Number.isNaN(num) ? { ok: false } : { ok: true, value: num };
        }
        case "bigint":
            try {
                return { ok: true, value: BigInt(text.replace(/n$/, "")) };
            } catch {
                return { ok: false };
            }
        default:
            return { ok: true, value: text };
    }
}
