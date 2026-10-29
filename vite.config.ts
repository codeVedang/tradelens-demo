import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwind()],
    server: {
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${Number(env.PORT) || 3001}` },
    },
    build: {
      rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
    },
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      environment: "node",
      maxWorkers: 1,
    },
  };
});
