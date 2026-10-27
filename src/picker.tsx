/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { currentAccountId } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import { KINDS, LibraryBrowser } from "./library";
import type { MediaKind } from "./model";
import { Design, findByProps, findInReactTree, patcher } from "./rv";
import { settings, TAB_SETTINGS, useSettings } from "./settings";

/**
 * Adds the Images, Videos, Audio and Files tabs of the desktop plugin to Discord's GIF/emoji picker.
 *
 * The picker (`ExpressionPicker`) is not exported, so it is swapped for a wrapper where React elements are created
 * (the jsx runtime). The wrapper renders it, adds MediaVault's tabs to its segmented control
 * (Emoji / GIF / Sticker), and shows the MediaVault grid in place of the picker's content while one of them is active.
 * If the segmented control cannot be extended, a row of MediaVault tabs is shown below it instead.
 */

/** Shown in the diagnostic. */
export const pickerStatus = { wrapped: 0, segmentedHook: false, injected: false, segmentedOptions: [] as string[], contentFound: false, error: "" };

interface Injection {
    kinds: MediaKind[];
    select(kind: MediaKind | null): void;
    injected: boolean;
}
/** Set while the wrapper renders the original picker, so the segmented control hook knows it is the picker's. */
let rendering: Injection | null = null;

const isExpressionPicker = (type: any) => type?.name === "ExpressionPicker" || type?.type?.name === "ExpressionPicker";

export function patchExpressionPicker(): () => void {
    const unpatches: (() => void)[] = [];
    let original: ((props: any) => ReactNode) | undefined;

    function MediaVaultExpressionPicker(props: any) {
        const tabs = useSettings();
        const [active, setActive] = useState<MediaKind | null>(null);
        const kinds = KINDS.filter(kind => kind !== "gif" && tabs[TAB_SETTINGS[kind]]);
        const injection: Injection = { kinds, select: setActive, injected: false };
        let tree: ReactNode;
        rendering = injection;
        try {
            tree = original!(props);
        } finally {
            rendering = null;
        }
        pickerStatus.injected = injection.injected;
        const kind = active && kinds.includes(active) ? active : null;
        try {
            return decorate(tree as ReactElement, kinds, kind, setActive, injection.injected);
        } catch (error) {
            pickerStatus.error = error instanceof Error ? error.message : String(error);
            return tree;
        }
    }

    const runtime = findByProps("jsx", "jsxs");
    if (!runtime) throw new Error("React's jsx runtime was not found.");
    // forEach rather than for...of: each hook needs its own `name` once the bundle is minified.
    ["jsx", "jsxs"].forEach(name => {
        if (typeof runtime[name] !== "function") return;
        unpatches.push(patcher.before(name, runtime, args => {
            const [type] = args;
            if (typeof type !== "function" && typeof type !== "object") return;
            if (!isExpressionPicker(type) || !settings().pickerTabs) return;
            original ??= typeof type === "function" ? type : type.type;
            pickerStatus.wrapped++;
            return [MediaVaultExpressionPicker, ...args.slice(1)];
        }));
    });

    const segmented = findByProps("useSegmentedControlState");
    if (segmented) {
        pickerStatus.segmentedHook = true;
        unpatches.push(patcher.instead("useSegmentedControlState", segmented, (args, hook) => {
            const injection = rendering;
            const [options] = args as [any];
            if (!injection || !Array.isArray(options?.items) || !injection.kinds.length) return hook(...args);
            rendering = null; // Only the picker's own segmented control.
            pickerStatus.segmentedOptions = Object.keys(options);
            const base = options.items.length;
            const items = [...options.items, ...injection.kinds.map(kind => ({ id: `mediavault-${kind}`, label: t(`tab.${kind}` as Key), page: null }))];
            const indexOf = (value: unknown) => typeof value === "number" ? value
                : items.findIndex(item => item === value || item.id === value || (value as any)?.id === item.id);
            // A tap on a MediaVault tab selects it; a tap on Discord's tabs leaves MediaVault and goes on as usual.
            const handles = (value: unknown) => {
                const index = indexOf(value);
                if (index >= base) {
                    injection.select(injection.kinds[index - base]);
                    return true;
                }
                if (index >= 0) injection.select(null);
                return false;
            };
            const wrapped: Record<string, unknown> = { ...options, items };
            for (const key of Object.keys(options)) {
                if (typeof options[key] !== "function" || key === "items") continue;
                wrapped[key] = (...callArgs: unknown[]) => handles(callArgs[0]) ? undefined : options[key](...callArgs);
            }
            const state = hook(wrapped);
            injection.injected = true;
            if (state && typeof state.setActiveIndex === "function" && !state.__mediavault) {
                const setActiveIndex = state.setActiveIndex;
                state.setActiveIndex = (index: unknown, ...rest: unknown[]) => {
                    handles(index);
                    return setActiveIndex(index, ...rest);
                };
                state.__mediavault = true;
            }
            return state;
        }));
    }

    return () => unpatches.forEach(unpatch => unpatch());
}

/** Shows the MediaVault grid in place of the picker's content, and the fallback tab row when needed. */
function decorate(tree: ReactElement, kinds: MediaKind[], kind: MediaKind | null, select: (kind: MediaKind | null) => void, injected: boolean): ReactNode {
    const root = tree as any;
    const children: ReactNode[] | undefined = Array.isArray(root?.props?.children) ? root.props.children : undefined;
    if (!children || !kinds.length) return tree;

    // The content is the child that holds the active picker (EmojiPicker, GIF picker...), not the segmented control.
    const holds = (node: any, pattern: RegExp) => !!findInReactTree(node, candidate => pattern.test(candidate?.type?.name ?? candidate?.type?.displayName ?? candidate?.type?.type?.name ?? ""));
    let contentIndex = children.findIndex(child => child && holds(child, /Picker|Gif|GIF|Sticker|Soundboard/) && !holds(child, /SegmentedControl/));
    pickerStatus.contentFound = contentIndex !== -1;
    if (contentIndex === -1) contentIndex = children.length - 1;

    const next = [...children];
    if (kind) {
        const content = next[contentIndex] as any;
        next[contentIndex] = <View key="mediavault-content" style={[content?.props?.style, styles.content]}>
            <LibraryBrowser accountId={currentAccountId() ?? ""} kind={kind} onSent={closePicker} />
        </View>;
    }
    if (!injected) next.splice(contentIndex, 0, <FallbackTabs key="mediavault-tabs" kinds={kinds} active={kind} select={select} />);
    return React.cloneElement(tree, undefined, ...next);
}

function FallbackTabs({ kinds, active, select }: { kinds: MediaKind[]; active: MediaKind | null; select(kind: MediaKind | null): void; }) {
    const { Text } = Design;
    return <View style={styles.tabs}>
        {kinds.map(kind => <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected: kind === active }} onPress={() => select(kind === active ? null : kind)} style={[styles.tab, kind === active && styles.tabActive]}>
            <Text variant="text-sm/semibold" color={kind === active ? "text-strong" : "text-muted"}>{t(`tab.${kind}` as Key)}</Text>
        </Pressable>)}
    </View>;
}

function closePicker() {
    try {
        findByProps("closePortalKeyboard")?.closePortalKeyboard();
    } catch {}
}

const styles = StyleSheet.create({
    content: { flex: 1 },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.14)" },
    tabActive: { backgroundColor: "rgba(88,101,242,0.35)" }
});
