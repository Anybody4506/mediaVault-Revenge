/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** A short, JSON-safe outline of a value, for the diagnostic. */
export function describe(value: any, depth = 0): unknown {
    if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
    if (typeof value === "function") return `fn ${value.displayName ?? value.name ?? "?"}/${value.length}`;
    if (Array.isArray(value)) return depth > 1 ? `array(${value.length})` : value.slice(0, 6).map(item => describe(item, depth + 1));
    if (typeof value === "object") {
        if (depth > 1) return `{${Object.keys(value).slice(0, 12).join(",")}}`;
        if (value.$$typeof) return `element ${value.type?.displayName ?? value.type?.name ?? value.type}`;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).slice(0, 20)) out[key] = describe(value[key], depth + 1);
        return out;
    }
    return typeof value;
}
