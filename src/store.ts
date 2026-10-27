/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useCallback, useEffect, useState } from "react";

import type { LibraryData } from "./model";
import { readLibrary } from "./model";
import { pluginStorage } from "./settings";

const listeners = new Set<(accountId: string) => void>();
const parsed = new Map<string, LibraryData>();

/**
 * One library per Discord account, like the per-account DataStore keys of the desktop plugin.
 * Kept as a JSON string: the plugin storage is a deep proxy, which is slow on thousands of items.
 */
function read(accountId: string): LibraryData {
    const known = parsed.get(accountId);
    if (known) return known;
    const raw = pluginStorage().libraries?.[accountId];
    let value: unknown;
    try {
        value = typeof raw === "string" ? JSON.parse(raw) : undefined;
    } catch {
        throw new Error("The MediaVault favorites could not be read. The data was not overwritten.");
    }
    const library = readLibrary(value);
    parsed.set(accountId, library);
    return library;
}

export function loadLibrary(accountId: string): Promise<LibraryData> {
    try {
        return Promise.resolve(read(accountId));
    } catch (error) {
        return Promise.reject(error);
    }
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialises writes so two quick taps never overwrite each other. */
export function updateLibrary(accountId: string, change: (current: LibraryData) => LibraryData): Promise<LibraryData> {
    const next = queue.catch(() => undefined).then(() => {
        const updated = change(read(accountId));
        const storage = pluginStorage();
        storage.libraries = { ...storage.libraries, [accountId]: JSON.stringify(updated) };
        parsed.set(accountId, updated);
        for (const listener of listeners) listener(accountId);
        return updated;
    });
    queue = next;
    return next;
}

export function useLibrary(accountId: string | undefined) {
    const [library, setLibrary] = useState<LibraryData | null>(null);
    const [error, setError] = useState("");

    const reload = useCallback(() => {
        if (!accountId) return Promise.resolve();
        return loadLibrary(accountId).then(value => { setLibrary(value); setError(""); }, e => setError(e instanceof Error ? e.message : String(e)));
    }, [accountId]);

    useEffect(() => {
        setLibrary(null);
        void reload();
        const onChange = (changed: string) => {
            if (changed === accountId) void reload();
        };
        listeners.add(onChange);
        return () => { listeners.delete(onChange); };
    }, [accountId, reload]);

    return { library, error, reload };
}

export const resetLibraryCache = () => parsed.clear();
