import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

// The Viral UI: served on :5733 in dev (the desktop app loads it from there), built to dist/ for packaging.
export default defineConfig({
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5733, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true }
})
