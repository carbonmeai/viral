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
      external: ["electron"],
      noExternal: [/.*/]
    }
  ]
})
