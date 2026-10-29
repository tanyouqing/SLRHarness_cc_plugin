# 论文门控：L1 身份与 L2 内容核验

## 谁控制入库

管理 Agent 可以独立于存储运行，因为它只提交核验判断。当前采用 `paper-conflicts-v2`：只有有证据的矛盾阻止入库；证据不足、未知版本或原文不可达默认放行，并保存证据缺口。实际发布权限属于服务端：入库 worker 取得核验记录后，发布事务再次校验论文内容哈希；数据库的 `paper_revision_admission` 触发器拒绝没有通过 L1/L2 的新论文修订。Agent 没有任意 SQL 或 Shell 工具，不能直接跳过发布条件。

现有去重只解决“是否同一篇论文、是否需要补充”，不能证明笔记正确。新流程为：接收草稿 → 去重/生成最终补充稿 → L1 → L2 → 编码并原子发布。首次无相似候选的论文同样必须经过核验。合并改变笔记时，核验对象为最终完整稿。补充稿待定时不改变旧稿的当前版本或索引。

输入仍是 `submit_paper({metadata,note})`，Pipeline 不上传 PDF；八个 MCP 工具名称及论文输入格式不变。核验使用现有 Pi manager 模型配置，L1/L2 为相互独立的新调用。需要调整预算时修改私有 `config/agents.json` 的 manager 配置。

## L1：独立核对身份及版本

- 通过 Crossref 题名/作者检索及 DOI 查询，存在 arXiv ID 时再查询带版本的 arXiv API；请求由知识库发起，不接受 Pipeline 自报“已查证”代替。
- 比较题名、作者、年份，以及提交中存在的 DOI、arXiv ID 和会议。解释预印本年份和正式发表年份等差异；不自动改写提交元信息。
- 管理 Agent 读取检索记录并自行获取公开原文，优先 HTML，必要时 PDF。明确版本、引用原文版本证据，将后续 L2 绑定到相同原文。身份或版本出现有证据的冲突时待定；未知版本、无法取得来源时放行并标为证据不足。
- 身份元信息完全相同且已有证据充分、verified=true 的 L1 记录时，补充可复用固定版本的原文和 L1，记录 identityReusedFrom；L2 总是核验新笔记。身份/版本字段改变就重新执行 L1。原始哈希完全相同的重复提交继续复用已有回执。
- 无版本号的 arXiv 输入应尽量查明具体版本，查不到时记录 unknown 并放行。不能默认最新版本等同于笔记所读版本；只有确认实际版本与明确提交的版本矛盾时待定。仅取到了其他版本不能证明原笔记有误。

