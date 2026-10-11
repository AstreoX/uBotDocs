// Runs the Astro CLI with telemetry disabled, on every OS (npm scripts cannot set env vars portably).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("astro")), "..", "bin", "astro.mjs");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
});
// Pass termination on, so stopping this wrapper also stops the dev or preview server.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
