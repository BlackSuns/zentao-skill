import process from "node:process";
import { decodeEscapedNewlines, extractCommand, hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { createClientFromCli } from "../zentao/client.js";
import { getTask, createTask, editTask, startTask, finishTask, closeTask, pauseTask } from "../zentao/tasks.js";
import { normalizeDateInput, parseExecutionRef, parseStoryRef, parseTaskRef } from "../zentao/normalize.js";

function printHelp() {
  process.stdout.write(`zentao task - view and manage tasks\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  zentao task get --id <taskId|url> [--json]\n`);
  process.stdout.write(`  zentao task create --execution <id|url> --name "..."\n`);
  process.stdout.write(`                     [--est-started YYYY-MM-DD|today] [--deadline YYYY-MM-DD|today]\n`);
  process.stdout.write(`                     [--story <id|url>] [--assigned-to <account|me>]\n`);
  process.stdout.write(`                     [--pri 1-4] [--estimate N] [--type devel|test|design|...]\n`);
  process.stdout.write(`                     [--desc "..."] [--json]\n`);
  process.stdout.write(`  zentao task edit   --id <taskId|url>\n`);
  process.stdout.write(`                     [--name "..."] [--est-started YYYY-MM-DD|today] [--deadline YYYY-MM-DD|today]\n`);
  process.stdout.write(`                     [--story <id|url>] [--assigned-to <account|me>]\n`);
  process.stdout.write(`                     [--pri 1-4] [--estimate N] [--consumed N] [--left N]\n`);
  process.stdout.write(`                     [--status wait|doing|done|pause|cancel|closed] [--desc "..."] [--comment "..."] [--json]\n`);
  process.stdout.write(`  zentao task start  --id <taskId|url> [--consumed N] [--left N] [--json]\n`);
  process.stdout.write(`  zentao task finish --id <taskId|url> [--finished-date YYYY-MM-DD|today] [--consumed N] [--json]\n`);
  process.stdout.write(`  zentao task close  --id <taskId|url> [--comment "..."] [--json]\n`);
  process.stdout.write(`  zentao task pause  --id <taskId|url> [--json]\n`);
  process.stdout.write(`\nNotes:\n`);
  process.stdout.write(`  --execution and --id accept numeric IDs or ZenTao page URLs (e.g. execution-task-2049.html).\n`);
  process.stdout.write(`  --est-started and --deadline support dates (YYYY-MM-DD) or keywords like "today" / "明天".\n`);
  process.stdout.write(`  --assigned-to supports "me" or "指派给我" to resolve to the current login account.\n`);
}

function formatAccount(value) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return String(value.account || value.name || value.realname || "");
  return "";
}

export function formatTaskSimple(task) {
  const header = [
    "id",
    "name",
    "status",
    "pri",
    "assignedTo",
    "estStarted",
    "deadline",
    "estimate",
    "consumed",
    "left",
    "story",
  ].join("\t");
  const row = [
    String(task?.id ?? ""),
    String(task?.name ?? ""),
    String(task?.status ?? ""),
    String(task?.pri ?? ""),
    formatAccount(task?.assignedTo),
    String(task?.estStarted ?? ""),
    String(task?.deadline ?? ""),
    String(task?.estimate ?? ""),
    String(task?.consumed ?? ""),
    String(task?.left ?? ""),
    task?.story ? `#${task.story}` : "",
  ].join("\t");
  return `${header}\n${row}\n`;
}

function resolveAssignedTo(value, currentAccount) {
  if (value === undefined || value === null || value === true || value === "") return undefined;
  const str = String(value).trim();
  const lower = str.toLowerCase();
  if (lower === "me" || lower === "@me" || lower === "current" || str === "我" || str === "指派给我") {
    return currentAccount || undefined;
  }
  return str;
}

