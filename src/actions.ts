/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Modules, notify, readClipboard, sendLink, setNativeGif } from "./discord";
import { t } from "./i18n";
import type { LibraryData, MediaKind, SavedMedia } from "./model";
import { canonicalUrl, EMPTY_LIBRARY, inferKind, mediaNameFromUrl, mergeLibraries, readImportedLibrary, removeMedia, saveMedia } from "./model";
import { settings } from "./settings";
import { loadLibrary, updateLibrary } from "./store";
import { refreshUrl } from "./urls";

export interface MediaInput {
    url: string;
    previewUrl?: string;
    name?: string;
    kind?: MediaKind;
    contentType?: string;
    width?: number;
    height?: number;
    messageUrl?: string;
    sourceUrl?: string;
}

export type PreparedMedia = Omit<SavedMedia, "categoryId" | "savedAt">;

export function makeMedia(input: MediaInput): PreparedMedia | null {
    if (!input.url || !/^https?:\/\//i.test(input.url)) return null;
    return {
        url: input.url,
        previewUrl: input.previewUrl && input.previewUrl !== input.url ? input.previewUrl : undefined,
        name: input.name?.trim() || mediaNameFromUrl(input.url),
        kind: input.kind ?? inferKind(input.url, input.contentType, input.name),
        width: input.width || undefined,
        height: input.height || undefined,
        messageUrl: input.messageUrl,
        sourceUrl: input.sourceUrl
    };
}

export async function addMedia(accountId: string, input: MediaInput): Promise<void> {
    const media = makeMedia(input);
    if (!media) return;
    const nativeFavorite = media.kind === "gif" && settings().syncNativeGifs && await setNativeGif(media, true);
    await updateLibrary(accountId, current => saveMedia(current, { ...media, nativeFavorite: nativeFavorite || undefined }));
}

const recentlyRemoved = new Map<string, number>();
const REMOVAL_GRACE = 2 * 60 * 1000;

/** Drops GIFs removed a moment ago, so a sync running before Discord has applied the removal cannot bring them back. */
export function withoutRecentlyRemoved<T extends { url: string; }>(list: T[]): T[] {
    const now = Date.now();
    for (const [key, time] of recentlyRemoved) if (now - time > REMOVAL_GRACE) recentlyRemoved.delete(key);
    return recentlyRemoved.size ? list.filter(entry => !recentlyRemoved.has(canonicalUrl(entry.url))) : list;
}

export async function removeSaved(accountId: string, item: Pick<SavedMedia, "kind" | "url" | "previewUrl" | "nativeFavorite">): Promise<void> {
    if (item.kind === "gif" && (item.nativeFavorite || settings().syncNativeGifs)) {
        recentlyRemoved.set(canonicalUrl(item.url), Date.now());
        await setNativeGif(item, false);
    }
    await updateLibrary(accountId, current => removeMedia(current, item.url));
}

export function getMessageUrl(message: { id?: string; channel_id?: string; guild_id?: string | null; } | undefined, guildId?: string | null): string | undefined {
    if (!message?.id || !message.channel_id) return undefined;
    return `https://discord.com/channels/${message.guild_id ?? guildId ?? "@me"}/${message.channel_id}/${message.id}`;
}

interface MediaLike {
    url?: string;
    proxyURL?: string;
    proxy_url?: string;
    width?: number;
    height?: number;
}

export interface MessageLike {
    id?: string;
    channel_id?: string;
    guild_id?: string | null;
    content?: string;
    attachments?: { url?: string; proxy_url?: string; filename?: string; content_type?: string; width?: number; height?: number; }[];
    embeds?: {
        url?: string;
        title?: string;
        rawTitle?: string;
        image?: MediaLike;
        thumbnail?: MediaLike;
        video?: MediaLike;
    }[];
}

const proxyOf = (media?: MediaLike) => media?.proxyURL ?? media?.proxy_url;

/** Every media of a message: attachments, embed images and videos, and media links in the text. */
export function getMediaFromMessage(message: MessageLike | undefined, guildId?: string | null): PreparedMedia[] {
    const found = new Map<string, PreparedMedia>();
    const messageUrl = getMessageUrl(message, guildId);
    const add = (input: MediaInput) => {
        const media = makeMedia({ ...input, messageUrl });
        if (media) found.set(canonicalUrl(media.url), media);
    };

    for (const attachment of message?.attachments ?? []) {
        add({ url: attachment.url ?? "", previewUrl: attachment.proxy_url, name: attachment.filename, contentType: attachment.content_type, width: attachment.width, height: attachment.height });
    }
    for (const embed of message?.embeds ?? []) {
        const { image, thumbnail, video } = embed;
        const title = embed.title ?? embed.rawTitle;
        // Tenor and Giphy links are shown as a looping video: the page link is the GIF, like on desktop.
        const isGifv = !!video?.url && /^https?:\/\/(www\.)?(tenor\.com\/view|giphy\.com\/gifs)\//i.test(embed.url ?? "");
        if (isGifv && embed.url) {
            add({ url: embed.url, previewUrl: video?.url ?? proxyOf(video), name: title, kind: "gif", width: video?.width, height: video?.height });
            continue;
        }
        if (image?.url) add({ url: image.url, previewUrl: proxyOf(image), name: title ?? t("name.image"), kind: inferKind(image.url, "image/*"), width: image.width, height: image.height, sourceUrl: embed.url });
        else if (thumbnail?.url && !video?.url) add({ url: thumbnail.url, previewUrl: proxyOf(thumbnail), name: title ?? t("name.thumbnail"), kind: inferKind(thumbnail.url, "image/*"), width: thumbnail.width, height: thumbnail.height, sourceUrl: embed.url });
        if (video?.url) add({ url: video.url, previewUrl: proxyOf(thumbnail) ?? proxyOf(video), name: title ?? t("name.video"), kind: "video", width: video.width, height: video.height, sourceUrl: embed.url });
    }
    for (const match of String(message?.content ?? "").matchAll(/https?:\/\/[^\s<>]+/gi)) {
        const url = match[0].replace(/[),.!?]+$/, "");
        const kind = inferKind(url);
        if (kind !== "file") add({ url, kind });
    }
    return [...found.values()];
}

