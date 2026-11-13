import {
  normalizeResult,
  normalizeError,
  toInt,
  normalizeDateInput,
} from "./normalize.js";

export async function listTasks(client, { execution, page, limit }) {
  if (!execution) throw new Error("execution is required");

  const payload = await client.request({
    method: "GET",
    path: `/api.php/v1/executions/${execution}/tasks`,
    query: {
      page: toInt(page, 1),
      limit: toInt(limit, 20),
    },
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function getTask(client, { id }) {
  if (!id) throw new Error("id is required");

  const payload = await client.request({
    method: "GET",
    path: `/api.php/v1/tasks/${id}`,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function createTask(client, {
  execution,
  name,
  assignedTo,
  pri,
  estimate,
  type = "devel",
  desc,
  estStarted,
  deadline,
  story,
  module,
  mailto,
  keywords,
  color,
}) {
  if (!execution) throw new Error("execution is required");
  if (!name) throw new Error("name is required");

  const body = { name, type: type || "devel" };
  if (assignedTo) body.assignedTo = assignedTo;
  if (pri !== undefined && pri !== null && pri !== "") body.pri = Number(pri);
  if (estimate !== undefined && estimate !== null && estimate !== "") body.estimate = Number(estimate);
  if (desc) body.desc = desc;
  if (estStarted) body.estStarted = estStarted;
  if (deadline) body.deadline = deadline;
  if (story) body.story = Number(story);
  if (module) body.module = Number(module);
  if (mailto) body.mailto = Array.isArray(mailto) ? mailto : [mailto];
  if (keywords) body.keywords = keywords;
  if (color) body.color = color;

  const payload = await client.request({
    method: "POST",
    path: `/api.php/v1/executions/${execution}/tasks`,
    body,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function editTask(client, {
  id,
  name,
  execution,
  type,
  status,
  assignedTo,
  pri,
  estimate,
  consumed,
  left,
  desc,
  estStarted,
  deadline,
  story,
  module,
  comment,
}) {
  if (!id) throw new Error("id is required");

  let current = null;
  if (!name || !execution || !type || !status) {
    const existing = await client.request({ method: "GET", path: `/api.php/v1/tasks/${id}` });
    if (existing?.error) return normalizeError(existing.error, existing);
    current = existing;
  }

  const body = {
    name: name ?? current?.name ?? "",
    execution: execution ?? current?.execution ?? 0,
    type: type ?? current?.type ?? "devel",
    status: status ?? current?.status ?? "wait",
  };

  if (assignedTo !== undefined) body.assignedTo = assignedTo;
  if (pri !== undefined && pri !== null && pri !== "") body.pri = Number(pri);
  if (estimate !== undefined && estimate !== null && estimate !== "") body.estimate = Number(estimate);
  if (consumed !== undefined && consumed !== null && consumed !== "") body.consumed = Number(consumed);
  if (left !== undefined && left !== null && left !== "") body.left = Number(left);
  if (desc !== undefined) body.desc = desc;
  if (estStarted !== undefined) body.estStarted = estStarted;
  if (deadline !== undefined) body.deadline = deadline;
  if (story !== undefined) body.story = Number(story);
  if (module !== undefined) body.module = Number(module);
  if (comment) body.comment = comment;

  const payload = await client.request({
    method: "PUT",
    path: `/api.php/v1/tasks/${id}`,
    body,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function startTask(client, { id, consumed, left }) {
  if (!id) throw new Error("id is required");

  const body = {};
  if (consumed !== undefined) body.consumed = Number(consumed);
  if (left !== undefined) body.left = Number(left);

  const payload = await client.request({
    method: "POST",
    path: `/api.php/v1/tasks/${id}/start`,
    body,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function finishTask(client, { id, finishedDate, consumed }) {
  if (!id) throw new Error("id is required");

  const body = {};
  if (finishedDate) body.finishedDate = normalizeDateInput(finishedDate) || finishedDate;
  if (consumed !== undefined) body.consumed = Number(consumed);

  const payload = await client.request({
    method: "POST",
    path: `/api.php/v1/tasks/${id}/finish`,
    body,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function closeTask(client, { id, comment }) {
  if (!id) throw new Error("id is required");

  const body = {};
  if (comment) body.comment = comment;

  const payload = await client.request({
    method: "POST",
    path: `/api.php/v1/tasks/${id}/close`,
    body,
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}

export async function pauseTask(client, { id }) {
  if (!id) throw new Error("id is required");

  const payload = await client.request({
    method: "POST",
    path: `/api.php/v1/tasks/${id}/pause`,
    body: {},
  });

  if (payload.error) return normalizeError(payload.error, payload);
  return normalizeResult(payload);
}
