import { normalizeResult, normalizeError, toInt } from "./normalize.js";

export const TYPE_ALIASES = {
  all: "all",
  全部: "all",
  "*": "all",

  task: "task",
  tasks: "task",
  任务: "task",

  case: "case",
  cases: "case",
  testcase: "case",
  testcases: "case",
  用例: "case",
  测试用例: "case",

  bug: "bug",
  bugs: "bug",
  缺陷: "bug",

  story: "story",
  stories: "story",
  需求: "story",
  研发需求: "story",

  testtask: "testtask",
  testtasks: "testtask",
  测试单: "testtask",

  doc: "doc",
  docs: "doc",
  文档: "doc",

  project: "project",
  projects: "project",
  项目: "project",

  execution: "execution",
  executions: "execution",
  迭代: "execution",
  执行: "execution",

  build: "build",
  builds: "build",
  版本: "build",

  release: "release",
  releases: "release",
  发布: "release",

  product: "product",
  products: "product",
  产品: "product",

  plan: "productplan",
  plans: "productplan",
  productplan: "productplan",
  计划: "productplan",

  program: "program",
  programs: "program",
  项目集: "program",
};

export function normalizeSearchType(type) {
  if (!type) return "all";
  const key = String(type).trim().toLowerCase();
  const matched = TYPE_ALIASES[key] || TYPE_ALIASES[String(type).trim()];
  if (!matched) {
    throw new Error(
      `Unknown search type "${type}". Valid types: all, task, case, bug, story, testtask, doc, project, execution, build, release, product, plan, program.`
    );
  }
  return matched;
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;?/g, "<")
    .replace(/&gt;?/g, ">")
    .replace(/>\s*>/g, ">>")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function stripHtml(value) {
  if (value === undefined || value === null) return "";
  const withoutTags = String(value).replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

export function normalizeSearchItem(raw, baseUrl = "") {
  const objectType = String(raw?.objectType ?? "");
  const objectID = Number(raw?.objectID) || raw?.objectID;
  const rawUrl = String(raw?.url ?? "");
  const htmlUrl = rawUrl.replace(/\.json(\?|$)/, ".html$1");
  const cleanUrl = htmlUrl.startsWith("/") ? htmlUrl : `/${htmlUrl}`;
  const fullUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}${cleanUrl.replace(/^\/zentao/, "")}`
    : cleanUrl;

  return {
    id: objectID,
    indexId: raw?.id,
    objectType,
    objectID,
    title: stripHtml(raw?.title),
    rawTitle: raw?.title ?? "",
    score: Number(raw?.score) || 0,
    addedDate: raw?.addedDate ?? "",
    editedDate: raw?.editedDate ?? "",
    summary: stripHtml(raw?.summary ?? raw?.content ?? ""),
    url: cleanUrl,
    fullUrl,
  };
}

export async function searchZentao(client, { words, type = "all", page, limit = 20 } = {}) {
  if (!words || !String(words).trim()) {
    throw new Error("words is required");
  }

  const queryWords = String(words).trim();
  const normalizedType = normalizeSearchType(type);
  const targetPage = page !== undefined && page !== null && page !== "" ? toInt(page, 1) : null;
  const targetLimit = toInt(limit, 20);

  async function fetchPage(pageNumber) {
    const path = pageNumber <= 1 ? "/search-index.json" : `/search-index-0-${pageNumber}.json`;
    const res = await client.request({
      method: "GET",
      path,
      query: {
        words: queryWords,
        type: "all",
        zin: 1,
      },
    });

    if (res?.error) return { error: res.error };
    let data = res?.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (err) {
        return { error: `Failed to parse search response: ${err.message}` };
      }
    }
    return { data };
  }

  // If a specific page is requested
  if (targetPage !== null) {
    const { data, error } = await fetchPage(targetPage);
    if (error) return normalizeError(error);

    const pager = data?.pager || {};
    const rawResults = data?.results ? Object.values(data.results) : [];

    const items = rawResults
      .map((item) => normalizeSearchItem(item, client.baseUrl))
      .filter((item) => {
        if (normalizedType === "all") return true;
        return item.objectType === normalizedType;
      });

    return normalizeResult({
      words: queryWords,
      type: normalizedType,
      total: pager.recTotal ?? items.length,
      page: targetPage,
      pageTotal: pager.pageTotal ?? 1,
      items,
    });
  }

  // Otherwise, auto-page starting from page 1 up to targetLimit items
  let currentPage = 1;
  let totalRec = 0;
  let pageTotal = 1;
  const collectedItems = [];
  const maxPages = 10;

  while (currentPage <= maxPages) {
    const { data, error } = await fetchPage(currentPage);
    if (error) {
      if (collectedItems.length > 0) break;
      return normalizeError(error);
    }

    const pager = data?.pager || {};
    totalRec = pager.recTotal ?? totalRec;
    pageTotal = pager.pageTotal ?? pageTotal;
    const rawResults = data?.results ? Object.values(data.results) : [];
    if (rawResults.length === 0) break;

    for (const raw of rawResults) {
      const item = normalizeSearchItem(raw, client.baseUrl);
      if (normalizedType === "all" || item.objectType === normalizedType) {
        collectedItems.push(item);
      }
      if (collectedItems.length >= targetLimit) break;
    }

    if (collectedItems.length >= targetLimit || currentPage >= pageTotal) {
      break;
    }

    currentPage += 1;
  }

  return normalizeResult({
    words: queryWords,
    type: normalizedType,
    total: totalRec,
    page: 1,
    pageTotal,
    items: collectedItems.slice(0, targetLimit),
  });
}
