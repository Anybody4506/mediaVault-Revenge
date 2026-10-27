/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import { chooseMedia, withoutRecentlyRemoved } from "./actions";
import { notify, useNativeGifs } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import type { LibraryData, MediaCategory, MediaKind, SavedMedia } from "./model";
import { canonicalUrl, gifView } from "./model";
import { openFolderOptions, openMediaOptions, promptCreateFolder } from "./options";
import { TAB_SETTINGS, useSettings } from "./settings";
import { useLibrary } from "./store";
import { Design, SheetScrollView, useSafeAreaInsets } from "./rv";
import { previewOf, thumbnailSource } from "./thumbs";
import { EmptyText, hideSheet, icon, openSheet } from "./ui";
import { useFreshUrl } from "./urls";

export const LIBRARY_SHEET = "MEDIAVAULT_LIBRARY";
export const KINDS: MediaKind[] = ["gif", "image", "video", "audio", "file"];
const VISUAL = new Set<MediaKind>(["gif", "image", "video"]);
const GAP = 8;

export interface LibrarySheetProps {
    accountId: string;
    initialKind?: MediaKind;
}

export function openLibrary(accountId: string | undefined, initialKind?: MediaKind) {
    if (!accountId) return notify(t("m.signedOut"), true);
    openSheet(LIBRARY_SHEET, LibrarySheet, { accountId, initialKind }, "replaceAll");
}

/** What the current tab shows. On the GIF tab Discord's own favorites come first, as on desktop. */
export function useTabItems(library: LibraryData | null, kind: MediaKind, nativeGifs: ReturnType<typeof useNativeGifs>, syncNative: boolean) {
    return useMemo(() => {
        if (!library) return [];
        if (kind === "gif" && syncNative && nativeGifs) return gifView(library, withoutRecentlyRemoved(nativeGifs));
        return library.items.filter(item => item.kind === kind);
    }, [library, kind, nativeGifs, syncNative]);
}

export function folderPath(library: LibraryData, folderId: string | null): MediaCategory[] {
    const path: MediaCategory[] = [];
    let cursor = folderId;
    while (cursor) {
        const folder = library.categories.find(category => category.id === cursor);
        if (!folder || path.includes(folder)) break;
        path.unshift(folder);
        cursor = folder.parentId ?? null;
    }
    return path;
}

export default function LibrarySheet({ accountId, initialKind }: LibrarySheetProps) {
    const settings = useSettings();
    const { ActionSheet, BottomSheetTitleHeader, Text } = Design;
    const kinds = KINDS.filter(kind => settings[TAB_SETTINGS[kind]]);
    const tabs = kinds.length ? kinds : ["gif" as const];
    const [kind, setKind] = useState<MediaKind>(initialKind && tabs.includes(initialKind) ? initialKind : tabs[0]);

    return <ActionSheet scrollable startExpanded>
        <BottomSheetTitleHeader title={t("grid.title")} />
        <LibraryBrowser accountId={accountId} kind={kind} onSent={() => hideSheet(LIBRARY_SHEET)} header={<View style={styles.tabs}>
            {tabs.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: tab === kind }} onPress={() => setKind(tab)} style={[styles.tab, tab === kind && styles.tabActive]}>
                <Text variant="text-sm/semibold" color={tab === kind ? "text-strong" : "text-muted"}>{t(`tab.${tab}` as Key)}</Text>
            </Pressable>)}
        </View>} />
    </ActionSheet>;
}

export interface LibraryBrowserProps {
    accountId: string;
    kind: MediaKind;
    /** Called once a media was sent or inserted in the chat box. */
    onSent(): void;
    header?: React.ReactNode;
    /** Denser layout for the GIF/emoji picker tabs: 4 columns, no hint. */
    compact?: boolean;
    /** Folder open at first. */
    initialFolderId?: string | null;
    /** A link at the top level, beside the search (the GIF tab's link to Discord's own GIFs). */
    link?: { label: string; onPress(): void; };
}

