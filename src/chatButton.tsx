/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import type { FC, ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { currentAccountId } from "./discord";
import { t } from "./i18n";
import { openLibrary } from "./library";
import { findInReactTree, patcher } from "./rv";
import { settings } from "./settings";
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
 * Replaces the desktop chat bar buttons: one button, next to the emoji button, that opens the library.
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

// Same element every render, so it can be found again in cached trees.
const button = <MediaVaultButton key="mediavault" />;

function insertButton(tree: ReactElement) {
    chatButtonStatus.rendered++;
    const node = findInReactTree(tree, candidate => Array.isArray(candidate?.props?.children)) as { props: { children: ReactNode[]; }; } | undefined;
    if (!node) return tree;
    chatButtonStatus.insertedInto = true;
    const { children } = node.props;
    if (!chatButtonStatus.siblings.length) describeChildren(children);
    const index = children.indexOf(button);
    if (index !== -1) children.splice(index, 1);
    if (settings().chatButton) children.unshift(button);
    return tree;
}

function MediaVaultButton() {
    const ChatInputActionButton = findActionButton();
    const Icon = icon("StarIcon", "FolderIcon", "ImageIcon");
    chatButtonStatus.actionButtonFound = !!ChatInputActionButton;
    const onPress = () => openLibrary(currentAccountId());
    if (ChatInputActionButton && Icon) return <ChatInputActionButton accessibilityLabel={t("m.open")} IconComponent={Icon} onPress={onPress} />;
    // Recent Discord versions no longer export ChatInputActionButton: draw a round button the size of the others.
    return <Pressable accessibilityRole="button" accessibilityLabel={t("m.open")} onPress={onPress} hitSlop={6} style={styles.button} ref={(view: unknown) => { chatButtonHost.current = view; }}>
        {Icon ? <Icon size="md" /> : <Text style={styles.star}>★</Text>}
    </Pressable>;
}

const styles = StyleSheet.create({
    button: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    star: { fontSize: 22, color: "#b5bac1" }
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
