/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import { chooseMedia, withoutRecentlyRemoved } from "./actions";
import { notify, useNativeGifs } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import type { LibraryData, MediaCategory, MediaKind, SavedMedia } from "./model";
import { canonicalUrl, gifView, isVideoUrl } from "./model";
import { openFolderOptions, openMediaOptions, promptCreateFolder } from "./options";
import { TAB_SETTINGS, useSettings } from "./settings";
import { useLibrary } from "./store";
import { Design, SheetFlatList, useSafeAreaInsets, VideoPlayer } from "./rv";
import { previewOf, thumbnailSource } from "./thumbs";
import { EmptyText, hideSheet, icon, openSheet, RenderBoundary } from "./ui";
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
    // A virtualized list: only the rows near the screen are mounted, so the GIFs further down neither load nor play.
    const List = (SheetFlatList() ?? FlatList) as React.ComponentType<any>;
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
    const entries = useMemo(() => [...folders.map(folder => ({ folder })), ...shown.map(item => ({ item }))], [folders, shown]);
    const pages = Math.max(1, Math.ceil(entries.length / perPage));
    const visible = useMemo(() => entries.slice(page * perPage, (page + 1) * perPage), [entries, page, perPage]);
    const columns = VISUAL.has(kind) && !compact ? 3 : 2;
    const padding = compact ? 12 : 16;
    const tile = width ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
    const path = library ? folderPath(library, folderId) : [];
    const visibleFolders = visible.flatMap(entry => "folder" in entry ? [entry.folder] : []);
    // The media grid, row by row, for the list.
    const rows = useMemo(() => {
        const media = visible.flatMap(entry => "item" in entry ? [entry.item] : []);
        const chunks: SavedMedia[][] = [];
        for (let at = 0; at < media.length; at += columns) chunks.push(media.slice(at, at + columns));
        return chunks;
    }, [visible, columns]);

    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width - padding * 2);

    const FolderPlus = icon("FolderPlusIcon", "FolderIcon");

    const renderRow = ({ item: row }: { item: SavedMedia[]; }) => <View style={styles.mediaRow}>
        {row.map(item => <MediaTile key={`m-${canonicalUrl(item.url)}`} item={item} size={tile} visual={VISUAL.has(kind)}
            onPress={() => void chooseMedia(item).then(sent => sent && onSent())}
            onLongPress={() => openMediaOptions({ accountId, item, folderId })} />)}
    </View>;

    const footer = (pages > 1 || !compact) && <View style={styles.footer}>
        {pages > 1 && <View style={styles.pager}>
            <Button size="sm" variant="secondary" text={t("page.prev")} disabled={page === 0} onPress={() => setPage(page - 1)} />
            <Text variant="text-sm/medium" color="text-muted">{`${page + 1} / ${pages}`}</Text>
            <Button size="sm" variant="secondary" text={t("page.next")} disabled={page >= pages - 1} onPress={() => setPage(page + 1)} />
        </View>}
        {!compact && <Text variant="text-xs/medium" color="text-muted" style={{ textAlign: "center" }}>{t("m.hint")}</Text>}
    </View>;

    return <List
        data={tile > 0 && library && !error ? rows : []}
        keyExtractor={(row: SavedMedia[]) => canonicalUrl(row[0].url)}
        renderItem={renderRow}
        onLayout={onLayout}
        // Few rows mounted at a time: the ones far from the screen are unmounted, so their GIFs stop playing.
        // (Not removeClippedSubviews: on Android, detached rows can come back with blank images.)
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={60}
        windowSize={3}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: padding, paddingTop: 8, paddingBottom: 16 + bottom }}
        ListFooterComponent={footer || null}
        ListHeaderComponent={<Stack spacing={compact ? 8 : 12}>
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
                        // Folders first, as wide cards on two columns like the desktop GIF categories; the media rows follow.
                        : tile > 0 && visibleFolders.length > 0 && <View style={styles.grid}>
                            {visibleFolders.map(folder => <FolderTile key={`f-${folder.id}`} folder={folder} items={items}
                                width={Math.floor((width - GAP) / 2)} height={compact ? 64 : 80} visual={VISUAL.has(kind)} hideThumbnail={settings.hideThumbnail}
                                onPress={() => { setSearch(""); setFolderId(folder.id); }}
                                onLongPress={() => openFolderOptions({ accountId, folderId: folder.id, kind })} />)}
                        </View>}
        </Stack>}
    />;
}

function Thumbnail({ url, size, height = size, fallbackIcon }: { url: string | undefined; size: number; height?: number; fallbackIcon: string[]; }) {
    const fresh = useFreshUrl(url);
    // 0: the light thumbnail, 1: the file itself when the thumbnail fails, 2: an icon.
    const [failures, setFailures] = useState(0);
    const light = thumbnailSource(fresh);
    useEffect(() => setFailures(0), [light]);
    const original = fresh && !isVideoUrl(fresh) && fresh !== light ? fresh : null;
    const source = failures === 0 ? light : failures === 1 ? original : null;
    if (!source) {
        const Icon = icon(...fallbackIcon);
        return <View style={{ width: size, height, alignItems: "center", justifyContent: "center" }}>{Icon && <Icon size="md" />}</View>;
    }
    return <Image source={{ uri: source }} style={{ width: size, height }} resizeMode="cover" onError={() => setFailures(failures + (failures === 0 && !original ? 2 : 1))} />;
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
        {item.kind === "video" && <VideoPreview url={item.url} />}
    </Pressable>;
}

/**
 * A video playing muted and looping over its still frame, like the GIFs (the list unmounts it once scrolled away).
 * If Discord has no video player, or it fails, the still frame stays.
 */
function VideoPreview({ url }: { url: string; }) {
    const { animateVideos } = useSettings();
    const fresh = useFreshUrl(url);
    const Player = animateVideos ? VideoPlayer() : undefined;
    if (!Player || !fresh) return null;
    return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <RenderBoundary>
            <Player source={{ uri: fresh }} style={StyleSheet.absoluteFill} resizeMode="cover" repeat muted paused={false}
                disableFocus playInBackground={false} playWhenInactive={false} hideShutterView controls={false} />
        </RenderBoundary>
    </View>;
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
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,0.18)" },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(128,128,128,0.14)" },
    tabActive: { backgroundColor: "rgba(88,101,242,0.35)" },
    crumb: { flexDirection: "row", alignItems: "center", gap: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
    mediaRow: { flexDirection: "row", gap: GAP, marginTop: GAP },
    footer: { gap: 12, marginTop: 12 },
    card: { borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(128,128,128,0.14)" },
    row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, minHeight: 48 },
    folder: { borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    folderFade: { backgroundColor: "rgba(0,0,0,0.45)" },
    folderName: { textAlign: "center", textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
    noShadow: { textShadowRadius: 0 },
    pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
});
