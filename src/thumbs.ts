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
        if (!isVideoUrl(url)) return url;
        parsed.searchParams.set("format", "webp");
        parsed.searchParams.set("width", String(size));
        parsed.searchParams.set("height", String(size));
        return parsed.toString();
    }

    // media.tenor.com/<id>AAAPo/<name>.mp4 or <id>AAAAC/<name>.gif -> media.tenor.com/<id>AAAAM/<name>.gif (small GIF).
    const tenor = /^(media|c)\d*\.tenor\.com$/i.test(parsed.hostname) && /^\/([\w-]{11,})AA[\w-]{3}\/([^/]+)\.(mp4|webm|gif)$/i.exec(parsed.pathname);
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
