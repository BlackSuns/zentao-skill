import assert from "node:assert/strict";
import test from "node:test";

import { ZentaoClient } from "../src/zentao/client.js";
import {
  TYPE_ALIASES,
  decodeHtmlEntities,
  normalizeSearchItem,
  normalizeSearchType,
  searchZentao,
  stripHtml,
} from "../src/zentao/search.js";
import { formatSearchSimple, parseSearchArgs } from "../src/commands/search.js";

const BASE = "https://zentao.example.com/zentao";

function client() {
  return new ZentaoClient({ baseUrl: BASE, account: "leo", password: "pw" });
}

function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const s = String(url);
    calls.push({ url: s, options });
    if (s.endsWith("/api.php/v1/tokens")) {
      return {
        status: 200,
        headers: { getSetCookie: () => [] },
        text: async () => JSON.stringify({ token: "test-token" }),
      };
    }
    for (const [key, handler] of Object.entries(routes)) {
      if (s.includes(key)) {
        const body = handler(s, options);
        return {
          status: 200,
          headers: { getSetCookie: () => [] },
          text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
        };
      }
    }
    return {
      status: 404,
      headers: { getSetCookie: () => [] },
      text: async () => JSON.stringify({ error: `unexpected ${s}` }),
    };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("parseSearchArgs parses positional words, flags and options", () => {
  const r1 = parseSearchArgs(["事务-后端-值班管理优化-执行测试用例"]);
  assert.equal(r1.words, "事务-后端-值班管理优化-执行测试用例");
  assert.equal(r1.type, "all");
  assert.equal(r1.json, false);

  const r2 = parseSearchArgs(["生态", "市场", "--type", "task", "--limit", "30", "--json"]);
  assert.equal(r2.words, "生态 市场");
  assert.equal(r2.type, "task");
  assert.equal(r2.limit, "30");
  assert.equal(r2.json, true);

  const r3 = parseSearchArgs(["--words", "值班管理", "-t", "bug", "--page", "2"]);
  assert.equal(r3.words, "值班管理");
  assert.equal(r3.type, "bug");
  assert.equal(r3.page, "2");

  const r4 = parseSearchArgs(["-w", "测试单", "--type=testtask"]);
  assert.equal(r4.words, "测试单");
  assert.equal(r4.type, "testtask");
});

test("normalizeSearchType maps types and aliases, rejects invalid type", () => {
  assert.equal(normalizeSearchType("all"), "all");
  assert.equal(normalizeSearchType("全部"), "all");
  assert.equal(normalizeSearchType("task"), "task");
  assert.equal(normalizeSearchType("任务"), "task");
  assert.equal(normalizeSearchType("case"), "case");
  assert.equal(normalizeSearchType("用例"), "case");
  assert.equal(normalizeSearchType("测试用例"), "case");
  assert.equal(normalizeSearchType("bug"), "bug");
  assert.equal(normalizeSearchType("Bug"), "bug");
  assert.equal(normalizeSearchType("缺陷"), "bug");
  assert.equal(normalizeSearchType("story"), "story");
  assert.equal(normalizeSearchType("需求"), "story");
  assert.equal(normalizeSearchType("testtask"), "testtask");
  assert.equal(normalizeSearchType("测试单"), "testtask");
  assert.equal(normalizeSearchType("doc"), "doc");
  assert.equal(normalizeSearchType("文档"), "doc");
  assert.equal(normalizeSearchType("execution"), "execution");
  assert.equal(normalizeSearchType("迭代"), "execution");
  assert.equal(normalizeSearchType("project"), "project");
  assert.equal(normalizeSearchType("项目"), "project");

  assert.throws(() => normalizeSearchType("unknown_type"), /Unknown search type/);
});

test("stripHtml and decodeHtmlEntities clean highlighted titles", () => {
  assert.equal(
    stripHtml("设计- <span class='text-danger'>后端</span>- <span class='text-danger'>值班管理优化</span>- 执行测试用例"),
    "设计- 后端- 值班管理优化- 执行测试用例"
  );
  assert.equal(
    stripHtml("<span class='text-danger'>生态市场</span> &gt &gt  知识库 &gt &gt  授权与同步"),
    "生态市场 >> 知识库 >> 授权与同步"
  );
  assert.equal(stripHtml("hello &quot;world&quot; &amp; &lt;test&gt;"), 'hello "world" & <test>');
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml(null), "");
});

test("normalizeSearchItem formats objectID, titles and URLs", () => {
  const raw = {
    id: 96985,
    vision: "rnd",
    objectType: "task",
    objectID: 81605,
    title: "设计- <span class='text-danger'>后端</span>- 值班",
    content: "",
    addedDate: "2026-10-30 18:40:31",
    score: 3,
    url: "/zentao/task-view-81605.json",
  };
  const item = normalizeSearchItem(raw, BASE);
  assert.equal(item.id, 81605);
  assert.equal(item.objectID, 81605);
  assert.equal(item.indexId, 96985);
  assert.equal(item.objectType, "task");
  assert.equal(item.title, "设计- 后端- 值班");
  assert.equal(item.rawTitle, "设计- <span class='text-danger'>后端</span>- 值班");
  assert.equal(item.score, 3);
  assert.equal(item.url, "/zentao/task-view-81605.html");
  assert.equal(item.fullUrl, "https://zentao.example.com/zentao/task-view-81605.html");
});

