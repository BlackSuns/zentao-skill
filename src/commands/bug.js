import process from "node:process";
import { decodeEscapedNewlines, extractCommand, hasHelpFlag, parseCliArgs } from "../cli/args.js";
import { createClientFromCli } from "../zentao/client.js";
import { getBug, resolveBug, assignBug, commentBug, closeBug, activateBug, createBug } from "../zentao/bugs.js";
import { extractBugImages, downloadBugImages } from "../zentao/images.js";

function printHelp() {
  process.stdout.write(`zentao bug - view and manage bugs\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  zentao bug get --id <bugId> [--download-images] [--output-dir <path>] [--json]\n`);
  process.stdout.write(`  zentao bug images --id <bugId> [--output-dir <path>] [--json]\n`);
  process.stdout.write(`  zentao bug resolve --id <bugId> --resolution <fixed|bydesign|duplicate|postponed|notrepro|willnotfix|tostory|external> [--resolved-build trunk] [--assigned-to <account>] [--comment "..."] [--json]\n`);
  process.stdout.write(`  zentao bug assign --id <bugId> --assigned-to <account> [--comment "..."] [--json]\n`);
  process.stdout.write(`  zentao bug comment --id <bugId> --comment "..." [--json]\n`);
  process.stdout.write(`  zentao bug create --product <id> --title "..." [--severity N] [--pri N] [--type codeerror|...] [--steps "..."] [--assigned-to account] [--opened-build trunk] [--json]\n`);
  process.stdout.write(`  zentao bug close --id <bugId> [--comment "..."] [--json]\n`);
  process.stdout.write(`  zentao bug activate --id <bugId> [--assigned-to account] [--comment "..."] [--json]\n`);
}

function formatAccount(value) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return String(value.account || value.name || value.realname || "");
  return "";
}

function formatStepsText(html) {
  if (!html || typeof html !== "string") return "";
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<p[^>]*>/gi, "");
  text = text.replace(/<img[^>]+(?:alt=["']([^"']*)["'])?[^>]*>/gi, (m, alt) => `[Image${alt ? ": " + alt : ""}]`);
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&nbsp;/g, " ")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&amp;/g, "&")
             .replace(/&quot;/g, '"');
  return text.trim();
}

export function formatBugSimple(bug) {
  const header = [
    "id",
    "title",
    "status",
    "pri",
    "severity",
    "assignedTo",
    "openedBy",
    "resolvedBy",
  ].join("\t");
  const row = [
    String(bug?.id ?? ""),
    String(bug?.title ?? ""),
    String(bug?.status ?? ""),
    String(bug?.pri ?? ""),
    String(bug?.severity ?? ""),
    formatAccount(bug?.assignedTo),
    formatAccount(bug?.openedBy),
    formatAccount(bug?.resolvedBy),
  ].join("\t");
  return `${header}\n${row}\n`;
}

export async function runBug({ argv = [], env = process.env } = {}) {
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  const { command: sub, argv: argvWithoutSub } = extractCommand(argv);
  const cliArgs = parseCliArgs(argvWithoutSub);

  if (sub === "get") {
    return runBugGet(cliArgs, argvWithoutSub, env);
  }
  if (sub === "images") {
    return runBugImages(cliArgs, argvWithoutSub, env);
  }
  if (sub === "resolve") {
    return runBugResolve(cliArgs, argvWithoutSub, env);
  }
  if (sub === "assign") {
    return runBugAssign(cliArgs, argvWithoutSub, env);
  }
  if (sub === "comment") {
    return runBugComment(cliArgs, argvWithoutSub, env);
  }
  if (sub === "create") {
    return runBugCreate(cliArgs, argvWithoutSub, env);
  }
  if (sub === "close") {
    return runBugClose(cliArgs, argvWithoutSub, env);
  }
  if (sub === "activate") {
    return runBugActivate(cliArgs, argvWithoutSub, env);
  }

  throw new Error(`Unknown bug subcommand: ${sub || "(missing)"}`);
}

function failMutation(result) {
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  const err = new Error(result?.msg || "operation failed");
  err.exitCode = 1;
  throw err;
}

