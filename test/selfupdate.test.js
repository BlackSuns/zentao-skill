import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  compareVersions,
  detectInstallSource,
  installCommandFor,
  manualGuidance,
} from "../src/commands/selfupdate.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

test("compareVersions orders release and prerelease versions", () => {
  assert.equal(compareVersions("0.7.0", "0.7.0"), 0);
  assert.equal(compareVersions("0.8.0", "0.7.9"), 1);
  assert.equal(compareVersions("0.7.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
});

test("detectInstallSource only auto-updates confirmed global installs", () => {
  const npmGlobalRoot = "/usr/local/lib/node_modules";
  const pnpmGlobalRoot = "/home/u/.local/share/pnpm/global/5/node_modules";
  const base = { npmGlobalRoot, pnpmGlobalRoot };
  assert.equal(
    detectInstallSource({ ...base, pkgRoot: "/usr/local/lib/node_modules/@leeguoo/zentao-mcp" }),
    "npm"
  );
  assert.equal(
    detectInstallSource({
      ...base,
      pkgRoot: "/home/u/.local/share/pnpm/global/5/.pnpm/@leeguoo+zentao-mcp@0.7.0/node_modules/@leeguoo/zentao-mcp",
    }),
    "pnpm"
  );
  assert.equal(
    detectInstallSource({ ...base, pkgRoot: "/home/u/.npm/_npx/abc/node_modules/@leeguoo/zentao-mcp" }),
    "npx"
  );
  assert.equal(detectInstallSource({ ...base, pkgRoot: "/home/u/src/zentao-mcp", hasGit: true }), "source");
  assert.equal(
    detectInstallSource({ ...base, pkgRoot: "/home/u/project/node_modules/@leeguoo/zentao-mcp" }),
    "unknown"
  );
});

test("detectInstallSource tolerates npm's *** redaction in the global root", () => {
  assert.equal(
    detectInstallSource({
      npmGlobalRoot: "/tmp/***/prefix/lib/node_modules",
      pkgRoot: "/tmp/0f1e2d3c-aaaa-bbbb-cccc-123456789abc/prefix/lib/node_modules/@leeguoo/zentao-mcp",
    }),
    "npm"
  );
  assert.equal(
    detectInstallSource({
      npmGlobalRoot: "/tmp/***/prefix/lib/node_modules",
      pkgRoot: "/tmp/x/other/lib/node_modules/@leeguoo/zentao-mcp",
    }),
    "unknown"
  );
});

test("installCommandFor never targets unknown installs", () => {
  assert.deepEqual(installCommandFor("npm", "0.8.0"), {
    cmd: "npm",
    args: ["install", "-g", "@leeguoo/zentao-mcp@0.8.0"],
  });
  assert.deepEqual(installCommandFor("pnpm", "0.8.0"), {
    cmd: "pnpm",
    args: ["add", "-g", "@leeguoo/zentao-mcp@0.8.0"],
  });
  assert.equal(installCommandFor("npx", "0.8.0"), null);
  assert.equal(installCommandFor("unknown", "0.8.0"), null);
  assert.match(manualGuidance("unknown", "0.8.0"), /left untouched/);
});

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withRegistry(versions, fn) {
  const server = http.createServer((req, res) => {
    const tag = decodeURIComponent(req.url.split("/").pop());
    const version = tag === "latest" ? versions.latest : versions.known.includes(tag) ? tag : null;
    if (!version) {
      res.writeHead(404).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("self-update --check --json reports versions without installing", async () => {
  await withRegistry({ latest: "99.0.0", known: ["99.0.0"] }, async (registry) => {
    const res = await runCli(["self-update", "--check", "--json"], {
      ZENTAO_UPDATE_REGISTRY: registry,
      ZENTAO_UPDATE_SOURCE: "npm",
    });
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.target, "99.0.0");
    assert.equal(out.result, "update-available");
    assert.equal(out.command, "npm install -g @leeguoo/zentao-mcp@99.0.0");
    assert.equal(out.configPreserved, true);
  });
});

test("self-update refuses to install without --yes when there is no TTY", async () => {
  await withRegistry({ latest: "99.0.0", known: ["99.0.0"] }, async (registry) => {
    const res = await runCli(["self-update"], {
      ZENTAO_UPDATE_REGISTRY: registry,
      ZENTAO_UPDATE_SOURCE: "npm",
    });
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--yes/);
  });
});

test("self-update --to rejects versions missing from the registry", async () => {
  await withRegistry({ latest: "99.0.0", known: ["99.0.0"] }, async (registry) => {
    const res = await runCli(["self-update", "--to", "1.2.3", "--check"], {
      ZENTAO_UPDATE_REGISTRY: registry,
      ZENTAO_UPDATE_SOURCE: "npm",
    });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /does not exist/);
  });
});

test("self-update gives manual guidance for unknown installs", async () => {
  await withRegistry({ latest: "99.0.0", known: ["99.0.0"] }, async (registry) => {
    const res = await runCli(["self-update", "--yes", "--json"], {
      ZENTAO_UPDATE_REGISTRY: registry,
      ZENTAO_UPDATE_SOURCE: "unknown",
    });
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.result, "manual");
    assert.equal(out.command, null);
  });
});

test("--version prints the package version", async () => {
  const res = await runCli(["--version"], {});
  assert.equal(res.code, 0);
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+/);
});
