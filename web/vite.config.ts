import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Studio server (pg-explain studio) defaults to port 5177; dev proxies /api there.
const API_TARGET = process.env.PGX_API ?? "http://127.0.0.1:5177";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Built UI ships inside the npm package and is served by the Hono server.
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
});