async function runBugGet(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");

  const api = createClientFromCli({ argv, env });
  const result = await getBug(api, { id });
  const bug = result?.result?.bug ?? result?.result;

  if (!bug || typeof bug !== "object") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const downloadRequested = Boolean(cliArgs["download-images"] || cliArgs.images);
  let downloadedImages = null;

  if (downloadRequested) {
    downloadedImages = await downloadBugImages(api, bug, {
      outputDir: cliArgs["output-dir"],
    });
  }

  if (cliArgs.json) {
    if (downloadedImages) {
      result.images = downloadedImages;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  // Terminal output
  process.stdout.write(formatBugSimple(bug));

  const stepsText = formatStepsText(bug.steps);
  if (stepsText) {
    process.stdout.write(`\nSteps:\n${stepsText}\n`);
  }

  const existingImages = extractBugImages(bug, api.baseUrl);
  if (downloadedImages) {
    if (downloadedImages.count === 0) {
      process.stdout.write(`\n[Images] No images found for this bug.\n`);
    } else {
      process.stdout.write(`\n[Images] Downloaded ${downloadedImages.count} image(s) to: ${downloadedImages.outputDir}\n`);
      for (const img of downloadedImages.images) {
        if (img.success) {
          process.stdout.write(`  [${img.index}] ${img.localPath} (${img.sizeKb} KB) [${img.source}]\n`);
        } else {
          process.stdout.write(`  [${img.index}] Failed: ${img.url} (${img.error})\n`);
        }
      }
      process.stdout.write(`Tip: Use read tool to view these images directly.\n`);
    }
  } else if (existingImages.length > 0) {
    process.stdout.write(`\n[Images] ${existingImages.length} image(s) available. Run 'zentao bug images --id ${id}' or pass '--download-images' to download.\n`);
  }
}

async function runBugImages(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");

  const api = createClientFromCli({ argv, env });
  const result = await getBug(api, { id });
  const bug = result?.result?.bug ?? result?.result;

  if (!bug || typeof bug !== "object") {
    throw new Error(`Failed to load bug #${id}: ${JSON.stringify(result)}`);
  }

  const downloadResult = await downloadBugImages(api, bug, {
    outputDir: cliArgs["output-dir"],
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify({ status: 1, msg: "success", result: downloadResult }, null, 2)}\n`);
    return;
  }

  if (downloadResult.count === 0) {
    process.stdout.write(`No images found for Bug #${id} (${bug.title || ""}).\n`);
    return;
  }

  process.stdout.write(`Bug #${id} (${bug.title || ""})\n`);
  process.stdout.write(`Downloaded ${downloadResult.count} image(s) to: ${downloadResult.outputDir}\n\n`);
  for (const img of downloadResult.images) {
    if (img.success) {
      process.stdout.write(`  [${img.index}] ${img.localPath} (${img.sizeKb} KB) [source: ${img.source}]\n`);
    } else {
      process.stdout.write(`  [${img.index}] Failed: ${img.url} (${img.error})\n`);
    }
  }
  process.stdout.write(`\nTip: You can view these images directly with your multi-modal read tool.\n`);
}

async function runBugResolve(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");
  const resolution = cliArgs.resolution;
  if (!resolution) throw new Error("Missing --resolution (fixed|bydesign|duplicate|postponed|notrepro|willnotfix|tostory|external)");

  const api = createClientFromCli({ argv, env });
  const result = await resolveBug(api, {
    id,
    resolution,
    resolvedBuild: cliArgs["resolved-build"],
    assignedTo: cliArgs["assigned-to"],
    comment: decodeEscapedNewlines(cliArgs.comment),
  });

  if (result.status !== 1) failMutation(result);

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const bug = result.result;
  process.stdout.write(`Bug #${bug.id} resolved (${bug.resolution || resolution}), assigned to ${formatAccount(bug.assignedTo)}\n`);
}

async function runBugAssign(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");
  const assignedTo = cliArgs["assigned-to"];
  if (!assignedTo) throw new Error("Missing --assigned-to <account>");

  const api = createClientFromCli({ argv, env });
  const result = await assignBug(api, {
    id,
    assignedTo,
    comment: decodeEscapedNewlines(cliArgs.comment),
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const bug = result.result;
    process.stdout.write(`Bug #${bug.id} assigned to ${formatAccount(bug.assignedTo)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runBugComment(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");
  const comment = decodeEscapedNewlines(cliArgs.comment);
  if (!comment) throw new Error("Missing --comment");

  const api = createClientFromCli({ argv, env });
  const result = await commentBug(api, { id, comment });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    process.stdout.write(`Comment added to bug #${id}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runBugCreate(cliArgs, argv, env) {
  const product = cliArgs.product;
  if (!product) throw new Error("Missing --product <id>");
  const title = cliArgs.title;
  if (!title) throw new Error("Missing --title");

  const api = createClientFromCli({ argv, env });
  const result = await createBug(api, {
    product,
    title,
    severity: cliArgs.severity,
    pri: cliArgs.pri,
    type: cliArgs.type,
    steps: decodeEscapedNewlines(cliArgs.steps),
    assignedTo: cliArgs["assigned-to"],
    openedBuild: cliArgs["opened-build"],
  });

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.status === 1) {
    const bug = result.result;
    process.stdout.write(`Bug #${bug.id} created: ${bug.title}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function runBugClose(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");

  const api = createClientFromCli({ argv, env });
  const result = await closeBug(api, {
    id,
    comment: decodeEscapedNewlines(cliArgs.comment),
  });

  if (result.status !== 1) failMutation(result);

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const bug = result.result;
  process.stdout.write(`Bug #${bug.id} closed\n`);
}

async function runBugActivate(cliArgs, argv, env) {
  const id = cliArgs.id;
  if (!id) throw new Error("Missing --id");

  const api = createClientFromCli({ argv, env });
  const result = await activateBug(api, {
    id,
    assignedTo: cliArgs["assigned-to"],
    comment: decodeEscapedNewlines(cliArgs.comment),
  });

  if (result.status !== 1) failMutation(result);

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const bug = result.result;
  process.stdout.write(`Bug #${bug.id} activated, assigned to ${formatAccount(bug.assignedTo)}\n`);
}
