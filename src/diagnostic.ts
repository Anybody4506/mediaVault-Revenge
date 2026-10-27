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
        modules: [...names].sort()
    }, null, 1);
}
