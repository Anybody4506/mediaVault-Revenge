/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { currentAccountId } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import { LibraryBrowser } from "./library";
import type { MediaKind } from "./model";
import { describe } from "./describe";
import { Design, findByProps, findInReactTree, patcher } from "./rv";
import type { Settings } from "./settings";
import { PICKER_TAB_SETTINGS, settings, useSettings } from "./settings";

/**
 * Adds the Images, Videos, Audio and Files tabs of the desktop plugin to Discord's GIF/emoji picker.
 *
 * The picker (`ExpressionPicker`) is not exported, so it is swapped for a wrapper where React elements are created
 * (the jsx runtime). The wrapper renders it and replaces its segmented control (Emoji / GIF / Sticker) with a tab bar
 * of its own holding Discord's tabs and MediaVault's: Discord's control spaces and highlights its tabs from
 * measurements that extra tabs throw off. The MediaVault grid replaces the picker's content while one of its tabs is
 * active. If the segmented control is not found, a row of MediaVault tabs is shown below it instead.
 */

/** Shown in the diagnostic. */
export const pickerStatus = { wrapped: 0, segmentedHook: false, injected: false, segmentedOptions: [] as string[], contentFound: false, contentNames: [] as string[], tabs: [] as string[], error: "", hookCalls: [] as unknown[], segmentedState: null as unknown };

interface Injection {
    /** The picker's segmented control: its state (active page, `setActiveIndex`) and Discord's tabs. */
    discord?: { state: any; items: any[]; };
}

/** MediaVault's kinds in the picker: the ones with a chat bar button setting turned on (images and videos by default). */
const pickerKinds = (current: Settings): MediaKind[] => (Object.keys(PICKER_TAB_SETTINGS) as (keyof typeof PICKER_TAB_SETTINGS)[])
    .filter(kind => current[PICKER_TAB_SETTINGS[kind]]);

/** The tab to show when the picker opens, set by a chat bar button. */
let pendingKind: MediaKind | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
/** Selects a tab in the open picker, if any. */
let openPicker: ((kind: MediaKind) => void) | null = null;

/**
 * Shows a MediaVault tab in Discord's GIF/emoji picker, opening the picker with `openExpressionPicker` (the emoji
 * button's own handler) when it is closed. Returns false when the picker tabs are off, so the caller can fall back.
 */
export function showInPicker(kind: MediaKind, openExpressionPicker: (() => void) | undefined): boolean {
    const current = settings();
    if (!current.pickerTabs || !pickerKinds(current).includes(kind)) return false;
    const keyboardType = findByProps("getKeyboardType")?.getKeyboardType?.();
    if (openPicker && (keyboardType === undefined || keyboardType === "expression")) {
        openPicker(kind);
        return true;
    }
    if (!openExpressionPicker) return false;
    pendingKind = kind;
    // Forgotten if the picker does not open, so a later, manual opening shows Discord's tab as usual.
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingKind = null; }, 3000);
    openExpressionPicker();
    return true;
}
/** Set while the wrapper renders the original picker, so the segmented control hook knows it is the picker's. */
let rendering: Injection | null = null;

const isExpressionPicker = (type: any) => type?.name === "ExpressionPicker" || type?.type?.name === "ExpressionPicker";

