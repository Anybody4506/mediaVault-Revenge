// Loads dist/MediaVault/index.js the way classic Revenge does (revenge-bundle/src/core/vendetta/plugins.ts)
// with a fake `vendetta` object, then checks onLoad, the message sheet patch and onUnload.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "..", "dist", "MediaVault", "index.js"), "utf8");

const patches = [];
const patch = kind => (name, parent, hook) => {
    const original = parent[name];
    parent[name] = function (...args) {
        if (kind === "before") return original.apply(this, hook(args) ?? args);
        if (kind === "after") return hook(args, original.apply(this, args));
        return hook(args, original.bind(this));
    };
    const entry = { kind, name };
    patches.push(entry);
    return () => {
        parent[name] = original;
        patches.splice(patches.indexOf(entry), 1);
    };
};

const sheets = { openLazy() {}, hideActionSheet() {} };
const ActionSheet = function ActionSheet() {};
const commands = [];
const storage = {};
const errors = [];
const stateCalls = [];
const androidToasts = [];
const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length > 1 ? children : children[0] } }),
    cloneElement: (element, props, ...children) => ({ ...element, props: { ...element.props, ...props, children } }),
    useState: initial => [typeof initial === "function" ? initial() : initial, value => stateCalls.push(value)],
    Component: class {},
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    Fragment: "Fragment"
};
// Discord's jsx runtime and segmented control hook, as used by the GIF/emoji picker.
const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const segmented = { useSegmentedControlState: options => ({ items: options.items, options, setActiveIndex: index => options.onPageChange?.(index) }) };
// A module re-exporting the hook: the picker may call either one.
const segmentedReexport = { get useSegmentedControlState() { return segmented.useSegmentedControlState; }, set useSegmentedControlState(value) { segmented.useSegmentedControlState = value; } };

const vendetta = {
    patcher: { before: patch("before"), after: patch("after"), instead: patch("instead") },
    metro: {
        common: {
            React: fakeReact,
            ReactNative: { StyleSheet: { create: s => s }, ToastAndroid: { SHORT: 0, LONG: 1, show: text => androidToasts.push(text) } },
            clipboard: {}
        },
        find: () => undefined,
        findByName: () => undefined,
        findByStoreName: () => undefined,
        findByPropsAll: (...props) => props[0] === "useSegmentedControlState" ? [segmented, segmentedReexport] : [],
        findByProps: (...props) => {
            if (props[0] === "openLazy") return sheets;
            if (props[0] === "ActionSheet") return { ActionSheet };
            if (props[0] === "jsx") return jsxRuntime;
            if (props[0] === "useSegmentedControlState") return segmented;
            return undefined;
        }
    },
    commands: {
        registerCommand: command => {
            commands.push(command);
            return () => commands.splice(commands.indexOf(command), 1);
        }
    },
    storage: { useProxy: () => {} },
    plugin: { id: "test/", storage },
    ui: { toasts: { showToast() {} }, assets: { getAssetIDByName: () => 1 } },
    utils: { findInReactTree: () => undefined },
    logger: { error: (...args) => errors.push(args), log() {}, warn() {} }
};

// Exactly how revenge-bundle evaluates a Vendetta plugin.
const raw = (0, eval)(`vendetta=>{return ${js}}`)(vendetta);
const ret = typeof raw === "function" ? raw() : raw;
const plugin = ret?.default ?? ret;

assert.equal(typeof plugin.onLoad, "function", "onLoad");
assert.equal(typeof plugin.onUnload, "function", "onUnload");
assert.equal(typeof plugin.settings, "function", "settings component");

plugin.onLoad();
assert.deepEqual(errors, [], "no setup error");
assert.equal(commands.length, 1, "/mediavault registered");
assert.equal(commands[0].name, "mediavault");
assert.ok(patches.some(p => p.kind === "before" && p.name === "openLazy"), "action sheet patch");

(async () => {
    // Opening the message long-press sheet patches the lazily loaded component once.
    const message = { id: "1", channel_id: "2", attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/cat.png", filename: "cat.png", content_type: "image/png" }] };
    const sheetModule = { default: () => ({ type: ActionSheet, props: { children: [{ type: "group" }] } }) };
    sheets.openLazy(Promise.resolve(sheetModule), "MessageLongPressActionSheet", { message });
    await new Promise(resolve => setTimeout(resolve, 10));
    const tree = sheetModule.default({ message });
    assert.equal(tree.props.children.length, 2, "MediaVault rows added to the sheet");
    assert.equal(tree.props.children[1].props.key, "mediavault");

    // Other sheets are left alone.
    const other = { default: () => ({ type: ActionSheet, props: { children: [] } }) };
    sheets.openLazy(Promise.resolve(other), "SomethingElse", {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(other.default().props.children.length, 0, "other sheets untouched");

    // The GIF/emoji picker's segmented control gives way to MediaVault's tab bar.
    const discordPages = [];
    let pickerState;
    function SegmentedControl() {}
    function ExpressionPicker() {
        pickerState = segmentedReexport.useSegmentedControlState({ items: [{ id: "emoji", label: "Émoji" }, { id: "gif", label: "GIF" }, { id: "sticker", label: "Autocollants" }], onPageChange: index => discordPages.push(index) });
        return { type: "View", props: { children: [{ type: "View", props: { children: { type: SegmentedControl, props: { state: pickerState } } } }, { type: "View", props: { children: [] } }] } };
    }
    const element = jsxRuntime.jsx(ExpressionPicker, { channel: {} });
    assert.notEqual(element.type, ExpressionPicker, "picker wrapped");
    const rendered = element.type(element.props);
    const bar = [rendered.props.children].flat()[0].props.children[0];
    assert.equal(bar?.props?.state, pickerState, "segmented control replaced by the tab bar");
    assert.notEqual(bar.type, SegmentedControl);
    const barTabs = bar.type(bar.props).props.children;
    assert.equal(barTabs.length, 5, "Discord's tabs, then Images and Videos (Audio and Files are off by default)");
    assert.equal(barTabs[2].props.children.props.children, "Sticker", "Sticker label shortened");
    barTabs[1].props.onPress();
    assert.deepEqual(discordPages, [1], "Discord tabs still work");
    barTabs[3].props.onPress();
    assert.deepEqual(discordPages, [1], "MediaVault tab not passed to Discord");
    assert.ok(stateCalls.includes("image"), "MediaVault tab selected");
    assert.equal(jsxRuntime.jsx("View", {}).type, "View", "other elements untouched");

    plugin.onUnload();
    assert.equal(commands.length, 0, "/mediavault unregistered");
    assert.equal(patches.length, 0, "every patch removed");
    console.log("smoke test passed");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
