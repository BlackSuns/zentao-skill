---
name: zentao
description: ZenTao (禅道) 企业私有化部署专属 CLI 与多模态自动化工具。用于查询和操作禅道 Bug、下载并视觉分析 Bug 截图/附件、任务(Task)、需求(Story)、待办(Todo)、产品(Product)、项目(Project)、执行(Execution)、构建(Build)、测试用例(Test Case)、文档库等所有资源，支持 Bug 解决率与解决数量统计。本地已配置好内网免密鉴权与经典 API 兼容层。当用户提及任何禅道操作时，必须强制且唯一使用此 skill 的 zentao 命令行工具，严禁编写临时 Python/curl 脚本或爬虫绕过。
homepage: https://github.com/BlackSuns/zentao-skill
metadata: {"openclaw":{"emoji":"🐞","install":[{"id":"node","kind":"node","package":"@leeguoo/zentao-mcp","bins":["zentao"],"label":"Install zentao CLI (node)"}]}}
---

# zentao (ZenTao CLI - 企业私有化适配与多模态增强版)

用于操作企业私有化部署的禅道管理系统，底层已打通内网鉴权、经典 API 兼容层与 Bug 截图多模态直读能力。

## 核心执行原则（AI 必读）

- **唯一标准途径**：凡是查询、更新、统计禅道数据，**必须**直接使用本 skill 提供的 `zentao` CLI 命令。
- **严禁自行造轮子**：严禁尝试编写 Python 爬虫、curl 脚本或自建 HTTP 请求去直连禅道，本地 CLI 已处理好复杂的会话保持、Token 与企业老版本接口兼容。
- **优先结构化输出**：当需要提取数据、进行分析或后续多步自动化时，优先在命令后追加 `--json` 参数。
- **遇到样式/UI Bug 必须读图**：前端样式或界面缺陷 Bug 通常只包含截图，**排查前必须运行 `zentao bug images --id <id>` 或 `zentao bug get --id <id> --download-images` 下载截图，再使用多模态 `read` 工具查看本地图片**，切勿盲猜代码。

## When to use this skill

Use this skill when the user asks anything about 禅道 / ZenTao, including:

- bugs: list, mine, stats, get, images, create, resolve, assign, comment, close, activate
- bug images: download and inspect screenshots/attachments for UI bugs
- tasks: list, get, create, start, finish, pause, close
- stories: list, get, create
- todos: list, get, create, finish, close
- products, programs, projects, executions
- plans, releases, builds
- test cases, test tasks, test suites
- docs and doc libraries
- users and departments
- issues and risks
- login, whoami, self-test, JSON export

Typical user asks include:

- “帮我查禅道 bug / task / story / todo”
- “看下这个 bug 的截图 / 下载 bug 图片”
- “统计一下 bug 解决率” / “看看各产品的 bug 解决情况”
- “看一下产品、项目、执行、版本、计划、构建”
- “查测试单、测试用例、测试套件”
- “看文档库 / 文档 / 部门 / 用户”
- “查问题 / 风险”
- “帮我登录禅道” / “验证禅道连接”

## Installation

```bash
npx skills add BlackSuns/zentao-skill -y -g
npm i -g @leeguoo/zentao-mcp
```

Fallbacks:

```bash
pnpm i -g @leeguoo/zentao-mcp
npx -y @leeguoo/zentao-mcp --help
```

`skills add` installs the skill definition; the CLI still needs to be available as `zentao` in PATH for normal usage.

## Login

```bash
zentao login --zentao-url="https://zentao.example.com/zentao" --zentao-account="leo" --zentao-password="***"
zentao whoami
```

IMPORTANT: `--zentao-url` usually must include `/zentao`.

## Quick start

```bash
zentao login --zentao-url="https://zentao.example.com/zentao" --zentao-account="leo" --zentao-password="***"
zentao whoami
zentao self-test
```

## Capability map

Use the singular command for one record or a state-changing action, and the plural command for list queries.

```bash
zentao login
zentao whoami
zentao self-test
zentao products list
zentao programs list
zentao projects list
zentao projects builds --id 22
zentao executions list
zentao bugs list --product 6
zentao bugs mine --status active --include-details
zentao bugs stats --product-ids 1,2 --group-by product|person [--from DATE] [--to DATE]
zentao bug get|images|create|resolve|assign|comment|close|activate ...
zentao tasks list --execution 25
zentao task get|create|start|finish|pause|close ...
zentao stories list --product 3
zentao story get|create ...
zentao todos list|get|create|finish|close ...
zentao plans list|get ...
zentao releases list|get ...
zentao testcases list|get ...
zentao testtasks list|get ...
zentao testsuites list|get ...
zentao docs libs|list|get ...
zentao users list
zentao departments list
zentao issues list|get ...
zentao risks list|get ...
```

## Auth and output rules

- All commands can read credentials from saved login config.
- Flags also work: `--zentao-url`, `--zentao-account`, `--zentao-password`
- Environment variables also work: `ZENTAO_URL`, `ZENTAO_ACCOUNT`, `ZENTAO_PASSWORD`
- Add `--json` when the caller wants raw machine-readable output.
- ZenTao URLs usually need the `/zentao` suffix.