export function patchExpressionPicker(): () => void {
    const unpatches: (() => void)[] = [];
    let original: ((props: any) => ReactNode) | undefined;

    function MediaVaultExpressionPicker(props: any) {
        const tabs = useSettings();
        const [active, setActive] = useState<MediaKind | null>(() => {
            const kind = pendingKind;
            pendingKind = null;
            return kind;
        });
        const kinds = pickerKinds(tabs);
        // Discord's own GIFs (search, trending) instead of MediaVault in the GIF tab.
        const [discordGifs, setDiscordGifs] = useState(false);
        const select = (kind: MediaKind | null) => {
            setActive(kind);
            setDiscordGifs(false);
        };
        const injection: Injection = {};

        useEffect(() => {
            const open = (kind: MediaKind) => {
                setActive(kind);
                setDiscordGifs(false);
            };
            openPicker = open;
            return () => {
                if (openPicker === open) openPicker = null;
            };
        }, []);
        let tree: ReactNode;
        rendering = injection;
        try {
            tree = original!(props);
        } finally {
            rendering = null;
        }
        const kind = active && kinds.includes(active) ? active : null;
        try {
            return decorate(tree as ReactElement, { kinds, kind, select, discord: injection.discord, discordGifs, setDiscordGifs, gifFolders: tabs.gifFolders });
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

    // Discord has several copies of the hook (the original module and modules re-exporting it), and the picker
    // does not use the first one found: every copy is patched. Nested copies see `rendering` cleared and pass through.
    const modules: any[] = vendetta.metro.findByPropsAll?.("useSegmentedControlState") ?? [findByProps("useSegmentedControlState")].filter(Boolean);
    modules.forEach(module => {
        try {
            unpatches.push(patcher.instead("useSegmentedControlState", module, recordTabs));
            pickerStatus.segmentedHook = true;
        } catch {
            // Re-exports defined as read-only getters cannot be patched; patching the original module covers them.
        }
    });

    // Reverse order, so nested patches of the same hook are undone cleanly.
    return () => unpatches.reverse().forEach(unpatch => unpatch());
}

/** Records the picker's segmented control (Emoji / GIF / Sticker), which the tab bar drives. */
function recordTabs(args: any[], hook: (...args: any[]) => any) {
    const injection = rendering;
    const [options] = args as [any];
    if (injection && pickerStatus.hookCalls.length < 4) pickerStatus.hookCalls.push(describe(args));
    const state = hook(...args);
    if (injection && Array.isArray(options?.items)) {
        rendering = null; // Only the picker's own segmented control.
        pickerStatus.segmentedOptions = Object.keys(options);
        injection.discord = { state, items: options.items };
    }
    return state;
}

/** Shows the MediaVault grid in place of the picker's content, and the fallback tab row when needed. */
interface Decoration {
    kinds: MediaKind[];
    kind: MediaKind | null;
    select(kind: MediaKind | null): void;
    discord: Injection["discord"];
    discordGifs: boolean;
    setDiscordGifs(shown: boolean): void;
    gifFolders: boolean;
}

const typeName = (node: any): string => node?.type?.name ?? node?.type?.displayName ?? node?.type?.type?.name ?? "";

function decorate(tree: ReactElement, { kinds, kind, select, discord, discordGifs, setDiscordGifs, gifFolders }: Decoration): ReactNode {
    const root = tree as any;
    const children: ReactNode[] | undefined = Array.isArray(root?.props?.children) ? root.props.children : undefined;
    if (!children) return tree;

    // The content is the child that holds the active picker (EmojiPicker, GIF picker...), not the segmented control.
    const holds = (node: any, pattern: RegExp) => !!findInReactTree(node, candidate => pattern.test(typeName(candidate)));
    let contentIndex = children.findIndex(child => child && holds(child, /Picker|Gif|GIF|Sticker|Soundboard/) && !holds(child, /SegmentedControl/));
    pickerStatus.contentFound = contentIndex !== -1;
    if (!pickerStatus.segmentedState) {
        const control = findInReactTree(tree, candidate => candidate?.props?.state && /Segmented/.test(candidate?.type?.name ?? candidate?.type?.displayName ?? ""));
        if (control) pickerStatus.segmentedState = { type: control.type?.name ?? control.type?.displayName, props: Object.keys(control.props), state: describe(control.props.state) };
    }
    if (contentIndex === -1) contentIndex = children.length - 1;

    const next = [...children];
    const content = next[contentIndex] as any;
    pickerStatus.contentNames = [...new Set([content, ...[content?.props?.children].flat()].map(typeName).filter(Boolean))].slice(0, 8);
    const accountId = currentAccountId() ?? "";
    // Discord's GIF tab, as on desktop: MediaVault's folders and Discord's favorite GIFs in one grid.
    // Discord's own GIFs (search, trending) stay one tap away, with a way back.
    const gifTab = !kind && gifFolders && !!content && holds(content, /gif/i) && !holds(content, /Emoji|Sticker/);
    if (gifTab && !discordGifs) {
        next[contentIndex] = <View key="mediavault-gif" style={[content.props?.style, styles.content]}>
            <LibraryBrowser accountId={accountId} kind="gif" link={{ label: `${t("m.searchGifs")} ›`, onPress: () => setDiscordGifs(true) }} onSent={closePicker} compact />
        </View>;
    } else if (gifTab) {
        next[contentIndex] = React.cloneElement(content, undefined, <Pressable key="mediavault-gif-back" accessibilityRole="button" onPress={() => setDiscordGifs(false)} style={styles.backLink}>
            <Design.Text variant="text-sm/semibold" color="text-link">{`‹ ${t("grid.title")}`}</Design.Text>
        </Pressable>, ...[content.props?.children].flat());
    }
    if (kind) {
        next[contentIndex] = <View key="mediavault-content" style={[content?.props?.style, styles.content]}>
            <LibraryBrowser accountId={currentAccountId() ?? ""} kind={kind} onSent={closePicker} compact />
        </View>;
    }
    // Discord's segmented control gives way to MediaVault's tab bar.
    let replaced = false;
    const withBar: ReactNode[] = discord && kinds.length ? replaceInTree(next, node => {
        if (replaced || !node?.props?.state) return false;
        return node.props.state === discord.state || /SegmentedControl$/.test(typeName(node));
    }, () => {
        replaced = true;
        return <TabBar key="mediavault-tab-bar" state={discord.state} items={discord.items} kinds={kinds} active={kind} select={select} />;
    }) : next;
    pickerStatus.injected = replaced;
    pickerStatus.tabs = replaced ? [...discord!.items.map(item => String(discordLabel(item))), ...kinds] : [];
    if (!replaced && kinds.length) withBar.splice(contentIndex, 0, <FallbackTabs key="mediavault-tabs" kinds={kinds} active={kind} select={select} />);
    return React.cloneElement(tree, undefined, ...withBar);
}

/** A copy of `node` (an element or an array of them) where the first descendant matching `match` is replaced. */
function replaceInTree(node: any, match: (candidate: any) => boolean, make: () => ReactNode): any {
    if (Array.isArray(node)) {
        let changed = false;
        const next = node.map(child => {
            const result = replaceInTree(child, match, make);
            if (result !== child) changed = true;
            return result;
        });
        return changed ? next : node;
    }
    if (!node || typeof node !== "object" || !node.props) return node;
    if (match(node)) return make();
    const { children } = node.props;
    if (children == null || typeof children !== "object") return node;
    const next = replaceInTree(children, match, make);
    return next === children ? node : React.cloneElement(node, undefined, ...(Array.isArray(next) ? next : [next]));
}

const readShared = (shared: any): unknown => {
    try {
        return shared?.value;
    } catch {
        return undefined;
    }
};

/** Discord's tab label, with "Autocollants" and other long translations of Sticker shortened. */
function discordLabel(item: any): ReactNode {
    const label = item?.label ?? item?.title ?? item?.id;
    return typeof label === "string" && /sticker|autocollant/i.test(`${item?.id} ${label}`) ? "Sticker" : label;
}

interface TabBarProps {
    state: any;
    items: any[];
    kinds: MediaKind[];
    active: MediaKind | null;
    select(kind: MediaKind | null): void;
}

/** Discord's tabs followed by MediaVault's, evenly spread when they fit, scrolling when they do not. */
function TabBar({ state, items, kinds, active, select }: TabBarProps) {
    const { Text } = Design;
    const [discordIndex, setDiscordIndex] = useState(() => readShared(state?.activeIndex) ?? 0);
    // A swipe between Discord's pages moves its active index without telling anyone: it is read regularly.
    useEffect(() => {
        const timer = setInterval(() => {
            const index = readShared(state?.activeIndex);
            if (typeof index === "number") setDiscordIndex(index);
        }, 200);
        return () => clearInterval(timer);
    }, [state]);
    const scroll = useRef<any>(null);
    const layouts = useRef<Record<string, { x: number; }>>({});

    const showDiscordTab = (index: number) => {
        setDiscordIndex(index);
        const move = () => {
            try {
                state?.setActiveIndex?.(index);
            } catch {}
        };
        if (!active) return move();
        // Discord's pages come back once MediaVault's grid is gone.
        select(null);
        setTimeout(move, 50);
    };
    const tabs = [
        ...items.map((item, index) => ({ key: `discord-${index}`, label: discordLabel(item), selected: !active && discordIndex === index, onPress: () => showDiscordTab(index) })),
        ...kinds.map(kind => ({ key: kind, label: t(`tab.${kind}` as Key) as ReactNode, selected: active === kind, onPress: () => select(kind) }))
    ];
    const selectedKey = tabs.find(tab => tab.selected)?.key;
    useEffect(() => {
        const layout = selectedKey ? layouts.current[selectedKey] : undefined;
        if (layout) scroll.current?.scrollTo?.({ x: Math.max(0, layout.x - 48), animated: true });
    }, [selectedKey]);

    return <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.bar} contentContainerStyle={styles.barContent}>
        {tabs.map(tab => <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: tab.selected }} onPress={tab.onPress}
            onLayout={(event: any) => { layouts.current[tab.key] = event.nativeEvent.layout; }}
            style={[styles.barTab, tab.selected && styles.barTabActive]}>
            {typeof tab.label === "string"
                ? <Text variant="text-sm/semibold" color={tab.selected ? "text-strong" : "text-muted"} numberOfLines={1}>{tab.label}</Text>
                : tab.label}
        </Pressable>)}
    </ScrollView>;
}

