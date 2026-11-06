import {
  normalizeResult,
  normalizeError,
  toInt,
  normalizeAccountValue,
} from "./normalize.js";

// 测试单执行相关能力。
// - 测试单基础信息走 REST API v1（/api.php/v1/testtasks）。
// - 测试单下的用例列表、执行表单与执行历史，REST v1 只给第一页且没有执行接口，
//   所以走禅道页面同名的 .json 视图（testtask-cases / testtask-runCase / testtask-results），
//   和网页端「测试单 -> 用例 -> 执行」用的是同一套控制器，数据和权限都一致。

export const RUN_RESULTS = ["pass", "fail", "blocked", "n/a"];
export const UNRUN = "unrun";

const RESULT_ALIASES = {
  pass: "pass",
  passed: "pass",
  ok: "pass",
  通过: "pass",
  fail: "fail",
  failed: "fail",
  失败: "fail",
  blocked: "blocked",
  block: "blocked",
  阻塞: "blocked",
  "n/a": "n/a",
  na: "n/a",
  skip: "n/a",
  ignore: "n/a",
  忽略: "n/a",
  unrun: UNRUN,
  wait: UNRUN,
  none: UNRUN,
  todo: UNRUN,
  未执行: UNRUN,
};

export function normalizeRunResult(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return RESULT_ALIASES[key] || null;
}

// 列表筛选用：支持逗号分隔多个值，另外 `done` 表示「已执行（任意结果）」。
export function parseResultFilter(value) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const tokens = String(value)
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const set = new Set();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "all") return null;
    if (lower === "done" || lower === "run" || lower === "executed" || token === "已执行") {
      RUN_RESULTS.forEach((r) => set.add(r));
      continue;
    }
    const normalized = normalizeRunResult(token);
    if (!normalized) {
      throw new Error(`Unknown result filter "${token}". Use unrun, pass, fail, blocked, n/a, done or all.`);
    }
    set.add(normalized);
  }
  return set.size ? set : null;
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// 接受 1521、"1521"、以及禅道页面链接（testtask-cases-1521.html / testtask-view-1521.html）。
export function parseTesttaskRef(value) {
  if (value === undefined || value === null || value === true) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/testtask-(?:cases|view|browse|report|linkCase|runCase)-(\d+)/i);
  if (match) return Number(match[1]);
  const query = text.match(/[?&](?:taskID|testtaskID|id)=(\d+)/i);
  if (query) return Number(query[1]);
  return null;
}

function accountOf(value) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return String(value.account || value.realname || value.name || "");
  return "";
}

function parseWebPayload(res) {
  if (!res || typeof res !== "object") return { error: "Empty response" };
  if (res.error) return { error: res.error };
  if (res.result === "fail") {
    const alert = res.load?.alert || res.message;
    return { error: typeof alert === "string" ? alert : JSON.stringify(alert || res) };
  }
  if (res.status === "success" && res.data !== undefined) {
    try {
      return { data: typeof res.data === "string" ? JSON.parse(res.data) : res.data };
    } catch {
      return { error: "Failed to parse ZenTao view data" };
    }
  }
  return { error: `Unexpected response: ${JSON.stringify(res).slice(0, 200)}` };
}

async function getWebView(client, path) {
  let res;
  try {
    res = await client.request({ method: "GET", path });
  } catch (error) {
    return { error: error.message };
  }
  return parseWebPayload(res);
}

