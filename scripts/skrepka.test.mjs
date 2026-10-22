import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

for (const installed of [false, true]) {
  test(`local launcher ${installed ? "reuses Pi without npm" : "installs pinned Pi once"}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skrepka-launch-"));
    try {
      mkdirSync(path.join(root, "scripts"));
      mkdirSync(path.join(root, "bin"));
      copyFileSync(new URL("./skrepka.sh", import.meta.url), path.join(root, "scripts/skrepka.sh"));
      const runtime = path.join(root, ".paperclip-local/pi/node_modules/.bin");
      if (installed) {
        mkdirSync(runtime, { recursive: true });
        writeFileSync(path.join(runtime, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      writeFileSync(path.join(root, "bin/npm"), '#!/bin/sh\nprintf "%s\\n" "$@" > npm-args\n', { mode: 0o755 });
      writeFileSync(path.join(root, "bin/node"), '#!/bin/sh\nprintf "%s\\n" "$@" > bootstrap-args\n', { mode: 0o755 });
      writeFileSync(path.join(root, "bin/corepack"), '#!/bin/sh\nif [ "$1" = enable ]; then exit 0; fi\nprintf "%s\\n" "$PAPERCLIP_HOME" "$PAPERCLIP_TELEMETRY_DISABLED" "$PAPERCLIP_ANNOUNCEMENTS_ENABLED" "$PATH" "$@"\n', { mode: 0o755 });
      const { status, stdout, stderr } = spawnSync("/bin/sh", [path.join(root, "scripts/skrepka.sh"), "--port", "3199"], {
        cwd: os.tmpdir(), encoding: "utf8",
        env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, PAPERCLIP_HOME: "", PAPERCLIP_TELEMETRY_DISABLED: "0", PAPERCLIP_ANNOUNCEMENTS_ENABLED: "true" },
      });
      assert.equal(status, 0, stderr);
      assert.ok(stdout.includes(`${root}/.paperclip-local/state\n1\nfalse\n${root}/.paperclip-local/bin:${runtime}:`));
      assert.ok(stdout.endsWith("pnpm\ndev:once\n--port\n3199\n"));
      assert.ok(readFileSync(path.join(root, "bootstrap-args"), "utf8").includes("ensureAgentJwtSecret(); ensureToolActionSigningSecret();"));
      if (!installed) assert.ok(readFileSync(path.join(root, "npm-args"), "utf8").includes("@earendil-works/pi-coding-agent@0.74.0"));
      else assert.throws(() => readFileSync(path.join(root, "npm-args")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
