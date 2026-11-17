import process from "node:process";
import { hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { createClientFromCli } from "../zentao/client.js";
import { searchZentao } from "../zentao/search.js";

function printHelp() {
  process.stdout.write(`zentao search - 全局全文检索（过滤噪音、定位对象）\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(
    `  zentao search <words> [--type <all|task|bug|story|case|testtask|doc|...>] [--page N] [--limit N] [--json]\n`
  );
  process.stdout.write(`  zentao search --words <words> [--type <type>] [--json]\n\n`);
  process.stdout.write(`核心原则（AI 必读）：\n`);
  process.stdout.write(`  没有明确指派时优先使用搜索过滤噪音。\n`);
  process.stdout.write(
    `  当未给出明确 ID、只有关键词或需求标题时，严禁盲目遍历全量列表，必须优先使用 search 定位目标对象。\n\n`
  );
  process.stdout.write(`Options:\n`);
  process.stdout.write(
    `  --type, -t           对象类型：all(默认), task(任务), case(用例), bug(Bug), story(需求), testtask(测试单), doc(文档), project(项目), execution(迭代) 等\n`
  );
  process.stdout.write(`  --page               指定页码（ZenTao 每页 10 条）\n`);
  process.stdout.write(`  --limit              最大返回数量（默认 20 条，自动翻页补足）\n`);
  process.stdout.write(`  --json               输出完整 JSON 结构\n`);
  process.stdout.write(`  --help, -h           显示帮助\n`);
}

export function parseSearchArgs(argv) {
  const cliArgs = parseCliArgs(argv);
  const positionalTokens = [];
  let shortType = null;
  let shortWords = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (token.startsWith("--")) {
      if (!token.includes("=")) {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          i += 1;
        }
      }
      continue;
    }
    if (token === "-t") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        shortType = next;
        i += 1;
      }
      continue;
    }
    if (token === "-w") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        shortWords = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("-")) continue;
    positionalTokens.push(token);
  }

  const words = cliArgs.words || shortWords || (positionalTokens.length ? positionalTokens.join(" ") : "");
  const type = cliArgs.type || shortType || "all";
  const page = cliArgs.page;
  const limit = cliArgs.limit;
  const json = Boolean(cliArgs.json);

  return { words, type, page, limit, json, cliArgs };
}

export function formatSearchSimple(items) {
  if (!items || items.length === 0) {
    return "type\tid\ttitle\tscore\taddedDate\turl\n";
  }
  const rows = [];
  rows.push(["type", "id", "title", "score", "addedDate", "url"].join("\t"));
  for (const item of items) {
    rows.push(
      [
        String(item.objectType ?? item.type ?? ""),
        String(item.objectID ?? item.id ?? ""),
        String(item.title ?? ""),
        String(item.score ?? ""),
        String(item.addedDate ?? ""),
        String(item.url ?? ""),
      ].join("\t")
    );
  }
  return `${rows.join("\n")}\n`;
}

export async function runSearch({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  const { words, type, page, limit, json, cliArgs } = parseSearchArgs(argv);
  if (!words || !words.trim()) {
    printHelp();
    throw new Error("Missing search words. Usage: zentao search <words> [--type <type>] [--json]");
  }

  const api = createClientFromCli({ argv, env });
  const result = await searchZentao(api, {
    words,
    type,
    page,
    limit,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const items = result?.result?.items;
  if (!Array.isArray(items)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatSearchSimple(items));
}
