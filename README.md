# zentao-skill

专为 AI 编码助手（Pi / Codex / Claude Code 等）及工程师打造的禅道 (ZenTao) CLI 命令行工具与 Agent Skill。

深度适配企业私有化部署版本及经典 REST API，内置 Bug 截图自动鉴权下载与多模态读图分析能力。

零依赖、纯原生 Node.js，装完即用。

## 快速安装

通过 Agent Skills 安装技能：

```bash
npx skills add BlackSuns/zentao-skill -y -g
```

本地全局安装 CLI 命令：

```bash
npm i -g @leeguoo/zentao-mcp
```

或使用当前仓库源码链接：

```bash
cd D:\Projects\zentao-skill
npm link
```

不想全局安装？可直接执行：

```bash
node src/index.js --help
```

`skills add` 负责安装 AI Skill 定义；CLI 建议全局安装或 link 后直接在终端使用 `zentao` 命令。

## 升级

```bash
zentao self-update --check   # 只看当前版本和最新版本，不改任何东西
zentao self-update           # 确认后用原来安装它的 npm / pnpm 升级（脚本里加 --yes）
zentao self-update --to 0.7.0 --yes   # 装指定版本
```

- 只读取 npm registry 的公开版本信息，再调用当初安装它的包管理器（`npm i -g` 或 `pnpm add -g`）。npx 运行、git 源码目录或识别不出来的安装方式不会被改动，只给出手动升级命令。
- 不登录禅道，不改 `~/.config/zentao/config.toml`，不发版。升级后会核对版本并离线跑一次 `--help`，失败就装回原来的版本。
- `--json` 输出 `current` / `target` / `result` 等字段，方便脚本和 AI 助手读取。
- skill 文件要单独更新：重新执行 `npx skills add BlackSuns/zentao-skill -y -g`（会覆盖你对 SKILL.md 的本地修改）。
- `zentao release` 是维护者发版用的，不是升级命令。

## 登录

只需登录一次，凭据会保存到本地配置文件：

```bash
zentao login \
  --zentao-url=http://172.31.80.150:81/zentao \
  --zentao-account=你的账号 \
  --zentao-password=你的密码
```

> **注意：** URL 通常需要包含 `/zentao` 路径。如果登录时看到 404，多半是少了这段。

验证登录状态：

```bash
zentao whoami
```

配置文件位置：`~/.config/zentao/config.toml`

## 支持的能力

当前 CLI 已支持这些对象和动作：

- 认证与连通性：`login`、`whoami`、`self-test`
- Bug：列表、查询、**截图下载 (images)**、创建、指派、评论、解决、关闭、激活、查我的 Bug、解决率统计
- 任务：列表、查询、创建、开始、完成、暂停、关闭
- 需求：列表、查询、创建
- 待办：列表、查询、创建、完成、关闭
- 产品 / 项目 / 项目集 / 执行：列表，项目构建查询
- 计划 / 发布：列表、详情
- 测试用例 / 测试单 / 测试套件：列表、详情；测试单按名称搜索
- 测试单执行：按 id / 链接 / 名称定位测试单，列出全部用例，按执行结果、关键字、优先级筛选，提交通过 / 失败 / 阻塞 / 忽略
- 文档库 / 文档：列表、详情
- 用户 / 部门：列表
- 问题 / 风险：列表、详情
- 机器可读输出：全部命令支持 `--json`

## 日常使用

### 查看产品列表

```bash
zentao products list
```

### 查看某个产品的 Bug

```bash
zentao bugs list --product 6
```

### 查看 Bug 详情

```bash
zentao bug get --id 1329
```

### 查看分配给我的 Bug

```bash
zentao bugs mine --status active
```

带详情：

```bash
zentao bugs mine --status active --include-details
```

### Bug 截图下载与多模态分析

前端与 UI 界面缺陷 Bug 在重现步骤中往往包含截图与红线标注，而禅道系统对附件图片加了权限校验，外部工具无法直接读取。本工具提供原生截图解析与鉴权下载能力：

```bash
# 自动提取并下载 Bug 关联的所有截图与附件（默认保存在 .zentao-images/<bugId>/）
zentao bug images --id 40175

# 指定本地存放目录
zentao bug images --id 40175 --output-dir ./my-bug-images

# 查询 Bug 详情并一键拉取截图
zentao bug get --id 40175 --download-images
```

配合 AI Agent 的多模态视觉能力（如 `read` 工具），可直接读取图片排查界面错位与样式问题，避免纯文本猜测代码。

### 执行测试单

测试单可以用 id、禅道页面链接或名称指定。名称匹配到多个测试单时会列出候选，不会自动挑选。用例列表会翻完所有分页，不受网页每页 20 条的限制。

```bash
# 查找测试单
zentao testtasks list --keyword 生态市场 --product 142

# 测试单概况：总数、未执行、通过、失败、阻塞
zentao testtask get --id 1521
zentao testtask get --name "生态市场功能"

# 筛选用例：按执行结果（unrun / pass / fail / blocked / n/a / done / all，可逗号组合）与关键字
zentao testtask cases --id 1521 --result unrun
zentao testtask cases --id 1521 --keyword "Skill 下架" --result unrun,fail

# 查看单条用例：标题、前置条件、步骤、历史执行记录
zentao testtask case --run 43402 --history

# 提交执行结果（fail / blocked 必须用 --real 写明实际结果）
zentao testtask run --run 43402 --result pass
zentao testtask run --run 43402,43403 --result pass
zentao testtask run --run 43402 --result fail --real "点击下架后列表仍显示该 Skill"
```

