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
    /** Chat bar buttons next to the emoji button, as on desktop. */
    chatButtons: boolean;
    /** Discord's GIF tab shows MediaVault's folders with Discord's favorite GIFs, as on desktop. */
    gifFolders: boolean;
    /** MediaVault tabs in Discord's GIF/emoji picker. */
    pickerImageTab: boolean;
    pickerVideoTab: boolean;
    pickerAudioTab: boolean;
    pickerFileTab: boolean;
    /** Media kinds with a chat bar button and a GIF/emoji picker tab. */
    chatImageButton: boolean;
    chatVideoButton: boolean;
    chatAudioButton: boolean;
    chatFileButton: boolean;
    /** Records Discord component names and calls for "Copy diagnostic". */
    diagnostic: boolean;
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
    chatButtons: true,
    gifFolders: true,
    pickerImageTab: true,
    pickerVideoTab: true,
    pickerAudioTab: false,
    pickerFileTab: false,
    chatImageButton: true,
    chatVideoButton: true,
    chatAudioButton: false,
    chatFileButton: false,
    diagnostic: false,
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

/** Media kinds that can have a chat bar button (GIFs are in Discord's own GIF tab). */
export const CHAT_BUTTON_SETTINGS = {
    image: "chatImageButton",
    video: "chatVideoButton",
    audio: "chatAudioButton",
    file: "chatFileButton"
} as const satisfies Partial<Record<MediaKind, keyof Settings>>;

/** Media kinds that can have a tab in Discord's GIF/emoji picker (GIFs live in Discord's own GIF tab). */
export const PICKER_TAB_SETTINGS = {
    image: "pickerImageTab",
    video: "pickerVideoTab",
    audio: "pickerAudioTab",
    file: "pickerFileTab"
} as const satisfies Partial<Record<MediaKind, keyof Settings>>;

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
