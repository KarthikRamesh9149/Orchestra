import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createViteNoticePlugin } from "../../scripts/desktop/build-notices.mjs";

export default defineConfig({
  plugins: [react(), createViteNoticePlugin({root: fileURLToPath(new URL("../../", import.meta.url))})]
});