/** Search, folders and the media grid of one tab: the body of the library sheet, and of the GIF/emoji picker tabs. */
export function LibraryBrowser({ accountId, kind, onSent, header, compact, initialFolderId, link }: LibraryBrowserProps) {
    const settings = useSettings();
    const { Button, Stack, Text, TextInput } = Design;
    const Scroller = SheetScrollView() ?? ScrollView;
    const { bottom } = useSafeAreaInsets();
    const [folderId, setFolderId] = useState<string | null>(initialFolderId ?? null);
    const shownKind = useRef(kind);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(0);
    const [width, setWidth] = useState(0);

    const { library, error } = useLibrary(accountId);
    const nativeGifs = useNativeGifs(kind === "gif" && settings.syncNativeGifs);
    const items = useTabItems(library, kind, nativeGifs, settings.syncNativeGifs);

    useEffect(() => {
        if (shownKind.current === kind) return; // Not on mount, which would close the initial folder.
        shownKind.current = kind;
        setFolderId(null);
        setSearch("");
    }, [kind]);
    useEffect(() => setPage(0), [kind, folderId, search]);
    // The open folder may have been deleted from its options.
    useEffect(() => {
        if (folderId && library && !library.categories.some(category => category.id === folderId)) setFolderId(null);
    }, [library, folderId]);

    const query = search.trim().toLowerCase();
    const folders = useMemo(() => {
        if (!library) return [];
        const sameKind = library.categories.filter(category => category.kind === kind || category.kind === "all");
        if (query) return sameKind.filter(category => category.name.toLowerCase().includes(query));
        return sameKind.filter(category => (category.parentId ?? null) === folderId);
    }, [library, kind, folderId, query]);

    const shown = useMemo(() => {
        if (query) return items.filter(item => item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query));
        if (folderId) return items.filter(item => item.categoryId === folderId);
        return settings.hideUnsortedMedias ? items.filter(item => !item.categoryId) : items;
    }, [items, folderId, query, settings.hideUnsortedMedias]);

    const perPage = settings.maxMediasPerPage;
    const entries = [...folders.map(folder => ({ folder })), ...shown.map(item => ({ item }))];
    const pages = Math.max(1, Math.ceil(entries.length / perPage));
    const visible = entries.slice(page * perPage, (page + 1) * perPage);
    const columns = VISUAL.has(kind) && !compact ? 3 : 2;
    const tile = width ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
    const path = library ? folderPath(library, folderId) : [];

    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

    const FolderPlus = icon("FolderPlusIcon", "FolderIcon");

    return <Scroller contentContainerStyle={[compact ? styles.compactContent : styles.content, { paddingBottom: 16 + bottom }]} keyboardShouldPersistTaps="handled">
        <Stack spacing={compact ? 8 : 12}>
            {header}
            <View style={styles.searchRow}>
                <View style={{ flex: 1 }}>
                    <TextInput size="sm" placeholder={t(`search.${kind}` as Key)} value={search} onChange={(value: string) => setSearch(value)} isClearable onClear={() => setSearch("")} />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t("grid.createFolder")} hitSlop={4} onPress={() => library && promptCreateFolder(accountId, kind, folderId)} style={styles.iconButton}>
                    {FolderPlus ? <FolderPlus size="sm" /> : <Text variant="text-lg/bold">+</Text>}
                </Pressable>
            </View>
            {!query && !path.length && link && <Pressable accessibilityRole="button" onPress={link.onPress} style={styles.crumb}>
                <Text variant="text-sm/semibold" color="text-link">{link.label}</Text>
            </Pressable>}
            {!query && path.length > 0 && <Pressable accessibilityRole="button" onPress={() => setFolderId(path.at(-2)?.id ?? null)} style={styles.crumb}>
                <Text variant="text-sm/semibold" color="text-link">{`‹ ${t("back")}`}</Text>
                <Text variant="text-sm/medium" color="text-muted" lineClamp={1} style={{ flexShrink: 1 }}>{path.map(folder => folder.name).join(" / ")}</Text>
            </Pressable>}
            {error ? <EmptyText>{error}</EmptyText>
                : !library ? <EmptyText>{t("loading")}</EmptyText>
                    : !visible.length ? <EmptyText>{query ? t("empty.search") : folderId ? t("m.emptyFolder") : t("m.emptyRoot")}</EmptyText>
                        : <View onLayout={onLayout} style={{ gap: GAP }}>
                            {/* Folders first, as wide cards on two columns like the desktop GIF categories, then the media grid. */}
                            {tile > 0 && visible.some(entry => "folder" in entry) && <View style={styles.grid}>
                                {visible.map(entry => "folder" in entry && <FolderTile key={`f-${entry.folder.id}`} folder={entry.folder} items={items}
                                    width={Math.floor((width - GAP) / 2)} height={compact ? 64 : 80} visual={VISUAL.has(kind)} hideThumbnail={settings.hideThumbnail}
                                    onPress={() => { setSearch(""); setFolderId(entry.folder.id); }}
                                    onLongPress={() => openFolderOptions({ accountId, folderId: entry.folder.id, kind })} />)}
                            </View>}
                            {tile > 0 && visible.some(entry => "item" in entry) && <View style={styles.grid}>
                                {visible.map(entry => "item" in entry && <MediaTile key={`m-${canonicalUrl(entry.item.url)}`} item={entry.item} size={tile} visual={VISUAL.has(kind)}
                                    onPress={() => void chooseMedia(entry.item).then(sent => sent && onSent())}
                                    onLongPress={() => openMediaOptions({ accountId, item: entry.item, folderId })} />)}
                            </View>}
                        </View>}
            {pages > 1 && <View style={styles.pager}>
                <Button size="sm" variant="secondary" text={t("page.prev")} disabled={page === 0} onPress={() => setPage(page - 1)} />
                <Text variant="text-sm/medium" color="text-muted">{`${page + 1} / ${pages}`}</Text>
                <Button size="sm" variant="secondary" text={t("page.next")} disabled={page >= pages - 1} onPress={() => setPage(page + 1)} />
            </View>}
            {!compact && <Text variant="text-xs/medium" color="text-muted" style={{ textAlign: "center" }}>{t("m.hint")}</Text>}
        </Stack>
    </Scroller>;
}

