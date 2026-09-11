// Rotas dedicadas do quadro de Tarefas (nível Asana). Tudo sob /api/tasks
// herda o guard da tela `tasks` (screens.js, por prefixo); as notificações
// ficam em /api/notifications, FORA do guard de propósito: quem não tem a tela
// ainda precisa saber que foi atribuído/mencionado (mesma régua do /api/feedback).
//
// Erro de domínio sai SEMPRE em 4xx com { error, code } (o proxy do EasyPanel
// engole 5xx e mostra "Service is not reachable" no lugar do motivo).

import { randomUUID } from "node:crypto";
import { isAdmin } from "./routes.flashcards.js";
import {
  ACTOR_API, ASSET_PREFIX, moveTask, completeTask, addComment, editComment, deleteComment, toggleCommentLike, toggleLike,
  setFollower, setBlocker, addAttachment, removeAttachment, setCover, convertTask, duplicateTask, followUpTask,
  createTask, activityOf, bulkTasks, listNotifications, markNotificationsRead, httpError,
} from "./tasks-core.js";

const MAX_ASSET = 5 * 1024 * 1024;

// Handler → 4xx legível quando a regra de negócio recusa (statusCode no erro).
const guarded = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (err) {
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
    throw err;
  }
};
const actorOf = (req) => req.authUser?.id || ACTOR_API;
const notFound = (reply) => reply.code(404).send({ error: "Not found" });

