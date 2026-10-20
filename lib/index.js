/**
 * dsh-delete-session — 给 DeepSeek Harness 增加真正的「删除会话」。
 *
 * DSH 内建只有「归档」（archive）：它只把会话 id 加进 `archivedSessionIds`
 * 集合，磁盘上的会话日志（`~/.dsh/sessions/<project>/<id>/session.v4.jsonl.zstd`）
 * 与投影缓存（`~/.dsh/storages/session_projcache/sessions/<id>.json`）永远不删。
 *
 * 本插件在侧栏每个会话的「…」菜单里加一个「删除会话」项，点击后由浏览器
 * POST 到本插件的同源路由，宿主持有全部删除权限，按顺序：
 *
 *   1. 停止该会话正在进行的工作（`workspace/session-stop` 触发
 *      `agent.cancel`，与归档的「停止并归档」同一条路径）；
 *   2. 从全局归档集与置顶集移除该 id（`unarchiveSession` / `unpinSession`，
 *      均幂等）；
 *   3. 从每个工作区的 `sessionIds` 记账里 detach（幂等）；
 *   4. 删除投影缓存记录（走 storage-domain 的 `session_projcache` 域，
 *      同步内存与磁盘；域未挂载时跳过）；
 *   5. 删除会话日志目录（优先用 `sessionPersistence.locate()` 拿精确路径，
 *      缺该能力时回退为扫描 `~/.dsh/sessions` 下同名目录）；
 *   6. `ctx.emit('api-session/removed', sessionId)` —— 该事件已在
 *      `dsh-api-remotes` 的转发白名单中，浏览器会立即把这一行从列表移除。
 *
 * 会话 id 经 `sessionPersistence.stat()` 校验真实存在后才继续；`locate()` 内部
 * 用 `encodeSegment` 把 id 编码成安全路径段，因此不会发生路径穿越。
 *
 * @module dsh-delete-session
 */
import { rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Cordis 插件名。 */
export const name = 'dsh-session-delete';

/** 本插件需要的宿主服务；webServer 走可选注入（无 web 的 profile 仍可加载）。 */
export const inject = ['sessionPersistence', 'workspaceRegistry', 'sessions'];

/** 同源删除路由。 */
export const DELETE_SESSION_PATH = '/plugins/dsh-delete-session/delete';

/** 停止活动后、删除前的短暂等待：让 `agent.cancel` 的最后一次 flush 落盘。 */
const STOP_SETTLE_MS = 500;

/** 删除日志目录时，遇到 Windows EBUSY/EPERM 的重试次数与间隔。 */
const RM_RETRY = 6;
const RM_RETRY_GAP_MS = 150;

/** 仅回环来源；其它来源一律拒绝（删除是不可逆操作）。 */
function loopbackOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/** 最大请求体（只承载一个 sessionId）。 */
const MAX_BODY_BYTES = 16 * 1024;

/** 读取一个小 JSON 请求体。 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 应答 JSON。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** 是否有文件系统占用类错误（Windows 删除被占用的目录时会报告）。 */
function isBusyError(error) {
  const code = error && error.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY';
}

/** 带重试的递归删除：停止活动后，反病毒/索引可能短暂占用日志文件。 */
async function rmWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < RM_RETRY; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isBusyError(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, RM_RETRY_GAP_MS));
    }
  }
  throw lastError;
}

/** 会话是否真实存在（live 或持久化均可）。 */
async function sessionExists(ctx, sessionId) {
  if (ctx.sessions.get(sessionId) !== undefined) return true;
  try {
    return (await ctx.sessionPersistence.stat(sessionId)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * 删除会话日志目录。
 *
 * 首选 `sessionPersistence.locate(meta)`（jsonl 后端公开）：它返回该会话
 * 日志文件的绝对路径（id 已经 `encodeSegment` 安全编码），目录即其父目录。
 * 该能力缺失时，回退为在 `~/.dsh/sessions` 下递归寻找 basename 恰为 sessionId
 * 的目录（当前会话 id 形如 `session-<uuid>`，均为路径安全字符，编码后恒等）。
 */
async function removeSessionLog(ctx, meta) {
  const persistence = ctx.sessionPersistence;
  if (typeof persistence.locate === 'function') {
    const located = persistence.locate(meta);
    if (located && typeof located.path === 'string' && located.path !== '') {
      await rmWithRetry(dirname(located.path));
      return;
    }
  }
  // 回退：扫描默认 home 下的 sessions 根。无法定位 home 时只删投影缓存，
  // 日志目录由用户下次手动清理（此处不 throw，避免半途失败）。
  let home;
  try {
    const { resolveDshHome } = await import('@deepseek-ai/dsh-home-paths');
    home = resolveDshHome();
  } catch {
    return;
  }
  const sessionsRoot = join(home, 'sessions');
  let projects;
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return; // 无 sessions 根：没有日志可删。
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(sessionsRoot, project.name);
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.isDirectory() && child.name === meta.id) {
        await rmWithRetry(join(dir, child.name));
        return;
      }
    }
  }
}

