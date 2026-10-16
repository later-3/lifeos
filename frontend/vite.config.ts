import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 后端地址：默认 43120；调试别的端口时用 VITE_DEV_API=http://127.0.0.1:43121 pnpm dev:web
    proxy: { "/api": process.env.VITE_DEV_API ?? "http://127.0.0.1:43120" },
  },
});
