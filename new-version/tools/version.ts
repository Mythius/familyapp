import type { Hono } from "hono";
import { execSync } from "child_process";
import pkg from "../package.json" with { type: "json" };

// Computed once at process start (i.e. effectively at each deploy restart),
// not per-request — git metadata and package.json don't change while the
// process is running. Format: <major.minor from package.json>.<YYYYMMDD>.<short sha>
function computeVersion(): string {
  let sha = "unknown";
  try {
    sha = execSync("git rev-parse --short HEAD", { cwd: import.meta.dir }).toString().trim();
  } catch {
    // Not a git checkout (or git unavailable) - fall back rather than fail startup.
  }
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // Only major.minor from package.json - bump that by hand for a real release
  // line; date + sha already pin the exact build.
  const majorMinor = pkg.version.split(".").slice(0, 2).join(".");
  return `${majorMinor}.${date}.${sha}`;
}

export const APP_VERSION = computeVersion();

export function exposeVersion(app: Hono) {
  app.get("/version", (c) => c.json({ version: APP_VERSION }));
}
