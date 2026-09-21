import type { Hono } from "hono";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import pkg from "../package.json" with { type: "json" };

// Computed once at process start (i.e. effectively at each deploy restart),
// not per-request — git metadata and package.json don't change while the
// process is running. Format: <major.minor from package.json>.<YYYYMMDD>.<short sha>
//
// The deploy script writes .deploy-sha (gitignored) right after syncing to
// the deployed commit; prefer that over shelling out to git here, since the
// running process's environment (systemd, its own user/PATH/HOME) isn't
// guaranteed to be able to invoke git the way an interactive deploy shell
// can - hit exactly that in production (git rev-parse silently failing at
// runtime while working fine over SSH).
function resolveSha(): string {
  const deployedShaFile = new URL("../.deploy-sha", import.meta.url);
  try {
    if (existsSync(deployedShaFile)) {
      return readFileSync(deployedShaFile, "utf-8").trim();
    }
  } catch {
    // Fall through to git.
  }
  try {
    return execSync("git rev-parse --short HEAD", { cwd: import.meta.dir }).toString().trim();
  } catch {
    return "unknown";
  }
}

function computeVersion(): string {
  const sha = resolveSha();
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
