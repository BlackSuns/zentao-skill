import assert from "node:assert/strict";
import test from "node:test";

import { ZentaoClient } from "../src/zentao/client.js";
import {
  formatYMD,
  normalizeDateInput,
  parseExecutionRef,
  parseStoryRef,
  parseTaskRef,
} from "../src/zentao/normalize.js";
import { createTask, editTask, getTask } from "../src/zentao/tasks.js";
import { runTask, formatTaskSimple } from "../src/commands/task.js";
import { formatTasksSimple } from "../src/commands/tasks.js";

const BASE = "https://zentao.example.com/zentao";

function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const s = String(url);
    calls.push({ url: s, options });
    if (s.endsWith("/api.php/v1/tokens")) {
      return { status: 200, text: async () => JSON.stringify({ token: "t_mock" }) };
    }
    for (const [key, handler] of Object.entries(routes)) {
      if (s.includes(key)) {
        const body = handler(s, options);
        return { status: 200, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
      }
    }
    return { status: 404, text: async () => JSON.stringify({ error: `unexpected ${s}` }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function client() {
  return new ZentaoClient({ baseUrl: BASE, account: "xujintao", password: "pw" });
}

test("normalizeDateInput handles relative keywords and formats", () => {
  const today = formatYMD(new Date());
  assert.equal(normalizeDateInput("today"), today);
  assert.equal(normalizeDateInput("td"), today);
  assert.equal(normalizeDateInput("今天"), today);
  assert.equal(normalizeDateInput("当日"), today);

  const tm = new Date();
  tm.setDate(tm.getDate() + 1);
  const tomorrow = formatYMD(tm);
  assert.equal(normalizeDateInput("tomorrow"), tomorrow);
  assert.equal(normalizeDateInput("tm"), tomorrow);
  assert.equal(normalizeDateInput("明天"), tomorrow);

  assert.equal(normalizeDateInput("2026-11-11"), "2026-11-11");
  assert.equal(normalizeDateInput("2026/11/11"), "2026-11-11");
  assert.equal(normalizeDateInput("2026.11.11"), "2026-11-11");
  assert.equal(normalizeDateInput("20261111"), "2026-11-11");
  assert.equal(normalizeDateInput(null), null);
  assert.equal(normalizeDateInput(""), null);
  assert.throws(() => normalizeDateInput("not-a-date"), /Invalid date/);
});

test("parseExecutionRef accepts IDs and ZenTao URLs", () => {
  assert.equal(parseExecutionRef("2049"), 2049);
  assert.equal(parseExecutionRef(2049), 2049);
  assert.equal(parseExecutionRef("#2049"), 2049);
  assert.equal(parseExecutionRef("http://172.31.80.150:81/zentao/execution-task-2049.html"), 2049);
  assert.equal(parseExecutionRef("/zentao/execution-view-2049.html"), 2049);
  assert.equal(parseExecutionRef("execution-story-2049.html"), 2049);
  assert.equal(parseExecutionRef("execution_2049"), 2049);
  assert.equal(parseExecutionRef("index.php?m=execution&f=task&executionID=2049"), 2049);
  assert.equal(parseExecutionRef("invalid"), null);
});

test("parseStoryRef accepts story IDs and ZenTao URLs", () => {
  assert.equal(parseStoryRef("3816"), 3816);
  assert.equal(parseStoryRef(3816), 3816);
  assert.equal(parseStoryRef("#3816"), 3816);
  assert.equal(parseStoryRef("http://172.31.80.150:81/zentao/story-view-3816.html"), 3816);
  assert.equal(parseStoryRef("story-3816"), 3816);
  assert.equal(parseStoryRef("index.php?m=story&f=view&storyID=3816"), 3816);
});

test("parseTaskRef accepts task IDs and ZenTao URLs", () => {
  assert.equal(parseTaskRef("82091"), 82091);
  assert.equal(parseTaskRef(82091), 82091);
  assert.equal(parseTaskRef("#82091"), 82091);
  assert.equal(parseTaskRef("http://172.31.80.150:81/zentao/task-view-82091.html"), 82091);
  assert.equal(parseTaskRef("/zentao/task-edit-82091.html"), 82091);
  assert.equal(parseTaskRef("task-82091"), 82091);
  assert.equal(parseTaskRef("index.php?m=task&f=view&taskID=82091"), 82091);
});

test("createTask passes estStarted, deadline, story, and defaults", async () => {
  let postedBody = null;
  let targetPath = null;
  const mock = mockFetch({
    "/api.php/v1/executions/2049/tasks": (url, options) => {
      targetPath = url;
      postedBody = JSON.parse(options.body);
      return { id: 82091, name: postedBody.name, execution: 2049, ...postedBody };
    },
  });

  try {
    const res = await createTask(client(), {
      execution: 2049,
      name: "培训-AI的梦",
      assignedTo: "xujintao",
      estStarted: "2026-11-11",
      deadline: "2026-11-11",
      story: 3816,
      estimate: 2,
      pri: 3,
    });
    assert.equal(res.status, 1);
    assert.equal(res.result.id, 82091);
    assert.equal(postedBody.name, "培训-AI的梦");
    assert.equal(postedBody.estStarted, "2026-11-11");
    assert.equal(postedBody.deadline, "2026-11-11");
    assert.equal(postedBody.story, 3816);
    assert.equal(postedBody.assignedTo, "xujintao");
    assert.equal(postedBody.estimate, 2);
    assert.equal(postedBody.type, "devel");
    assert.equal(postedBody.pri, 3);
  } finally {
    mock.restore();
  }
});

test("editTask fetches current task to preserve required fields on partial update", async () => {
  let putBody = null;
  const existingTask = {
    id: 82091,
    name: "培训-AI的梦",
    execution: 2049,
    type: "devel",
    status: "wait",
    assignedTo: "xujintao",
    estStarted: "2026-11-11",
    deadline: "2026-11-11",
    story: 3816,
    estimate: 2,
  };

  const mock = mockFetch({
    "/api.php/v1/tasks/82091": (url, options) => {
      if (options.method === "PUT") {
        putBody = JSON.parse(options.body);
        return { ...existingTask, ...putBody };
      }
      return existingTask;
    },
  });

  try {
    const res = await editTask(client(), {
      id: 82091,
      deadline: "2026-11-15",
      estimate: 4,
    });
    assert.equal(res.status, 1);
    assert.equal(putBody.name, "培训-AI的梦");
    assert.equal(putBody.execution, 2049);
    assert.equal(putBody.type, "devel");
    assert.equal(putBody.status, "wait");
    assert.equal(putBody.deadline, "2026-11-15");
    assert.equal(putBody.estimate, 4);
  } finally {
    mock.restore();
  }
});

test("runTask create handles execution URL, relative date keywords and --assigned-to me", async () => {
  let postedBody = null;
  const today = formatYMD(new Date());
  const mock = mockFetch({
    "/api.php/v1/executions/2049/tasks": (url, options) => {
      postedBody = JSON.parse(options.body);
      return { id: 82091, name: postedBody.name, execution: 2049, ...postedBody };
    },
  });

  const written = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(chunk); return true; };

  try {
    await runTask({
      argv: [
        "create",
        "--execution",
        "http://172.31.80.150:81/zentao/execution-task-2049.html",
        "--name",
        "培训-AI的梦",
        "--est-started",
        "today",
        "--deadline",
        "今天",
        "--story",
        "#3816",
        "--assigned-to",
        "me",
        "--estimate",
        "2",
      ],
      env: { ZENTAO_URL: BASE, ZENTAO_ACCOUNT: "xujintao", ZENTAO_PASSWORD: "pw" },
    });
    assert.equal(postedBody.name, "培训-AI的梦");
    assert.equal(postedBody.estStarted, today);
    assert.equal(postedBody.deadline, today);
    assert.equal(postedBody.story, 3816);
    assert.equal(postedBody.assignedTo, "xujintao");
    assert.equal(postedBody.estimate, 2);
    const out = written.join("");
    assert.match(out, /Task #82091 created: 培训-AI的梦/);
    assert.match(out, /execution: #2049/);
    assert.match(out, /story: #3816/);
  } finally {
    process.stdout.write = origWrite;
    mock.restore();
  }
});

test("runTask create provides helpful hint when required story is missing", async () => {
  const mock = mockFetch({
    "/api.php/v1/executions/2049/tasks": () => ({ error: "『相关研发需求』不能为空" }),
  });

  try {
    await assert.rejects(
      () => runTask({
        argv: ["create", "--execution", "2049", "--name", "未挂需求的任务"],
        env: { ZENTAO_URL: BASE, ZENTAO_ACCOUNT: "xujintao", ZENTAO_PASSWORD: "pw" },
      }),
      /This execution requires tasks to be linked to a story; pass --story <storyId>/
    );
  } finally {
    mock.restore();
  }
});

test("formatTaskSimple and formatTasksSimple include dates and story", () => {
  const single = formatTaskSimple({
    id: 82091,
    name: "培训-AI的梦",
    status: "done",
    pri: 3,
    assignedTo: { account: "xujintao" },
    estStarted: "2026-11-11",
    deadline: "2026-11-11",
    estimate: 2,
    consumed: 2,
    left: 0,
    story: 3816,
  });
  assert.match(single, /2026-11-11\t2026-11-11/);
  assert.match(single, /#3816/);

  const multiple = formatTasksSimple([{
    id: 82091,
    name: "培训-AI的梦",
    status: "done",
    pri: 3,
    assignedTo: "xujintao",
    estStarted: "2026-11-11",
    deadline: "2026-11-11",
    estimate: 2,
    consumed: 2,
    left: 0,
  }]);
  assert.match(multiple, /2026-11-11\t2026-11-11/);
});