/**
 * 删除会话的完整清理。返回 `{ ok: true }` 或 `{ ok: false, error }`。
 *
 * 清理顺序经过刻意设计：先停活动（让最后一次事件落盘），再摘除所有指向该
 * id 的记账（归档/置顶/工作区），再删投影缓存，最后删日志目录；任何一步
 * 失败都立即报错，保证不出现「UI 里没了但磁盘还在」的半完成状态。
 */
export async function deleteSession(ctx, sessionId) {
  // 0. 校验：id 必须是真实存在的会话。live 会话优先用其精确 header，
  //    否则回退到持久化的 stat（cold 会话）。
  const live = ctx.sessions.get(sessionId);
  let meta;
  if (live !== undefined) {
    meta = live.header;
  } else {
    const stat = await ctx.sessionPersistence.stat(sessionId);
    if (stat === undefined) {
      return { ok: false, error: 'session not found' };
    }
    meta = stat.header;
  }

  // 1. 停止活动。`workspace/session-stop` 由 agent 的归档准入安装，
  //    会把正在运行的回合按用户停止的方式取消；无活动时是 no-op。
  try {
    await ctx.parallel('workspace/session-stop', { sessionId });
  } catch {
    // 停止失败不应阻断删除：归档的「停止并归档」也只记录警告。
  }
  // 让 cancel 引发的最后一次事件 flush 落盘，避免删目录与 flush 重建竞态。
  await new Promise((resolve) => setTimeout(resolve, STOP_SETTLE_MS));

  // 2. 摘除归档 / 置顶（均幂等；归档与置顶互斥，先摘归档再摘置顶顺序安全）。
  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId);
  } catch {
    /* 未归档或 registry 异常都继续 */
  }
  try {
    await ctx.workspaceRegistry.unpinSession(sessionId);
  } catch {
    /* 未置顶或 registry 异常都继续 */
  }

  // 3. 从每个工作区记账 detach（幂等：不在列表即 no-op）。
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue;
    await workspace.detachSession(sessionId);
  }

  // 4. 删除投影缓存（走 domain，同步内存与磁盘；未挂载则跳过）。
  try {
    const domain = ctx.get('storageDomain');
    const projcache = typeof domain?.get === 'function' ? domain.get('session_projcache') : undefined;
    if (projcache) await projcache.table('sessions').delete(sessionId);
  } catch {
    /* 缓存是派生数据，删不掉下次冷读也会重建；不阻断删除 */
  }

  // 5. 删除日志目录（含 session.v4.jsonl.zstd 与可能的 session.lock）。
  await removeSessionLog(ctx, meta);

  // 6. 广播移除：api-remotes 把该事件转发到浏览器，UI 立即移除该行。
  ctx.emit('api-session/removed', sessionId);

  return { ok: true };
}

/**
 * 删除路由处理器：只接受回环来源的 POST，body 为一个 sessionId。
 * @param req - 请求。
 * @param res - 响应。
 */
export async function handleDeleteRequest(ctx, req, res) {
  try {
    if ((req.method ?? 'POST').toUpperCase() !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!loopbackOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'origin not trusted' });
      return;
    }
    const body = await readJsonBody(req);
    const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (sessionId === '') {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    if (!(await sessionExists(ctx, sessionId))) {
      sendJson(res, 404, { ok: false, error: 'session not found' });
      return;
    }
    const result = await deleteSession(ctx, sessionId);
    if (result.ok) {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 500, { ok: false, error: result.error });
    }
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Cordis 插件入口。 */
export function apply(ctx) {
  // webServer 为可选服务：headless profile 无路由，但插件本体仍加载。
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({
          kind: 'exact',
          path: DELETE_SESSION_PATH,
          handler: (req, res) => handleDeleteRequest(ctx, req, res),
        }), 'dsh-delete-session: delete route');
      });
    }
  } catch {
    /* 无 webServer：不注册路由 */
  }
}
