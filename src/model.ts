/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type MediaKind = "gif" | "image" | "video" | "audio" | "file";
export type MediaCategoryKind = MediaKind | "all";

export interface SavedMedia {
    url: string;
    previewUrl?: string;
    name: string;
    kind: MediaKind;
    width?: number;
    height?: number;
    categoryId: string | null;
    savedAt: number;
    /** True when this entry mirrors Discord's native GIF favourites. */
    nativeFavorite?: boolean;
    /** Link to the message the media was saved from, when known. */
    messageUrl?: string;
    /** Link to the page an embed came from, when known. */
    sourceUrl?: string;
}

export interface MediaCategory {
    id: string;
    name: string;
    kind: MediaCategoryKind;
    color?: string;
    /** Parent folder, allowing FavoriteMedia-style nested folders. */
    parentId?: string | null;
    /** Optional explicit thumbnail URL; otherwise a favorite in the folder is used. */
    thumbnail?: string;
}

export interface LibraryData {
    items: SavedMedia[];
    categories: MediaCategory[];
}

export interface GifCategory {
    id: string;
    name: string;
    urls: string[];
    color?: string;
}

export const EMPTY_LIBRARY: LibraryData = { items: [], categories: [] };

export function inferKind(url: string, contentType?: string | null, fileName?: string | null): MediaKind {
    const mime = (contentType ?? "").toLowerCase();
    const candidate = `${fileName ?? ""} ${url}`.toLowerCase().split(/[?#]/, 1)[0];
    if (mime === "image/gif" || /\.gif$/.test(candidate)) return "gif";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (/\.(png|jpe?g|webp|avif|bmp|svg|heic|heif)$/.test(candidate)) return "image";
    if (/\.(mp4|webm|mov|m4v|mkv|avi|ogv|mpeg|mpg)$/.test(candidate)) return "video";
    if (/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba)$/.test(candidate)) return "audio";
    return "file";
}

const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

const canonicalCache = new Map<string, string>();

function computeCanonicalUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        for (const key of ["ex", "is", "hm"]) parsed.searchParams.delete(key);
        if (DISCORD_CDN_HOSTS.has(parsed.hostname)) {
            parsed.hostname = "cdn.discordapp.com";
            for (const key of ["width", "height", "quality", "format"]) parsed.searchParams.delete(key);
        }
        return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
}

/** Identity of a media link. Memoised: libraries compare thousands of links on every change. */
export function canonicalUrl(url: string): string {
    let key = canonicalCache.get(url);
    if (key === undefined) {
        if (canonicalCache.size > 20_000) canonicalCache.clear();
        key = computeCanonicalUrl(url);
        canonicalCache.set(url, key);
    }
    return key;
}

/** Origin + path only: what Discord's refresh endpoint expects. */
export function urlKey(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return url;
    }
}

export function mediaNameFromUrl(url: string, fallback = "Media"): string {
    try {
        const leaf = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").trim();
        return leaf || fallback;
    } catch {
        return fallback;
    }
}

function validKind(value: unknown): value is MediaKind {
    return ["gif", "image", "video", "audio", "file"].includes(value as string);
}

