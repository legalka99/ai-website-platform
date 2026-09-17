import { defineConfig } from "vite";
const base =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; font-src 'self'; img-src 'self' data:";
export default defineConfig({
  envDir: false,
  envPrefix: "PUBLIC_",
  esbuild: { jsx: "automatic" },
  server: {
    host: "localhost",
    port: 3000,
    strictPort: true,
    allowedHosts: ["localhost"],
    headers: {
      "Content-Security-Policy":
        base +
        "; style-src 'self'; connect-src 'self' http://localhost:3001 ws://localhost:3000",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
    },
  },
  preview: {
    host: "localhost",
    port: 3000,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        base + "; style-src 'self'; connect-src 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
    },
  },
  build: { sourcemap: false },
});
