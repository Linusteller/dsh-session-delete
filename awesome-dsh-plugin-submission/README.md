# 市场收录目录（Awesome DSH Plugin Submission）

本目录存放提交到 [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 注册表的**草稿**。

## 提交步骤

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
2. 在 fork 的 `data/plugins/` 下新建 `Linusteller__dsh-session-delete.yml`（内容即本目录同名文件）
3. 推分支、开 PR

## 收录前置（CI 会自动检查）

- [x] 仓库 `package.json` 声明 `dsh.bundle.patch`（`./cordis.patch.yml`）
- [x] 仓库打了 `dsh-plugin` topic
- [ ] 仓库满 1 天（创建于本日，需等）
- [ ] 提交数 ≥ 10（当前 1 个，需等）

> 仓库创建时间与提交数需自然累积，CI 检查不通过时 PR 会挂起，等条件满足后自动重跑。

## 字段规范（依据 contributing.md）

- 文件名：`<owner>__<repo>.yml`
- `url`：与仓库地址完全一致
- `name`：`owner/repo`
- `category`：有效值之一，本项目用 `session`
- `description.en`：必填，一行，以句号结尾
- `description.zh`：可选，已补
