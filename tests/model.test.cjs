const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "model.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const model = loaded.exports;

let library = model.readLibrary(undefined);
assert.deepEqual(library, { items: [], categories: [] }, "initial library");

library = model.saveMedia(library, {
    url: "https://cdn.example/a.png?ex=1",
    name: "a.png",
    kind: "image"
});
assert.equal(library.items.length, 1, "media saved");

library = model.upsertCategory(library, { id: "root", name: "Reactions", kind: "image", parentId: null, color: "#234567" });
library = model.upsertCategory(library, { id: "child", name: "Rire", kind: "image", parentId: "root", color: "#202225" });
library = model.upsertCategory(library, { id: "other", name: "Divers", kind: "image", parentId: null, color: "#202225" });
library = model.saveMedia(library, {
    url: "https://cdn.example/a.png?ex=2",
    name: "a.png",
    kind: "image",
    categoryId: "child"
});
assert.equal(library.items.length, 1, "signed URL variants do not duplicate a saved media");
assert.equal(library.items[0].categoryId, "child", "media is assigned to nested folder");

library = model.moveCategoryOrder(library, "other", -1);
const roots = library.categories.filter(category => category.parentId == null);
assert.equal(roots[0].id, "other", "sibling folder reordering");

library = model.moveMedia(library, library.items[0].url, null);
assert.equal(library.items[0].categoryId, null, "move to unsorted");
library = model.moveMedia(library, library.items[0].url, "child");
library = model.deleteCategory(library, "root");
assert.equal(library.categories.some(category => category.id === "root" || category.id === "child"), false, "deleting a folder deletes descendants");
assert.equal(library.items[0].categoryId, null, "deleted folder items become unsorted");

assert.equal(
    model.canonicalUrl("https://media.discordapp.net/a.gif?ex=1&is=2&hm=3&width=200&format=webp"),
    "https://cdn.discordapp.com/a.gif",
    "Discord's signed and sizing URL parameters are normalized"
);

const repaired = model.readLibrary({
    categories: [
        { id: "a", name: "A", kind: "image", parentId: "b" },
        { id: "b", name: "B", kind: "image", parentId: "a" }
    ],
    items: []
});
assert.equal(repaired.categories.some(category => category.parentId == null), true, "imported parent cycles are repaired");

assert.throws(() => model.upsertCategory(repaired, {
    id: "invalid", name: "   ", kind: "image", parentId: null
}), /folder name/i, "empty folder names are rejected");


