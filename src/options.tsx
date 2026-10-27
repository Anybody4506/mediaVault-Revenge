/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import type { ReactNode } from "react";

import { chooseMedia, removeSaved } from "./actions";
import { copy, notify } from "./discord";
import { t } from "./i18n";
import type { LibraryData, MediaCategory, MediaKind, SavedMedia } from "./model";
import { deleteCategory, ensureMedia, moveCategory, moveCategoryOrder, moveMedia, renameMedia, setCategoryThumbnail, upsertCategory } from "./model";
import { useLibrary, updateLibrary } from "./store";
import { Design } from "./rv";
import { confirmAction, hideSheet, icon, openSheet, promptText, run } from "./ui";

const MEDIA_SHEET = "MEDIAVAULT_MEDIA_OPTIONS";
const FOLDER_SHEET = "MEDIAVAULT_FOLDER_OPTIONS";
const PICKER_SHEET = "MEDIAVAULT_FOLDER_PICKER";
const LIBRARY_SHEET = "MEDIAVAULT_LIBRARY";

const fail = (message: string) => notify(message, true);
const makeId = () => `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function Row({ label, sub, iconNames, danger, onPress }: { label: string; sub?: string; iconNames: string[]; danger?: boolean; onPress(): void; }) {
    const { ActionSheet, ActionSheetRow, BottomSheetTitleHeader } = Design;
    const Icon = icon(...iconNames);
    return <ActionSheetRow
        label={label}
        subLabel={sub}
        variant={danger ? "danger" : "default"}
        icon={Icon ? <ActionSheetRow.Icon IconComponent={Icon} variant={danger ? "danger" : "default"} /> : undefined}
        onPress={onPress}
    />;
}

/** Closes the options sheet, then runs the action. */
const closeThen = (key: string, action: () => unknown) => run(() => {
    hideSheet(key);
    return action();
}, fail);

// Media

interface MediaOptionsProps {
    accountId: string;
    item: SavedMedia;
    folderId: string | null;
}

export const openMediaOptions = (props: MediaOptionsProps) => openSheet(MEDIA_SHEET, MediaOptionsSheet, props);

function MediaOptionsSheet({ accountId, item, folderId }: MediaOptionsProps) {
    const { ActionSheet, ActionSheetRow, BottomSheetTitleHeader } = Design;
    const close = (action: () => unknown) => closeThen(MEDIA_SHEET, action);
    const change = (update: (library: LibraryData) => LibraryData) => updateLibrary(accountId, current => update(ensureMedia(current, item)));
    return <ActionSheet>
        <BottomSheetTitleHeader title={item.name} subtitle={t(`tab.${item.kind}`)} />
        <ActionSheetRow.Group>
            <Row label={t("media.send")} iconNames={["SendMessageIcon", "ArrowLargeRightIcon"]} onPress={close(() => chooseMedia(item).then(sent => sent && hideSheet(LIBRARY_SHEET)))} />
            <Row label={t("media.rename")} iconNames={["PencilIcon"]} onPress={close(() => promptText({
                title: t("media.rename"),
                label: t("media.name"),
                initial: item.name,
                maxLength: 80,
                onSubmit: name => change(library => renameMedia(library, item.url, name)).catch(error => fail(error.message))
            }))} />
            <Row label={t("media.moveTo")} iconNames={["FolderIcon"]} onPress={close(() => openFolderPicker({
                accountId,
                kind: item.kind,
                title: t("media.moveTo"),
                onPick: target => change(library => moveMedia(library, item.url, target)).then(() => notify(t("m.moved")), error => fail(error.message))
            }))} />
            {folderId && <Row label={t("media.thumbFolder")} iconNames={["ImageIcon"]} onPress={close(() => updateLibrary(accountId, library => setCategoryThumbnail(library, folderId, item.previewUrl ?? item.url)))} />}
        </ActionSheetRow.Group>
        <ActionSheetRow.Group>
            <Row label={t("media.copyLink")} iconNames={["LinkIcon", "CopyIcon"]} onPress={close(() => copy(item.url))} />
            {item.messageUrl && <Row label={t("media.copyMessage")} iconNames={["ChatIcon", "CopyIcon"]} onPress={close(() => copy(item.messageUrl!))} />}
            {item.sourceUrl && <Row label={t("media.copySource")} iconNames={["GlobeEarthIcon", "CopyIcon"]} onPress={close(() => copy(item.sourceUrl!))} />}
        </ActionSheetRow.Group>
        <ActionSheetRow.Group>
            <Row danger label={t("media.remove")} iconNames={["TrashIcon"]} onPress={close(() => removeSaved(accountId, item).then(() => notify(t("m.removed"))))} />
        </ActionSheetRow.Group>
    </ActionSheet>;
}

// Folders

export function promptCreateFolder(accountId: string, kind: MediaKind, parentId: string | null) {
    promptText({
        title: parentId ? t("folder.createChild") : t("grid.createFolder"),
        label: t("folder.name"),
        placeholder: t("folder.placeholder"),
        maxLength: 20,
        withColor: true,
        onSubmit: (name, color) => updateLibrary(accountId, library => upsertCategory(library, { id: makeId(), name, kind, color, parentId }))
            .catch(error => fail(error.message))
    });
}

interface FolderOptionsProps {
    accountId: string;
    folderId: string;
    kind: MediaKind;
}

export const openFolderOptions = (props: FolderOptionsProps) => openSheet(FOLDER_SHEET, FolderOptionsSheet, props);

function FolderOptionsSheet({ accountId, folderId, kind }: FolderOptionsProps) {
    const { ActionSheet, ActionSheetRow, BottomSheetTitleHeader } = Design;
    const { library } = useLibrary(accountId);
    const folder = library?.categories.find(category => category.id === folderId);
    if (!library || !folder) return <ActionSheet><BottomSheetTitleHeader title={t("folder.options")} /></ActionSheet>;
    const close = (action: () => unknown) => closeThen(FOLDER_SHEET, action);
    const change = (update: (current: LibraryData) => LibraryData) => updateLibrary(accountId, update).catch(error => fail(error.message));
    const first = library.items.find(item => item.categoryId === folderId);
    return <ActionSheet>
        <BottomSheetTitleHeader title={folder.name} subtitle={t("folder.options")} />
        <ActionSheetRow.Group>
            <Row label={t("folder.createChild")} iconNames={["FolderPlusIcon", "PlusLargeIcon", "FolderIcon"]} onPress={close(() => promptCreateFolder(accountId, folder.kind === "all" ? kind : folder.kind, folder.id))} />
            <Row label={t("folder.edit")} iconNames={["PencilIcon"]} onPress={close(() => promptText({
                title: t("folder.edit"),
                label: t("folder.name"),
                initial: folder.name,
                color: folder.color,
                maxLength: 20,
                withColor: true,
                onSubmit: (name, color) => change(current => upsertCategory(current, { ...folder, name, color }))
            }))} />
        </ActionSheetRow.Group>
        <ActionSheetRow.Group>
            <Row label={t("folder.before")} iconNames={["ArrowSmallUpIcon", "ChevronSmallUpIcon"]} onPress={close(() => change(current => moveCategoryOrder(current, folder.id, -1, kind)))} />
            <Row label={t("folder.after")} iconNames={["ArrowSmallDownIcon", "ChevronSmallDownIcon"]} onPress={close(() => change(current => moveCategoryOrder(current, folder.id, 1, kind)))} />
            <Row label={t("folder.into")} iconNames={["FolderIcon"]} onPress={close(() => openFolderPicker({
                accountId,
                kind: folder.kind === "all" ? kind : folder.kind,
                title: t("folder.into"),
                excludeId: folder.id,
                onPick: target => change(current => moveCategory(current, folder.id, target))
            }))} />
            {folder.parentId && <Row label={t("folder.toRoot")} iconNames={["HomeIcon", "FolderIcon"]} onPress={close(() => change(current => moveCategory(current, folder.id, null)))} />}
        </ActionSheetRow.Group>
        <ActionSheetRow.Group>
            {first && <Row label={t("folder.thumbFirst")} iconNames={["ImageIcon"]} onPress={close(() => change(current => setCategoryThumbnail(current, folder.id, first.previewUrl ?? first.url)))} />}
            {folder.thumbnail && <Row label={t("folder.unthumb")} iconNames={["ImageIcon"]} onPress={close(() => change(current => setCategoryThumbnail(current, folder.id, undefined)))} />}
            <Row danger label={t("folder.delete")} iconNames={["TrashIcon"]} onPress={close(() => confirmAction(t("folder.delete"), folder.name, () => change(current => deleteCategory(current, folder.id))))} />
        </ActionSheetRow.Group>
    </ActionSheet>;
}

// Folder picker

interface FolderPickerProps {
    accountId: string;
    kind: MediaKind;
    title: string;
    /** A folder that cannot be picked, with its subfolders (moving a folder into itself). */
    excludeId?: string;
    onPick(folderId: string | null): unknown;
}

const openFolderPicker = (props: FolderPickerProps) => openSheet(PICKER_SHEET, FolderPickerSheet, props);

function excluded(library: LibraryData, excludeId?: string) {
    const ids = new Set<string>(excludeId ? [excludeId] : []);
    let changed = true;
    while (changed) {
        changed = false;
        for (const category of library.categories) {
            if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
                ids.add(category.id);
                changed = true;
            }
        }
    }
    return ids;
}

/** Folders in tree order, each with its depth. */
function flatten(categories: MediaCategory[], parentId: string | null = null, depth = 0, seen = new Set<string>()): [MediaCategory, number][] {
    return categories.filter(category => (category.parentId ?? null) === parentId && !seen.has(category.id)).flatMap(category => {
        seen.add(category.id);
        return [[category, depth] as [MediaCategory, number], ...flatten(categories, category.id, depth + 1, seen)];
    });
}

function FolderPickerSheet({ accountId, kind, title, excludeId, onPick }: FolderPickerProps) {
    const { ActionSheet, ActionSheetRow, BottomSheetTitleHeader } = Design;
    const { library } = useLibrary(accountId);
    const pick = (target: string | null) => closeThen(PICKER_SHEET, () => onPick(target));
    let rows: ReactNode = null;
    if (library) {
        const skip = excluded(library, excludeId);
        rows = flatten(library.categories.filter(category => category.kind === kind || category.kind === "all"))
            .filter(([category]) => !skip.has(category.id))
            .map(([category, depth]) => <Row key={category.id} label={`${"    ".repeat(depth)}${category.name}`} iconNames={["FolderIcon"]} onPress={pick(category.id)} />);
    }
    return <ActionSheet scrollable>
        <BottomSheetTitleHeader title={title} />
        <ActionSheetRow.Group>
            <Row label={t("m.toRoot")} iconNames={["HomeIcon", "FolderIcon"]} onPress={pick(null)} />
            {rows}
        </ActionSheetRow.Group>
    </ActionSheet>;
}
