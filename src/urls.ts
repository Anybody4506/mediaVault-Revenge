/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";

import { Modules } from "./discord";
import { urlKey } from "./model";

const SIGNED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const PROXY_HOSTS = new Set(["images-ext-1.discordapp.net", "images-ext-2.discordapp.net"]);
const REFRESH_MARGIN = 5 * 60 * 1000;
const BATCH_SIZE = 50;
const REFRESH_ENDPOINT = "/attachments/refresh-urls";

interface Job {
    key: string;
    fallback: string;
    resolve: (url: string) => void;
}

const signed = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let queue: Job[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** True for Discord attachment links whose signature is missing or about to run out. */
export function needsRefresh(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const ex = parsed.searchParams.get("ex");
    if (SIGNED_HOSTS.has(parsed.hostname)) {
        if (!/^\/(ephemeral-)?attachments\//.test(parsed.pathname)) return false;
        if (!ex) return true;
    } else if (!PROXY_HOSTS.has(parsed.hostname) || !ex) {
        return false;
    }
    const expiry = parseInt(ex ?? "", 16) * 1000;
    return Number.isNaN(expiry) || expiry - REFRESH_MARGIN < Date.now();
}

/** Best link available right now without any network call. */
export function bestKnownUrl(url: string): string {
    if (!needsRefresh(url)) return url;
    const known = signed.get(urlKey(url));
    return known && !needsRefresh(known) ? known : url;
}

async function flush() {
    timer = undefined;
    const batch = queue.splice(0, BATCH_SIZE);
    if (queue.length) timer = setTimeout(flush, 80);
    if (!batch.length) return;

    let refreshed = new Map<string, string | null>();
    try {
        if (!Modules.HTTP) throw new Error("Discord's HTTP module was not found.");
        const { body } = await Modules.HTTP.post({
            url: REFRESH_ENDPOINT,
            body: { attachment_urls: batch.map(job => job.key) },
            retries: 2
        });
        refreshed = new Map((body.refreshed_urls as { original: string; refreshed: string | null; }[]).map(entry => [entry.original, entry.refreshed]));
    } catch (error) {
        console.warn("[MediaVault] Could not refresh Discord links.", error);
    }
    for (const job of batch) {
        const fresh = refreshed.get(job.key);
        if (fresh) signed.set(job.key, fresh);
        inflight.delete(job.key);
        job.resolve(fresh ?? job.fallback);
    }
}

/** Resolves with a signed link, batching requests so a full page costs one call. */
export function refreshUrl(url: string): Promise<string> {
    if (!needsRefresh(url)) return Promise.resolve(url);
    const key = urlKey(url);
    const known = signed.get(key);
    if (known && !needsRefresh(known)) return Promise.resolve(known);

    let job = inflight.get(key);
    if (!job) {
        job = new Promise<string>(resolve => {
            queue.push({ key, fallback: url, resolve });
            timer ??= setTimeout(flush, 60);
        });
        inflight.set(key, job);
    }
    return job;
}

export function resetUrlQueue() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const job of queue) job.resolve(job.fallback);
    queue = [];
    inflight.clear();
    signed.clear();
}

export function useFreshUrl(url: string | undefined): string | undefined {
    const [value, setValue] = useState(() => url && bestKnownUrl(url));
    useEffect(() => {
        if (!url) {
            setValue(undefined);
            return;
        }
        const known = bestKnownUrl(url);
        setValue(known);
        if (!needsRefresh(known)) return;
        let alive = true;
        void refreshUrl(url).then(next => { if (alive) setValue(next); });
        return () => { alive = false; };
    }, [url]);
    return value;
}