/** Sends a saved media in the current channel (or inserts its link), with a fresh link when it had expired. */
export async function chooseMedia(item: SavedMedia): Promise<boolean> {
    const url = await refreshUrl(item.url);
    const instantly = settings().alwaysSendInstantly;
    if (!sendLink(url, instantly)) return false;
    notify(t(instantly ? "m.sent" : "m.inserted"));
    return true;
}

export function exportLibrary(library: LibraryData): string {
    return JSON.stringify({ format: "MediaVault", version: 4, exportedAt: new Date().toISOString(), library });
}

async function importValue(accountId: string, value: unknown) {
    const incoming = readImportedLibrary(value);
    let added = { items: 0, folders: 0 };
    await updateLibrary(accountId, current => {
        const { library, addedItems, addedCategories } = mergeLibraries(current, incoming);
        added = { items: addedItems, folders: addedCategories };
        return library;
    });
    notify(t("toast.imported", added));
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text.replace(/^﻿/, ""));
    } catch {
        throw new Error("The text is not valid JSON.");
    }
}

/** Imports a MediaVault export or a FavoriteMedia.config.json file from a link. */
export async function importFromUrl(accountId: string, url: string) {
    try {
        const target = await refreshUrl(url.trim());
        if (!/^https:\/\//i.test(target)) throw new Error("The link must start with https://");
        const response = await fetch(target);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        await importValue(accountId, parseJson(await response.text()));
    } catch (error) {
        notify(t("toast.importFailed", { error: error instanceof Error ? error.message : String(error) }), true);
    }
}

export async function importFromClipboard(accountId: string) {
    try {
        const text = (await readClipboard()).trim();
        // A link to a file is accepted too.
        if (/^https:\/\/\S+$/i.test(text)) return importFromUrl(accountId, text);
        await importValue(accountId, parseJson(text));
    } catch (error) {
        notify(t("toast.importFailed", { error: error instanceof Error ? error.message : String(error) }), true);
    }
}

export async function clearLibrary(accountId: string) {
    await updateLibrary(accountId, () => ({ ...EMPTY_LIBRARY }));
    notify(t("m.cleared"));
}

export async function isSaved(accountId: string, url: string): Promise<boolean> {
    const key = canonicalUrl(url);
    return (await loadLibrary(accountId)).items.some(item => canonicalUrl(item.url) === key);
}

export const modulesReady = () => !!(Modules.HTTP && Modules.MessageActions);
