import assert from "node:assert/strict";
import test from "node:test";

import { ZentaoClient } from "../src/zentao/client.js";
import {
  buildRunCaseForm,
  filterRuns,
  listTesttaskCases,
  normalizeRunResult,
  parseResultFilter,
  parseTesttaskRef,
  resolveTesttask,
  runTesttaskCase,
} from "../src/zentao/testtasks.js";
import { compactRun, formatRunsSimple } from "../src/commands/testtask.js";

const BASE = "https://zentao.example.com/zentao";

function view(data) {
  return { status: "success", data: JSON.stringify(data) };
}

function rawRun(overrides = {}) {
  return {
    id: 1,
    case: 101,
    version: 1,
    caseVersion: 1,
    title: "模块 >> 功能 >> 用例",
    precondition: "无",
    keywords: "",
    storyTitle: "",
    pri: 2,
    module: 0,
    lastRunResult: "",
    lastRunner: "",
    lastRunDate: "",
    assignedTo: "",
    stepNumber: 0,
    bugs: 0,
    isScene: false,
    ...overrides,
  };
}

// 路由表形式的 fetch 假实现：key 为路径片段，value 为 (url, options) => body
function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const s = String(url);
    calls.push({ url: s, options });
    if (s.endsWith("/api.php/v1/tokens")) {
      return { status: 200, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify({ token: "t" }) };
    }
    if (s.includes("/user-login.html")) {
      return { status: 302, headers: { getSetCookie: () => ["zentaosid=abc; path=/"] }, text: async () => "" };
    }
    for (const [key, handler] of Object.entries(routes)) {
      if (s.includes(key)) {
        const body = handler(s, options);
        return { status: 200, headers: { getSetCookie: () => [] }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
      }
    }
    return { status: 404, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify({ error: `unexpected ${s}` }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function client() {
  return new ZentaoClient({ baseUrl: BASE, account: "leo", password: "pw" });
}

test("parseTesttaskRef accepts ids and ZenTao page links", () => {
  assert.equal(parseTesttaskRef("1521"), 1521);
  assert.equal(parseTesttaskRef(1521), 1521);
  assert.equal(parseTesttaskRef("http://172.31.80.150:81/zentao/testtask-cases-1521.html"), 1521);
  assert.equal(parseTesttaskRef("/zentao/testtask-view-88.html"), 88);
  assert.equal(parseTesttaskRef("index.php?m=testtask&f=cases&taskID=7"), 7);
  assert.equal(parseTesttaskRef("生态市场功能"), null);
});

test("result filters accept aliases, lists and done/all", () => {
  assert.equal(normalizeRunResult("通过"), "pass");
  assert.equal(normalizeRunResult("Blocked"), "blocked");
  assert.equal(normalizeRunResult("skip"), "n/a");
  assert.deepEqual([...parseResultFilter("unrun,fail")], ["unrun", "fail"]);
  assert.deepEqual([...parseResultFilter("done")].sort(), ["blocked", "fail", "n/a", "pass"]);
  assert.equal(parseResultFilter("all"), null);
  assert.throws(() => parseResultFilter("passs"), /Unknown result filter/);
});

test("filterRuns combines result, keyword (AND), pri and case filters", () => {
  const runs = [
    { run: 1, case: 11, pri: 1, result: "unrun", title: "Skill >> 下架 >> 引用失效", precondition: "", keywords: "", storyTitle: "", assignedTo: "", lastRunner: "" },
    { run: 2, case: 12, pri: 2, result: "pass", title: "Skill >> 发布", precondition: "", keywords: "", storyTitle: "", assignedTo: "", lastRunner: "maxiang" },
    { run: 3, case: 13, pri: 2, result: "unrun", title: "知识库 >> 上传", precondition: "需要先下架 Skill", keywords: "", storyTitle: "", assignedTo: "", lastRunner: "" },
  ];
  assert.deepEqual(filterRuns(runs, { result: "unrun" }).map((r) => r.run), [1, 3]);
  assert.deepEqual(filterRuns(runs, { keyword: "skill 下架" }).map((r) => r.run), [1, 3]);
  assert.deepEqual(filterRuns(runs, { keyword: "skill 下架", pri: "1" }).map((r) => r.run), [1]);
  assert.deepEqual(filterRuns(runs, { cases: "12,13" }).map((r) => r.run), [2, 3]);
  assert.deepEqual(filterRuns(runs, { runner: "maxiang" }).map((r) => r.run), [2]);
});

test("buildRunCaseForm uses result[0] for title-only cases and step ids otherwise", () => {
  const titleOnly = buildRunCaseForm({ caseId: 101, version: 2, steps: [], result: "pass", real: "" });
  assert.equal(titleOnly.get("result[0]"), "pass");
  assert.equal(titleOnly.get("real[0]"), "");
  assert.equal(titleOnly.get("case"), "101");
  assert.equal(titleOnly.get("version"), "2");

  const withSteps = buildRunCaseForm({
    caseId: 101,
    version: 1,
    steps: [
      { id: 5, type: "group" },
      { id: 6, type: "item" },
      { id: 7, type: "step" },
    ],
    result: "fail",
    real: "按钮无响应",
  });
  assert.equal(withSteps.has("result[5]"), false);
  assert.equal(withSteps.get("result[6]"), "fail");
  assert.equal(withSteps.get("result[7]"), "fail");
  assert.equal(withSteps.get("real[7]"), "按钮无响应");
  assert.equal(withSteps.has("result[0]"), false);
});

test("resolveTesttask by name prefers exact match and reports ambiguity", async () => {
  const tasks = [
    { id: 1521, name: "生态市场功能", product: 142, productName: "AI", status: "doing" },
    { id: 1520, name: "生态市场-知识库", product: 142, productName: "AI", status: "doing" },
    { id: 900, name: "老版本测试", product: 7, productName: "旧", status: "done" },
  ];
  const mock = mockFetch({
    "/api.php/v1/testtasks": () => ({ page: 1, total: tasks.length, limit: 1000, testtasks: tasks }),
  });
  try {
    const exact = await resolveTesttask(client(), { name: "生态市场功能" });
    assert.equal(exact.status, 1);
    assert.equal(exact.result.id, 1521);

    const ambiguous = await resolveTesttask(client(), { name: "生态市场" });
    assert.equal(ambiguous.status, 0);
    assert.deepEqual(ambiguous.result.candidates.map((t) => t.id), [1521, 1520]);

    const missing = await resolveTesttask(client(), { name: "不存在" });
    assert.equal(missing.status, 0);
  } finally {
    mock.restore();
  }
});

test("listTesttaskCases pages through all runs and keeps a full summary", async () => {
  const page1 = [rawRun({ id: 1, case: 101, lastRunResult: "pass" }), rawRun({ id: 2, case: 102 })];
  const page2 = [rawRun({ id: 3, case: 103, title: "关键 用例" }), rawRun({ id: 9, isScene: true })];
  const mock = mockFetch({
    "/api.php/v1/testtasks/1521": () => ({ id: 1521, name: "生态市场功能", product: 142, status: "doing" }),
    "/testtask-cases-1521-all-0-id_asc-0-": (url) =>
      url.endsWith("-1.json")
        ? view({ runs: page1, pager: { pageTotal: 2, recTotal: 3 } })
        : view({ runs: page2, pager: { pageTotal: 2, recTotal: 3 } }),
  });
  try {
    const res = await listTesttaskCases(client(), { id: "1521", result: "unrun" });
    assert.equal(res.status, 1);
    assert.equal(res.result.summary.total, 3);
    assert.equal(res.result.summary.pass, 1);
    assert.equal(res.result.summary.unrun, 2);
    assert.deepEqual(res.result.runs.map((r) => r.run), [2, 3]);
    assert.equal(mock.calls.filter((c) => c.url.includes("testtask-cases")).length, 2);
  } finally {
    mock.restore();
  }
});

test("runTesttaskCase posts the form and confirms the result by reading it back", async () => {
  let reads = 0;
  let posted = null;
  const mock = mockFetch({
    "/testtask-runCase-43402.json": () => {
      reads += 1;
      const done = posted !== null;
      return view({
        run: {
          id: 43402,
          task: 1521,
          version: 1,
          lastRunResult: done ? "pass" : "",
          lastRunner: done ? "leo" : "",
          lastRunDate: done ? "2026-11-10 10:00:00" : "",
          case: { id: 61604, version: 1, currentVersion: 1, title: "用例", steps: [] },
        },
      });
    },
    "/testtask-runCase-43402-61604-1.json": (url, options) => {
      posted = new URLSearchParams(options.body);
      return { result: "success", message: "保存成功", load: true };
    },
  });
  try {
    const res = await runTesttaskCase(client(), { run: 43402, result: "通过" });
    assert.equal(res.status, 1);
    assert.equal(res.result.before, "unrun");
    assert.equal(res.result.after, "pass");
    assert.equal(posted.get("result[0]"), "pass");
    assert.equal(posted.get("case"), "61604");
    assert.equal(reads, 2);
    const post = mock.calls.find((c) => c.options.method === "POST" && c.url.includes("runCase"));
    assert.match(post.options.headers.Cookie, /zentaosid=abc/);
  } finally {
    mock.restore();
  }
});

test("runTesttaskCase reports failure when ZenTao did not record the result", async () => {
  const mock = mockFetch({
    "/testtask-runCase-43402.json": () =>
      view({ run: { id: 43402, version: 1, lastRunResult: "", lastRunDate: "", case: { id: 61604, version: 1, steps: [] } } }),
    "/testtask-runCase-43402-61604-1.json": () => "<html>login</html>",
  });
  try {
    const res = await runTesttaskCase(client(), { run: 43402, result: "pass" });
    assert.equal(res.status, 0);
    assert.match(res.msg, /not recorded/);
  } finally {
    mock.restore();
  }
});

test("runTesttaskCase requires --real for fail and blocked and rejects unknown results", async () => {
  const mock = mockFetch({});
  try {
    assert.match((await runTesttaskCase(client(), { run: 1, result: "fail" })).msg, /requires --real/);
    assert.match((await runTesttaskCase(client(), { run: 1, result: "blocked", real: "  " })).msg, /requires --real/);
    assert.match((await runTesttaskCase(client(), { run: 1, result: "unrun" })).msg, /Invalid result/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("compactRun and formatRunsSimple keep list output small and single-line", () => {
  const run = { run: 1, case: 2, title: "a\tb\nc", pri: 2, result: "unrun", precondition: "无", lastRunner: "", lastRunDate: "", assignedTo: "", stepNumber: 0, bugs: 0 };
  assert.deepEqual(compactRun(run), { run: 1, case: 2, title: "a\tb\nc", pri: 2, result: "unrun" });
  const out = formatRunsSimple([run]);
  assert.equal(out.trim().split("\n").length, 2);
  assert.match(out, /a b c/);
});
