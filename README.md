# MediaVault for Revenge

Port of [MediaVault for Equicord](https://github.com/Anybody4506/mediaVault-Equicord) to [Revenge](https://github.com/revenge-mod/revenge-bundle) (Discord Android, Vendetta plugin format). A favorites library for GIFs, images, videos, audio and files, with folders, search and links that never expire.

## Install

In Discord: **Settings → Revenge → Plugins → "+" (Install a plugin)**, paste the plugin URL, then confirm the "Hold On!" warning shown for plugins that are not on the official proxy:

```
https://raw.githubusercontent.com/Anybody4506/mediaVault-Revenge/main/dist/MediaVault/
```

(Replace it with the address of your own repository if it is different.)

## Features

- **Save from any message.** Long-press a message: each of its media gets an "Add to MediaVault" / "Remove from MediaVault" row, plus "Add all media" and "Open MediaVault". This replaces the desktop star and the right-click menu.
- **Library sheet**, opened with the button next to the emoji button in the chat bar, the `/mediavault` command, the message long-press sheet, or the plugin settings. Tabs for GIF, Images, Videos, Audio and Files (each can be hidden), search, pages and folders.
- **Folders and subfolders** with colors and thumbnails. Long-press a folder to create a subfolder, rename it, change its color, reorder it, move it, set its thumbnail or delete it.
- **Media options.** Long-press a media to send it, rename it, move it to a folder, use it as the folder thumbnail, copy its link, message link or source link, or remove it.
- **Discord's favorite GIFs.** The GIF tab shows Discord's own favorites, synced across devices, and adding a GIF also stars it in Discord (can be turned off).
- **Links that never expire.** Expired Discord attachment links are renewed in batches before they are shown or sent.
- **Sending.** Tap a media to send it in the current channel, or turn off "Send immediately" to insert its link in the chat box instead.
- **Import and export.** Import a MediaVault export or a BetterDiscord `FavoriteMedia.config.json` from a link (for example the file sent in a Discord channel from your computer) or from the clipboard. Imports are merged like on desktop. Export copies the library as JSON to the clipboard.
- **Translated interface** with the same dictionaries as the desktop plugin. Mobile-only strings exist in English and French; other languages fall back to English for them.

## Differences with the desktop plugin

- No local copies of media, no copies folder and no sending as an attachment (they need the desktop app).
- No takeover of Discord's GIF picker or tabs in the expression picker: the mobile picker is a different component.
- No drag and drop: "Move to" and "Move before / after" replace it.
- The library is stored on the phone, per Discord account, in the plugin's storage. It is not synced with the desktop plugin: use an export and "Import from a link" to move it.

## Build

```sh
npm install
npm run typecheck
npm run build
```

`npm run build` writes `dist/MediaVault/index.js` and `dist/MediaVault/manifest.json`. Commit both: the URL of that folder is the install URL, and Revenge updates the plugin when the `hash` in the manifest changes.

Tests: `node tests/smoke.cjs` loads the built plugin the way Revenge does, with a fake `vendetta` object. `node tests/model.test.cjs` runs the desktop plugin's model tests (needs TypeScript 5).

## Status

Not yet tested on a phone. The plugin follows the API that classic Revenge gives to Vendetta plugins (`revenge-bundle/src/core/vendetta/api.tsx`). If a Discord update breaks one part (the chat bar button, the message long-press rows), the other entry points keep working; the error is in Revenge's logs (Settings → Revenge → Developer → Debug logs).

## Credits and license

Based on MediaVault for Equicord, itself inspired by [FavoriteMedia](https://github.com/Dastan21/BDAddons/tree/main/plugins/FavoriteMedia). License: GNU GPL v3 or later. See `LICENSE`.