export async function runTask({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  const { command: sub, argv: argvWithoutSub } = extractCommand(argv);
  const cliArgs = parseCliArgs(argvWithoutSub);

  if (sub === "get") {
    return runTaskGet(cliArgs, argvWithoutSub, env);
  }
  if (sub === "create") {
    return runTaskCreate(cliArgs, argvWithoutSub, env);
  }
  if (sub === "edit" || sub === "update") {
    return runTaskEdit(cliArgs, argvWithoutSub, env);
  }
  if (sub === "start") {
    return runTaskStart(cliArgs, argvWithoutSub, env);
  }
  if (sub === "finish") {
    return runTaskFinish(cliArgs, argvWithoutSub, env);
  }
  if (sub === "close") {
    return runTaskClose(cliArgs, argvWithoutSub, env);
  }
  if (sub === "pause") {
    return runTaskPause(cliArgs, argvWithoutSub, env);
  }

  throw new Error(`Unknown task subcommand: ${sub || "(missing)"}`);
}

async function runTaskGet(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const result = await getTask(api, { id });
  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const task = result?.result?.task ?? result?.result;
  if (!task || typeof task !== "object") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatTaskSimple(task));
}

async function runTaskCreate(cliArgs, argv, env) {
  const rawExecution = cliArgs.execution;
  if (!rawExecution) throw new Error("Missing --execution");
  const execution = parseExecutionRef(rawExecution);
  if (!execution) throw new Error(`Invalid --execution "${rawExecution}". Use execution ID or execution page URL.`);
  const name = cliArgs.name;
  if (!name) throw new Error("Missing --name");

  const api = createClientFromCli({ argv, env });
  const rawEstStarted = cliArgs["est-started"] ?? cliArgs.estStarted ?? cliArgs.begin ?? cliArgs.start;
  const estStarted = rawEstStarted ? normalizeDateInput(rawEstStarted) : undefined;
  const rawDeadline = cliArgs.deadline ?? cliArgs.end ?? cliArgs["est-finished"] ?? cliArgs.estFinished;
  const deadline = rawDeadline ? normalizeDateInput(rawDeadline) : undefined;
  const rawStory = cliArgs.story ?? cliArgs["story-id"] ?? cliArgs.storyId;
  const story = rawStory ? parseStoryRef(rawStory) : undefined;
  if (rawStory && !story) throw new Error(`Invalid --story "${rawStory}". Use story ID or URL.`);

  const rawAssignedTo = cliArgs["assigned-to"] ?? cliArgs.assignedTo;
  const assignedTo = resolveAssignedTo(rawAssignedTo, api.account);
  const rawEstimate = cliArgs.estimate ?? cliArgs.est ?? cliArgs.hours;
  const estimate = rawEstimate !== undefined && rawEstimate !== null && rawEstimate !== "" ? Number(rawEstimate) : undefined;

  const result = await createTask(api, {
    execution,
    name,
    assignedTo,
    pri: cliArgs.pri !== undefined ? Number(cliArgs.pri) : 3,
    estimate,
    type: cliArgs.type ? String(cliArgs.type) : "devel",
    desc: decodeEscapedNewlines(cliArgs.desc),
    estStarted,
    deadline,
    story,
  });

  if (result.status !== 1) {
    if (cliArgs.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      const err = new Error(result.msg);
      err.silent = true;
      err.exitCode = 1;
      throw err;
    }
    let hint = "";
    if (String(result.msg || "").includes("相关研发需求") && !story) {
      hint = `\nHint: This execution requires tasks to be linked to a story; pass --story <storyId>.`;
    }
    const err = new Error(`Failed to create task: ${result.msg}${hint}`);
    err.exitCode = 1;
    throw err;
  }

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const task = result.result;
  const baseUrl = api.baseUrl?.replace(/\/+$/, "") || "";
  const taskUrl = baseUrl ? `${baseUrl}/task-view-${task.id}.html` : "";
  const details = [];
  if (task.execution) details.push(`execution: #${task.execution}${task.executionName ? ` (${task.executionName})` : ""}`);
  if (task.assignedTo) details.push(`assignedTo: ${formatAccount(task.assignedTo)}`);
  if (task.estStarted) details.push(`estStarted: ${task.estStarted}`);
  if (task.deadline) details.push(`deadline: ${task.deadline}`);
  if (task.story) details.push(`story: #${task.story}${task.storyTitle ? ` (${task.storyTitle})` : ""}`);
  if (task.estimate !== undefined) details.push(`estimate: ${task.estimate}h`);
  if (task.type) details.push(`type: ${task.type}`);
  if (task.pri !== undefined) details.push(`pri: ${task.pri}`);

  process.stdout.write(`Task #${task.id} created: ${task.name}\n`);
  if (details.length) {
    process.stdout.write(`  ${details.join(" | ")}\n`);
  }
  if (taskUrl) {
    process.stdout.write(`  url: ${taskUrl}\n`);
  }
}