export async function listTesttasks(client, { page, limit }) {
  const payload = await client.request({
    method: "GET",
    path: `/api.php/v1/testtasks`,
    query: {
      limit: toInt(limit, 20),
      page: toInt(page, 1),
    },
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function getTesttask(client, { id }) {
  if (!id) throw new Error("id is required");

  const payload = await client.request({
    method: "GET",
    path: `/api.php/v1/testtasks/${id}`,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export function summarizeTesttask(task) {
  return {
    id: Number(task.id),
    name: decodeHtmlEntities(task.name),
    product: Number(task.product) || 0,
    productName: decodeHtmlEntities(task.productName || ""),
    project: Number(task.project) || 0,
    projectName: decodeHtmlEntities(task.projectName || ""),
    execution: Number(task.execution) || 0,
    executionName: decodeHtmlEntities(task.executionName || ""),
    build: task.build ?? "",
    buildName: decodeHtmlEntities(task.buildName || ""),
    status: task.status || "",
    owner: accountOf(task.owner),
    begin: task.begin || "",
    end: task.end || "",
  };
}

// 测试单总数一般在几百到上千，一次 limit=1000 分页拉完再做名称/产品/状态筛选。
export async function searchTesttasks(client, { keyword, product, status, owner, perPage } = {}) {
  const pageSize = toInt(perPage, 1000);
  const all = [];
  let page = 1;
  while (true) {
    const payload = await client.request({
      method: "GET",
      path: "/api.php/v1/testtasks",
      query: { page, limit: pageSize },
    });
    if (payload.error) return normalizeError(payload.error, payload);
    const items = Array.isArray(payload.testtasks) ? payload.testtasks : [];
    all.push(...items);
    const total = toInt(payload.total, all.length);
    if (!items.length || all.length >= total || items.length < pageSize) break;
    page += 1;
  }

  const kw = keyword && keyword !== true ? String(keyword).trim().toLowerCase() : "";
  const productId = product ? Number(product) : null;
  const statusSet = status && status !== true
    ? new Set(String(status).split(/[,|]/).map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;
  const ownerAccount = owner && owner !== true ? normalizeAccountValue(owner) : "";

  const testtasks = all
    .map(summarizeTesttask)
    .filter((task) => {
      if (productId && task.product !== productId) return false;
      if (statusSet && !statusSet.has(String(task.status).toLowerCase())) return false;
      if (ownerAccount && normalizeAccountValue(task.owner) !== ownerAccount) return false;
      if (kw) {
        const haystack = `${task.name} ${task.productName} ${task.projectName} ${task.executionName} ${task.buildName}`.toLowerCase();
        if (!kw.split(/\s+/).every((token) => haystack.includes(token))) return false;
      }
      return true;
    });

  return normalizeResult({ total: testtasks.length, testtasks });
}

// 按 id、链接或名称定位唯一的测试单。名称优先精确匹配，再退到包含匹配；
// 多个候选时不猜，直接把候选列表返回给调用方选择。
export async function resolveTesttask(client, { id, name, product } = {}) {
  const refId = parseTesttaskRef(id) ?? parseTesttaskRef(name);
  if (refId) {
    const res = await getTesttask(client, { id: refId });
    if (res.status !== 1) return res;
    return normalizeResult(summarizeTesttask(res.result));
  }

  if (!name || name === true) {
    return normalizeError("Missing testtask: pass --id <id|url> or --name <name>");
  }

  const search = await searchTesttasks(client, { product });
  if (search.status !== 1) return search;
  const target = decodeHtmlEntities(String(name)).trim().toLowerCase();
  const tasks = search.result.testtasks;

  const exact = tasks.filter((task) => task.name.trim().toLowerCase() === target);
  const candidates = exact.length
    ? exact
    : tasks.filter((task) => task.name.toLowerCase().includes(target));

  if (candidates.length === 1) return normalizeResult(candidates[0]);
  if (!candidates.length) {
    return normalizeError(`No testtask matches name "${name}"`, { candidates: [] });
  }

  // 多个候选时，只剩一个未关闭的就用它
  const open = candidates.filter((task) => task.status !== "done");
  if (open.length === 1) return normalizeResult(open[0]);

  return normalizeError(
    `Testtask name "${name}" matches ${candidates.length} testtasks; pass --id or narrow with --product`,
    { candidates: candidates.slice(0, 20) }
  );
}

export function normalizeRun(run) {
  return {
    run: Number(run.id),
    case: Number(run.case),
    version: Number(run.caseVersion || run.version) || 1,
    title: decodeHtmlEntities(run.title || ""),
    pri: Number(run.pri) || 0,
    module: Number(run.module) || 0,
    precondition: decodeHtmlEntities(run.precondition || "").trim(),
    keywords: decodeHtmlEntities(run.keywords || ""),
    storyTitle: decodeHtmlEntities(run.storyTitle || ""),
    caseStatus: run.caseStatus || run.status || "",
    result: run.lastRunResult ? String(run.lastRunResult) : UNRUN,
    lastRunner: accountOf(run.lastRunner),
    lastRunDate: run.lastRunDate || "",
    assignedTo: accountOf(run.assignedTo),
    stepNumber: Number(run.stepNumber) || 0,
    bugs: Number(run.bugs) || 0,
  };
}

export async function fetchTesttaskRuns(client, { taskId, perPage }) {
  const pageSize = Math.min(Math.max(toInt(perPage, 500), 20), 1000);
  const runs = [];
  let page = 1;
  let pageTotal = 1;

  while (page <= pageTotal) {
    const view = await getWebView(
      client,
      `/testtask-cases-${taskId}-all-0-id_asc-0-${pageSize}-${page}.json`
    );
    if (view.error) return { error: view.error };
    const pageRuns = Object.values(view.data?.runs || {});
    for (const run of pageRuns) {
      if (run.isScene) continue;
      runs.push(normalizeRun(run));
    }
    pageTotal = toInt(view.data?.pager?.pageTotal, 1) || 1;
    if (!pageRuns.length) break;
    page += 1;
  }

  return { runs };
}

export function countResults(runs) {
  const counts = { total: runs.length, unrun: 0, pass: 0, fail: 0, blocked: 0, "n/a": 0 };
  for (const run of runs) {
    if (counts[run.result] === undefined) counts[run.result] = 0;
    counts[run.result] += 1;
  }
  return counts;
}

function parseNumberSet(value, splitter) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const set = new Set(
    String(value)
      .split(splitter)
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  return set.size ? set : null;
}

// keyword：空格分隔多个词时要求全部命中（AND），在标题、前置条件、关键词、需求标题里查找。
export function filterRuns(runs, { result, keyword, pri, assignedTo, runner, cases } = {}) {
  const resultSet = result instanceof Set ? result : parseResultFilter(result);
  const priSet = parseNumberSet(pri, /[,|]/);
  const caseSet = parseNumberSet(cases, /[,|\s]+/);
  const tokens = keyword && keyword !== true
    ? String(keyword).trim().toLowerCase().split(/\s+/).filter(Boolean)
    : [];
  const assignee = assignedTo && assignedTo !== true ? normalizeAccountValue(assignedTo) : "";
  const lastRunner = runner && runner !== true ? normalizeAccountValue(runner) : "";

  return runs.filter((run) => {
    if (resultSet && !resultSet.has(run.result)) return false;
    if (priSet && !priSet.has(run.pri)) return false;
    if (caseSet && !caseSet.has(run.case) && !caseSet.has(run.run)) return false;
    if (assignee && normalizeAccountValue(run.assignedTo) !== assignee) return false;
    if (lastRunner && normalizeAccountValue(run.lastRunner) !== lastRunner) return false;
    if (tokens.length) {
      const haystack = `${run.title} ${run.precondition} ${run.keywords} ${run.storyTitle}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  });
}

export async function listTesttaskCases(client, { id, name, product, perPage, ...filters } = {}) {
  const resolved = await resolveTesttask(client, { id, name, product });
  if (resolved.status !== 1) return resolved;
  const testtask = resolved.result;

  const fetched = await fetchTesttaskRuns(client, { taskId: testtask.id, perPage });
  if (fetched.error) return normalizeError(fetched.error);

  const matched = filterRuns(fetched.runs, filters);
  return normalizeResult({
    testtask,
    summary: countResults(fetched.runs),
    matched: matched.length,
    runs: matched,
  });
}

function normalizeStep(step) {
  return {
    id: Number(step.id),
    type: step.type || "step",
    parent: Number(step.parent) || 0,
    grade: Number(step.grade) || 1,
    name: step.name ?? "",
    desc: decodeHtmlEntities(step.desc || ""),
    expect: decodeHtmlEntities(step.expect || ""),
  };
}

function normalizeResultRecord(record) {
  const stepResults = Array.isArray(record.stepResults)
    ? record.stepResults
    : Object.values(record.stepResults || {});
  return {
    id: Number(record.id),
    result: record.caseResult || "",
    runner: accountOf(record.lastRunner),
    date: record.date || "",
    build: record.build ?? "",
    real: stepResults.map((s) => decodeHtmlEntities(s?.real || "")).filter(Boolean).join("\n"),
  };
}

async function loadRunCase(client, runId) {
  const view = await getWebView(client, `/testtask-runCase-${runId}.json`);
  if (view.error) return { error: view.error };
  const run = view.data?.run;
  const testcase = run?.case;
  if (!run || !testcase || !testcase.id) return { error: `Run #${runId} not found` };
  const rawSteps = Array.isArray(testcase.steps) ? testcase.steps : Object.values(testcase.steps || {});
  return {
    run: {
      run: Number(run.id),
      task: Number(run.task) || 0,
      case: Number(testcase.id),
      version: Number(testcase.version || run.version) || 1,
      currentVersion: Number(testcase.currentVersion || testcase.version) || 1,
      title: decodeHtmlEntities(testcase.title || ""),
      pri: Number(testcase.pri) || 0,
      type: testcase.type || "",
      precondition: decodeHtmlEntities(testcase.precondition || "").trim(),
      keywords: decodeHtmlEntities(testcase.keywords || ""),
      result: run.lastRunResult ? String(run.lastRunResult) : UNRUN,
      lastRunner: accountOf(run.lastRunner),
      lastRunDate: run.lastRunDate || "",
      assignedTo: accountOf(run.assignedTo),
      steps: rawSteps.map(normalizeStep),
    },
  };
}

// --run 直接给执行 ID；或者 --case 用例 ID + 测试单（--id/--name）反查执行 ID。
export async function resolveRunId(client, { run, id, name, product, caseId }) {
  const runId = toInt(run, 0);
  if (runId > 0) return { runId };
  if (!caseId || caseId === true) return { error: "Missing --run <runId> (or --case <caseId> with --id/--name)" };
  const listed = await listTesttaskCases(client, { id, name, product, cases: String(caseId) });
  if (listed.status !== 1) return { error: listed.msg };
  const match = listed.result.runs.find((r) => r.case === Number(caseId));
  if (!match) return { error: `Case #${caseId} is not in testtask #${listed.result.testtask.id}` };
  return { runId: match.run };
}

export async function getTesttaskRun(client, { run, history = false }) {
  const runId = toInt(run, 0);
  if (!runId) throw new Error("run is required");
  const loaded = await loadRunCase(client, runId);
  if (loaded.error) return normalizeError(loaded.error);

  const result = { ...loaded.run };
  if (history) {
    const view = await getWebView(client, `/testtask-results-${runId}.json`);
    if (view.error) return normalizeError(view.error);
    result.history = Object.values(view.data?.results || {}).map(normalizeResultRecord);
  }
  return normalizeResult(result);
}

// 组装 runCase 表单。禅道按步骤 ID 提交 result[stepID] / real[stepID]；
// 没有步骤（只有标题）的用例，网页表单用的是 result[0] / real[0]。
// 分组步骤（type=group）只是标题，不提交结果。
export function buildRunCaseForm({ caseId, version, steps = [], result, real = "" }) {
  const params = new URLSearchParams();
  const executable = steps.filter((step) => step.type !== "group");
  if (!executable.length) {
    params.set("result[0]", result);
    params.set("real[0]", real);
  } else {
    executable.forEach((step, index) => {
      params.set(`result[${step.id}]`, result);
      params.set(`real[${step.id}]`, index === executable.length - 1 ? real : "");
    });
  }
  params.set("case", String(caseId));
  params.set("version", String(version));
  return params;
}

export async function runTesttaskCase(client, { run, result, real = "" }) {
  const runId = toInt(run, 0);
  if (!runId) throw new Error("run is required");
  const target = normalizeRunResult(result);
  if (!target || target === UNRUN) {
    return normalizeError(`Invalid result "${result}". Use pass, fail, blocked or n/a.`);
  }
  const realText = real && real !== true ? String(real) : "";
  if ((target === "fail" || target === "blocked") && !realText.trim()) {
    return normalizeError(`Result "${target}" requires --real "<actual result>" describing what went wrong.`);
  }

  const before = await loadRunCase(client, runId);
  if (before.error) return normalizeError(before.error);
  const info = before.run;

  await client.ensureSessionCookies();
  const params = buildRunCaseForm({
    caseId: info.case,
    version: info.version,
    steps: info.steps,
    result: target,
    real: realText,
  });

  const base = `testtask-runCase-${runId}-${info.case}-${info.version}`;
  const res = await fetch(`${client.baseUrl}/${base}.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${client.baseUrl}/${base}.html`,
      Cookie: client.formatSessionCookies(),
    },
    body: params.toString(),
    redirect: "manual",
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (json && json.result === "fail") {
    const message = typeof json.message === "string" ? json.message : JSON.stringify(json.message || json);
    return normalizeError(`ZenTao rejected the result: ${message}`, json);
  }

  // 不信任响应，回读执行记录确认结果真的写进去了
  const after = await loadRunCase(client, runId);
  if (after.error) return normalizeError(`Submitted, but failed to read back run #${runId}: ${after.error}`);
  const recorded =
    after.run.result === target &&
    (after.run.lastRunDate !== info.lastRunDate || info.result !== target);

  const summary = {
    run: runId,
    case: info.case,
    title: info.title,
    before: info.result,
    after: after.run.result,
    lastRunner: after.run.lastRunner,
    lastRunDate: after.run.lastRunDate,
  };

  if (!recorded) {
    return normalizeError(
      `Result was not recorded for run #${runId} (still ${after.run.result}, last run ${after.run.lastRunDate || "never"})`,
      { ...summary, response: json ?? text.slice(0, 200) }
    );
  }
  return normalizeResult(summary);
}