## Bug commands

```bash
zentao bugs list --product 6 [--status active|resolved|unclosed|all] [--assigned-to account] [--opened-by account] [--keyword text] [--page N] [--limit N] [--json]
zentao bugs mine --scope assigned --status active --include-details
zentao bug get --id 1329 [--download-images]
zentao bug images --id 1329 [--output-dir <path>]
zentao bug create --product 6 --title "bug title" [--severity 3] [--pri 2] [--type codeerror] [--steps "..."] [--assigned-to account] [--opened-build trunk]
zentao bug resolve --id 1329 --resolution fixed [--resolved-build trunk] [--assigned-to kelly] [--comment "..."]
zentao bug assign --id 1329 --assigned-to rd-yitong [--comment "..."]
zentao bug close --id 1329 [--comment "..."]
zentao bug activate --id 1329 [--assigned-to account] [--comment "..."]
zentao bug comment --id 1329 --comment "已确认，等待修复"
```

Resolution values: `fixed`, `bydesign`, `duplicate`, `postponed`, `notrepro`, `willnotfix`, `tostory`, `external`

### Bug 截图与多模态读图 (Bug Images)

很多前端与业务 Bug 在重现步骤（steps）中只有截图。本工具支持自动鉴权并下载图片至本地：

```bash
# 下载 Bug 关联的所有截图与图片附件（默认保存在 .zentao-images/<bugId>/）
zentao bug images --id 40175

# 指定保存路径
zentao bug images --id 40175 --output-dir ./temp-bug-images

# 获取 Bug 详情的同时自动下载截图
zentao bug get --id 40175 --download-images

# 结合 read 工具查看图片（AI 常用工作流）
# 1. zentao bug images --id 40175
# 2. read({ path: ".zentao-images/40175/40175_img_1_file-read-124035.png" })
```

### Bug stats

```bash
# 按产品统计解决率
zentao bugs stats --product-ids 1,2 --group-by product

# 按人员统计解决率（按实际解决人 resolvedBy 分组）
zentao bugs stats --product-ids 1,2 --group-by person

# 按产品统计指定时间段内的解决数量
zentao bugs stats --product-ids 1,2 --group-by product --from 2026-01-01 --to 2026-04-09

# 按人员统计指定时间段内的解决数量
zentao bugs stats --product-ids 1,2 --group-by person --from 2026-03-01 --to 2026-03-31

# JSON 输出
zentao bugs stats --product-ids 1,2 --group-by product --json
```

- `--product-ids` 必填，逗号分隔
- `--group-by` 支持 `product` 或 `person`，默认 `product`
- 不指定 `--from`/`--to` 时输出解决率；指定时间段时输出该期间的解决数量
- 人员维度按 `resolvedBy`（实际解决人）分组

## Task commands

```bash
zentao tasks list --execution 25
zentao task get --id 388
zentao task create --execution 25 --name "task name" [--assigned-to account] [--pri 3] [--estimate 8] [--type devel] [--desc "..."]
zentao task start --id 388 [--consumed 2] [--left 6]
zentao task finish --id 388 [--finished-date "2026-04-08"] [--consumed 8]
zentao task pause --id 388
zentao task close --id 388 [--comment "done"]
```

## Story commands

```bash
zentao stories list --product 3
zentao story get --id 1
zentao story create --product 3 --title "story title" [--spec "description"] [--pri 2] [--estimate 3] [--type story] [--assigned-to account]
```

## Todo commands

```bash
zentao todos list
zentao todos get --id 1
zentao todos create --name "todo name" [--type custom] [--date 2026-04-08] [--begin 09:00] [--end 10:00] [--pri 3] [--desc "..."] [--assigned-to account]
zentao todos finish --id 1
zentao todos close --id 1
```

## Product, program, project, and execution commands

```bash
zentao products list
zentao programs list
zentao projects list
zentao projects builds --id 22
zentao executions list
```

## Product plans and releases

```bash
zentao plans list --product 3
zentao plans get --id 1
zentao releases list --product 3
zentao releases get --id 1
```

## Testing commands

```bash
zentao testcases list --product 3
zentao testcases get --id 1
zentao testtasks list
zentao testtasks get --id 1
zentao testsuites list --product 3
zentao testsuites get --id 1
```

## Organization & docs

```bash
zentao users list
zentao departments list
zentao docs libs
zentao docs list --lib 50
zentao docs get --id 1
```

## Issues & risks

```bash
zentao issues list
zentao issues get --id 1
zentao risks list
zentao risks get --id 1
```

## JSON output

All commands support `--json` for full JSON payload:

```bash
zentao whoami --json
zentao bugs list --product 6 --json
zentao task get --id 388 --json
zentao users list --json
zentao issues get --id 1 --json
```

## Recommended execution pattern

When helping a user operationally, prefer this sequence:

1. Ensure CLI exists: `zentao --help`
2. Ensure auth exists: `zentao whoami`
3. If auth may be broken, run: `zentao self-test`
4. Use the narrowest command that answers the request.
5. If investigating a UI/visual bug, run: `zentao bug images --id <id>` and read the downloaded image.
6. Add `--json` when the caller needs structured output for follow-up automation.
