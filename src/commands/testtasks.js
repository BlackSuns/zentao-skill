import process from "node:process";
import { extractCommand, hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { createClientFromCli } from "../zentao/client.js";
import { listTesttasks, getTesttask, searchTesttasks } from "../zentao/testtasks.js";

function printHelp() {
  process.stdout.write(`zentao testtasks <subcommand>\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  zentao testtasks list [--keyword "name"] [--product <id>] [--status wait|doing|blocked|done] [--owner account] [--json]\n`);
  process.stdout.write(`  zentao testtasks list --page N --limit N [--json]     raw REST page, no filtering\n`);
  process.stdout.write(`  zentao testtasks get --id <id> [--json]\n`);
  process.stdout.write(`\nTo view cases of one test task and record results, use: zentao testtask --help\n`);
}

const hasValue = (v) => v !== undefined && v !== null && v !== true && v !== "";

export function formatTesttasksSimple(testtasks) {
  const rows = [];
  rows.push(["id", "name", "product", "build", "status", "owner", "begin", "end"].join("\t"));
  for (const tt of testtasks) {
    rows.push(
      [
        String(tt?.id ?? ""),
        String(tt?.name ?? ""),
        String(tt?.productName ?? tt?.product ?? ""),
        String(tt?.buildName || tt?.build || ""),
        String(tt?.status ?? ""),
        typeof tt?.owner === "object" ? String(tt?.owner?.account ?? "") : String(tt?.owner ?? ""),
        String(tt?.begin ?? ""),
        String(tt?.end ?? ""),
      ].join("\t")
    );
  }
  return `${rows.join("\n")}\n`;
}

export async function runTesttasks({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  const { command: sub, argv: argvWithoutSub } = extractCommand(argv);
  const cliArgs = parseCliArgs(argvWithoutSub);
  const api = createClientFromCli({ argv: argvWithoutSub, env });

  if (sub === "list") {
    const filtered = ["keyword", "name", "product", "status", "owner"].some((k) => hasValue(cliArgs[k]));
    if (filtered) {
      const result = await searchTesttasks(api, {
        keyword: cliArgs.keyword ?? cliArgs.name,
        product: cliArgs.product,
        status: cliArgs.status,
        owner: cliArgs.owner,
      });
      const limit = Number(cliArgs.limit) > 0 ? Number(cliArgs.limit) : 0;
      const testtasks = result?.result?.testtasks || [];
      const shown = limit ? testtasks.slice(0, limit) : testtasks;
      if (cliArgs.json) {
        const payload = result.status === 1 ? { ...result, result: { ...result.result, testtasks: shown } } : result;
        const pretty = JSON.stringify(payload, null, 2);
        process.stdout.write(`${pretty.length > 20000 ? JSON.stringify(payload) : pretty}\n`);
        return;
      }
      process.stdout.write(formatTesttasksSimple(shown));
      return;
    }
    const result = await listTesttasks(api, {
      page: cliArgs.page,
      limit: cliArgs.limit,
    });

    if (cliArgs.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const testtasks = result?.result?.testtasks;
    if (!Array.isArray(testtasks)) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(formatTesttasksSimple(testtasks));
    return;
  }

  if (sub === "get") {
    const id = cliArgs.id;
    if (!id) throw new Error("Missing --id");
    const result = await getTesttask(api, { id });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown testtasks subcommand: ${sub || "(missing)"}`);
}
