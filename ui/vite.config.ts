import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Trace's server (npm start, port 4317) serves the built app from ui/dist and owns /api, /files and /mcp.
// In development, Vite serves the app and passes those through to it.
const TRACE = process.env.TRACE_URL || "http://127.0.0.1:4317"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5317,
    proxy: { "/api": TRACE, "/files": TRACE, "/mcp": TRACE, "/vendor": TRACE },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
})
