import { defineConfig } from "vite";

const devConnectSrc =
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*";
const productionConnectSrc = "connect-src 'self'";

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    {
      name: "department-csp-connect-src",
      transformIndexHtml(html) {
        return html.replace("__CSP_CONNECT_SRC__", command === "serve" ? devConnectSrc : productionConnectSrc);
      }
    }
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("node_modules/phaser") ? "phaser" : undefined;
        }
      }
    }
  }
}));
