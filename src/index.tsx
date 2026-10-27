/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { patchChatInput, registerCommand } from "./chatButton";
import { patchMessageActionSheet } from "./message";
import SettingsPage from "./settingsPage";
import { resetLibraryCache } from "./store";
import { resetUrlQueue } from "./urls";

const cleanups: (() => unknown)[] = [];

function attempt(name: string, setup: () => () => unknown) {
    try {
        cleanups.push(setup());
    } catch (error) {
        vendetta.logger.error(`[MediaVault] ${name} failed`, error);
    }
}

export default {
    onLoad() {
        attempt("Message actions", () => patchMessageActionSheet(error => vendetta.logger.error("[MediaVault] Could not add the message actions", error)));
        attempt("Chat bar button", patchChatInput);
        attempt("/mediavault command", registerCommand);
    },

    onUnload() {
        for (const cleanup of cleanups.splice(0)) {
            try {
                cleanup();
            } catch (error) {
                vendetta.logger.error("[MediaVault] Cleanup failed", error);
            }
        }
        resetUrlQueue();
        resetLibraryCache();
    },

    settings: SettingsPage
};