// Arquivo anexado a uma tarefa: bytes em base64 em `task_assets` (fora do CRUD
// genérico), servido em /public/tasks/:id (id randômico é a chave; <img> não
// manda header). `imagesOnly` mantém o contrato antigo do widget de feedback e
// do mapa mental (só imagem); o anexo de tarefa aceita qualquer arquivo ≤ 5MB.
export function makeTaskAssetHandler(repo, { imagesOnly = false } = {}) {
  return async (req, reply) => {
    let file;
    try { file = await req.file({ limits: { fileSize: MAX_ASSET } }); }
    catch (err) { return reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large", detail: err?.message }); }
    if (!file) return reply.code(400).send({ error: imagesOnly ? "envie uma imagem (multipart, campo file)" : "envie um arquivo (multipart, campo file)" });
    if (imagesOnly && !/^image\//.test(file.mimetype || "")) return reply.code(400).send({ error: "só aceito imagem" });
    let buf;
    try { buf = await file.toBuffer(); }
    catch { return reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large" }); }
    if (buf.length > MAX_ASSET) return reply.code(413).send({ error: imagesOnly ? "imagem acima de 5MB: recorte ou comprima" : "arquivo acima de 5MB", code: "asset_too_large" });
    const id = `tka_${randomUUID()}`;
    await repo.create("task_assets", {
      id, mime: file.mimetype || "application/octet-stream", size: buf.length, name: file.filename || "",
      data: buf.toString("base64"), by: req.authUser?.id || "", at: new Date().toISOString(),
    });
    return { id, url: `${ASSET_PREFIX}${id}`, name: file.filename || "", mime: file.mimetype || "", size: buf.length };
  };
}

export function registerTaskRoutes(app, repo) {
  const anyFile = makeTaskAssetHandler(repo);
  const imageOnly = makeTaskAssetHandler(repo, { imagesOnly: true });
  app.post("/api/tasks/asset", anyFile);
  // O widget de feedback e o mapa mental usam o MESMO asset por rota própria:
  // /api/tasks/* exige a tela "tasks" e eles vivem em toda tela.
  app.post("/api/feedback/asset", imageOnly);
  app.post("/api/mindmaps/asset", imageOnly);

  app.get("/public/tasks/:id", async (req, reply) => {
    const doc = await repo.get("task_assets", req.params.id);
    if (!doc) return reply.code(404).send({ error: "arquivo não encontrado" });
    const mime = doc.mime || "application/octet-stream";
    const inline = /^image\//.test(mime) || mime === "application/pdf";
    const safeName = String(doc.name || doc.id).replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
    return reply.type(mime).send(Buffer.from(doc.data || "", "base64"));
  });

  // ── Movimento, conclusão, ações em massa ──────────────────────────────────
  app.post("/api/tasks/bulk", guarded(async (req) => bulkTasks(repo, req.body || {}, { by: actorOf(req) })));

  app.post("/api/tasks/:id/move", guarded(async (req, reply) => {
    const r = await moveTask(repo, req.params.id, req.body || {}, { by: actorOf(req) });
    return r || notFound(reply);
  }));
  app.post("/api/tasks/:id/complete", guarded(async (req, reply) => {
    const value = req.body?.completed === undefined ? true : req.body.completed === true;
    const r = await completeTask(repo, req.params.id, value, { by: actorOf(req) });
    return r || notFound(reply);
  }));
  app.get("/api/tasks/:id/activity", guarded(async (req, reply) => {
    const items = await activityOf(repo, req.params.id, { limit: req.query?.limit });
    return items || notFound(reply);
  }));

  // ── Comentários e curtidas ────────────────────────────────────────────────
  app.post("/api/tasks/:id/comments", guarded(async (req, reply) => {
    const r = await addComment(repo, req.params.id, req.body?.text, { by: actorOf(req) });
    return r ? reply.code(201).send(r) : notFound(reply);
  }));
  app.patch("/api/tasks/:id/comments/:cid", guarded(async (req, reply) => {
    const r = await editComment(repo, req.params.id, req.params.cid, req.body?.text, { by: actorOf(req), admin: isAdmin(req.authUser) });
    if (!r) return notFound(reply);
    return { comment: (r.task.comments || []).find((c) => String(c.id) === String(req.params.cid)), task: r.task };
  }));
  app.delete("/api/tasks/:id/comments/:cid", guarded(async (req, reply) => {
    const r = await deleteComment(repo, req.params.id, req.params.cid, { by: actorOf(req), admin: isAdmin(req.authUser) });
    return r ? { ok: true, task: r.task } : notFound(reply);
  }));
  app.post("/api/tasks/:id/comments/:cid/like", guarded(async (req, reply) => {
    const r = await toggleCommentLike(repo, req.params.id, req.params.cid, { by: actorOf(req) });
    return r || notFound(reply);
  }));
  app.post("/api/tasks/:id/like", guarded(async (req, reply) => {
    const r = await toggleLike(repo, req.params.id, { by: actorOf(req) });
    return r || notFound(reply);
  }));

  // ── Seguidores, bloqueios ─────────────────────────────────────────────────
  app.post("/api/tasks/:id/followers", guarded(async (req, reply) => {
    const user = req.body?.user || actorOf(req);
    if (user === ACTOR_API) throw httpError(400, "informe a pessoa (user)", "user_required");
    const r = await setFollower(repo, req.params.id, user, true, { by: actorOf(req) });
    return r ? { followers: r.task.followers || [], task: r.task } : notFound(reply);
  }));
  app.delete("/api/tasks/:id/followers/:user", guarded(async (req, reply) => {
    const r = await setFollower(repo, req.params.id, req.params.user, false, { by: actorOf(req) });
    return r ? { followers: r.task.followers || [], task: r.task } : notFound(reply);
  }));
  app.post("/api/tasks/:id/blockers", guarded(async (req, reply) => {
    const r = await setBlocker(repo, req.params.id, req.body?.taskId, true, { by: actorOf(req) });
    return r ? r.task : notFound(reply);
  }));
  app.delete("/api/tasks/:id/blockers/:blockerId", guarded(async (req, reply) => {
    const r = await setBlocker(repo, req.params.id, req.params.blockerId, false, { by: actorOf(req) });
    return r ? r.task : notFound(reply);
  }));

  // ── Subtarefas, converter, duplicar, acompanhamento ───────────────────────
  app.post("/api/tasks/:id/subtasks", guarded(async (req, reply) => {
    const parent = await repo.get("tasks", req.params.id);
    if (!parent) return notFound(reply);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const created = await createTask(repo, { ...body, parentId: parent.id, column: body.column || parent.column, saas: body.saas ?? parent.saas }, { by: actorOf(req) });
    return reply.code(201).send(created);
  }));
  app.post("/api/tasks/:id/convert", guarded(async (req, reply) => {
    const r = await convertTask(repo, req.params.id, { to: req.body?.to, parentId: req.body?.parentId }, { by: actorOf(req) });
    return r ? r.task : notFound(reply);
  }));
  app.post("/api/tasks/:id/duplicate", guarded(async (req, reply) => {
    const b = req.body || {};
    const copy = await duplicateTask(repo, req.params.id, { title: b.title, includeSubtasks: b.includeSubtasks !== false, includeAttachments: b.includeAttachments !== false }, { by: actorOf(req) });
    return copy ? reply.code(201).send(copy) : notFound(reply);
  }));
  app.post("/api/tasks/:id/follow-up", guarded(async (req, reply) => {
    const b = req.body || {};
    const created = await followUpTask(repo, req.params.id, { title: b.title, dueDate: b.dueDate, assignees: Array.isArray(b.assignees) ? b.assignees : null }, { by: actorOf(req) });
    return created ? reply.code(201).send(created) : notFound(reply);
  }));

  // ── Anexos e capa ─────────────────────────────────────────────────────────
  app.post("/api/tasks/:id/attachments", guarded(async (req, reply) => {
    const task = await repo.get("tasks", req.params.id);
    if (!task) return notFound(reply);
    const up = await anyFile(req, reply);
    if (reply.sent || !up?.id) return up; // erro já respondido pelo handler do asset
    const r = await addAttachment(repo, task.id, { id: up.id, url: up.url, name: up.name, mime: up.mime, size: up.size }, { by: actorOf(req) });
    const attachment = (r.task.attachments || []).find((a) => a.id === up.id) || null;
    return reply.code(201).send({ attachment, task: r.task });
  }));
  app.delete("/api/tasks/:id/attachments/:aid", guarded(async (req, reply) => {
    const r = await removeAttachment(repo, req.params.id, req.params.aid, { by: actorOf(req) });
    return r ? r.task : notFound(reply);
  }));
  app.post("/api/tasks/:id/cover", guarded(async (req, reply) => {
    const r = await setCover(repo, req.params.id, req.body?.attachmentId ?? "", { by: actorOf(req) });
    return r ? r.task : notFound(reply);
  }));

  // ── Caixa de entrada (fora do guard de telas) ─────────────────────────────
  const inboxUser = (req) => {
    if (req.authUser?.id) return req.authUser.id;
    const u = String(req.query?.user || req.body?.user || "").trim();
    if (!u) throw httpError(400, "com a chave mestre, informe ?user=", "user_required");
    return u;
  };
  app.get("/api/notifications", guarded(async (req) => {
    const q = req.query || {};
    return listNotifications(repo, inboxUser(req), { unread: q.unread === "1" || q.unread === "true", limit: q.limit });
  }));
  app.post("/api/notifications/read", guarded(async (req) => {
    const b = req.body || {};
    const marked = await markNotificationsRead(repo, inboxUser(req), { ids: Array.isArray(b.ids) ? b.ids : [], all: b.all === true });
    return { ok: true, marked };
  }));
}
