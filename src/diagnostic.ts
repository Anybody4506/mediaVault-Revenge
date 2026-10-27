/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chatButtonHost, chatButtonStatus } from "./chatButton";
import { describe } from "./describe";
import { pickerStatus } from "./picker";
import { findByProps, patcher, VideoPlayer, videoViews } from "./rv";
import { thumbnailFailures } from "./thumbs";

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


export function recordPortalKeyboard(): () => void {
    const unpatches: (() => void)[] = [];
    // forEach rather than for...of: each hook needs its own `name` once the bundle is minified.
    PORTAL_FUNCTIONS.forEach(name => {
        const module = findByProps(name);
        if (typeof module?.[name] !== "function") return;
        let calls = 0;
        unpatches.push(patcher.before(name, module, args => {
            // The last calls are kept, a few per function, so opening the picker just before copying shows up.
            const entry = `${name}${JSON.stringify(describe(args))}`;
            if (++calls > 6) portalCalls.splice(portalCalls.findIndex(call => call.startsWith(`${name}[`)), 1);
            portalCalls.push(entry);
            if (name === "setKeyboardType" && args[0]?.type === "expression") setTimeout(capturePicker, 1500);
        }));
    });
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

let pickerTree: string[] = [];
/** Components that start a branch worth keeping in the tree dump. */
const PICKER = /Expression|Picker|Gif|GIF|PortalKeyboard(?!Host)/;

const nameOf = (type: any): string | undefined => typeof type === "string" ? undefined
    : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name;

/**
 * Walks Discord's React tree, starting from the MediaVault chat bar button, while the GIF/emoji picker is open.
 * Its tab components are not exported, so this is the only way to learn their names and props.
 */
function capturePicker() {
    try {
        let fiber = chatButtonHost.current?.__internalInstanceHandle ?? chatButtonHost.current?._internalFiberInstanceHandleDEV;
        if (!fiber) {
            pickerTree = [`no fiber on the chat button (${Object.keys(chatButtonHost.current ?? {}).slice(0, 12).join(",")})`];
            return;
        }
        while (fiber.return) fiber = fiber.return;
        const lines: string[] = [];
        // Depth-first with an explicit stack (the tree is too deep for recursion), keeping named components inside anything that looks like the picker.
        const stack: [any, number, number][] = [[fiber, 0, 0]];
        while (stack.length && lines.length < 600) {
            const [current, depth, inside] = stack.pop()!;
            if (!current) continue;
            stack.push([current.sibling, depth, inside]);
            const name = nameOf(current.type);
            const matches = !!name && PICKER.test(name);
            const keep = matches || (inside > 0 && !!name);
            if (keep) lines.push(`${depth}${" ".repeat(Math.min(inside, 30))}${name}(${Object.keys(current.memoizedProps ?? {}).slice(0, 10).join(",")})`);
            stack.push([current.child, depth + 1, matches ? Math.max(inside, 1) + 1 : inside > 0 ? inside + (keep ? 1 : 0) : 0]);
        }
        pickerTree = lines;
    } catch (error) {
        pickerTree = [`capture failed: ${error instanceof Error ? error.message : String(error)}`];
    }
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

/** Modules that export something about segmented controls, to find the hook that builds the picker's tabs. */
function segmentedModules() {
    const found: string[] = [];
    try {
        vendetta.metro.findAll((exports: any) => {
            if (found.length < 30 && exports && typeof exports === "object") {
                const keys = Object.keys(exports).filter(key => /Segmented/i.test(key));
                if (keys.length) found.push(`${keys.join(",")} [${Object.keys(exports).slice(0, 8).join(",")}]`);
            }
            return false;
        });
    } catch {}
    return found;
}

/** Modules that export a video player, to find the one Discord plays its GIF videos with. */
function videoModules() {
    const found: string[] = [];
    const named = (value: any) => typeof value === "function" ? value.displayName ?? value.name : value?.displayName ?? value?.type?.name ?? value?.render?.name;
    try {
        vendetta.metro.findAll((exports: any) => {
            if (found.length >= 40 || !exports || (typeof exports !== "object" && typeof exports !== "function")) return false;
            const own = named(exports) ?? named(exports.default);
            const keys = typeof exports === "object" ? Object.keys(exports).filter(key => /Video|Player/.test(key) && !/Icon$/.test(key)) : [];
            const ownMatches = typeof own === "string" && /Video|Player/.test(own) && !/Icon$/.test(own);
            if (keys.length || ownMatches) found.push(`${ownMatches ? own : ""}${keys.length ? ` .${keys.join(",.")}` : ""} [${typeof exports === "object" ? Object.keys(exports).slice(0, 8).join(",") : typeof exports}]`);
            return false;
        });
    } catch {}
    return found;
}

let stopRecording: (() => void) | null = null;

/** Starts or stops recording what "Copy diagnostic" reports (it patches Discord, so it is off unless asked for). */
export function setDiagnostic(enabled: boolean) {
    if (enabled && !stopRecording) {
        const stops = [recordActionSheets(), recordPortalKeyboard()];
        stopRecording = () => stops.forEach(stop => stop());
    } else if (!enabled && stopRecording) {
        stopRecording();
        stopRecording = null;
    }
}

export function collectDiagnostic(): string {
    if (!pickerTree.length) capturePicker();
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
        picker: { ...pickerStatus, segmentedModules: segmentedModules() },
        video: { views: videoViews(), player: describe(VideoPlayer()), modules: videoModules() },
        // Thumbnails of the grid that ended as an icon: the link shown, and the light version tried first.
        thumbnailFailures,
        actionSheets: sheetKeys,
        portalCalls,
        pickerTree,
        portal: portalModules(),
        modules: [...names].filter(name => !/GIFT|Gift|gift|Sticker|STICKER/.test(name)).sort()
    }, null, 1);
}