function validColor(value: unknown): value is string {
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

export function readLibrary(value: unknown): LibraryData {
    if (value === undefined || value === null) return { items: [], categories: [] };
    if (typeof value !== "object") throw new Error("The MediaVault favorites could not be read. The data was not overwritten.");
    const candidate = value as Partial<LibraryData>;
    if (!Array.isArray(candidate.items) || !Array.isArray(candidate.categories))
        throw new Error("The MediaVault favorites could not be read. The data was not overwritten.");

    const categoryIds = new Set<string>();
    const categories: MediaCategory[] = [];
    for (const raw of candidate.categories) {
        if (!raw || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name.trim())
            throw new Error("A saved MediaVault folder is invalid. The data was not overwritten.");
        if (categoryIds.has(raw.id)) throw new Error("Some MediaVault folders share the same id. The data was not overwritten.");
        categoryIds.add(raw.id);
        // Categories created by the first MediaVault prototype are kept visible in every tab.
        const kind: MediaCategoryKind = validKind((raw as MediaCategory).kind) || (raw as MediaCategory).kind === "all"
            ? (raw as MediaCategory).kind
            : "all";
        const category = raw as MediaCategory;
        categories.push({
            id: raw.id,
            name: raw.name.trim(),
            kind,
            color: validColor(category.color) ? category.color : undefined,
            parentId: typeof category.parentId === "string" ? category.parentId : null,
            thumbnail: typeof category.thumbnail === "string" && /^https?:\/\//i.test(category.thumbnail) ? category.thumbnail : undefined
        });
    }

    // Validate parents after all category ids have been read so import order does not matter.
    for (const category of categories) {
        if (category.parentId && !categoryIds.has(category.parentId)) category.parentId = null;
        if (category.parentId === category.id) category.parentId = null;
    }
    // Broken imports/older versions can contain parent cycles. Break one link per cycle
    // before any UI operation tries to walk the tree.
    for (const category of categories) {
        const seen = new Set<string>([category.id]);
        let parentId = category.parentId ?? null;
        while (parentId) {
            if (seen.has(parentId)) {
                category.parentId = null;
                break;
            }
            seen.add(parentId);
            parentId = categories.find(other => other.id === parentId)?.parentId ?? null;
        }
    }

    const items: SavedMedia[] = [];
    for (const raw of candidate.items) {
        const item = raw as SavedMedia;
        if (!item || typeof item.url !== "string" || !item.url || typeof item.name !== "string"
            || !validKind(item.kind)
            || (item.categoryId !== null && item.categoryId !== undefined && typeof item.categoryId !== "string"))
            throw new Error("A saved MediaVault media is invalid. The data was not overwritten.");
        items.push({
            url: item.url,
            previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : undefined,
            name: item.name,
            kind: item.kind,
            width: typeof item.width === "number" ? item.width : undefined,
            height: typeof item.height === "number" ? item.height : undefined,
            categoryId: typeof item.categoryId === "string" && categoryIds.has(item.categoryId) ? item.categoryId : null,
            savedAt: typeof item.savedAt === "number" ? item.savedAt : 0,
            nativeFavorite: typeof item.nativeFavorite === "boolean" ? item.nativeFavorite : undefined,
            messageUrl: typeof item.messageUrl === "string" ? item.messageUrl : undefined,
            sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined
        });
    }
    return { items, categories };
}

export function saveMedia(library: LibraryData, media: Omit<SavedMedia, "savedAt" | "categoryId"> & Partial<Pick<SavedMedia, "savedAt" | "categoryId">>): LibraryData {
    const key = canonicalUrl(media.url);
    const found = library.items.find(item => canonicalUrl(item.url) === key);
    const proposedCategoryId = found?.categoryId ?? media.categoryId ?? null;
    const category = library.categories.find(item => item.id === proposedCategoryId);
    const categoryCompatible = !category || category.kind === "all" || category.kind === media.kind;
    const item: SavedMedia = {
        ...media,
        name: found?.name || media.name?.trim() || "Unnamed media",
        categoryId: categoryCompatible ? proposedCategoryId : null,
        savedAt: found?.savedAt ?? media.savedAt ?? Date.now(),
        messageUrl: media.messageUrl ?? found?.messageUrl,
        sourceUrl: media.sourceUrl ?? found?.sourceUrl
    };
    return { ...library, items: [item, ...library.items.filter(existing => canonicalUrl(existing.url) !== key)] };
}

export function hasMedia(library: LibraryData, url: string): boolean {
    const key = canonicalUrl(url);
    return library.items.some(item => canonicalUrl(item.url) === key);
}

export function removeMedia(library: LibraryData, url: string): LibraryData {
    const key = canonicalUrl(url);
    return { ...library, items: library.items.filter(item => canonicalUrl(item.url) !== key) };
}

export function moveMedia(library: LibraryData, url: string, categoryId: string | null): LibraryData {
    const key = canonicalUrl(url);
    const item = library.items.find(existing => canonicalUrl(existing.url) === key);
    if (!item) throw new Error("This media is no longer in the favorites.");
    if (categoryId !== null) {
        const category = library.categories.find(existing => existing.id === categoryId);
        if (!category) throw new Error("This folder no longer exists.");
        if (category.kind !== "all" && category.kind !== item.kind) throw new Error("This folder belongs to another media type.");
    }
    return { ...library, items: library.items.map(existing => canonicalUrl(existing.url) === key ? { ...existing, categoryId } : existing) };
}

export function upsertCategory(library: LibraryData, category: MediaCategory): LibraryData {
    const name = category.name.trim();
    if (!name || name.length > 20) throw new Error("A folder name must be between 1 and 20 characters long.");
    const parentId = category.parentId ?? null;
    if (parentId === category.id) throw new Error("A folder cannot be its own parent.");
    const parent = parentId ? library.categories.find(other => other.id === parentId) : undefined;
    if (parentId && !parent) throw new Error("The parent folder no longer exists.");
    if (parent && parent.kind !== "all" && parent.kind !== category.kind)
        throw new Error("A folder can only contain the same media type.");
    let ancestorId = parentId;
    while (ancestorId) {
        if (ancestorId === category.id) throw new Error("A folder cannot be moved into one of its own subfolders.");
        ancestorId = library.categories.find(other => other.id === ancestorId)?.parentId ?? null;
    }
    if (library.categories.some(other => other.id !== category.id && other.kind === category.kind && (other.parentId ?? null) === parentId && other.name.toLowerCase() === name.toLowerCase()))
        throw new Error("A folder of this type with this name already exists here.");
    const next: MediaCategory = {
        id: category.id,
        name,
        kind: category.kind,
        color: validColor(category.color) ? category.color : "#202225",
        parentId,
        thumbnail: typeof category.thumbnail === "string" && /^https?:\/\//i.test(category.thumbnail) ? category.thumbnail : undefined
    };
    return {
        ...library,
        categories: library.categories.some(other => other.id === next.id)
            ? library.categories.map(other => other.id === next.id ? next : other)
            : [...library.categories, next]
    };
}

export function deleteCategory(library: LibraryData, categoryId: string): LibraryData {
    const deleted = new Set<string>([categoryId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const category of library.categories) {
            if (category.parentId && deleted.has(category.parentId) && !deleted.has(category.id)) {
                deleted.add(category.id);
                changed = true;
            }
        }
    }
    return {
        categories: library.categories.filter(category => !deleted.has(category.id)),
        items: library.items.map(item => item.categoryId && deleted.has(item.categoryId) ? { ...item, categoryId: null } : item)
    };
}

export function moveCategory(library: LibraryData, categoryId: string, parentId: string | null): LibraryData {
    const category = library.categories.find(item => item.id === categoryId);
    if (!category) throw new Error("This folder no longer exists.");
    if (parentId === categoryId) throw new Error("A folder cannot be its own parent.");
    if (parentId && !library.categories.some(item => item.id === parentId)) throw new Error("The parent folder no longer exists.");
    const parent = parentId ? library.categories.find(item => item.id === parentId) : undefined;
    if (parent && parent.kind !== "all" && parent.kind !== category.kind)
        throw new Error("A folder can only contain the same media type.");
    let cursor = parentId;
    while (cursor) {
        if (cursor === categoryId) throw new Error("A folder cannot be moved into one of its own subfolders.");
        cursor = library.categories.find(item => item.id === cursor)?.parentId ?? null;
    }
    return {
        ...library,
        categories: library.categories.map(item => item.id === categoryId ? { ...item, parentId } : item)
    };
}

export function moveCategoryOrder(library: LibraryData, categoryId: string, direction: -1 | 1, visibleKind?: MediaKind): LibraryData {
    const category = library.categories.find(item => item.id === categoryId);
    if (!category) throw new Error("This folder no longer exists.");
    const siblings = library.categories.filter(item =>
        (item.parentId ?? null) === (category.parentId ?? null)
        && (visibleKind ? item.kind === "all" || item.kind === visibleKind : item.kind === category.kind)
    );
    const currentIndex = siblings.findIndex(item => item.id === categoryId);
    const target = siblings[currentIndex + direction];
    if (!target) return library;
    const firstIndex = library.categories.findIndex(item => item.id === categoryId);
    const secondIndex = library.categories.findIndex(item => item.id === target.id);
    if (firstIndex < 0 || secondIndex < 0) return library;
    const categories = [...library.categories];
    [categories[firstIndex], categories[secondIndex]] = [categories[secondIndex], categories[firstIndex]];
    return { ...library, categories };
}

export function setCategoryThumbnail(library: LibraryData, categoryId: string, thumbnail?: string): LibraryData {
    if (!library.categories.some(category => category.id === categoryId)) throw new Error("This folder no longer exists.");
    return {
        ...library,
        categories: library.categories.map(category => category.id === categoryId
            ? { ...category, thumbnail: thumbnail && /^https?:\/\//i.test(thumbnail) ? thumbnail : undefined }
            : category)
    };
}

export function readGifCategories(value: unknown): GifCategory[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(category =>
        !category || typeof category.id !== "string" || !category.id || typeof category.name !== "string" || !category.name.trim()
        || !Array.isArray(category.urls) || category.urls.some((url: unknown) => typeof url !== "string")
    ) || new Set(value.map(category => category.id)).size !== value.length)
        throw new Error("The GIF folders could not be read. The data was not overwritten.");
    return value.map(category => ({
        id: category.id,
        name: category.name.trim(),
        urls: [...new Set(category.urls as string[])],
        color: validColor(category.color) ? category.color : "#202225"
    }));
}

export function upsertGifCategory(categories: GifCategory[], category: GifCategory): GifCategory[] {
    const name = category.name.trim();
    if (!name || name.length > 20) throw new Error("A folder name must be between 1 and 20 characters long.");
    if (categories.some(other => other.id !== category.id && other.name.toLowerCase() === name.toLowerCase()))
        throw new Error("A GIF folder with this name already exists.");
    const next = { id: category.id, name, urls: [...new Set(category.urls)], color: validColor(category.color) ? category.color : "#202225" };
    return categories.some(other => other.id === next.id)
        ? categories.map(other => other.id === next.id ? next : other)
        : [...categories, next];
}

export function moveGif(categories: GifCategory[], url: string, targetId: string | null, favorites: { url: string; }[]): GifCategory[] {
    if (!favorites.some(gif => gif.url === url)) throw new Error("Only Discord favorite GIFs can be filed.");
    if (targetId !== null && !categories.some(category => category.id === targetId)) throw new Error("This folder no longer exists.");
    return categories.map(category => ({
        ...category,
        urls: category.id === targetId ? [...new Set([...category.urls, url])] : category.urls.filter(item => item !== url)
    }));
}

export function deleteGifCategory(categories: GifCategory[], categoryId: string): GifCategory[] {
    return categories.filter(category => category.id !== categoryId);
}

export function categoryGifs<T extends { url: string; }>(category: GifCategory, favorites: T[]): T[] {
    const urls = new Set(category.urls);
    return favorites.filter(gif => urls.has(gif.url));
}

export function unsortedGifs<T extends { url: string; }>(categories: GifCategory[], favorites: T[]): T[] {
    const filed = new Set(categories.flatMap(category => category.urls));
    return favorites.filter(gif => !filed.has(gif.url));
}

export function renameMedia(library: LibraryData, url: string, name: string): LibraryData {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new Error("A media name must be between 1 and 80 characters long.");
    const key = canonicalUrl(url);
    if (!library.items.some(item => canonicalUrl(item.url) === key)) throw new Error("This media is no longer in the favorites.");
    return { ...library, items: library.items.map(item => canonicalUrl(item.url) === key ? { ...item, name: trimmed } : item) };
}

/** Swaps expired signed URLs for refreshed ones. Keys are {@link urlKey} values. */
export function replaceUrls(library: LibraryData, refreshed: Record<string, string>): LibraryData {
    const swap = (url?: string) => (url && refreshed[urlKey(url)]) || url;
    let changed = false;
    const items = library.items.map(item => {
        const url = swap(item.url) as string;
        const previewUrl = swap(item.previewUrl);
        if (url === item.url && previewUrl === item.previewUrl) return item;
        changed = true;
        return { ...item, url, previewUrl };
    });
    const categories = library.categories.map(category => {
        const thumbnail = swap(category.thumbnail);
        if (thumbnail === category.thumbnail) return category;
        changed = true;
        return { ...category, thumbnail };
    });
    return changed ? { items, categories } : library;
}

export interface NativeGif {
    url: string;
    src?: string;
    width?: number;
    height?: number;
}

/** Mirrors Discord's own favourite GIFs into the library, keeping folders and names. */
/**
 * Mirrors Discord's own favourite GIFs into the library, keeping folders and names.
 * `favorites` is Discord's list, newest first; GIFs are stored in that order.
 * Single pass over the library, and the same object is returned when nothing changed.
 */
export function syncNativeGifs(library: LibraryData, favorites: NativeGif[], now = Date.now()): LibraryData {
    const byKey = new Map<string, SavedMedia>();
    for (const item of library.items) {
        const key = canonicalUrl(item.url);
        if (!byKey.has(key)) byKey.set(key, item);
    }
    const categoryKinds = new Map(library.categories.map(category => [category.id, category.kind]));

    const nativeKeys = new Set<string>();
    const gifs: SavedMedia[] = [];
    for (const gif of favorites) {
        const key = canonicalUrl(gif.url);
        if (nativeKeys.has(key)) continue;
        nativeKeys.add(key);
        const existing = byKey.get(key);
        const previewUrl = gif.src && gif.src !== gif.url ? gif.src : existing?.previewUrl;
        const width = gif.width ?? existing?.width;
        const height = gif.height ?? existing?.height;
        const folderKind = existing?.categoryId ? categoryKinds.get(existing.categoryId) : undefined;
        const categoryId = existing?.categoryId && (folderKind === "gif" || folderKind === "all") ? existing.categoryId : null;
        const unchanged = existing && existing.kind === "gif" && existing.nativeFavorite && existing.url === gif.url
            && existing.previewUrl === previewUrl && existing.width === width && existing.height === height && (existing.categoryId ?? null) === categoryId;
        gifs.push(unchanged ? existing : {
            ...existing,
            url: gif.url,
            previewUrl,
            name: existing?.name ?? mediaNameFromUrl(gif.url, "GIF"),
            kind: "gif",
            width,
            height,
            nativeFavorite: true,
            categoryId,
            savedAt: existing?.savedAt ?? now
        });
    }

    // GIFs saved a moment ago may not be in Discord's list yet: keep them on top for a minute.
    const pending: SavedMedia[] = [];
    const others: SavedMedia[] = [];
    for (const item of library.items) {
        const key = canonicalUrl(item.url);
        if (nativeKeys.has(key)) continue;
        if (item.kind === "gif" && item.nativeFavorite) {
            if (now - item.savedAt <= 60_000) pending.push(item);
            continue;
        }
        others.push(item);
    }

    const items = [...pending, ...gifs, ...others];
    const same = items.length === library.items.length && items.every((item, index) => item === library.items[index]);
    return same ? library : { ...library, items };
}

export function withoutNativeGifs(library: LibraryData): LibraryData {
    const items = library.items.filter(item => !(item.kind === "gif" && item.nativeFavorite));
    return items.length === library.items.length ? library : { ...library, items };
}

export interface MergeResult {
    library: LibraryData;
    addedItems: number;
    addedCategories: number;
}

/**
 * Imports another library. Folders with the same name in the same place are merged
 * instead of duplicated, and media already present keep their current folder.
 */
export function mergeLibraries(current: LibraryData, incoming: LibraryData, makeId: () => string = () => `import-${Math.random().toString(36).slice(2, 12)}`): MergeResult {
    const idMap = new Map<string, string>();
    let merged = current;
    let addedCategories = 0;
    const pending = [...incoming.categories];
    while (pending.length) {
        const ready = pending.filter(category => !category.parentId || idMap.has(category.parentId));
        // readLibrary already removes dangling parents and cycles, so this only guards against bad input.
        if (!ready.length) throw new Error("The imported folders are inconsistent.");
        for (const category of ready) {
            pending.splice(pending.indexOf(category), 1);
            const parentId = category.parentId ? idMap.get(category.parentId) ?? null : null;
            const same = merged.categories.find(other => other.kind === category.kind && (other.parentId ?? null) === parentId && other.name.toLowerCase() === category.name.toLowerCase());
            if (same) {
                idMap.set(category.id, same.id);
                continue;
            }
            const id = makeId();
            idMap.set(category.id, id);
            merged = upsertCategory(merged, { ...category, id, parentId });
            addedCategories++;
        }
    }
    let addedItems = 0;
    for (const item of incoming.items) {
        if (!hasMedia(merged, item.url)) addedItems++;
        merged = saveMedia(merged, { ...item, categoryId: item.categoryId ? idMap.get(item.categoryId) ?? null : null });
    }
    return { library: merged, addedItems, addedCategories };
}

const FAVORITE_MEDIA_TYPES: MediaKind[] = ["gif", "image", "video", "audio", "file"];

interface FavoriteMediaTypeData {
    medias?: unknown[];
    categories?: unknown[];
}

export function isFavoriteMediaConfig(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const config = value as Record<string, FavoriteMediaTypeData | undefined>;
    return FAVORITE_MEDIA_TYPES.some(type => Array.isArray(config[type]?.medias) || Array.isArray(config[type]?.categories));
}

/** Converts a BetterDiscord `FavoriteMedia.config.json` into a MediaVault library. */
export function fromFavoriteMedia(value: unknown): LibraryData {
    const config = (value ?? {}) as Record<string, FavoriteMediaTypeData | undefined>;
    const categories: MediaCategory[] = [];
    const items: SavedMedia[] = [];
    const str = (input: unknown) => typeof input === "string" && input ? input : undefined;
    const http = (input: unknown) => {
        const url = str(input);
        if (!url) return undefined;
        const full = url.startsWith("//") ? `https:${url}` : url;
        return /^https?:\/\//i.test(full) ? full : undefined;
    };

    for (const kind of FAVORITE_MEDIA_TYPES) {
        const data = config[kind];
        if (!data) continue;
        const categoryId = (id: unknown) => id === undefined || id === null ? null : `fm-${kind}-${String(id)}`;

        for (const raw of (Array.isArray(data.categories) ? data.categories : []) as Record<string, unknown>[]) {
            const name = str(raw?.name)?.trim().slice(0, 20);
            if (!name || raw.id === undefined || raw.id === null) continue;
            categories.push({
                id: categoryId(raw.id) as string,
                name,
                kind,
                color: typeof raw.color === "string" && validColor(raw.color) ? raw.color : "#202225",
                parentId: categoryId(raw.category_id),
                thumbnail: http(raw.thumbnail)
            });
        }

        (Array.isArray(data.medias) ? data.medias : []).forEach((raw, index) => {
            const media = raw as Record<string, unknown>;
            const url = http(media?.url);
            if (!url) return;
            const preview = kind === "gif" ? http(media.src) : kind === "video" ? http(media.poster) : undefined;
            items.push({
                url,
                previewUrl: preview && preview !== url ? preview : undefined,
                name: str(media.name)?.trim() || mediaNameFromUrl(url),
                kind,
                width: typeof media.width === "number" ? media.width : undefined,
                height: typeof media.height === "number" ? media.height : undefined,
                categoryId: categoryId(media.category_id),
                savedAt: index + 1,
                messageUrl: http(media.message),
                sourceUrl: http(media.source)
            });
        });
    }
    return readLibrary({ items, categories });
}

/** Accepts MediaVault exports, raw MediaVault libraries and FavoriteMedia config files. */
export function readImportedLibrary(value: unknown): LibraryData {
    const candidate = value as { library?: unknown; items?: unknown; } | null;
    if (candidate && typeof candidate === "object") {
        if (candidate.library) return readLibrary(candidate.library);
        if (Array.isArray(candidate.items)) return readLibrary(candidate);
        if (isFavoriteMediaConfig(candidate)) return fromFavoriteMedia(candidate);
    }
    throw new Error("Unrecognized format. Choose a MediaVault export or a FavoriteMedia.config.json file.");
}

export function isVideoUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
        return /\.(mp4|webm|mov|m4v|ogv)$/i.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

/** The file worth keeping: Tenor page links are HTML, their preview is the real media. */
export function archiveSource(item: Pick<SavedMedia, "url" | "previewUrl">): string {
    return /^https?:\/\/(www\.)?tenor\.com\/view\//i.test(item.url) && item.previewUrl ? item.previewUrl : item.url;
}

const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/ogg": "ogv",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/opus": "opus", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac", "audio/webm": "weba"
};

