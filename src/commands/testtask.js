import process from "node:process";
import { decodeEscapedNewlines, extractCommand, hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { createClientFromCli } from "../zentao/client.js";
import {
  resolveTesttask,
  listTesttaskCases,
  getTesttaskRun,
  resolveRunId,
  runTesttaskCase,
  fetchTesttaskRuns,
  countResults,
} from "../zentao/testtasks.js";

function printHelp() {
  process.stdout.write(`zentao testtask - view a test task (测试单) and record case results\n\n`);
  process.stdout.write(`Select the test task with --id <id|url> or --name <name> [--product <id>].\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  zentao testtask get   (--id <id|url> | --name <name>) [--json]\n`);
  process.stdout.write(`  zentao testtask cases (--id <id|url> | --name <name>) [--result unrun|pass|fail|blocked|n/a|done|all]\n`);
  process.stdout.write(`                        [--keyword "text"] [--pri 1,2] [--case 61604,61606] [--assigned-to account]\n`);
  process.stdout.write(`                        [--runner account] [--limit N] [--json]\n`);
  process.stdout.write(`  zentao testtask case  (--run <runId> | --case <caseId> --id <id>) [--history] [--json]\n`);
  process.stdout.write(`  zentao testtask run   (--run <runId>[,<runId>...] | --case <caseId> --id <id>) --result pass|fail|blocked|n/a\n`);
  process.stdout.write(`                        [--real "actual result"] [--json]\n\n`);
  process.stdout.write(`Notes:\n`);
  process.stdout.write(`  --result in "cases" filters by last run result; several values can be comma separated.\n`);
  process.stdout.write(`  "unrun" = never executed, "done" = executed with any result.\n`);
  process.stdout.write(`  --keyword matches title, precondition, keywords and story title; space separated words must all match.\n`);
  process.stdout.write(`  "run" requires --real for fail/blocked and reads the run back to confirm the result was recorded.\n`);
}

function writeJson(value) {
  const pretty = JSON.stringify(value, null, 2);
  // 大列表用单行 JSON，避免撑爆 AI 工具输出上限
  process.stdout.write(`${pretty.length > 20000 ? JSON.stringify(value) : pretty}\n`);
}

function fail(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function clean(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

export function formatSummaryLine(summary) {
  const parts = [`total ${summary.total}`, `unrun ${summary.unrun}`, `pass ${summary.pass}`, `fail ${summary.fail}`, `blocked ${summary.blocked}`];
  if (summary["n/a"]) parts.push(`n/a ${summary["n/a"]}`);
  return parts.join(" | ");
}

export function formatTesttaskHeader(testtask, summary) {
  const rows = [];
  rows.push(`testtask\t#${testtask.id} ${testtask.name}`);
  const where = [testtask.productName, testtask.executionName].filter(Boolean).join(" / ");
  if (where) rows.push(`product\t${where}`);
  if (testtask.buildName) rows.push(`build\t${testtask.buildName}`);
  rows.push(`status\t${testtask.status}${testtask.owner ? `  owner ${testtask.owner}` : ""}${testtask.begin ? `  ${testtask.begin} ~ ${testtask.end}` : ""}`);
  if (summary) rows.push(`cases\t${formatSummaryLine(summary)}`);
  return `${rows.join("\n")}\n`;
}

export function formatRunsSimple(runs) {
  const rows = [["run", "case", "pri", "result", "lastRunner", "lastRunDate", "title"].join("\t")];
  for (const run of runs) {
    rows.push(
      [run.run, run.case, run.pri, run.result, run.lastRunner, run.lastRunDate, clean(run.title)].join("\t")
    );
  }
  return `${rows.join("\n")}\n`;
}

export function formatRunDetail(run) {
  const rows = [];
  rows.push(`run\t${run.run}`);
  rows.push(`case\t${run.case} (version ${run.version}${run.currentVersion && run.currentVersion !== run.version ? `, latest ${run.currentVersion}` : ""})`);
  rows.push(`title\t${clean(run.title)}`);
  rows.push(`pri\t${run.pri}`);
  if (run.precondition) rows.push(`precondition\t${clean(run.precondition)}`);
  if (run.keywords) rows.push(`keywords\t${clean(run.keywords)}`);
  rows.push(`result\t${run.result}${run.lastRunner ? `  by ${run.lastRunner}` : ""}${run.lastRunDate ? `  at ${run.lastRunDate}` : ""}`);
  if (run.steps?.length) {
    rows.push("");
    rows.push(["step", "type", "desc", "expect"].join("\t"));
    run.steps.forEach((step, index) => {
      rows.push([index + 1, step.type, clean(step.desc), clean(step.expect)].join("\t"));
    });
  } else {
    rows.push(`steps\t(none, the title is the test step)`);
  }
  if (Array.isArray(run.history)) {
    rows.push("");
    rows.push(["history", "result", "runner", "date", "real"].join("\t"));
    for (const item of run.history) {
      rows.push([item.id, item.result, item.runner, item.date, clean(item.real)].join("\t"));
    }
  }
  return `${rows.join("\n")}\n`;
}

function selector(cliArgs) {
  return { id: cliArgs.id, name: cliArgs.name, product: cliArgs.product };
}

// 列表 JSON 默认只留执行用例所需字段，空值省略，避免大测试单的输出被 AI 工具外置；--full 返回全部字段。
export function compactRun(run) {
  const out = { run: run.run, case: run.case, title: run.title, pri: run.pri, result: run.result };
  if (run.precondition && run.precondition !== "无") out.precondition = run.precondition;
  if (run.lastRunner) out.lastRunner = run.lastRunner;
  if (run.lastRunDate) out.lastRunDate = run.lastRunDate;
  if (run.assignedTo) out.assignedTo = run.assignedTo;
  if (run.stepNumber) out.steps = run.stepNumber;
  if (run.bugs) out.bugs = run.bugs;
  return out;
}

export async function runTesttask({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  const { command: sub, argv: argvWithoutSub } = extractCommand(argv);
  const cliArgs = parseCliArgs(argvWithoutSub);
  if (!sub) {
    printHelp();
    return;
  }
  const api = createClientFromCli({ argv: argvWithoutSub, env });

  if (sub === "get") {
    const resolved = await resolveTesttask(api, selector(cliArgs));
    if (resolved.status !== 1) {
      if (cliArgs.json) return writeJson(resolved);
      throw fail(formatResolveError(resolved));
    }
    const fetched = await fetchTesttaskRuns(api, { taskId: resolved.result.id });
    if (fetched.error) throw fail(fetched.error);
    const summary = countResults(fetched.runs);
    if (cliArgs.json) return writeJson({ status: 1, msg: "success", result: { ...resolved.result, summary } });
    process.stdout.write(formatTesttaskHeader(resolved.result, summary));
    return;
  }

  if (sub === "cases") {
    const result = await listTesttaskCases(api, {
      ...selector(cliArgs),
      result: cliArgs.result ?? cliArgs.status,
      keyword: cliArgs.keyword,
      pri: cliArgs.pri,
      cases: cliArgs.case ?? cliArgs.cases,
      assignedTo: cliArgs["assigned-to"],
      runner: cliArgs.runner,
    });
    if (result.status !== 1) {
      if (cliArgs.json) return writeJson(result);
      throw fail(formatResolveError(result));
    }

    const limit = Number(cliArgs.limit) > 0 ? Number(cliArgs.limit) : 0;
    const runs = limit ? result.result.runs.slice(0, limit) : result.result.runs;

    if (cliArgs.json) {
      const items = cliArgs.full ? runs : runs.map(compactRun);
      return writeJson({ ...result, result: { ...result.result, shown: runs.length, runs: items } });
    }

    process.stdout.write(formatTesttaskHeader(result.result.testtask, result.result.summary));
    process.stdout.write(`matched\t${result.result.matched}${limit && result.result.matched > runs.length ? ` (showing ${runs.length})` : ""}\n\n`);
    process.stdout.write(formatRunsSimple(runs));
    return;
  }

  if (sub === "case") {
    const target = await resolveRunId(api, { ...selector(cliArgs), run: cliArgs.run, caseId: cliArgs.case });
    if (target.error) throw fail(target.error);
    const result = await getTesttaskRun(api, { run: target.runId, history: Boolean(cliArgs.history) });
    if (cliArgs.json) return writeJson(result);
    if (result.status !== 1) throw fail(result.msg);
    process.stdout.write(formatRunDetail(result.result));
    return;
  }

  if (sub === "run") {
    if (!cliArgs.result || cliArgs.result === true) throw fail("Missing --result pass|fail|blocked|n/a");
    const real = cliArgs.real && cliArgs.real !== true ? decodeEscapedNewlines(String(cliArgs.real)) : "";

    let runIds = [];
    if (cliArgs.run && cliArgs.run !== true) {
      runIds = String(cliArgs.run)
        .split(/[,\s]+/)
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (!runIds.length) throw fail(`Invalid --run "${cliArgs.run}"`);
    } else {
      const target = await resolveRunId(api, { ...selector(cliArgs), caseId: cliArgs.case });
      if (target.error) throw fail(target.error);
      runIds = [target.runId];
    }

    const outcomes = [];
    for (const runId of runIds) {
      const outcome = await runTesttaskCase(api, { run: runId, result: cliArgs.result, real });
      outcomes.push({ run: runId, ...outcome });
      if (!cliArgs.json) {
        if (outcome.status === 1) {
          const r = outcome.result;
          process.stdout.write(`ok\trun ${r.run}\tcase ${r.case}\t${r.before} -> ${r.after}\t${clean(r.title)}\n`);
        } else {
          process.stdout.write(`failed\trun ${runId}\t${outcome.msg}\n`);
        }
      }
    }

    const failed = outcomes.filter((o) => o.status !== 1);
    if (cliArgs.json) {
      writeJson(
        runIds.length === 1
          ? outcomes[0]
          : { status: failed.length ? 0 : 1, msg: failed.length ? `${failed.length} of ${outcomes.length} failed` : "success", result: outcomes }
      );
    }
    if (failed.length) {
      const error = fail(`${failed.length} of ${outcomes.length} result(s) were not recorded`);
      error.silent = !cliArgs.json ? false : true;
      throw error;
    }
    return;
  }

  throw fail(`Unknown testtask subcommand: ${sub}`);
}

function formatResolveError(result) {
  const candidates = result?.result?.candidates;
  if (Array.isArray(candidates) && candidates.length) {
    const lines = candidates.map((t) => `  #${t.id}\t${t.status}\t${t.productName}\t${t.name}`);
    return `${result.msg}\n${lines.join("\n")}`;
  }
  return result?.msg || "error";
}