test("formatSearchSimple returns TSV table", () => {
  const items = [
    {
      objectType: "task",
      objectID: 81605,
      title: "设计- 后端- 值班管理优化- 执行测试用例",
      score: 3,
      addedDate: "2026-10-30",
      url: "/zentao/task-view-81605.html",
    },
    {
      objectType: "testtask",
      objectID: 1521,
      title: "生态市场功能",
      score: 2,
      addedDate: "2026-11-05",
      url: "/zentao/testtask-view-1521.html",
    },
  ];

  const tsv = formatSearchSimple(items);
  const lines = tsv.trim().split("\n");
  assert.equal(lines[0], "type\tid\ttitle\tscore\taddedDate\turl");
  assert.equal(lines[1], "task\t81605\t设计- 后端- 值班管理优化- 执行测试用例\t3\t2026-10-30\t/zentao/task-view-81605.html");
  assert.equal(lines[2], "testtask\t1521\t生态市场功能\t2\t2026-11-05\t/zentao/testtask-view-1521.html");

  const emptyTsv = formatSearchSimple([]);
  assert.equal(emptyTsv, "type\tid\ttitle\tscore\taddedDate\turl\n");
});

test("searchZentao validates required words and queries endpoint", async () => {
  const c = client();
  await assert.rejects(() => searchZentao(c, { words: "" }), /words is required/);

  const mock = mockFetch({
    "/search-index.json": (url) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get("words"), "值班");
      assert.equal(u.searchParams.get("type"), "all");
      assert.equal(u.searchParams.get("zin"), "1");
      return {
        status: "success",
        data: JSON.stringify({
          title: "全文检索",
          type: "all",
          pager: { recTotal: 2, recPerPage: 10, pageTotal: 1, pageID: 1 },
          results: {
            "1": {
              id: 1,
              objectType: "task",
              objectID: 81605,
              title: "值班优化",
              score: 3,
              addedDate: "2026-10-30",
              url: "/zentao/task-view-81605.json",
            },
            "2": {
              id: 2,
              objectType: "bug",
              objectID: 1234,
              title: "值班Bug",
              score: 2,
              addedDate: "2026-11-01",
              url: "/zentao/bug-view-1234.json",
            },
          },
        }),
      };
    },
  });

  try {
    const res = await searchZentao(c, { words: "值班" });
    assert.equal(res.status, 1);
    assert.equal(res.result.words, "值班");
    assert.equal(res.result.total, 2);
    assert.equal(res.result.items.length, 2);
    assert.equal(res.result.items[0].objectID, 81605);
    assert.equal(res.result.items[1].objectID, 1234);
  } finally {
    mock.restore();
  }
});

test("searchZentao filters by type on client side", async () => {
  const c = client();
  const mock = mockFetch({
    "/search-index.json": () => {
      return {
        status: "success",
        data: JSON.stringify({
          title: "全文检索",
          type: "all",
          pager: { recTotal: 2, recPerPage: 10, pageTotal: 1, pageID: 1 },
          results: {
            "1": { id: 1, objectType: "task", objectID: 81605, title: "值班任务", score: 3 },
            "2": { id: 2, objectType: "bug", objectID: 1234, title: "值班Bug", score: 2 },
          },
        }),
      };
    },
  });

  try {
    const res = await searchZentao(c, { words: "值班", type: "bug" });
    assert.equal(res.status, 1);
    assert.equal(res.result.type, "bug");
    assert.equal(res.result.items.length, 1);
    assert.equal(res.result.items[0].objectType, "bug");
    assert.equal(res.result.items[0].objectID, 1234);
  } finally {
    mock.restore();
  }
});

test("searchZentao requests specific page with /search-index-0-N.json", async () => {
  const c = client();
  let requestedPage = null;
  const mock = mockFetch({
    "/search-index-0-2.json": (url) => {
      requestedPage = 2;
      return {
        status: "success",
        data: JSON.stringify({
          title: "全文检索",
          type: "all",
          pager: { recTotal: 15, recPerPage: 10, pageTotal: 2, pageID: 2 },
          results: {
            "11": { id: 11, objectType: "task", objectID: 81699, title: "第2页任务", score: 1 },
          },
        }),
      };
    },
  });

  try {
    const res = await searchZentao(c, { words: "任务", page: 2 });
    assert.equal(requestedPage, 2);
    assert.equal(res.result.page, 2);
    assert.equal(res.result.items.length, 1);
    assert.equal(res.result.items[0].objectID, 81699);
  } finally {
    mock.restore();
  }
});
