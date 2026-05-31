import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: base must match your GitHub repo name.
// If your repo is github.com/USER/coinquest  -> base = "/coinquest/"
// If you use a user/org page (USER.github.io)  -> base = "/"
export default defineConfig({
  plugins: [react()],
  base: "/coinquest/",
});
