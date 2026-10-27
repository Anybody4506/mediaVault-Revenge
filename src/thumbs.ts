/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SavedMedia } from "./model";
import { isVideoUrl } from "./model";

const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/**
 * React Native's Image cannot play videos, which the desktop plugin shows with <video>.
 * Tenor videos have a GIF twin, and Discord's media proxy returns the first frame of a video.
 */
export function thumbnailSource(url: string | undefined, size = 256): string | null {
    if (!url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    // media.tenor.com/<id>AAAPo/<name>.mp4 -> media.tenor.com/<id>AAAAM/<name>.gif (small GIF).
    const tenor = /^media\d*\.tenor\.com$/i.test(parsed.hostname) && /^\/([\w-]{11,})AA[\w-]{3}\/([^/]+)\.(mp4|webm)$/i.exec(parsed.pathname);
    if (tenor) return `https://media.tenor.com/${tenor[1]}AAAAM/${tenor[2]}.gif`;

    if (DISCORD_CDN_HOSTS.has(parsed.hostname) && /^\/(ephemeral-)?attachments\//.test(parsed.pathname)) {
        const video = isVideoUrl(url);
        if (!video && /\.gif$/i.test(parsed.pathname)) return url;
        parsed.hostname = "media.discordapp.net";
        parsed.searchParams.set("format", "webp");
        parsed.searchParams.set("width", String(size));
        parsed.searchParams.set("height", String(size));
        return parsed.toString();
    }

    return isVideoUrl(url) ? null : url;
}

/** The link worth showing for a media: its preview first (GIF pickers store the animated file there). */
export function previewOf(item: Pick<SavedMedia, "url" | "previewUrl" | "kind">): string | undefined {
    if (item.kind === "audio" || item.kind === "file") return undefined;
    // Tenor and Giphy page links are HTML documents: only their preview can be displayed.
    return item.previewUrl ?? item.url;
}
