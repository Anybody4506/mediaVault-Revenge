/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import type { MessageLike } from "./actions";
import { addMedia, getMediaFromMessage, removeSaved } from "./actions";
import { currentAccountId, notify } from "./discord";
import { t } from "./i18n";
import { canonicalUrl, hasMedia } from "./model";
import { openLibrary } from "./library";
import { ActionSheetActionCreators, Design, findByProps, patcher } from "./rv";
import { useLibrary } from "./store";
import { icon, run } from "./ui";

type Element = ReactElement<{ children?: ReactNode; }>;
interface SheetProps { message?: MessageLike; channel?: { id: string; guild_id?: string | null; }; }

/**
 * Replaces the desktop star and the "MediaVault" context menu: rows in the message long-press sheet.
 * The sheet is loaded lazily, so it is patched when Discord opens it, like other Vendetta plugins do.
 */
export function patchMessageActionSheet(onError: (error: unknown) => void) {
    const sheets = findByProps("openLazy", "hideActionSheet");
    if (!sheets) throw new Error("Discord's action sheet module was not found.");
    const patched = new WeakSet<object>();
    const unpatches: (() => void)[] = [];

    unpatches.push(patcher.before("openLazy", sheets, args => {
        const [lazySheet, key, props] = args as [Promise<{ default: (props: SheetProps) => unknown; }>, string, SheetProps | undefined];
        if (!/MessageLongPress|LongPressMessage/.test(String(key)) || !props?.message) return;
        void Promise.resolve(lazySheet).then(module => {
            if (!module || patched.has(module)) return;
            patched.add(module);
            unpatches.push(patcher.instead("default", module, (sheetArgs, Sheet) => {
                const tree = Sheet(...sheetArgs) as Element;
                try {
                    const [{ message, channel }] = sheetArgs as [SheetProps];
                    const media = getMediaFromMessage(message, channel?.guild_id);
                    if (media.length) addToActionSheet(tree, <MessageRows key="mediavault" media={media} />);
                } catch (error) {
                    onError(error);
                }
                return tree;
            }));
        }, onError);
    }));

    return () => {
        for (const unpatch of unpatches) unpatch();
    };
}

function addToActionSheet(tree: unknown, group: ReactNode) {
    const sheet = findActionSheet(tree);
    if (!sheet) return;
    const children = [sheet.props.children].flat().filter(Boolean);
    // After the reactions and quick actions, before the long list of Discord's own rows.
    children.splice(Math.min(1, children.length), 0, group);
    sheet.props.children = children;
}

function findActionSheet(element: unknown): Element | undefined {
    if (!element || typeof element !== "object") return;
    if (Array.isArray(element)) {
        for (const child of element) {
            const found = findActionSheet(child);
            if (found) return found;
        }
        return;
    }
    const { type, props } = element as Element;
    if (type === Design.ActionSheet) return element as Element;
    return findActionSheet(props?.children);
}

const fail = (message: string) => notify(message, true);

function MessageRows({ media }: { media: ReturnType<typeof getMediaFromMessage>; }) {
    const { ActionSheetRow } = Design;
    const accountId = currentAccountId();
    const { library } = useLibrary(accountId);
    if (!accountId) return null;
    const close = (action: () => unknown) => run(() => {
        ActionSheetActionCreators.hideActionSheet();
        return action();
    }, fail);
    const StarIcon = icon("StarIcon", "StarOutlineIcon");
    const RemoveIcon = icon("StarOutlineIcon", "TrashIcon");
    const LibraryIcon = icon("FolderIcon", "ImageIcon");
    const missing = library ? media.filter(item => !hasMedia(library, item.url)) : [];

    return <ActionSheetRow.Group>
        {media.slice(0, 10).map(item => {
            const saved = !!library && hasMedia(library, item.url);
            const RowIcon = saved ? RemoveIcon : StarIcon;
            return <ActionSheetRow
                key={canonicalUrl(item.url)}
                label={saved ? t("m.remove") : t("m.add")}
                subLabel={`${t(`tab.${item.kind}`)} · ${item.name}`}
                subLabelLineClamp={1}
                variant={saved ? "danger" : "default"}
                icon={RowIcon ? <ActionSheetRow.Icon IconComponent={RowIcon} variant={saved ? "danger" : "default"} /> : undefined}
                onPress={close(() => saved
                    ? removeSaved(accountId, { ...item, nativeFavorite: undefined }).then(() => notify(t("m.removed")))
                    : addMedia(accountId, item).then(() => notify(t("toast.added"))))}
            />;
        })}
        {missing.length > 1 && <ActionSheetRow
            label={t("m.addAll", { count: missing.length })}
            icon={StarIcon ? <ActionSheetRow.Icon IconComponent={StarIcon} /> : undefined}
            onPress={close(async () => {
                for (const item of missing) await addMedia(accountId, item);
                notify(t("toast.added"));
            })}
        />}
        <ActionSheetRow
            label={t("m.open")}
            icon={LibraryIcon ? <ActionSheetRow.Icon IconComponent={LibraryIcon} /> : undefined}
            onPress={close(() => openLibrary(accountId, media[0]?.kind))}
        />
    </ActionSheetRow.Group>;
}
