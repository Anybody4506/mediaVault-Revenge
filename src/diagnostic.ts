/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chatButtonStatus } from "./chatButton";
import { findByProps, patcher } from "./rv";

/**
 * Discord's component names change between versions and can only be read on the phone.
 * This collects the ones the chat bar button and an expression picker tab would need, to be pasted in a bug report.
 */
const INTERESTING = /ChatInput|Expression|Emoji|Gif|GIF|Sticker|Picker|Keyboard/;
const MAX_NAMES = 400;

const sheetKeys: string[] = [];

/** Remembers the keys of the action sheets opened since the plugin started (the expression picker may be one). */
export function recordActionSheets(): () => void {
    const sheets = findByProps("openLazy", "hideActionSheet");
    if (!sheets) return () => {};
    return patcher.before("openLazy", sheets, args => {
        const key = String(args[1]);
        if (!sheetKeys.includes(key)) sheetKeys.push(key);
        if (sheetKeys.length > 50) sheetKeys.shift();
    });
}

/**
 * The GIF/emoji picker is a "portal keyboard" shown in place of the system keyboard.
 * These functions are watched to learn how Discord opens it, and its renderers.
 */
const PORTAL_FUNCTIONS = ["openPortalKeyboard", "handlePortalKeyboardOpen", "registerPortalKeyboardRenderer", "setKeyboardType", "closePortalKeyboard"];
const portalCalls: string[] = [];

function describe(value: any, depth = 0): unknown {
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

export function recordPortalKeyboard(): () => void {
    const unpatches: (() => void)[] = [];
    for (const name of PORTAL_FUNCTIONS) {
        const module = findByProps(name);
        if (typeof module?.[name] !== "function") continue;
        let calls = 0;
        unpatches.push(patcher.before(name, module, args => {
            // The last calls are kept, a few per function, so opening the picker just before copying shows up.
            const entry = `${name}${JSON.stringify(describe(args))}`;
            if (++calls > 6) portalCalls.splice(portalCalls.findIndex(call => call.startsWith(`${name}[`)), 1);
            portalCalls.push(entry);
        }));
    }
    return () => unpatches.forEach(unpatch => unpatch());
}

function portalModules() {
    const out: Record<string, unknown> = {};
    for (const name of [...PORTAL_FUNCTIONS, "KeyboardTypes", "ExpressionPickerViewType", "PortalKeyboardUIStore", "PortalKeyboard", "useKeyboardType", "MediaKeyboardTarget"]) {
        try {
            const module = findByProps(name);
            if (module) out[name] = { value: describe(module[name]), module: Object.keys(module).slice(0, 40) };
        } catch (error) {
            out[name] = `error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    try {
        const store = vendetta.metro.findByStoreName("PortalKeyboardUIStore");
        if (store) out.portalStoreState = describe(store.getState?.() ?? store.__getLocalVars?.());
    } catch {}
    return out;
}

function namesOf(exports: any): string[] {
    const names: string[] = [];
    const add = (value: unknown, path: string) => {
        if (typeof value === "string" && INTERESTING.test(value)) names.push(path ? `${value} (${path})` : value);
    };
    const component = (value: any, path: string) => {
        if (!value) return;
        if (typeof value === "function") add(value.displayName ?? value.name, path);
        else if (typeof value === "object") {
            add(value.displayName, path);
            add(value.type?.displayName ?? value.type?.name, path ? `${path}.type` : "type");
            add(value.render?.displayName ?? value.render?.name, path ? `${path}.render` : "render");
        }
    };
    component(exports, "");
    if (exports && typeof exports === "object") {
        for (const key of Object.keys(exports)) {
            if (INTERESTING.test(key)) names.push(`.${key}`);
            if (key === "default") component(exports.default, "default");
        }
    }
    return names;
}

export function collectDiagnostic(): string {
    const names = new Set<string>();
    try {
        vendetta.metro.findAll((exports: any) => {
            if (names.size < MAX_NAMES) {
                try {
                    for (const name of namesOf(exports)) names.add(name);
                } catch {}
            }
            return false;
        });
    } catch (error) {
        names.add(`scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return JSON.stringify({
        plugin: "MediaVault",
        chatButton: chatButtonStatus,
        actionSheets: sheetKeys,
        portalCalls,
        portal: portalModules(),
        modules: [...names].filter(name => !/GIFT|Gift|gift|Sticker|STICKER/.test(name)).sort()
    }, null, 1);
}
