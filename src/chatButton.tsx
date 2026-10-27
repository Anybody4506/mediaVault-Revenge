/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import type { FC, ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { currentAccountId } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import { KIND_ICONS, openLibrary } from "./library";
import type { MediaKind } from "./model";
import { showInPicker } from "./picker";
import { findInReactTree, patcher } from "./rv";
import { CHAT_BUTTON_SETTINGS, settings } from "./settings";
import { icon } from "./ui";

interface ChatInputActionButtonProps {
    accessibilityLabel: string;
    IconComponent: React.ComponentType<any>;
    onPress(): void;
}

const findRightActions = () => vendetta.metro.find((m: any) => m?.type?.displayName === "ChatInputRightActions");
const findActionButton = (): FC<ChatInputActionButtonProps> | undefined => vendetta.metro.findByName("ChatInputActionButton");

/** The button's native view: the diagnostic starts from it to walk Discord's React tree. */
export const chatButtonHost: { current: any; } = { current: null };

/** Shown in the diagnostic. */
export const chatButtonStatus = { rightActionsFound: false, tries: 0, rendered: 0, actionButtonFound: false, insertedInto: false, siblings: [] as string[] };

/**
 * The desktop chat bar buttons: one per media kind (images and videos by default), next to the emoji button,
 * each opening the library on its tab.
 * Discord loads the chat bar lazily, so the lookup is retried for a while after startup.
 */
export function patchChatInput(): () => void {
    let unpatch: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
        const RightActions = findRightActions();
        chatButtonStatus.tries = tries + 1;
        if (RightActions) {
            chatButtonStatus.rightActionsFound = true;
            unpatch = patcher.after("type", RightActions, (_, tree) => insertButton(tree as ReactElement));
            return;
        }
        if (++tries < 60) timer = setTimeout(attempt, 2000);
    };
    attempt();
    return () => {
        if (timer !== undefined) clearTimeout(timer);
        unpatch?.();
    };
}

/** The emoji button's handler, which opens the GIF/emoji picker the way Discord does. */
let expressionButtonPress: (() => void) | undefined;

// Same elements every render, so they can be found again in cached trees.
const buttons = (Object.keys(CHAT_BUTTON_SETTINGS) as (keyof typeof CHAT_BUTTON_SETTINGS)[])
    .map(kind => ({ kind, element: <MediaVaultButton key={`mediavault-${kind}`} kind={kind} /> }));

function insertButton(tree: ReactElement) {
    chatButtonStatus.rendered++;
    const node = findInReactTree(tree, candidate => Array.isArray(candidate?.props?.children)) as { props: { children: ReactNode[]; }; } | undefined;
    if (!node) return tree;
    chatButtonStatus.insertedInto = true;
    const { children } = node.props;
    if (!chatButtonStatus.siblings.length) describeChildren(children);
    for (const { element } of buttons) {
        const index = children.indexOf(element);
        if (index !== -1) children.splice(index, 1);
    }
    const expression: any = children.find((child: any) => /ExpressionButton/.test(child?.type?.name ?? child?.type?.displayName ?? child?.type?.type?.name ?? ""));
    expressionButtonPress = typeof expression?.props?.onPress === "function" ? expression.props.onPress : undefined;
    const current = settings();
    if (!current.chatButtons) return tree;
    children.unshift(...buttons.filter(({ kind }) => current[CHAT_BUTTON_SETTINGS[kind]]).map(({ element }) => element));
    return tree;
}

function MediaVaultButton({ kind }: { kind: MediaKind; }) {
    const ChatInputActionButton = findActionButton();
    const Icon = icon(...KIND_ICONS[kind]);
    chatButtonStatus.actionButtonFound = !!ChatInputActionButton;
    const label = `MediaVault: ${t(`tab.${kind}` as Key)}`;
    // The picker opens on this kind's tab, like the desktop buttons; the library sheet is the fallback.
    const onPress = () => {
        if (!showInPicker(kind, expressionButtonPress)) openLibrary(currentAccountId(), kind);
    };
    if (ChatInputActionButton && Icon) return <ChatInputActionButton accessibilityLabel={label} IconComponent={Icon} onPress={onPress} />;
    // Recent Discord versions no longer export ChatInputActionButton: draw a round button the size of the others.
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={styles.button} ref={(view: unknown) => { chatButtonHost.current = view; }}>
        {Icon ? <Icon size="md" /> : <Text style={styles.fallback}>{kind === "video" ? "▶" : "▣"}</Text>}
    </Pressable>;
}

const styles = StyleSheet.create({
    button: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
    fallback: { fontSize: 20, color: "#b5bac1" }
});

/** Describes the chat bar's buttons, so the diagnostic shows what the MediaVault button sits next to. */
function describeChildren(children: ReactNode[]) {
    chatButtonStatus.siblings = children.slice(0, 8).map((child: any) => {
        const type = child?.type;
        const name = typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.type?.displayName ?? type?.type?.name ?? typeof type;
        return `${name}(${Object.keys(child?.props ?? {}).join(",")})`;
    });
}

/** `/mediavault` opens the library, whatever happens to the chat bar patch. */
export function registerCommand(): () => void {
    return vendetta.commands.registerCommand({
        name: "mediavault",
        displayName: "mediavault",
        description: "Open the MediaVault library",
        displayDescription: "Open the MediaVault library",
        applicationId: "-1",
        inputType: 1,
        type: 1,
        options: [],
        execute: () => {
            openLibrary(currentAccountId());
        }
    });
}
