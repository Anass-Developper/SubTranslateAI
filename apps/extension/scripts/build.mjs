import { mkdir, rm, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(extensionRoot, "dist");
const watching = process.argv.includes("--watch");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyFile(resolve(extensionRoot, "manifest.json"), resolve(outDir, "manifest.json"));

const common = {
  configFile: false,
  root: extensionRoot,
  logLevel: "info",
};

const uiConfig = {
  ...common,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    watch: watching ? {} : undefined,
    rollupOptions: {
      input: {
        popup: resolve(extensionRoot, "popup.html"),
        options: resolve(extensionRoot, "options.html"),
      },
    },
  },
};

function scriptConfig(entry, fileName, globalName) {
  return {
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      watch: watching ? {} : undefined,
      lib: {
        entry: resolve(extensionRoot, entry),
        name: globalName,
        formats: ["iife"],
        fileName: () => fileName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
}

await Promise.all([
  build(uiConfig),
  build(scriptConfig("src/page-bridge/index.ts", "page-bridge.js", "DualSubtitlesPageBridge")),
  build(scriptConfig("src/content/index.ts", "content.js", "DualSubtitlesContent")),
  build(scriptConfig("src/background/index.ts", "background.js", "DualSubtitlesBackground")),
]);

if (watching) {
  console.log("Extension build is watching for changes.");
  process.stdin.resume();
}
