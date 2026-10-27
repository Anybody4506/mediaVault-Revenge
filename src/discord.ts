/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useState } from "react";

import { t } from "./i18n";
import type { NativeGif, SavedMedia } from "./model";
import { canonicalUrl } from "./model";
import { Clipboard, findByProps, findStore, showToast } from "./rv";

interface HTTP {
    post(options: { url: string; body: unknown; retries?: number; }): Promise<{ body: any; }>;
}

interface ChatInputs {
    getBestActiveInputForChannelId(channelId: string): { insertText(text: string): void; } | undefined;
}

interface MessageActions {
    sendMessage(channelId: string, message: { content: string; tts?: boolean; invalidEmojis?: unknown[]; validNonShortcutEmojis?: unknown[]; }, waitForChannel?: boolean, options?: Record<string, unknown>): unknown;
}

interface FavoriteGifsProto {
    gifs: Record<string, { format: number; src: string; width: number; height: number; order: number; }>;
}

interface FrecencyActions {
    updateAsync(key: "favoriteGifs", update: (proto: FavoriteGifsProto) => void, delay?: unknown): Promise<unknown>;
    loadIfNecessary?(): unknown;
}

/** Discord modules, looked up on first use. */
export const Modules = {
    get HTTP() {
        return findByProps<{ HTTP: HTTP; }>("HTTP")?.HTTP ?? findByProps<HTTP>("getAPIBaseURL", "post");
    },
    get ChatInputs() {
        return findByProps<ChatInputs>("getBestActiveInputForChannelId");
    },
    get MessageActions() {
        return findByProps<MessageActions>("sendMessage", "receiveMessage");
    },
    get Frecency() {
        return findByProps<{ FrecencyUserSettingsActionCreators: FrecencyActions; }>("FrecencyUserSettingsActionCreators")?.FrecencyUserSettingsActionCreators;
    },
    get UserSettingsDelay() {
        return findByProps<{ INFREQUENT_USER_ACTION?: unknown; }>("INFREQUENT_USER_ACTION");
    }
};

type Store<T> = T & { addChangeListener(cb: () => void): void; removeChangeListener(cb: () => void): void; };

const UserStore = () => findStore<Store<{ getCurrentUser(): { id: string; } | undefined; }>>("UserStore");
const SelectedChannelStore = () => findStore<Store<{ getChannelId(): string | undefined; }>>("SelectedChannelStore");
const UserSettingsProtoStore = () => findStore<Store<{ frecencyWithoutFetchingLatest?: { favoriteGifs?: FavoriteGifsProto; }; }>>("UserSettingsProtoStore");

export const currentAccountId = () => UserStore()?.getCurrentUser()?.id;
export const currentChannelId = () => SelectedChannelStore()?.getChannelId();

export const notify = (text: string, failure = false) => showToast(text, failure);

export function copy(text: string) {
    Clipboard.setString(text);
    notify(t("toast.copied"));
}

export const readClipboard = () => Clipboard.getString();

function toNativeGifs(gifs: FavoriteGifsProto["gifs"]): NativeGif[] {
    return Object.entries(gifs)
        // Items with format 0 are files stored by FavoriteAnything, not GIFs.
        .filter(([, gif]) => gif.format !== 0)
        .sort(([, a], [, b]) => b.order - a.order)
        .map(([url, gif]) => ({ url, src: gif.src, width: gif.width, height: gif.height }));
}

const readGifs = () => UserSettingsProtoStore()?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? null;

/**
 * Discord's favourite GIFs, kept live. They are synced across devices but only fetched
 * on demand, so ask Discord for the latest list and follow its updates.
 * Returns null while the list has not been loaded yet.
 */
export function useNativeGifs(enabled: boolean): NativeGif[] | null {
    // A string signature: the proto object may be updated in place, which a reference check would miss.
    const signatureOf = () => {
        const gifs = enabled ? readGifs() : null;
        return gifs ? Object.entries(gifs).map(([url, gif]) => `${url} ${gif.src} ${gif.order}`).join("\n") : null;
    };
    const [signature, setSignature] = useState(signatureOf);

    useEffect(() => {
        if (!enabled) return;
        void Promise.resolve(Modules.Frecency?.loadIfNecessary?.()).catch(() => undefined);
        const target = UserSettingsProtoStore();
        const onChange = () => setSignature(signatureOf());
        onChange();
        target?.addChangeListener(onChange);
        return () => target?.removeChangeListener(onChange);
    }, [enabled]);

    return useMemo(() => {
        const gifs = signature === null ? null : readGifs();
        return gifs ? toNativeGifs(gifs) : null;
    }, [signature]);
}

function updateFavoriteGifs(update: (proto: FavoriteGifsProto) => void) {
    const frecency = Modules.Frecency;
    if (!frecency) throw new Error("Discord's favorite GIF settings were not found.");
    return frecency.updateAsync("favoriteGifs", update, Modules.UserSettingsDelay?.INFREQUENT_USER_ACTION);
}

/** Adds or removes a link in Discord's own favourite GIF list so it stays in sync across devices. */
export async function setNativeGif(media: Pick<SavedMedia, "url" | "previewUrl" | "width" | "height">, enabled: boolean): Promise<boolean> {
    const src = media.previewUrl ?? media.url;
    const format = /\.(gif|webp|avif|png|jpe?g)(\?|$)/i.test(src) ? 1 : 2;
    const key = canonicalUrl(media.url);
    try {
        await updateFavoriteGifs(proto => {
            proto.gifs ??= {};
            if (!enabled) {
                // Discord may have stored it as media.discordapp.net while MediaVault knows it as cdn.discordapp.com.
                for (const storedUrl of Object.keys(proto.gifs)) {
                    if (storedUrl === media.url || canonicalUrl(storedUrl) === key) delete proto.gifs[storedUrl];
                }
                return;
            }
            const order = Math.max(0, ...Object.values(proto.gifs).map(gif => gif.order)) + 1;
            proto.gifs[media.url] = { format, src, width: media.width ?? 200, height: media.height ?? 110, order };
        });
        return true;
    } catch (error) {
        console.warn("[MediaVault] Could not update Discord's favorite GIFs.", error);
        notify(t(enabled ? "toast.nativeGifFailed" : "toast.favoriteFailed"), true);
        return false;
    }
}

/** Sends a link in a channel (the current one by default), or inserts it in the chat box. */
export function sendLink(url: string, instantly: boolean, channelId = currentChannelId()): boolean {
    if (!channelId) {
        notify(t("m.noChannel"), true);
        return false;
    }
    if (!instantly) {
        const input = Modules.ChatInputs?.getBestActiveInputForChannelId(channelId);
        if (input) {
            input.insertText(`${url} `);
            return true;
        }
    }
    const actions = Modules.MessageActions;
    if (!actions) {
        notify(t("toast.favoriteFailed"), true);
        return false;
    }
    void actions.sendMessage(channelId, { content: url, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, true, {});
    return true;
}
