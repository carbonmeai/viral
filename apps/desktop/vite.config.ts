import { defineConfig } from "vite-plus"

// Bundles the Electron main process and preload into CommonJS, with every dependency inside, so the
// packaged app needs no node_modules. Electron itself is provided at runtime.
export default defineConfig({
  pack: [
    {
      entry: ["src/main.ts", "src/preload.ts"],
      format: "cjs",
      outDir: "dist-electron",
      platform: "node",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      deps: { neverBundle: ["electron"], alwaysBundle: [/.*/] },
    },
    // The server, bundled into plain JavaScript for Electron's Node (Node won't strip TypeScript types inside
    // node_modules, where a packaged app keeps workspace packages). scripts/build-server.ts copies the Python
    // scripts and the skill pack next to it, where the server looks for them.
    {
      entry: { main: "../server/src/main.ts" },
      format: "esm",
      outDir: "dist-server",
      platform: "node",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".mjs" }),
      deps: { alwaysBundle: [/.*/] }
    }
  ]
})
