// Builds the plugin for classic Revenge (Vendetta plugin format):
// dist/MediaVault/index.js is an expression that Revenge evaluates as `vendetta => { return <index.js> }`,
// and dist/MediaVault/manifest.json describes it. The URL of that folder is what gets installed.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { rolldown } from "rolldown";

const out = "dist/MediaVault";
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

const bundle = await rolldown({
    input: "src/index.tsx",
    external: ["react", "react-native"],
    jsx: "react",
    transform: { target: "es2019" }
});
const { output } = await bundle.generate({
    format: "iife",
    name: "__mediavault",
    exports: "named",
    globals: {
        react: "vendetta.metro.common.React",
        "react-native": "vendetta.metro.common.ReactNative"
    },
    minify: true
});

// An expression, so that `return <code>` works: the IIFE assigns the plugin to a local name and returns it.
const code = `(()=>{${output[0].code}\nreturn __mediavault})()`;
const hash = createHash("sha256").update(code).digest("hex");

await mkdir(out, { recursive: true });
await writeFile(`${out}/index.js`, code);
await writeFile(`${out}/manifest.json`, `${JSON.stringify({ ...manifest, main: "index.js", hash }, null, 4)}\n`);
console.log(`Built ${out} (${(code.length / 1024).toFixed(1)} KB, hash ${hash.slice(0, 12)})`);
