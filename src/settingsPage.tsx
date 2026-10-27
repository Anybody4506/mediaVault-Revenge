/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { ScrollView } from "react-native";

import { clearLibrary, exportLibrary, importFromClipboard, importFromUrl } from "./actions";
import { currentAccountId, notify } from "./discord";
import type { Key } from "./i18n";
import { t } from "./i18n";
import { openLibrary } from "./library";
import type { Settings } from "./settings";
import { setSetting, TAB_SETTINGS, useSettings } from "./settings";
import { useLibrary } from "./store";
import { Clipboard, Design } from "./rv";
import { confirmAction, icon, promptText } from "./ui";

function Icon({ names }: { names: string[]; }) {
    const { TableRowIcon } = Design;
    const Component = icon(...names);
    return Component && TableRowIcon ? <TableRowIcon IconComponent={Component} /> : null;
}

export default function SettingsPage() {
    const { TableRow, TableRowGroup, TableSwitchRow, TableRadioGroup, TableRadioRow, Text } = Design;
    const settings = useSettings();
    const accountId = currentAccountId();
    const { library } = useLibrary(accountId);

    const switchRow = (key: keyof Settings, label: string, subLabel?: string) => <TableSwitchRow
        key={key}
        label={label}
        subLabel={subLabel}
        value={settings[key] as boolean}
        onValueChange={(value: boolean) => void setSetting(key, value as never)}
    />;

    return <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 24 }}>
        <TableRowGroup title={t("m.library")}>
            <TableRow
                label={t("m.open")}
                subLabel={library ? t("m.stats", { items: library.items.length, folders: library.categories.length }) : accountId ? t("loading") : t("m.signedOut")}
                icon={<Icon names={["FolderIcon", "ImageIcon"]} />}
                arrow
                disabled={!accountId}
                onPress={() => openLibrary(accountId)}
            />
            <TableRow
                label={t("m.importUrl")}
                subLabel={t("m.importUrlHelp")}
                icon={<Icon names={["LinkIcon", "DownloadIcon"]} />}
                disabled={!accountId}
                onPress={() => accountId && promptText({
                    title: t("m.importUrl"),
                    description: t("m.importUrlHelp"),
                    placeholder: "https://cdn.discordapp.com/attachments/…/FavoriteMedia.config.json",
                    onSubmit: url => url.trim() && importFromUrl(accountId, url)
                })}
            />
            <TableRow
                label={t("m.importClipboard")}
                icon={<Icon names={["ClipboardListIcon", "CopyIcon"]} />}
                disabled={!accountId}
                onPress={() => accountId && void importFromClipboard(accountId)}
            />
            <TableRow
                label={t("m.exportClipboard")}
                icon={<Icon names={["CopyIcon"]} />}
                disabled={!library}
                onPress={() => {
                    if (!library) return;
                    Clipboard.setString(exportLibrary(library));
                    notify(t("m.exported", { count: library.items.length }));
                }}
            />
            <TableRow
                label={t("m.clear")}
                variant="danger"
                icon={<Icon names={["TrashIcon"]} />}
                disabled={!accountId || !library}
                onPress={() => accountId && confirmAction(t("m.clear"), t("m.clearConfirm"), () => clearLibrary(accountId))}
            />
        </TableRowGroup>

        <TableRowGroup title={t("tab.gif")}>
            {switchRow("syncNativeGifs", "Sync with Discord's favorite GIFs", "The GIF tab shows Discord's own favorites (synced across devices), and adding a GIF also stars it in Discord.")}
        </TableRowGroup>

        <TableRowGroup title="Tabs">
            {(Object.keys(TAB_SETTINGS) as (keyof typeof TAB_SETTINGS)[]).map(kind => switchRow(TAB_SETTINGS[kind], t(`tab.${kind}` as Key)))}
        </TableRowGroup>

        <TableRowGroup title="Behavior">
            {switchRow("alwaysSendInstantly", t("opt.instant"), "Otherwise the link is inserted in the chat box.")}
            {switchRow("chatButton", "Chat bar button", "A button next to the emoji button opens the library.")}
            {switchRow("hideUnsortedMedias", t("opt.hideUnsorted"))}
            {switchRow("hideThumbnail", t("opt.hideThumb"))}
        </TableRowGroup>

        <TableRadioGroup title="Maximum number of folders and media per page" value={settings.maxMediasPerPage} onChange={(value: number) => void setSetting("maxMediasPerPage", value)}>
            {[20, 50, 100].map(value => <TableRadioRow key={value} label={String(value)} value={value} />)}
        </TableRadioGroup>

        <Text variant="text-sm/medium" color="text-muted">{t("m.unsupported")}</Text>
    </ScrollView>;
}