function FallbackTabs({ kinds, active, select }: { kinds: MediaKind[]; active: MediaKind | null; select(kind: MediaKind | null): void; }) {
    const { Text } = Design;
    return <View style={styles.tabs}>
        {kinds.map(kind => <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected: kind === active }} onPress={() => select(kind === active ? null : kind)} style={[styles.tab, kind === active && styles.tabActive]}>
            <Text variant="text-sm/semibold" color={kind === active ? "text-strong" : "text-muted"}>{t(`tab.${kind}` as Key)}</Text>
        </Pressable>)}
    </View>;
}

/**
 * Closing the portal keyboard alone leaves its space reserved under the chat bar (the keyboard type stays
 * "expression"): Discord also switches back to the system keyboard and dismisses it, as after sending a GIF.
 */
function closePicker() {
    const steps = [
        () => findByProps("closePortalKeyboard")?.closePortalKeyboard(),
        () => findByProps("setKeyboardType")?.setKeyboardType({ type: "system" }),
        () => {
            const keyboard = findByProps("dismissKeyboard") ?? findByProps("clearCurrentFocusAndDismissKeyboard");
            (keyboard?.dismissKeyboard ?? keyboard?.clearCurrentFocusAndDismissKeyboard)?.();
        },
        () => vendetta.metro.common.ReactNative.Keyboard?.dismiss()
    ];
    steps.forEach(step => {
        try {
            step();
        } catch {}
    });
}

const styles = StyleSheet.create({
    content: { flex: 1 },
    bar: { flexGrow: 0 },
    barContent: { flexGrow: 1, gap: 2, paddingHorizontal: 8, paddingVertical: 4 },
    barTab: { flexGrow: 1, alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
    barTabActive: { backgroundColor: "rgba(128,128,128,0.22)" },
    backLink: { paddingHorizontal: 12, paddingVertical: 8 },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.14)" },
    tabActive: { backgroundColor: "rgba(88,101,242,0.35)" }
});