async function runTaskEdit(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const rawEstStarted = cliArgs["est-started"] ?? cliArgs.estStarted ?? cliArgs.begin ?? cliArgs.start;
  const estStarted = rawEstStarted ? normalizeDateInput(rawEstStarted) : undefined;
  const rawDeadline = cliArgs.deadline ?? cliArgs.end ?? cliArgs["est-finished"] ?? cliArgs.estFinished;
  const deadline = rawDeadline ? normalizeDateInput(rawDeadline) : undefined;
  const rawStory = cliArgs.story ?? cliArgs["story-id"] ?? cliArgs.storyId;
  const story = rawStory ? parseStoryRef(rawStory) : undefined;
  if (rawStory && !story) throw new Error(`Invalid --story "${rawStory}". Use story ID or URL.`);

  const rawAssignedTo = cliArgs["assigned-to"] ?? cliArgs.assignedTo;
  const assignedTo = rawAssignedTo !== undefined ? resolveAssignedTo(rawAssignedTo, api.account) : undefined;
  const rawExecution = cliArgs.execution;
  const execution = rawExecution ? parseExecutionRef(rawExecution) : undefined;
  const rawEstimate = cliArgs.estimate ?? cliArgs.est ?? cliArgs.hours;
  const estimate = rawEstimate !== undefined && rawEstimate !== null && rawEstimate !== "" ? Number(rawEstimate) : undefined;

  const result = await editTask(api, {
    id,
    name: cliArgs.name,
    execution,
    type: cliArgs.type,
    status: cliArgs.status,
    assignedTo,
    pri: cliArgs.pri !== undefined ? Number(cliArgs.pri) : undefined,
    estimate,
    consumed: cliArgs.consumed !== undefined ? Number(cliArgs.consumed) : undefined,
    left: cliArgs.left !== undefined ? Number(cliArgs.left) : undefined,
    desc: cliArgs.desc ? decodeEscapedNewlines(cliArgs.desc) : undefined,
    estStarted,
    deadline,
    story,
    comment: cliArgs.comment ? decodeEscapedNewlines(cliArgs.comment) : undefined,
  });

  if (result.status !== 1) {
    if (cliArgs.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      const err = new Error(result.msg);
      err.silent = true;
      err.exitCode = 1;
      throw err;
    }
    const err = new Error(`Failed to update task #${id}: ${result.msg}`);
    err.exitCode = 1;
    throw err;
  }

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const task = result.result;
  process.stdout.write(`Task #${task.id ?? id} updated: ${task.name || ""}\n`);
  process.stdout.write(formatTaskSimple(task));
}

async function runTaskStart(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const result = await startTask(api, {
    id,
    consumed: cliArgs.consumed,
    left: cliArgs.left,
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const task = result.result;
    process.stdout.write(`Task #${task.id ?? id} started\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runTaskFinish(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const result = await finishTask(api, {
    id,
    finishedDate: cliArgs["finished-date"] ? normalizeDateInput(cliArgs["finished-date"]) || cliArgs["finished-date"] : undefined,
    consumed: cliArgs.consumed,
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const task = result.result;
    process.stdout.write(`Task #${task.id ?? id} finished\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runTaskClose(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const result = await closeTask(api, {
    id,
    comment: decodeEscapedNewlines(cliArgs.comment),
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const task = result.result;
    process.stdout.write(`Task #${task.id ?? id} closed\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runTaskPause(cliArgs, argv, env) {
  const rawId = cliArgs.id;
  if (!rawId) throw new Error("Missing --id");
  const id = parseTaskRef(rawId);
  if (!id) throw new Error(`Invalid --id "${rawId}". Use task ID or URL.`);

  const api = createClientFromCli({ argv, env });
  const result = await pauseTask(api, { id });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const task = result.result;
    process.stdout.write(`Task #${task.id ?? id} paused\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
