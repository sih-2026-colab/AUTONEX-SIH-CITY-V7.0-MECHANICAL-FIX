import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false, // fall back to 5174 automatically if 5173 is busy
    hmr: {
      // Always match HMR client port to the actual server port,
      // preventing the "RefreshRuntime.getRefreshReg is not a function" mismatch.
      protocol: "ws",
    },
  },
});
