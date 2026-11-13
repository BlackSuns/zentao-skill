export function normalizeResult(payload) {
  return { status: 1, msg: "success", result: payload };
}

export function normalizeError(message, payload) {
  return { status: 0, msg: message || "error", result: payload ?? [] };
}

export function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function normalizeAccountValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function extractAccounts(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const normalized = normalizeAccountValue(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractAccounts(item));
  }
  if (typeof value === "object") {
    if (value.account) return extractAccounts(value.account);
    if (value.user) return extractAccounts(value.user);
    if (value.name) return extractAccounts(value.name);
    if (value.realname) return extractAccounts(value.realname);
    return [];
  }
  return [];
}

export function matchesAccount(value, matchAccount) {
  const candidates = extractAccounts(value);
  return candidates.includes(matchAccount);
}

export function formatYMD(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateInput(value) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const text = String(value).trim();
  const lower = text.toLowerCase();

  const now = new Date();
  if (lower === "today" || lower === "td" || text === "今天" || text === "当日") {
    return formatYMD(now);
  }
  if (lower === "tomorrow" || lower === "tm" || text === "明天" || text === "次日") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatYMD(d);
  }
  if (lower === "yesterday" || lower === "yd" || text === "昨天") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return formatYMD(d);
  }

  const m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const year = m[1];
    const month = m[2].padStart(2, "0");
    const day = m[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const mDigits = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (mDigits) {
    return `${mDigits[1]}-${mDigits[2]}-${mDigits[3]}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return formatYMD(parsed);
  }

  throw new Error(`Invalid date "${value}". Use YYYY-MM-DD, today or tomorrow.`);
}

export function parseExecutionRef(value) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const text = String(value).trim();
  if (/^#?\d+$/.test(text)) return Number(text.replace(/^#/, ""));
  const match = text.match(/execution-(?:task|view|story|bug|testtask|build|action|tree|kanban|burn|all)-(\d+)/i);
  if (match) return Number(match[1]);
  const generalMatch = text.match(/execution[_-](\d+)/i);
  if (generalMatch) return Number(generalMatch[1]);
  const query = text.match(/[?&](?:executionID|executionId|execution|projectID)=(\d+)/i);
  if (query) return Number(query[1]);
  return null;
}

export function parseStoryRef(value) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const text = String(value).trim();
  if (/^#?\d+$/.test(text)) return Number(text.replace(/^#/, ""));
  const match = text.match(/story-(?:view|browse|track|change|review)-(\d+)/i);
  if (match) return Number(match[1]);
  const generalMatch = text.match(/story[_-](\d+)/i);
  if (generalMatch) return Number(generalMatch[1]);
  const query = text.match(/[?&](?:storyID|storyId|story)=(\d+)/i);
  if (query) return Number(query[1]);
  return null;
}

export function parseTaskRef(value) {
  if (value === undefined || value === null || value === true || value === "") return null;
  const text = String(value).trim();
  if (/^#?\d+$/.test(text)) return Number(text.replace(/^#/, ""));
  const match = text.match(/task-(?:view|edit|finish|start|close|activate|cancel|pause|assignTo|delete)-(\d+)/i);
  if (match) return Number(match[1]);
  const generalMatch = text.match(/task[_-](\d+)/i);
  if (generalMatch) return Number(generalMatch[1]);
  const query = text.match(/[?&](?:taskID|taskId|task)=(\d+)/i);
  if (query) return Number(query[1]);
  return null;
}
