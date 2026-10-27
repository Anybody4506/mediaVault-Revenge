/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MediaKind } from "./model";

export interface Settings {
    showGifTab: boolean;
    showImageTab: boolean;
    showVideoTab: boolean;
    showAudioTab: boolean;
    showFileTab: boolean;
    /** The GIF tab shows Discord's own favorite GIFs, and adding a GIF also stars it in Discord. */
    syncNativeGifs: boolean;
    hideUnsortedMedias: boolean;
    hideThumbnail: boolean;
    /** Send on tap. Otherwise the link is inserted in the chat box. */
    alwaysSendInstantly: boolean;
    chatButton: boolean;
    /** Images, Videos, Audio and Files tabs in Discord's GIF/emoji picker. */
    pickerTabs: boolean;
    maxMediasPerPage: number;
}

export const DefaultSettings: Settings = {
    showGifTab: true,
    showImageTab: true,
    showVideoTab: true,
    showAudioTab: true,
    showFileTab: true,
    syncNativeGifs: true,
    hideUnsortedMedias: true,
    hideThumbnail: false,
    alwaysSendInstantly: true,
    chatButton: true,
    pickerTabs: true,
    maxMediasPerPage: 50
};

export const TAB_SETTINGS = {
    gif: "showGifTab",
    image: "showImageTab",
    video: "showVideoTab",
    audio: "showAudioTab",
    file: "showFileTab"
} as const satisfies Record<MediaKind, keyof Settings>;

interface PluginStorage {
    settings?: Partial<Settings>;
    /** Library of each Discord account, as JSON. */
    libraries?: Record<string, string>;
}

/** The plugin's own MMKV storage, saved by Revenge whenever a key changes. */
export const pluginStorage = (): PluginStorage => vendetta.plugin.storage;

export const settings = (): Settings => ({ ...DefaultSettings, ...pluginStorage().settings });

/** Re-renders when a setting changes. */
export function useSettings(): Settings {
    vendetta.storage.useProxy(pluginStorage());
    return settings();
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const storage = pluginStorage();
    storage.settings = { ...storage.settings, [key]: value };
}