export function extensionOfUrl(url: string): string | undefined {
    try {
        const match = /\.([a-z0-9]{1,6})$/i.exec(new URL(url).pathname);
        const ext = match?.[1].toLowerCase();
        return ext === "jpeg" ? "jpg" : ext;
    } catch {
        return undefined;
    }
}

export function extensionOfMime(mime: string | undefined): string | undefined {
    return MIME_EXTENSIONS[(mime ?? "").split(";")[0].trim().toLowerCase()];
}

/** True when a stored file's real type matches the one its link announces (a webp copy of a png is not). */
export function sameFormat(mime: string | undefined, sourceUrl: string): boolean {
    const wanted = extensionOfUrl(sourceUrl);
    const actual = extensionOfMime(mime);
    return !wanted || !actual || wanted === actual;
}

/** File name with the real extension, taken from the original link first, then from the content type. */
export function fileNameFor(name: string, sourceUrl: string, mime?: string): string {
    const safe = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "media";
    const ext = extensionOfUrl(sourceUrl) ?? extensionOfMime(mime);
    if (!ext) return safe;
    return safe.toLowerCase().endsWith(`.${ext}`) || (ext === "jpg" && /\.jpe?g$/i.test(safe)) ? safe : `${safe}.${ext}`;
}

/** The original file behind a Discord attachment link: no resizing or format conversion by the media proxy. */
export function originalFileUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (!DISCORD_CDN_HOSTS.has(parsed.hostname) || !/^\/(ephemeral-)?attachments\//.test(parsed.pathname)) return url;
        parsed.hostname = "cdn.discordapp.com";
        for (const key of ["width", "height", "quality", "format"]) parsed.searchParams.delete(key);
        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * The GIF tab as FavoriteMedia shows it: Discord's own favourite list (newest first) is what is
 * displayed; MediaVault only adds the name and folder it knows for each link. GIFs saved only in
 * MediaVault (imported, for example) follow.
 */
export function gifView(library: LibraryData, favorites: NativeGif[]): SavedMedia[] {
    const known = new Map<string, SavedMedia>();
    for (const item of library.items) if (item.kind === "gif") known.set(canonicalUrl(item.url), item);
    const shown = new Set<string>();
    const view: SavedMedia[] = [];
    for (const gif of favorites) {
        const key = canonicalUrl(gif.url);
        if (shown.has(key)) continue;
        shown.add(key);
        const saved = known.get(key);
        view.push({
            url: gif.url,
            previewUrl: gif.src && gif.src !== gif.url ? gif.src : saved?.previewUrl,
            name: saved?.name ?? mediaNameFromUrl(gif.url, "GIF"),
            kind: "gif",
            width: gif.width ?? saved?.width,
            height: gif.height ?? saved?.height,
            categoryId: saved?.categoryId ?? null,
            savedAt: saved?.savedAt ?? 0,
            nativeFavorite: true,
            messageUrl: saved?.messageUrl,
            sourceUrl: saved?.sourceUrl
        });
    }
    for (const item of library.items) {
        if (item.kind === "gif" && !item.nativeFavorite && !shown.has(canonicalUrl(item.url))) view.push(item);
    }
    return view;
}

/** Makes sure a media shown in the panel exists in the library before it is moved or renamed. */
export function ensureMedia(library: LibraryData, item: SavedMedia): LibraryData {
    return hasMedia(library, item.url) ? library : saveMedia(library, { ...item, savedAt: item.savedAt || Date.now() });
}
