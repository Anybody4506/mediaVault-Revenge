/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Everything the plugin takes from the `vendetta` object that classic Revenge gives to plugins.
 */

import type { ComponentType } from "react";

type AnyComponent = ComponentType<any> & Record<string, any>;

const metro = () => vendetta.metro;
const cache = new Map<string, unknown>();

function lazy<T>(key: string, find: () => T): T | undefined {
    if (cache.has(key)) return cache.get(key) as T;
    let found: T | undefined;
    try {
        found = find();
    } catch {
        found = undefined;
    }
    if (found) cache.set(key, found);
    return found;
}

/** A module with exactly this one export, like Discord's Button and TextInput modules. */
const singular = (prop: string) => lazy(`singular:${prop}`, () => metro().find((m: any) => m?.[prop] && Object.keys(m).length === 1)?.[prop]);
const prop = (name: string, ...others: string[]) => lazy(`prop:${name}:${others}`, () => metro().findByProps(name, ...others)?.[name]);

const DESIGN_FINDERS: Record<string, () => unknown> = {
    Button: () => singular("Button"),
    TextInput: () => singular("TextInput"),
    Text: () => prop("Text", "LegacyText")
};

/** Discord's design system components, found on first use. */
export const Design = new Proxy({} as Record<string, AnyComponent>, {
    get: (_, name: string) => (DESIGN_FINDERS[name] ?? (() => prop(name)))()
});

export const ActionSheetActionCreators = new Proxy({} as {
    openLazy(sheet: Promise<{ default: ComponentType<any>; }>, key: string, props?: object, stacking?: string): void;
    hideActionSheet(key?: string): void;
}, { get: (_, name) => lazy("actionSheets", () => metro().findByProps("openLazy", "hideActionSheet"))?.[name] });

export const AlertActionCreators = new Proxy({} as {
    openAlert(key: string, alert: unknown): void;
    dismissAlert(key: string): void;
}, { get: (_, name) => lazy("alerts", () => metro().findByProps("openAlert", "dismissAlert"))?.[name] });

export const findStore = <T>(name: string) => lazy(`store:${name}`, () => metro().findByStoreName(name)) as T | undefined;

export const findByProps = <T = any>(...props: string[]) => lazy(`props:${props}`, () => metro().findByProps(...props)) as T | undefined;

export const Clipboard = {
    setString: (text: string) => metro().common.clipboard.setString(text),
    getString: (): Promise<string> => metro().common.clipboard.getString()
};

/** A generated Discord icon component (StarIcon, TrashIcon…), when this version of the app has it. */
export const lookupIcon = (name: string) => lazy(`icon:${name}`, () => {
    const found = metro().findByProps(name)?.[name];
    return typeof found === "function" || typeof found === "object" ? found : undefined;
}) as AnyComponent | undefined;

export const getAssetId = (name: string): number | undefined => vendetta.ui.assets.getAssetIDByName(name);

export function showToast(text: string, failure = false) {
    vendetta.ui.toasts.showToast(text, getAssetId(failure ? "CircleXIcon-primary" : "CircleCheckIcon-primary") ?? getAssetId(failure ? "Small" : "Check"));
}

export const findInReactTree = (tree: unknown, filter: (node: any) => boolean): any => vendetta.utils.findInReactTree(tree, filter);

type Unpatch = () => void;
export const patcher = {
    before: (name: string, parent: any, hook: (args: any[]) => any): Unpatch => vendetta.patcher.before(name, parent, hook),
    after: (name: string, parent: any, hook: (args: any[], result: any) => any): Unpatch => vendetta.patcher.after(name, parent, hook),
    instead: (name: string, parent: any, hook: (args: any[], original: (...args: any[]) => any) => any): Unpatch => vendetta.patcher.instead(name, parent, hook)
};

/** Gorhom's scroll view scrolls inside a bottom sheet without fighting its drag gesture. */
export const SheetScrollView = () => prop("BottomSheetScrollView") as AnyComponent | undefined;

export const useSafeAreaInsets = (): { bottom: number; } => {
    const hook = prop("useSafeAreaInsets") as (() => { bottom: number; }) | undefined;
    return hook ? hook() : { bottom: 0 };
};
