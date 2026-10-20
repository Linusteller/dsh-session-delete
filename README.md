# dsh-delete-sessions

给 DeepSeek Harness 增加真正的 **「删除会话」**：从侧栏每个会话的「…」菜单永久删除它，而不是只能「归档」。

## 为什么需要这个插件

DSH 内建的「归档」（archive）只做一件事：把会话 id 加进 `archivedSessionIds` 集合，把它从分组界面里藏起来。它**从不删除磁盘文件**——会话日志（`~/.dsh/sessions/<project>/<id>/session.v4.jsonl.zstd`）和投影缓存（`~/.dsh/storages/session_projcache/sessions/<id>.json`）会一直留在硬盘上。

本插件补上缺失的「删除」：停止该会话正在跑的工作 → 摘除归档/置顶/工作区记账 → 删除投影缓存 → 删除日志目录 → 广播移除事件让界面立即刷新。

## 安装

### 方式一：作为 bundle 安装（推荐）

```bash
dsh plugin --profile desktop add dsh-delete-sessions
```

`cordis.patch.yml` 会自动插入一行，加载插件。

### 方式二：手动安装

1. 把本目录复制到 profile 的 `node_modules/dsh-delete-sessions`（或用 `link:` 依赖）。
2. 在该 profile 自己的 `cordis.patch.yml` 里加一行：

```yaml
- insert:
    - id: dsh-session-delete
      name: 'dsh-delete-sessions'
```

> 注意：手动加行后**不要再**让 `cordis.patch.yml`（本目录里的那份）也被应用，否则同一插件会因 id 冲突重复加载。

3. 重启 DeepSeek Harness。

## 使用

1. 在侧栏任意会话上点「…」。
2. 菜单里「归档会话」正下方会多出「删除会话」（带删除图标，风格与其余菜单项一致）。
3. 点击后确认。删除后该行立即从列表消失。

## 行为细节

删除按固定顺序执行，任何一步失败都会整体报错，避免「界面里没了但磁盘还在」的半完成状态：

1. **停活动** —— 触发 `workspace/session-stop`（与归档「停止并归档」同一条路径，`agent.cancel`），并短暂等待最后一次事件落盘。
2. **摘除记账** —— `unarchiveSession` + `unpinSession` + 逐工作区 `detachSession`（均幂等）。
3. **删投影缓存** —— 走 storage-domain 的 `session_projcache` 域（内存与磁盘同步）；域未挂载时跳过（缓存是派生数据，下次冷读会重建）。
4. **删日志目录** —— 优先用 `sessionPersistence.locate()` 拿精确路径（session id 已被安全编码，无路径穿越风险），带重试处理 Windows 上反病毒/索引短暂占用。
5. **广播移除** —— `api-session/removed` 已在 DSH 的转发白名单中，浏览器会立即移除该行。

## 安全

- 删除路由只接受**回环来源**的 POST，且 body 只承载一个 `sessionId`。
- session id 会先经 `sessionPersistence.stat()` 校验真实存在，才继续删除。
- `locate()` 路径由 DSH 自身的 `encodeSegment` 编码，无路径穿越。

## 局限

- 若 profile 未挂载 `session_projcache` 域或 `~/.dsh/sessions` 无法定位，投影缓存/日志目录可能残留（缓存下次冷读自动重建；日志需手动清理）。
- 删除**不可撤销**，请确认后再点。

## License

MIT