// --- MediaVault 4.0 additions ---
let lib = model.readLibrary(undefined);
lib = model.saveMedia(lib, { url: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3", name: "a.png", kind: "image" });
lib = model.renameMedia(lib, "https://cdn.discordapp.com/attachments/1/2/a.png", "Mon chat");
assert.equal(lib.items[0].name, "Mon chat", "rename");
lib = model.saveMedia(lib, { url: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=9", name: "a.png", kind: "image" });
assert.equal(lib.items[0].name, "Mon chat", "re-saving keeps the chosen name");
assert.throws(() => model.renameMedia(lib, "https://x/none.png", "x"), /no longer in the favorites/);

const refreshed = model.replaceUrls(lib, { [model.urlKey("https://cdn.discordapp.com/attachments/1/2/a.png")]: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=ff&is=ff&hm=ff" });
assert.ok(refreshed.items[0].url.includes("ex=ff"), "expired url replaced");
assert.equal(model.replaceUrls(lib, {}), lib, "no change keeps identity");

let gifs = model.syncNativeGifs(model.readLibrary(undefined), [{ url: "https://tenor.com/view/a-gif-1", src: "https://media.tenor.com/a.gif", width: 10, height: 10 }, { url: "https://tenor.com/view/b-gif-2" }]);
assert.equal(gifs.items.length, 2, "native gifs mirrored");
gifs = model.upsertCategory(gifs, { id: "c1", name: "Reactions", kind: "gif", parentId: null, color: "#112233" });
gifs = model.moveMedia(gifs, "https://tenor.com/view/a-gif-1", "c1");
assert.equal(model.syncNativeGifs(gifs, [{ url: "https://tenor.com/view/a-gif-1" }]).items.length, 2, "a just-saved GIF is not dropped before Discord syncs it");
gifs = model.syncNativeGifs(gifs, [{ url: "https://tenor.com/view/a-gif-1" }], Date.now() + 120000);
assert.equal(gifs.items.length, 1, "unfavorited native gif dropped");
assert.equal(gifs.items[0].categoryId, "c1", "folder kept across sync");
assert.equal(model.withoutNativeGifs(gifs).items.length, 0, "withoutNativeGifs");

let base = model.upsertCategory(model.readLibrary(undefined), { id: "r", name: "Reactions", kind: "image", parentId: null, color: "#112233" });
base = model.saveMedia(base, { url: "https://x.test/one.png", name: "one", kind: "image", categoryId: "r" });
let incoming = model.readLibrary({
    categories: [
        { id: "child", name: "Rire", kind: "image", parentId: "root" },
        { id: "root", name: "reactions", kind: "image", parentId: null }
    ],
    items: [
        { url: "https://x.test/one.png", name: "one", kind: "image", categoryId: "root", savedAt: 1 },
        { url: "https://x.test/two.png", name: "two", kind: "image", categoryId: "child", savedAt: 2 }
    ]
});
let counter = 0;
const merged = model.mergeLibraries(base, incoming, () => `n${++counter}`);
assert.equal(merged.library.categories.length, 2, "same-name root merged, child added");
assert.equal(merged.addedCategories, 1);
assert.equal(merged.addedItems, 1, "only the new media counts");
const two = merged.library.items.find(item => item.url.endsWith("two.png"));
assert.equal(merged.library.categories.find(category => category.id === two.categoryId).name, "Rire", "child folder reattached under merged parent");
assert.equal(merged.library.categories.find(category => category.name === "Rire").parentId, "r", "child parent remapped to existing folder");

const fm = model.readImportedLibrary({
    settings: {},
    image: {
        categories: [{ id: 1, name: "Chats", color: "#ff0000" }, { id: 2, name: "Chatons", color: "#00ff00", category_id: 1 }],
        medias: [
            { url: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1", width: 10, height: 20, name: "a", message: "https://discord.com/channels/1/2/3", category_id: 2 },
            { url: "//cdn.example/b.png", name: "b" },
            { url: "not a url", name: "bad" }
        ]
    },
    gif: { medias: [{ url: "https://tenor.com/view/x-gif-1", src: "https://media.tenor.com/x.gif", width: 5, height: 5, name: "x" }], categories: [] },
    video: { medias: [{ url: "https://cdn.example/v.mp4", poster: "https://cdn.example/v.jpg", name: "v" }] },
    audio: { medias: [{ url: "https://cdn.example/s.mp3", name: "s", ext: ".mp3" }] }
});
assert.equal(fm.items.length, 5, "FavoriteMedia: invalid urls skipped, all types converted");
assert.equal(fm.categories.length, 2);
assert.equal(fm.categories.find(c => c.name === "Chatons").parentId, "fm-image-1", "FavoriteMedia: parent folder kept");
assert.equal(fm.items.find(i => i.name === "a").categoryId, "fm-image-2");
assert.equal(fm.items.find(i => i.name === "a").messageUrl, "https://discord.com/channels/1/2/3");
assert.equal(fm.items.find(i => i.name === "x").previewUrl, "https://media.tenor.com/x.gif", "gif src becomes preview");
assert.equal(fm.items.find(i => i.name === "v").previewUrl, "https://cdn.example/v.jpg", "video poster becomes preview");
assert.ok(fm.items.find(i => i.name === "b").url.startsWith("https://"), "protocol-relative url fixed");
assert.throws(() => model.readImportedLibrary({ foo: 1 }), /Unrecognized format/);
assert.equal(model.readImportedLibrary({ format: "MediaVault", library: { items: [], categories: [] } }).items.length, 0, "MediaVault export still accepted");
const mergedFm = model.mergeLibraries(model.readLibrary(undefined), fm, () => "id" + Math.random());
assert.equal(mergedFm.addedItems, 5, "FavoriteMedia import merges into a library");

assert.equal(model.isVideoUrl("https://media.tenor.com/abc/x.mp4"), true, "tenor mp4 preview is a video");
assert.equal(model.isVideoUrl("https://media.discordapp.net/attachments/1/2/v.MOV?ex=1"), true);
assert.equal(model.isVideoUrl("https://cdn.discordapp.com/attachments/1/2/a.gif"), false);
assert.equal(model.archiveSource({ url: "https://tenor.com/view/x-gif-1", previewUrl: "https://media.tenor.com/x.mp4" }), "https://media.tenor.com/x.mp4", "tenor pages archive their media file");
assert.equal(model.archiveSource({ url: "https://cdn.discordapp.com/attachments/1/2/a.gif" }), "https://cdn.discordapp.com/attachments/1/2/a.gif");

assert.equal(model.fileNameFor("photo", "https://cdn.discordapp.com/attachments/1/2/photo.png?ex=1", "image/webp"), "photo.png", "original extension wins over a converted content type");
assert.equal(model.fileNameFor("photo.png", "https://cdn.discordapp.com/a/photo.png"), "photo.png", "extension not duplicated");
assert.equal(model.fileNameFor("cat", "https://tenor.com/view/cat-gif-1", "image/gif"), "cat.gif", "content type used when the link has no extension");
assert.equal(model.fileNameFor("a/b:c", "https://x.test/f.JPEG"), "a_b_c.jpg", "unsafe characters replaced, jpeg normalised");
assert.equal(model.sameFormat("image/webp", "https://cdn.discordapp.com/a/b.png"), false, "webp copy of a png detected");
assert.equal(model.sameFormat("image/png", "https://cdn.discordapp.com/a/b.png?ex=1"), true);
assert.equal(model.sameFormat("image/gif", "https://tenor.com/view/x"), true, "unknown extension is accepted");
assert.equal(model.originalFileUrl("https://media.discordapp.net/attachments/1/2/a.png?ex=1&is=2&hm=3&width=200&format=webp"), "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3", "proxy resizing removed, signature kept");
assert.equal(model.originalFileUrl("https://media.discordapp.net/external/abc/https/x.test/a.png?width=2"), "https://media.discordapp.net/external/abc/https/x.test/a.png?width=2", "external proxy links untouched");

// Newest first, single pass, no change means same object.
{
    const favorites = Array.from({ length: 1200 }, (_, index) => ({ url: `https://media.tenor.com/g${1199 - index}.gif` }));
    const started = Date.now();
    const synced = model.syncNativeGifs(model.readLibrary(undefined), favorites);
    const again = model.syncNativeGifs(synced, favorites);
    const elapsed = Date.now() - started;
    assert.equal(synced.items[0].url, "https://media.tenor.com/g1199.gif", "newest GIF first");
    assert.equal(synced.items[1199].url, "https://media.tenor.com/g0.gif", "oldest GIF last");
    assert.equal(again, synced, "unchanged list returns the same library");
    assert.ok(elapsed < 1000, `sync of 1200 GIFs took ${elapsed} ms`);
    const reordered = model.syncNativeGifs(synced, [{ url: "https://media.tenor.com/new.gif" }, ...favorites]);
    assert.equal(reordered.items[0].url, "https://media.tenor.com/new.gif", "a newly favorited GIF goes on top");
}

{
    let lib = model.upsertCategory(model.readLibrary(undefined), { id: "g", name: "Fun", kind: "gif", parentId: null, color: "#112233" });
    lib = model.saveMedia(lib, { url: "https://media.tenor.com/old.gif", name: "Renamed", kind: "gif", categoryId: "g", nativeFavorite: true });
    lib = model.saveMedia(lib, { url: "https://x.test/local.gif", name: "Local", kind: "gif" });
    lib = model.saveMedia(lib, { url: "https://media.tenor.com/removed.gif", name: "Gone", kind: "gif", nativeFavorite: true });
    const view = model.gifView(lib, [{ url: "https://media.tenor.com/new.gif" }, { url: "https://media.tenor.com/old.gif" }]);
    assert.deepEqual(view.map(item => item.url), ["https://media.tenor.com/new.gif", "https://media.tenor.com/old.gif", "https://x.test/local.gif"], "Discord's list decides what is shown, newest first, then local-only GIFs");
    assert.equal(view[1].name, "Renamed", "name kept from the library");
    assert.equal(view[1].categoryId, "g", "folder kept from the library");
    const moved = model.moveMedia(model.ensureMedia(lib, view[0]), view[0].url, "g");
    assert.equal(moved.items.find(item => item.url === view[0].url).categoryId, "g", "a GIF not yet synced can still be filed");
}

console.log("model tests passed");
