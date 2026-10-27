/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SavedMedia } from "./model";
import { isVideoUrl } from "./model";

const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/**
 * A light version of a media for the grid. React Native's Image cannot play videos, which the desktop plugin shows
 * with <video>: Tenor videos have a GIF twin, and Discord's media proxy returns the first frame of a video. Full-size
 * GIFs are slow to decode by the dozen, so they are swapped for small ones too.
 */
export function thumbnailSource(url: string | undefined, size = 256): string | null {
    if (!url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    // Discord's proxy for outside media: images-ext-1.discordapp.net/external/<hash>/https/media.tenor.com/<path>.
    // The outside link inside it gets the same treatment; a video without a lighter twin asks the proxy for a frame.
    const external = /^images-ext-\d+\.discordapp\.net$/i.test(parsed.hostname) && /^\/external\/[^/]+\/(https?)\/(.+)$/i.exec(parsed.pathname);
    if (external) {
        const inner = thumbnailSource(`${external[1]}://${external[2]}${parsed.search}`, size);
        if (inner) return inner;
        return isVideoUrl(url) ? proxyFrame(url, size) : url;
    }

    // media.tenor.com/<id>AAAPo/<name>.mp4, <id>AAAAC/<name>.gif or <id>AAAAN/<name>.png -> <id>AAAAM/<name>.gif (small GIF).
    const tenor = /^(media|c)\d*\.tenor\.com$/i.test(parsed.hostname) && /^\/(?:m\/)?([\w-]{11,})AA[\w-]{3}\/([^/]+)\.(mp4|webm|gif|png)$/i.exec(parsed.pathname);
    if (tenor) return `https://media.tenor.com/${tenor[1]}AAAAM/${tenor[2]}.gif`;

    // media.giphy.com/media/<id>/giphy.mp4 -> media.giphy.com/media/<id>/200w.gif (GIF 200 pixels wide).
    const giphy = /^(media\d*|i)\.giphy\.com$/i.test(parsed.hostname) && /^(\/media\/(?:[^/]+\/)?[\w-]+)\/[\w-]+\.(mp4|webp|gif)$/i.exec(parsed.pathname);
    if (giphy) return `https://media.giphy.com${giphy[1]}/200w.gif`;

    if (DISCORD_CDN_HOSTS.has(parsed.hostname) && /^\/(ephemeral-)?attachments\//.test(parsed.pathname)) {
        const video = isVideoUrl(url);
        parsed.hostname = "media.discordapp.net";
        // A GIF stays a GIF, resized by the media proxy; the rest becomes a still WebP.
        if (video || !/\.gif$/i.test(parsed.pathname)) parsed.searchParams.set("format", "webp");
        parsed.searchParams.set("width", String(size));
        parsed.searchParams.set("height", String(size));
        return parsed.toString();
    }

    return isVideoUrl(url) ? null : url;
}

/** The first frame of a video behind Discord's proxy for outside media, as a WebP. */
function proxyFrame(url: string, size: number): string | null {
    try {
        const parsed = new URL(url);
        if (!/^images-ext-\d+\.discordapp\.net$/i.test(parsed.hostname)) return null;
        parsed.searchParams.set("format", "webp");
        parsed.searchParams.set("width", String(size));
        parsed.searchParams.set("height", String(size));
        return parsed.toString();
    } catch {
        return null;
    }
}

/**
 * What the grid tries for a media, in order: its light version, the file itself (not a video, which Image cannot
 * show), then a frame from Discord's proxy, which still has media that left Tenor.
 */
export function thumbnailCandidates(url: string | undefined, size = 256): string[] {
    if (!url) return [];
    const video = isVideoUrl(url);
    const list = [thumbnailSource(url, size), video ? null : url, video ? proxyFrame(url, size) : null];
    return list.filter((candidate, index): candidate is string => !!candidate && list.indexOf(candidate) === index);
}

const TENOR_PAGE = /^https?:\/\/(www\.)?tenor\.com\/view\//i;
const tenorGifs = new Map<string, Promise<string | null>>();

/**
 * The small GIF of a Tenor page link, from Tenor's oEmbed (its thumbnail is the GIF's still twin). Old Tenor links
 * (media.tenor.co/videos/<hash>/mp4) only ever serve a video, so the page is the only way to a GIF.
 */
export function tenorGif(page: string | undefined): Promise<string | null> {
    if (!page || !TENOR_PAGE.test(page)) return Promise.resolve(null);
    let found = tenorGifs.get(page);
    if (!found) {
        found = fetch(`https://tenor.com/oembed?url=${encodeURIComponent(page)}`)
            .then(response => response.ok ? response.json() : null)
            .then((data: any) => typeof data?.thumbnail_url === "string" ? thumbnailSource(data.thumbnail_url) : null)
            .catch(() => null);
        tenorGifs.set(page, found);
    }
    return found;
}

/** Thumbnails that could not be shown (an icon instead), for the diagnostic. */
export const thumbnailFailures: { url: string; light: string | null; }[] = [];

export function noteThumbnailFailure(url: string | undefined, light: string | null) {
    if (!url || thumbnailFailures.length >= 20 || thumbnailFailures.some(failure => failure.url === url)) return;
    thumbnailFailures.push({ url, light });
}

/** The link worth showing for a media: its preview first (GIF pickers store the animated file there). */
export function previewOf(item: Pick<SavedMedia, "url" | "previewUrl" | "kind">): string | undefined {
    if (item.kind === "audio" || item.kind === "file") return undefined;
    // Tenor and Giphy page links are HTML documents: only their preview can be displayed.
    return item.previewUrl ?? item.url;
}
