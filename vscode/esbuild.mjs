import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";

const isWatch = process.argv.includes("--watch");

// 1. Extension Host Build (Node.js target)
const extensionCtx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  minify: !isWatch
});

// 2. Webview Client Build (Browser target)
const webviewCtx = await esbuild.context({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview.js",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify: !isWatch,
  plugins: [
    esbuildSvelte({
      compilerOptions: { css: "external" },
      preprocess: sveltePreprocess()
    })
  ]
});

if (isWatch) {
  await extensionCtx.watch();
  await webviewCtx.watch();
  console.log("👀 Watching for changes in extension and webview...");
} else {
  await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  console.log("⚡ Extension and webview bundled successfully!");
  process.exit(0);
}