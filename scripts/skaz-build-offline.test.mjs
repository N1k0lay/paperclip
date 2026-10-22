import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";

const script = fileURLToPath(new URL("./skaz-build-offline.sh", import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "skaz-offline-"));
  for (const directory of ["bin", "scripts", "docker", "docs/deploy"]) mkdirSync(path.join(root, directory), { recursive: true });
  copyFileSync(script, path.join(root, "scripts/skaz-build-offline.sh"));
  writeFileSync(path.join(root, "docker/Dockerfile.skaz"), "FROM scratch\n");
  writeFileSync(path.join(root, "docker/compose.skaz.yml"), "services: {}\n");
  writeFileSync(path.join(root, "docker/compose.skaz.postgres.yml"), "services: {}\n");
  writeFileSync(path.join(root, "docker/skaz.env.example"), "BETTER_AUTH_SECRET=\n");
  writeFileSync(path.join(root, "docs/deploy/skaz-docker.ru.md"), "# Установка Сказа\n");
  writeFileSync(path.join(root, "skaz.env"), "SECRET=must-never-be-packaged\n");
  writeFileSync(path.join(root, ".env"), "SECRET=must-never-be-packaged\n");
  writeFileSync(path.join(root, "bin/git"), `#!/usr/bin/env node
process.stdout.write(process.argv.includes("rev-parse") ? "${"a".repeat(40)}\\n" : " M app.ts\\n");
`);
  writeFileSync(path.join(root, "bin/docker"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_CALL_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "image" && args[1] === "inspect") {
  process.stdout.write(JSON.stringify({ Id: "sha256:fixture", id: "sha256:fixture", os: "linux", architecture: process.env.STUB_ARCH || "amd64", variant: "", repoDigests: ["fixture@sha256:digest"], Config: { Env: ["SECRET=must-never-be-packaged"] } }));
}
if (args[0] === "save") {
  process.stdout.write("fixture docker archive");
  if (process.env.STUB_FAIL_SAVE === "1") process.exitCode = 9;
}
`);
  for (const command of ["git", "docker"]) chmodSync(path.join(root, "bin", command), 0o755);
  const output = path.join(root, "package");
  const log = path.join(root, "docker-calls.jsonl");
  return {
    root, output,
    run(env = {}) {
      return spawnSync("bash", [path.join(root, "scripts/skaz-build-offline.sh"), output], {
        cwd: root, encoding: "utf8", timeout: 15_000,
        env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, DOCKER_CALL_LOG: log, HTTP_PROXY: "must-never-be-packaged", ...env },
      });
    },
    calls() { return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []; },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test("builds, verifies, exports app and optional PostgreSQL without packaging credentials", () => {
  const f = fixture();
  try {
    const result = f.run({ INCLUDE_POSTGRES: "1", SKAZ_BUILD_NETWORK: "host" });
    assert.equal(result.status, 0, result.stderr);
    const calls = f.calls();
    assert.deepEqual(calls.map((args) => args[0]), ["build", "image", "pull", "image", "save"]);
    assert.ok(calls[0].includes("linux/amd64"));
    assert.ok(calls[0].includes("docker/Dockerfile.skaz"));
    assert.ok(calls[0].includes("host"));
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
      assert.ok(calls[0].some((arg, index) => arg === "--build-arg" && calls[0][index + 1] === name));
    }
    assert.deepEqual(calls.at(-1), ["save", "skaz:local", "postgres:16-alpine"]);
    assert.equal(gunzipSync(readFileSync(path.join(f.output, "images.tar.gz"))).toString(), "fixture docker archive");
    const files = readdirSync(f.output).sort();
    assert.deepEqual(files, ["README.md", "SHA256SUMS", "compose.skaz.postgres.yml", "compose.skaz.yml", "images.tar.gz", "manifest.json", "skaz.env.example"]);
    for (const file of files) assert.ok(!readFileSync(path.join(f.output, file)).includes(Buffer.from("must-never-be-packaged")), file);
    const manifest = JSON.parse(readFileSync(path.join(f.output, "manifest.json")));
    assert.equal(manifest.gitBaseCommit, "a".repeat(40));
    assert.equal(manifest.dirty, true);
    assert.equal(manifest.buildSkipped, false);
    assert.equal(manifest.images.length, 2);
    assert.deepEqual(manifest.images[0], { reference: "skaz:local", id: "sha256:fixture", os: "linux", architecture: "amd64", variant: "", repoDigests: ["fixture@sha256:digest"] });
    for (const line of readFileSync(path.join(f.output, "SHA256SUMS"), "utf8").trim().split("\n")) {
      const [, digest, filename] = /^(\S+)\s+(.+)$/.exec(line);
      assert.equal(createHash("sha256").update(readFileSync(path.join(f.output, filename))).digest("hex"), digest);
    }
  } finally { f.cleanup(); }
});

test("skip-build still inspects platform and labels checkout metadata as packaging provenance", () => {
  const f = fixture();
  try {
    const result = f.run({ SKAZ_SKIP_BUILD: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls().map((args) => args[0]), ["image", "save"]);
    const manifest = JSON.parse(readFileSync(path.join(f.output, "manifest.json")));
    assert.equal(manifest.buildSkipped, true);
    assert.match(manifest.sourceNote, /not.*image|не.*образ/i);
  } finally { f.cleanup(); }
});

test("wrong image architecture stops before export and removes temporary package", () => {
  const f = fixture();
  try {
    const result = f.run({ SKAZ_SKIP_BUILD: "1", STUB_ARCH: "arm64" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.calls().map((args) => args[0]), ["image"]);
    assert.equal(existsSync(f.output), false);
    assert.equal(readdirSync(f.root).some((name) => name.startsWith(".skaz-offline-package.")), false);
  } finally { f.cleanup(); }
});

test("failed docker save removes partial output without deleting any Docker resources", () => {
  const f = fixture();
  try {
    const result = f.run({ STUB_FAIL_SAVE: "1" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.output), false);
    assert.equal(readdirSync(f.root).some((name) => name.startsWith(".skaz-offline-package.")), false);
    assert.deepEqual(f.calls().map((args) => args[0]), ["build", "image", "save"]);
  } finally { f.cleanup(); }
});

test("refuses an existing output before Docker runs and preserves its contents", () => {
  const f = fixture();
  try {
    mkdirSync(f.output);
    writeFileSync(path.join(f.output, "keep.txt"), "existing delivery");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.calls(), []);
    assert.equal(readFileSync(path.join(f.output, "keep.txt"), "utf8"), "existing delivery");
  } finally { f.cleanup(); }
});
