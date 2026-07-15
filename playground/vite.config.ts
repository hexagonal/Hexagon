import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // The browser worker consumes the platform-neutral compiler source.
      allow: [".."],
    },
  },
});
