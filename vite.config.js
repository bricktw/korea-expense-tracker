import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" → 打包後可放在任何子路徑或靜態空間
// server/preview host:true → 同網路下手機可用電腦區網 IP 開啟
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
