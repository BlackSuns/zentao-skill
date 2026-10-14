import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { printSelfUpdateHelp } from "../cli/help.js";

// 给已安装用户用的升级入口，和维护者的 `zentao release` 完全分开：
// 只读 npm registry 的公开元数据、只调用装它的那个包管理器，
// 不登录禅道、不碰 ~/.config/zentao、不发版。

export const PACKAGE_NAME = "@leeguoo/zentao-mcp";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const SKILL_UPDATE_COMMAND = "npx skills add BlackSuns/zentao-skill -y -g";
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function packageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

export function readInstalledVersion(root = packageRoot()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return String(pkg.version || "0.0.0");
}

export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ""] = String(v).split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.nums[i] || 0) - (pb.nums[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

function isInside(child, parent) {
  if (!child || !parent) return false;
  if (parent.includes("***")) {
    // npm 会把路径里像 UUID 的片段打码成 ***，按单段通配处理。
    const sep = path.sep === "\\" ? "[\\\\/]" : "/";
    const pattern = parent
      .split("***")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(`[^${sep === "/" ? "/" : "\\\\/"}]+`);
    return new RegExp(`^${pattern}(?:${sep}|$)`).test(child);
  }
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathOrSelf(p) {
  if (!p) return p;
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// 纯函数：根据包所在路径判断是谁装的。只有确认是 npm / pnpm 全局安装时才自动升级，
// 其余情况一律只给手动指引，避免覆盖不相干的安装。
export function detectInstallSource({ pkgRoot, npmGlobalRoot, pnpmGlobalRoot, hasGit = false }) {
  const normalized = pkgRoot.split(path.sep).join("/");
  if (hasGit) return "source";
  if (/\/_npx\//.test(normalized)) return "npx";
  if (pnpmGlobalRoot) {
    // pnpm 全局目录是 <dir>/node_modules，真实文件在 <dir>/.pnpm/... 下
    const pnpmDir = path.dirname(pnpmGlobalRoot);
    if (isInside(pkgRoot, realpathOrSelf(pnpmDir)) || isInside(pkgRoot, pnpmDir)) return "pnpm";
  }
  if (npmGlobalRoot) {
    if (isInside(pkgRoot, realpathOrSelf(npmGlobalRoot)) || isInside(pkgRoot, npmGlobalRoot)) return "npm";
  }
  return "unknown";
}

export function installCommandFor(source, version) {
  const spec = `${PACKAGE_NAME}@${version}`;
  if (source === "npm") return { cmd: "npm", args: ["install", "-g", spec] };
  if (source === "pnpm") return { cmd: "pnpm", args: ["add", "-g", spec] };
  return null;
}

export function manualGuidance(source, version) {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (source) {
    case "npx":
      return `Running via npx: nothing to update in place. Use \`npx -y ${spec} ...\`.`;
    case "source":
      return "Running from a git checkout: update it with `git pull` in that checkout.";
    default:
      return `Could not tell which package manager installed this copy, so it was left untouched. Update it with the tool you used, e.g. \`npm install -g ${spec}\` or \`pnpm add -g ${spec}\`.`;
  }
}

function spawnTool(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
}

function globalRoot(tool, env) {
  const res = spawnTool(tool, ["root", "-g"], { env, stdio: ["ignore", "pipe", "ignore"] });
  if (res.status !== 0) return null;
  const out = String(res.stdout || "").trim().split(/\r?\n/).pop();
  return out || null;
}

async function fetchRegistryVersion(env, target) {
  const registry = String(env.ZENTAO_UPDATE_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, "");
  const url = `${registry}/${PACKAGE_NAME.replace("/", "%2f")}/${encodeURIComponent(target)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`Could not reach the npm registry (${registry}): ${error?.message || error}`);
  }
  if (res.status === 404) {
    throw new Error(`${PACKAGE_NAME}@${target} does not exist on the npm registry.`);
  }
  if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status} for ${url}`);
  const body = await res.json();
  if (!body?.version || !VERSION_RE.test(String(body.version))) {
    throw new Error(`npm registry returned no usable version for ${PACKAGE_NAME}@${target}`);
  }
  return String(body.version);
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} (y/N) `, resolve));
    return String(answer).trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

function locateGlobalPackage(source, env, pkgRoot) {
  // npm -g 原地覆盖，包目录不变。
  if (source === "npm" && pkgRoot && fs.existsSync(path.join(pkgRoot, "package.json"))) return pkgRoot;
  if (source === "pnpm") {
    // pnpm 11 把每个全局包放在 <root>/<hash>/node_modules 下，用 list 拿真实路径。
    const res = spawnTool("pnpm", ["list", "-g", "--depth", "0", "--json"], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      for (const entry of JSON.parse(String(res.stdout || "[]"))) {
        const dep = entry?.dependencies?.[PACKAGE_NAME];
        if (dep?.path) return dep.path;
        if (entry?.path) {
          const legacy = path.join(entry.path, "node_modules", ...PACKAGE_NAME.split("/"));
          if (fs.existsSync(legacy)) return legacy;
        }
      }
    } catch {
      // fall through
    }
  }
  const root = globalRoot(source, env);
  if (!root || root.includes("***")) return null;
  const dir = path.join(root, ...PACKAGE_NAME.split("/"));
  return fs.existsSync(dir) ? dir : null;
}

// 升级后从全局目录重新找到包，确认版本，并离线跑一次 --help。
function verifyInstalled(source, env, expected, pkgRoot) {
  const dir = locateGlobalPackage(source, env, pkgRoot);
  if (!dir) return { ok: false, reason: `could not locate ${PACKAGE_NAME} in the ${source} global directory` };
  let version;
  try {
    version = readInstalledVersion(dir);
  } catch (error) {
    return { ok: false, reason: `could not read installed package.json: ${error?.message || error}` };
  }
  if (version !== expected) {
    return { ok: false, version, reason: `installed version is ${version}, expected ${expected}` };
  }
  const help = spawnSync(process.execPath, [path.join(dir, "src", "index.js"), "--help"], {
    encoding: "utf8",
    env,
    timeout: 20000,
  });
  if (help.status !== 0 || !/zentao - ZenTao CLI/.test(String(help.stdout || ""))) {
    return { ok: false, version, reason: "the new version's `zentao --help` failed" };
  }
  return { ok: true, version };
}

function emit(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push(`Installed: ${result.current}`);
  if (result.target) lines.push(`Target:    ${result.target}${result.pinned ? " (pinned)" : " (latest)"}`);
  lines.push(`Source:    ${result.source}`);
  lines.push(`Result:    ${result.result}`);
  if (result.message) lines.push("", result.message);
  if (result.command) lines.push("", `Command: ${result.command}`);
  lines.push(
    "",
    `Config and credentials (~/.config/zentao/config.toml) are not touched.`,
    `The agent skill is not updated by this command; refresh it with \`${SKILL_UPDATE_COMMAND}\` (this overwrites local edits to that skill's SKILL.md).`,
    `Note: this package is in maintenance mode. The officially maintained alternative is zentao-cli (https://github.com/easysoft/zentao-cli); self-update never switches to it.`
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function runSelfUpdate({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printSelfUpdateHelp();
    return;
  }
  const cliArgs = parseCliArgs(argv);
  const json = Boolean(cliArgs.json);
  const checkOnly = Boolean(cliArgs.check || cliArgs["dry-run"]);
  const yes = Boolean(cliArgs.yes);
  const pinned = typeof cliArgs.to === "string" ? cliArgs.to.replace(/^v/, "") : null;
  if (cliArgs.to === true) throw new Error("--to needs a version, e.g. --to 0.7.0");
  if (pinned && !VERSION_RE.test(pinned)) throw new Error(`Invalid version: ${cliArgs.to}`);

  const pkgRoot = packageRoot();
  const current = readInstalledVersion(pkgRoot);
  const target = await fetchRegistryVersion(env, pinned || "latest");

  const hasGit = fs.existsSync(path.join(pkgRoot, ".git"));
  let source = env.ZENTAO_UPDATE_SOURCE ? String(env.ZENTAO_UPDATE_SOURCE) : null;
  if (!source) {
    // pnpm 11 的全局包是指向 store 的软链，realpath 落在全局目录外面；
    // 所以同时看一下 node 实际收到的入口路径（未解析软链）。
    const roots = [pkgRoot];
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
    if (path.basename(entry) === "index.js" && path.basename(path.dirname(entry)) === "src") {
      const unresolved = path.dirname(path.dirname(entry));
      if (unresolved !== pkgRoot) roots.push(unresolved);
    }
    const npmGlobalRoot = hasGit ? null : globalRoot("npm", env);
    const pnpmGlobalRoot = hasGit ? null : globalRoot("pnpm", env);
    source = "unknown";
    for (const root of roots) {
      const found = detectInstallSource({ pkgRoot: root, hasGit, npmGlobalRoot, pnpmGlobalRoot });
      if (found !== "unknown") {
        source = found;
        break;
      }
    }
  }

  const install = installCommandFor(source, target);
  const result = {
    package: PACKAGE_NAME,
    current,
    target,
    pinned: Boolean(pinned),
    source,
    command: install ? [install.cmd, ...install.args].join(" ") : null,
    configPreserved: true,
    skillUpdated: false,
    skillUpdateCommand: SKILL_UPDATE_COMMAND,
    result: "",
  };

  if (current === target) {
    result.result = "up-to-date";
    result.command = null;
    emit(result, json);
    return;
  }
  if (!pinned && compareVersions(current, target) > 0) {
    result.result = "up-to-date";
    result.message = `Installed version is newer than the registry's latest (${target}); nothing to do.`;
    result.command = null;
    emit(result, json);
    return;
  }
  if (!install) {
    result.result = "manual";
    result.message = manualGuidance(source, target);
    emit(result, json);
    return;
  }
  if (checkOnly) {
    result.result = "update-available";
    emit(result, json);
    return;
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      const error = new Error(
        `Update ${current} -> ${target} needs confirmation. Re-run with --yes, or use --check to only look.`
      );
      error.exitCode = 2;
      throw error;
    }
    const ok = await confirm(`Update ${PACKAGE_NAME} ${current} -> ${target} with \`${result.command}\`?`);
    if (!ok) {
      result.result = "cancelled";
      emit(result, json);
      return;
    }
  }

  // 包管理器自己会按 registry 里的 sha512 校验下载内容；失败时旧版本保持原样。
  const res = spawnTool(install.cmd, install.args, {
    env,
    stdio: ["ignore", json ? "pipe" : "inherit", json ? "pipe" : "inherit"],
  });
  if (res.status !== 0) {
    result.result = "failed";
    result.message = `\`${result.command}\` exited with ${res.status}; the previous installation (${current}) was left in place.`;
    emit(result, json);
    const error = new Error(result.message);
    error.exitCode = 1;
    error.silent = true;
    throw error;
  }

  const check = verifyInstalled(source, env, target, pkgRoot);
  if (check.ok) {
    result.result = "updated";
    result.installed = check.version;
    emit(result, json);
    return;
  }

  // 装上了但验证不过：回滚到原来的版本。
  const rollback = installCommandFor(source, current);
  const back = spawnTool(rollback.cmd, rollback.args, {
    env,
    stdio: ["ignore", json ? "pipe" : "inherit", json ? "pipe" : "inherit"],
  });
  result.result = back.status === 0 ? "rolled-back" : "failed";
  result.installed = check.version || null;
  result.message =
    back.status === 0
      ? `Post-install check failed (${check.reason}); restored ${current}.`
      : `Post-install check failed (${check.reason}) and restoring ${current} also failed. Run \`${rollback.cmd} ${rollback.args.join(" ")}\` manually.`;
  emit(result, json);
  const error = new Error(result.message);
  error.exitCode = 1;
  error.silent = true;
  throw error;
}