`run` 是测试单内的执行 ID（列表中的 `run` 列），`case` 是用例 ID；`case` / `run` 子命令也可以用 `--case <用例ID> --id <测试单>` 定位。提交后会回读该执行记录，只有禅道确实记下新结果才报告成功。

### 需要原始 JSON？

任何命令后面加 `--json`：

```bash
zentao products list --json
zentao bugs list --product 6 --json
zentao bug get --id 1329 --json
zentao bugs mine --include-details --json
```

### 自检

验证 API 连接是否正常：

```bash
zentao self-test
```

## 命令总览

```bash
zentao login --zentao-url=... --zentao-account=... --zentao-password=...
zentao whoami
zentao self-test
zentao self-update --check

zentao products list
zentao programs list
zentao projects list
zentao projects builds --id 22
zentao executions list

zentao bugs list --product 6
zentao bugs mine --status active --include-details
zentao bug get --id 1329
zentao bug create --product 6 --title "bug title"
zentao bug assign --id 1329 --assigned-to someone
zentao bug resolve --id 1329 --resolution fixed
zentao bug close --id 1329
zentao bug activate --id 1329
zentao bug comment --id 1329 --comment "comment"

zentao tasks list --execution 25
zentao task get --id 388
zentao task create --execution 25 --name "task name"
zentao task start --id 388
zentao task finish --id 388
zentao task pause --id 388
zentao task close --id 388

zentao stories list --product 3
zentao story get --id 1
zentao story create --product 3 --title "story title"

zentao todos list
zentao todos get --id 1
zentao todos create --name "todo name"
zentao todos finish --id 1
zentao todos close --id 1

zentao plans list --product 3
zentao plans get --id 1
zentao releases list --product 3
zentao releases get --id 1

zentao testcases list --product 3
zentao testcases get --id 1
zentao testtasks list
zentao testtasks get --id 1
zentao testtask get --id 1521
zentao testtask cases --id 1521 --result unrun --keyword "关键字"
zentao testtask case --run 43402
zentao testtask run --run 43402 --result pass
zentao testsuites list --product 3
zentao testsuites get --id 1

zentao docs libs
zentao docs list --lib 50
zentao docs get --id 1
zentao users list
zentao departments list
zentao issues list
zentao issues get --id 1
zentao risks list
zentao risks get --id 1
```

## 让 AI 帮你查禅道

只需对你的 AI 助手（Cursor / Claude Code / Windsurf / Pi 等）说：

> 帮我执行 `npx skills add BlackSuns/zentao-skill -y -g`，然后帮我登录禅道

安装后你就可以直接说：

- "看下 Bug #40175 的截图并排查样式问题"
- "帮我看下产品 6 有哪些未解决的 Bug"
- "查一下 Bug #1329 的详情"
- "我名下还有多少活跃 Bug？"
- "帮我看执行 25 下有哪些任务"
- "查一下产品 3 的需求 / 计划 / 发布"
- "列出测试单、测试用例、测试套件"
- "把测试单 1521 里还没执行的用例逐条验证，验证通过的点通过"
- "看一下项目问题和风险"
- "打开文档库 50 里的文档列表"

---

<!-- AI_SKILL_INSTALL: 以下内容供 AI 助手自动安装时读取 -->

<details>
<summary><strong>AI Skill 自动安装指引（AI 可直接执行）</strong></summary>

当用户要求安装本仓库为 skill 时，请按顺序执行：

**1. 安装 Skill**

```bash
npx skills add BlackSuns/zentao-skill -y -g
```

**2. 安装 CLI**

```bash
npm i -g @leeguoo/zentao-mcp
```

**3. 验证安装**

```bash
zentao --help
```

**4. 引导登录**

提示用户提供禅道 URL、账号和密码，然后执行：

```bash
zentao login --zentao-url="<用户的禅道URL>" --zentao-account="<账号>" --zentao-password="<密码>"
```

> 注意：URL 通常需要包含 `/zentao`，如 `http://172.31.80.150:81/zentao`

**5. 验证**

```bash
zentao whoami
zentao self-test
```

全部通过后告知用户安装完成。

</details>

## 常见问题

**Q: 登录时报 404？**
A: URL 需要包含 `/zentao`，比如 `https://zentao.example.com/zentao`，而不是 `https://zentao.example.com/`。

**Q: 支持哪些禅道版本？**
A: 针对企业私有化部署经典 API 和开源版 REST API（v1）进行了深度兼容，并打通了 Token 鉴权图片直下功能。

**Q: 凭据安全吗？**
A: 凭据以明文 TOML 存储在 `~/.config/zentao/config.toml`，请确保文件权限安全。不要把配置文件提交到 Git。

## 链接

- [GitHub 仓库](https://github.com/BlackSuns/zentao-skill)
- [问题反馈](https://github.com/BlackSuns/zentao-skill/issues)
