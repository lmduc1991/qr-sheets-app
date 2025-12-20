// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // dev server (npm run dev)
  server: {
    host: "0.0.0.0",
    port: 5173,
  },

  // preview server (npm run preview)
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: [
      "caustical-once-lena.ngrok-free.dev", // 👈 your current ngrok host
    ],
  },
});