function Thumbnail({ url, size, height = size, fallbackIcon }: { url: string | undefined; size: number; height?: number; fallbackIcon: string[]; }) {
    const fresh = useFreshUrl(url);
    const [failed, setFailed] = useState(false);
    const source = thumbnailSource(fresh);
    useEffect(() => setFailed(false), [source]);
    if (!source || failed) {
        const Icon = icon(...fallbackIcon);
        return <View style={{ width: size, height, alignItems: "center", justifyContent: "center" }}>{Icon && <Icon size="md" />}</View>;
    }
    return <Image source={{ uri: source }} style={{ width: size, height }} resizeMode="cover" onError={() => setFailed(true)} />;
}

export const KIND_ICONS: Record<MediaKind, string[]> = {
    gif: ["GifIcon", "ImageIcon"],
    image: ["ImageIcon"],
    video: ["CirclePlayIcon", "PlayIcon", "VideoIcon"],
    audio: ["MusicIcon", "SoundboardIcon", "VoiceNormalIcon"],
    file: ["PaperIcon", "AttachmentIcon"]
};

function MediaTile({ item, size, visual, onPress, onLongPress }: { item: SavedMedia; size: number; visual: boolean; onPress(): void; onLongPress(): void; }) {
    const { Text } = Design;
    if (!visual) {
        const Icon = icon(...KIND_ICONS[item.kind]);
        return <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={onPress} onLongPress={onLongPress} style={[styles.card, styles.row, { width: size }]}>
            {Icon && <Icon size="sm" />}
            <Text variant="text-sm/medium" lineClamp={2} style={{ flexShrink: 1 }}>{item.name}</Text>
        </Pressable>;
    }
    return <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={onPress} onLongPress={onLongPress} style={[styles.card, { width: size, height: size }]}>
        <Thumbnail url={previewOf(item)} size={size} fallbackIcon={KIND_ICONS[item.kind]} />
    </Pressable>;
}

/** Black or white, whichever reads better on a folder color. */
function readableOn(color: string) {
    const hex = /^#?([da-f]{6})$/i.exec(color)?.[1];
    if (!hex) return "#ffffff";
    const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#000000" : "#ffffff";
}

/** Same look as the desktop folders (and Discord's GIF categories): color or cover image, dark fade, centered name. */
export function FolderTile({ folder, items, width, height, visual, hideThumbnail, onPress, onLongPress }: {
    folder: MediaCategory; items: SavedMedia[]; width: number; height: number; visual: boolean; hideThumbnail: boolean; onPress(): void; onLongPress(): void;
}) {
    const { Text } = Design;
    const color = folder.color ?? "#202225";
    const first = items.find(item => item.categoryId === folder.id);
    const thumbnail = hideThumbnail || !visual ? undefined : folder.thumbnail ?? (first && previewOf(first));
    return <Pressable accessibilityRole="button" accessibilityLabel={t("folder.openAria", { name: folder.name })} onPress={onPress} onLongPress={onLongPress}
        style={[styles.folder, { width, height, backgroundColor: color }]}>
        {thumbnail && <View style={StyleSheet.absoluteFill}><Thumbnail url={thumbnail} size={width} height={height} fallbackIcon={["FolderIcon"]} /></View>}
        {thumbnail && <View style={[StyleSheet.absoluteFill, styles.folderFade]} />}
        <Text variant="text-md/bold" lineClamp={2} style={[styles.folderName, { color: thumbnail ? "#ffffff" : readableOn(color) }, !thumbnail && styles.noShadow]}>{folder.name}</Text>
    </Pressable>;
}

const styles = StyleSheet.create({
    content: { paddingHorizontal: 16, paddingTop: 8 },
    compactContent: { paddingHorizontal: 12, paddingTop: 8 },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,0.18)" },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.14)" },
    tabActive: { backgroundColor: "rgba(88,101,242,0.35)" },
    crumb: { flexDirection: "row", alignItems: "center", gap: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
    card: { borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(128,128,128,0.14)" },
    row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, minHeight: 48 },
    folder: { borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    folderFade: { backgroundColor: "rgba(0,0,0,0.45)" },
    folderName: { textAlign: "center", textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
    noShadow: { textShadowRadius: 0 },
    pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
});
