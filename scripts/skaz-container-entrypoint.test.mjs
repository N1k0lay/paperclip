import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const required = {
  DATABASE_URL: "postgres://fixture:fixture@db/skaz",
  BETTER_AUTH_SECRET: "auth-fixture",
  PAPERCLIP_AGENT_JWT_SECRET: "jwt-fixture",
  PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "action-fixture",
};
const entrypoint = new URL("./skaz-container-entrypoint.sh", import.meta.url);

test("container startup rejects missing configuration before starting the app without logging values", () => {
  for (const name of Object.keys(required)) {
    const env = { ...required, PATH: process.env.PATH };
    delete env[name];
    const result = spawnSync("sh", [entrypoint.pathname], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(name));
    for (const value of Object.values(required)) assert.ok(!result.stderr.includes(value));
  }
});

test("configured startup delegates to the existing permission entrypoint with exact arguments", () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "skaz-entrypoint-"));
  try {
    writeFileSync(path.join(bin, "docker-entrypoint.sh"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const env = { ...required, PATH: `${bin}:${process.env.PATH}` };
    const args = [entrypoint.pathname, "node", "server/dist-runtime/index.mjs", "argument with spaces"];
    const result = spawnSync("sh", args, { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "node\nserver/dist-runtime/index.mjs\nargument with spaces\n");
    const incompleteMinio = spawnSync("sh", args, { encoding: "utf8", env: { ...env, PAPERCLIP_STORAGE_PROVIDER: "s3" } });
    assert.equal(incompleteMinio.status, 1);
    assert.ok(incompleteMinio.stderr.includes("PAPERCLIP_STORAGE_S3_ENDPOINT"));
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
