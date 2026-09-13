import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "rig-agent-harness";
const FALLBACK_VERSION = "0.0.0";

/**
 * Resolve the CLI version from the nearest `package.json`.
 *
 * RIG is bundled to `dist/cli/index.js` and can be executed from any working
 * directory, so we walk up from this module's own location rather than relying
 * on `process.cwd()`.
 */
function resolveVersion(): string {
  try {
    let directory = path.dirname(fileURLToPath(import.meta.url));

    for (let depth = 0; depth < 6; depth++) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string") return pkg.version;
      } catch {
        // No package.json here (or unreadable) — keep walking up.
      }

      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // Fall through to the fallback below.
  }

  return FALLBACK_VERSION;
}

export const VERSION = resolveVersion();