接口依据：[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api)、[Crossref bibliographic 查询说明](https://github.com/CrossRef/rest-api-doc)、[arXiv API 使用说明](https://github.com/arXiv/arxiv-docs/blob/develop/source/help/api/user-manual.md)。Crossref 提供身份元数据，不能代替论文原文的内容证据。

## L2：逐项核对核心主张

Agent 必须读完笔记，列出核心方法、主要结论、关键限制和被笔记依赖的数值比较。每项记录笔记位置、原文 sourceId/位置/引文、实验条件及判断。数值核验记录笔记值、原文值、指标、单位、数据集/设定及比较基准；百分比与百分点、不同模型/数据划分不能混用。

服务端检查实际工具 schema、完整笔记读取、引文是否真的存在、引用窗口是否已读、原文是否属于 L1 固定的版本、数值字符串是否来自对应引用。存在有原文依据的 contradicted 主张时待定；unverified 主张默认放行。未读取的引文、编造 sourceId 或不符合工具格式的结果属于执行错误，继续原任务重试；不能伪造一个“已核验”的结果。位置为解析后文本的从 0 开始的 JavaScript 字符偏移，PDF 文本保留 `[PDF page N]` 物理页标记，HTML 保留章节/段落。hash 对应获取到的原始响应字节；保存解析全文及抓取时间供审计。

核心主张选择、语义对应和条件是否相容仍需要模型判断，结构校验不能证明结论一定正确。后续真实验收应人工抽查漏检、误通过、表格单位及版本对应。扫描 PDF 无文本、复杂表格解析失真、付费墙、访问失败或证据不足均作为缺口放行，不绕过登录、不凭模型记忆补证据。

## 待定、重试与历史

私有 `paper_checks` 保存完整待核验稿、来源快照和报告，完成记录不可修改。待定稿不加入 entities/revisions/search_chunks，也不进入公开论文搜索。旧论文保留，不批量重查；搜索和读取返回 `admission=legacy_unverified`，证据充分的内容返回 `verified`；按缺口放行的内容返回 `admitted_with_gaps`。三者均可参与公开检索，不能将 legacy_unverified 和 admitted_with_gaps 视为已核验。

一个已完成判断但未获准入库的任务示例：

```json
{
  "status": "succeeded",
  "result": {
    "ids": [], "admission": "held", "check_id": "核验UUID",
    "level": "L2", "reason": "核心数值与已确认版本的原文实验结果矛盾"
  }
}
```

`status=succeeded` 表示本次审核工作已结束；`admission=held` 且 ids 为空明确表示未入库。`get_job.progress` 提供核验结果、来源 URL/哈希及时间。模型调用错误、工具决策格式错误、索引错误继续原有最多三次任务重试，并保留已完成 L1/L2，不能伪装为审核通过。

Pipeline 将待定项标记为 `held`，不计入 succeeded、不无限轮询、不阻塞调研交付。最后可为已保存的完整状态建立快照，结果为 complete_with_exclusions；快照包含私有待定稿及报告，不能声称全部论文已正式入库。

查看报告、对有矛盾的待定稿重新核验：

```bash
KB=/root/survey-kb-source/knowledge-base
JOB_ID='替换为入库任务UUID'
# 只读：完整稿、历史报告和原文证据可能较长，保存到私有文件查看。
umask 077
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js paper-checks "$JOB_ID" > /root/paper-checks.json

# 会调用真实模型和获取论文；仅在准备好真实重查时执行。
# 保留原 job ID 和旧报告，创建新审核尝试，重新获取来源。
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js paper-recheck "$JOB_ID"
# 已重查的 Pipeline 工作区只恢复查询原 job，不再次上传。
node /root/JiahaoCAO/SLRHarness_cc_plugin/scripts/kb-sync.mjs resume \
  /root/JiahaoCAO/SLRHarness_cc_plugin/workspaces/实际工作区
```

原文可用但笔记或元信息错误时，修正本地论文并重新经过 Manager 验收后提交新内容，不能修改已冻结 outbox 或旧审核报告。相同内容重复上传复用 held 回执，不自动重查。模型/索引任务失败仍使用原 `admin retry JOB_ID`。恢复审核过程中发生目标论文版本变化时，重新做去重决策并核验新的最终稿。

## 获取能力与运行条件

worker 新增 Python 3 标准库 HTML 解析、Poppler `pdftotext` 和固定版本 uv/uvx；沿用已有官方 MCP SDK，不新增 npm 依赖。只读取公开 HTTPS，固定到校验过的公网 IPv4，跳转逐次检查，不附带模型密钥或浏览器登录。需要能访问 Crossref、arXiv 和对应出版平台；访问受限时记录证据缺口并放行。

单个响应上限 32 MiB，解析文本上限 100 万字符；源请求 20 秒、DNS 10 秒，最多 5 次跳转。L1 每调用最多新增 8 个源，最多保留 8 个原文文档。搜索 MCP 每层最多调用 12 次，每次结果最多保存 100 万字符、首次展示 12000 字符，后续按窗口读取。arXiv API 请求间隔至少 3 秒。PDF 不执行脚本，不做 OCR，临时源文件解析后删除；数据库保存解析文本、元信息、原始字节哈希、URL 和时间。管理 Agent 原有调用超时/轮数上限仍生效。

## 复用 Claude Code 的搜索 MCP

已只读确认当前服务器 `/root/.claude.json` 有全局 `arxiv`、`tavily`、`scholar`：arXiv/Scholar 用 uvx，Tavily 用 npx。项目 `.mcp.json` 的 survey-kb 是知识库自身，不导入搜索桥。此轮没有复制服务器配置或启动搜索工具。

Pi 在论文 L1/L2 模式下使用独立 MCP 客户端，把远端工具 schema 转为 Agent 工具，保留 required/optional 参数。支持 stdio、Streamable HTTP 和 SSE。搜索/读取/下载工具可用，明确写入或破坏性工具不提供；可选 allowedTools 进一步限制单个服务。其他经验管理、蒸馏任务的工具权限保持原配置。Claude 自带 WebSearch/WebFetch 并非 MCP，无法通过复制 MCP 配置获得；交互 OAuth 登录状态也不自动迁移。

在服务器代码更新后执行以下导入；脚本只读原文件、写新私有配置，不启动 MCP，不执行搜索或模型调用：

```bash
KB=/root/survey-kb-source/knowledge-base
python3 "$KB/scripts/import-search-mcp.py" \
  --source /root/.claude.json \
  --servers arxiv tavily scholar \
  --output /root/survey-kb/knowledge-base/config/search-mcp.json
chown 1000:1000 /root/survey-kb/knowledge-base/config/search-mcp.json
chmod 600 /root/survey-kb/knowledge-base/config/search-mcp.json
```

预期只输出保存位置、服务名和传输类型，不显示密钥。目标文件已存在时先检查，仅在确实需要覆盖时附加 `--replace`。也可从普通 `.mcp.json` 导入，或加 `--project /root/JiahaoCAO/SLRHarness_cc_plugin` 选取 Claude 项目配置覆盖全局定义。原文件不会改动。新配置已排除在 Git 和 Docker 构建上下文之外，不要粘贴到公开报告。

Dockerfile 已为 stdio 准备 Node/npx 和 [uv/uvx 0.13.6](https://docs.astral.sh/uv/guides/integration/docker/)，仍需重建 API/worker 镜像。现有配置挂载会映射新文件到 `/app/config/search-mcp.json`，无需新增卷。uv/npm 缓存放到已有 Pi 数据卷 `/data/mcp-cache`。第一次启动 MCP 可能下载第三方依赖，需能访问对应包源；导入会保留 Claude 原始包参数，若原参数未固定版本，建议固定为已验证版本后使用。

配置中的宿主机绝对路径和 localhost 需按容器环境调整；容器 localhost 指向容器自身。`${VAR}`/`${VAR:-fallback}` 从容器环境展开；已有 env/header 字面凭据可原样放在私有文件。若变量仅存在于宿主机 shell，需要加入知识库私有 `.env`，不要只在宿主机 export。Docker 应用已通过 env_file 加载它。stdio 子进程只取得基础运行环境和明确配置的 env，不自动继承模型密钥。

`PAPER_MCP_TIMEOUT_MS` 默认 20000，可在私有 `.env` 设置 1000–120000；首次 uvx/npx 下载慢可暂改 120000 并重新创建 worker。单个服务连接/调用失败记录为证据缺口，其余搜索源继续使用。整个配置文件 JSON 格式错误属于配置错误，需要修复，不能用默认放行掩盖程序未运行。服务返回结果和 schema 中的配置密钥会脱敏，避免写进审核记录；不要把与搜索无关的私人服务一并导入。

升级后静态检查（不启动搜索工具）：

```bash
bash "$KB/scripts/compose-git.sh" exec -T worker sh -c 'command -v npx; command -v uvx; python3 --version; pdftotext -v'
bash "$KB/scripts/compose-git.sh" exec -T worker node --input-type=module -e 'import {readFileSync} from "node:fs"; import {mcpConfigSchema} from "./dist/search-mcp.js"; const c=mcpConfigSchema.parse(JSON.parse(readFileSync("/app/config/search-mcp.json","utf8"))); console.log(Object.keys(c.mcpServers));'
```

静态检查只证明命令/配置存在；真实 MCP 握手、凭据可用性、检索返回和原文读取仍需用户后续验收。

## 现有部署升级（准备好后执行）

本轮有迁移 006 和容器运行依赖变化，需要重建 API 镜像并更新 API/worker。不能只给旧镜像添加 Git 别名。先结束使用 KB 的调研和同步；不重建数据库、Embedding 或模型卷。命令会修改服务及数据库，以下不属于真实模型测试。

应用镜像支持 `.env` 中的 `DEBIAN_MIRROR`，默认 `https://deb.debian.org`。服务器默认源下载缓慢时可设为 `https://mirrors.aliyun.com`，同时提供 Debian 主库与安全更新库，仍使用原 Debian 签名验证。该设置只影响构建时的 Python/Poppler 系统依赖下载。uv 镜像层使用固定版本 GHCR 镜像；下载成功后后续构建复用 Docker 缓存。

```bash
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
# 有本地改动先处理，不强制覆盖。
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
bash "$KB/scripts/compose-git.sh" build api </dev/null
umask 077
BACKUP=/root/survey-kb/backups/paper-gate-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP/old-image-id"
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-before"
bash "$KB/scripts/compose-git.sh" stop -t 330 api worker </dev/null
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP/database.dump"
docker exec -i survey-kb-db-1 pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database-toc.txt"
tar -C /root/survey-kb/knowledge-base -czf "$BACKUP/private-config.tar.gz" .env config
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps migrate </dev/null
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  --entrypoint node migrate dist/check-paper-sql.js </dev/null
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  --entrypoint node migrate dist/check-retrieval-sql.js </dev/null
bash "$KB/scripts/compose-git.sh" up -d --no-deps api worker </dev/null
bash "$KB/scripts/compose-git.sh" ps
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-after"
cmp "$BACKUP/containers-before" "$BACKUP/containers-after"
```

预期迁移 006 成功，原论文/经验/轨迹不改写，三个检查触发器启用，paper_checks 初始为空，DB/Embedding 容器 ID 不变。若数据库有未完成论文任务，启动 worker 后会自然进入核验；只做静态检查时应先确认原队列为空或继续保持 worker 停止。

升级后、队列为空时用 snapshot.py create 建立包含 006 的新基线。全库快照要求迁移列表相同，旧 005 快照不能直接在 006 环境恢复；保留升级前备份和旧代码/镜像用于运维回退。不要关闭入库触发器来放行未核验论文。

## 用户后续真实验收

会写入知识库并调用真实模型，默认不自动执行：

1. 提交一篇确知存在、带版本、笔记有明确章节/表格与数值的论文；检查 L1/L2、原文引用和发布结果。
2. 重复提交同一内容，确认复用 ID/job；补充有依据的主张，确认新修订和旧稿仍可读。
3. 提交错误 DOI/作者/版本，以及修改数值后的笔记，确认 held、无新可检索版本、旧稿不变。
4. 模拟原文不可访问/证据不足，确认正常发布、admission=admitted_with_gaps，报告解释缺口；对确有矛盾的 held 项，paper-recheck 保留 job ID 和旧报告。
5. 检查 Pipeline counts.held 与快照的 complete_with_exclusions，不将待定项标成入库成功。

原 smoke 虚构论文可能因证据缺口放行，也可能因发现明确矛盾待定；不能断言它必须被 held，更不能把它认定为 verified。默认 smoke 检查明确准入结果、幂等和其他经验/轨迹流程。验收真实论文时，将真实 `{metadata,note}` JSON 挂载到 client 并设置 KB_SMOKE_PAPER，支持可选 KB_SMOKE_SUPPLEMENT；未提供真实论文时不能把 smoke 报告解读为“真实论文核验已通过”。完整恢复演练继续在隔离环境进行。
