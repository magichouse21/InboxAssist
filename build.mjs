import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL(".", import.meta.url);
const dist = new URL("dist/", root);

await rm(dist, { recursive: true, force: true });
await mkdir(new URL("js/", dist), { recursive: true });
await mkdir(new URL("html/", dist), { recursive: true });

await cp(new URL("manifest.json", root), new URL("manifest.json", dist));
await cp(new URL("css/", root), new URL("css/", dist), { recursive: true });
await cp(new URL("icon/", root), new URL("icon/", dist), { recursive: true });
await cp(new URL("html/", root), new URL("html/", dist), { recursive: true });

await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: [
    fileURLToPath(new URL("js/background.js", root)),
    fileURLToPath(new URL("js/popup.js", root)),
    fileURLToPath(new URL("js/options.js", root)),
  ],
  outdir: fileURLToPath(new URL("js/", dist)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  sourcemap: true,
});

await cp(new URL("js/content.js", root), new URL("js/content.js", dist));

console.log("Built extension into dist/");
