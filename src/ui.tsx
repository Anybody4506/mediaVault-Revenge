/*
 * MediaVault, a media library for Revenge (port of the Equicord plugin)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from "react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ComponentType } from "react";

import { t } from "./i18n";
import { ActionSheetActionCreators, AlertActionCreators, Design, lookupIcon } from "./rv";

type IconComponent = NonNullable<ReturnType<typeof lookupIcon>>;

/** First generated Discord icon that exists in this version of the app. */
export function icon(...names: string[]): IconComponent | undefined {
    for (const name of names) {
        const found = lookupIcon(name);
        if (found) return found;
    }
    return undefined;
}

export function openSheet<P extends object>(key: string, Sheet: ComponentType<P>, props: P, stacking: "stack" | "replaceTopSheet" | "replaceAll" = "stack") {
    ActionSheetActionCreators.openLazy(Promise.resolve({ default: Sheet as ComponentType<any> }), key, props, stacking);
}

export const hideSheet = (key?: string) => ActionSheetActionCreators.hideActionSheet(key);

/** Same colors as the desktop folder picker. */
export const FOLDER_COLORS = ["#202225", "#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#9b59b6", "#1abc9c"];

interface PromptOptions {
    title: string;
    label?: string;
    placeholder?: string;
    initial?: string;
    description?: string;
    maxLength?: number;
    color?: string;
    withColor?: boolean;
    onSubmit(value: string, color?: string): unknown;
}

function PromptBody({ options, onChange }: { options: PromptOptions; onChange(value: string, color?: string): void; }) {
    const { Stack, TextInput } = Design;
    const [value, setValue] = useState(options.initial ?? "");
    const [color, setColor] = useState(options.color ?? FOLDER_COLORS[0]);
    return <Stack spacing={12}>
        <TextInput
            label={options.label}
            placeholder={options.placeholder}
            defaultValue={options.initial}
            maxLength={options.maxLength}
            autoFocus
            isClearable
            onChange={(next: string) => { setValue(next); onChange(next, color); }}
        />
        {options.withColor && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {FOLDER_COLORS.map(swatch => <Pressable
                key={swatch}
                accessibilityRole="radio"
                accessibilityState={{ selected: swatch === color }}
                accessibilityLabel={swatch === FOLDER_COLORS[0] ? t("m.colorNone") : swatch}
                onPress={() => { setColor(swatch); onChange(value, swatch); }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: swatch, borderWidth: swatch === color ? 3 : 1, borderColor: swatch === color ? "#ffffff" : "rgba(128,128,128,0.5)" }}
            />)}
        </View>}
    </Stack>;
}

/** A small text dialog, used for folder names, media names and import links. */
export function promptText(options: PromptOptions) {
    const { AlertModal, AlertActionButton } = Design;
    const Actions = Design.AlertActions ?? React.Fragment;
    let current = { value: options.initial ?? "", color: options.color ?? FOLDER_COLORS[0] };
    AlertActionCreators.openAlert("MEDIAVAULT_PROMPT", <AlertModal
        title={options.title}
        content={options.description}
        extraContent={<PromptBody options={options} onChange={(value, color) => { current = { value, color: color ?? current.color }; }} />}
        actions={<Actions>
            <AlertActionButton text={t("save")} variant="primary" onPress={() => { void options.onSubmit(current.value, current.color); }} />
            <AlertActionButton text={t("cancel")} variant="secondary" />
        </Actions>}
    />);
}

export function confirmAction(title: string, content: string, action: () => unknown) {
    const { AlertModal, AlertActionButton } = Design;
    const Actions = Design.AlertActions ?? React.Fragment;
    AlertActionCreators.openAlert("MEDIAVAULT_CONFIRM", <AlertModal
        title={title}
        content={content}
        actions={<Actions>
            <AlertActionButton text={t("m.confirm")} variant="destructive" onPress={() => { void action(); }} />
            <AlertActionButton text={t("cancel")} variant="secondary" />
        </Actions>}
    />);
}

export function EmptyText({ children }: { children: string; }) {
    const { Text } = Design;
    return <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center", paddingVertical: 24 }}>{children}</Text>;
}

/** Runs an action and shows its error as a toast instead of failing silently. */
export function run(action: () => Promise<unknown> | unknown, onError: (message: string) => void) {
    return () => {
        try {
            void Promise.resolve(action()).catch(error => onError(error instanceof Error ? error.message : String(error)));
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        }
    };
}
