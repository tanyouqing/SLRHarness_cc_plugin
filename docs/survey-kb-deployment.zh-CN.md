# Sprint2-B：已有 Pipeline 和知识库的 Git 升级手册

适用你的当前环境：Ubuntu 22.04.4 LTS，Pipeline 和 Survey KB 已部署在同一服务器。本次升级插件到 0.9.1，并配置两者的连接。**使用现有 Git 仓库拉取代码，不用上传或解压发布包，不用重建知识库。**

总体分为三部分：① 更新现有 Pipeline 代码及新增依赖；② 配置 MCP 连接和成功后单次同步；③ 验证开启、关闭、故障回退及跨调研复用。下面按这三个部分的执行顺序展开。

## 0. 先区分目录与需要执行的步骤

| 名称 | 含义 | 本次怎么处理 |
| --- | --- | --- |
| `PLUGIN_DIR` | 服务器上已有的 `SLRHarness_cc_plugin` Git 仓库，包含 `.claude-plugin/`、`agents/`、`scripts/`、`skills/` | 在这里拉取 `auto-survey` 最新代码、执行 npm ci；Claude 加载这里的插件 |
| `PROJECT_DIR` | 你平时启动调研的目录，调研保存在它的 `workspaces/<slug>/` 下 | 沿用原目录，在这里合并 `.mcp.json`；不搬动历史调研 |
| `WORKSPACE` | 某一次具体调研，例如 `$PROJECT_DIR/workspaces/rag-review` | 查询、恢复和验收命令指向这里 |
| `KB_DIR` | 已部署的知识库目录，你此前使用 `/root/survey-kb/knowledge-base` | 服务、数据库、模型和配置继续使用；此次不在这里拉取 Pipeline |
| 发布包 | 某个时间点的完整插件代码快照，包含插件代码和交付材料 | Git 升级时完全跳过；不要叠加到仓库里 |

`PLUGIN_DIR` 和 `PROJECT_DIR` 在你的旧部署中可能是同一目录，这是允许的。例如你一直在插件仓库里启动 Claude，且其中有 `workspaces/`，两个变量都填那个目录即可。如果以前分开存放，就保持分开。不能把 `PROJECT_DIR` 指向 `workspaces/<slug>` 这种单次调研目录。

| 步骤 | 是否需要做 |
| --- | --- |
| Docker 安装、Compose build/up、数据库初始化、模型下载 | **跳过**，已有知识库继续运行 |
| 知识库模型、provider、agents.json 配置 | **跳过**，沿用已验证配置 |
| Git、LaTeX、PDF 工具、原有检索服务安装 | **跳过**，沿用 Pipeline 现有环境 |
| Node 安装 | 先检查，满足 >=22.19.0 就跳过；本轮部署目标为 Node 22 LTS |
| Pipeline Git 更新、npm ci | **必须执行**，本轮新增了锁定版本的 MCP 客户端依赖 |
| 项目 MCP、令牌、客户端能力验证 | **必须检查或配置**，属于本轮新增接入 |
| 常驻同步服务、systemd 配置 | **不再需要**；若已安装旧版 survey-kb-sync，先停用，见 0.2 节 |
| 成功后单次同步 | 使用第 5 节启动脚本自动执行，或退出 Claude 后手动执行一次 |
| 小型调研联调 | **必须执行**，本机离线测试不能替代真实联调 |

先让现有活动调研正常结束并退出旧 Claude 会话，再更新代码；本轮不迁移旧任务，验收从新调研开始。下列命令在服务器 Bash 中逐段执行，报错就停在该步。无需重新 clone 仓库，也无需新建另一个调研项目。

### 0.1 设置你的实际路径

只需按提示输入两个**已经存在的绝对路径**。输入路径时不要加外层引号，也不要用 `~` 缩写。这里不猜测你的 Pipeline 实际位置。

```bash
read -r -e -p '现有插件 Git 仓库绝对路径（SLRHarness_cc_plugin）: ' PLUGIN_DIR
export PLUGIN_DIR
read -r -e -p '现有调研项目绝对路径（workspaces 的父目录，可与上面相同）: ' PROJECT_DIR
export PROJECT_DIR
export KB_DIR="$HOME/survey-kb/knowledge-base"
bash <<'SH'
set -e
case "$PLUGIN_DIR" in /*) ;; *) echo '插件路径必须是绝对路径'; exit 1;; esac
case "$PROJECT_DIR" in /*) ;; *) echo '项目路径必须是绝对路径'; exit 1;; esac
test -d "$PLUGIN_DIR/.claude-plugin"
test -d "$PROJECT_DIR"
test "$(git -C "$PLUGIN_DIR" rev-parse --show-toplevel)" = "$(realpath "$PLUGIN_DIR")"
if [ -f "$PROJECT_DIR/.slr/state.json" ]; then
  echo '这里是单次调研目录，请改填 workspaces 的父目录'; exit 1
fi
if [ "$(realpath "$PROJECT_DIR")" = "$(realpath -m "$KB_DIR")" ]; then
  echo 'PROJECT_DIR 不能填知识库服务目录'; exit 1
fi
printf '插件代码：%s\n调研项目：%s\n' "$PLUGIN_DIR" "$PROJECT_DIR"
git -C "$PLUGIN_DIR" remote -v
SH
```

预期远程仓库为 `tanyouqing/SLRHarness_cc_plugin`。如果报错或显示了别的仓库，先检查路径。检查成功后保存路径，便于重新 SSH 登录时恢复；该文件不保存令牌：

```bash
mkdir -p "$HOME/.local/state/survey-kb-upgrade"
printf 'export PLUGIN_DIR=%q\nexport PROJECT_DIR=%q\nexport KB_DIR=%q\n' "$PLUGIN_DIR" "$PROJECT_DIR" "$KB_DIR" > "$HOME/.local/state/survey-kb-upgrade/paths.sh"
```

以后新终端先执行 `source "$HOME/.local/state/survey-kb-upgrade/paths.sh"`。仍需在启动 Claude 的终端重新提供令牌，见第 2 节。

### 0.2 如果按旧手册安装过同步服务，先停用

这是停用 **Pipeline 的上传服务**，不要停止 Docker 中的知识库 API、Embedding 或蒸馏 worker。未安装过该服务会直接跳过。必须在拉取代码前执行，防止旧常驻进程仍按旧规则上传。

```bash
if systemctl cat survey-kb-sync.service >/dev/null 2>&1; then
  sudo systemctl disable --now survey-kb-sync.service
else
  printf '未安装常驻同步服务，跳过\n'
fi
```

不再创建 unit，不再设置开机自启。旧 `/etc/survey-kb-sync.env` 可以保留，但新版不会读取；令牌通过当前终端环境变量传入。不要自动启动旧服务，`watch` 命令已移除。

## 1. 更新现有 Pipeline 代码（必须）

仓库分支固定为 `auto-survey`。先检查服务器有没有本地改动；有改动时下面的命令会停下，**不会重置、覆盖或自动 stash**。保留改动后再决定如何合并，不能为了升级直接执行 `git reset --hard`。

```bash
bash <<'SH'
set -e
cd "$PLUGIN_DIR"
git status --short
if [ -n "$(git status --porcelain)" ]; then
  echo '仓库存在本地改动，请先检查和处理，再重新执行本步骤'; exit 1
fi
git fetch origin auto-survey
git switch auto-survey
git pull --ff-only origin auto-survey
git log -1 --oneline
SH
```

预期更新成功，最新提交包含 Sprint2-B；快进失败表示本地与远端分叉，先处理分支差异，不要强制覆盖。Git 只更新版本控制中的代码；已忽略的 `workspaces/`、环境变量与知识库数据库不会被拉取操作清空。

### 1.1 检查宿主机 Node，并安装新增依赖

```bash
node --version
npm --version
claude --version
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19)){console.error("需要 Node >=22.19.0；见附录 A");process.exit(1)}console.log("Node 版本满足最低要求")'
```

满足要求就**跳过 Node 安装**。知识库容器内的 Node 不等于宿主机 Node，这里必须在服务器普通终端检查。不满足时执行附录 A，随后回到这里。

```bash
bash <<'SH'
set -e
cd "$PLUGIN_DIR"
npm ci --ignore-scripts --no-audit --no-fund
claude plugin validate .
node --test tests/*.test.mjs
SH
```

预期：插件校验通过，140 项离线测试全部通过。`npm ci` 即使旧 Pipeline 能运行也必须执行，它安装本轮新增的 MCP SDK 依赖，并按锁文件固定版本。它不会重新部署知识库，也不会调用模型。

## 2. 配置项目级 MCP 与环境变量（必须检查）

使用你现有知识库的 MCP 访问令牌，不是 Doubao/其他模型的 API Key。宿主机不会自动继承知识库 Compose 的 `.env`。在启动 Claude 的同一个终端设置；默认地址沿用服务器回环端口 3000，若你实际修改过端口，只改这一处：

```bash
export SURVEY_KB_URL=http://127.0.0.1:3000/mcp
read -r -s -p 'Survey KB token: ' SURVEY_KB_TOKEN
printf '\n'
export SURVEY_KB_TOKEN
```

用下列命令只合并 `survey-kb` 服务，保留项目已有的其他 MCP 配置。文件只保存环境变量引用，不保存令牌：

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const file=path.join(process.env.PROJECT_DIR,'.mcp.json');
const config=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
if(fs.existsSync(file)){const backup=path.join(process.env.HOME,'.local/state/survey-kb-upgrade',`mcp-${Date.now()}.json`);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(file,backup);fs.chmodSync(backup,0o600);}
const sample=JSON.parse(fs.readFileSync(path.join(process.env.PLUGIN_DIR,'deploy/survey-kb.mcp.json'),'utf8'));
config.mcpServers??={};
config.mcpServers['survey-kb']={...sample.mcpServers['survey-kb'],url:process.env.SURVEY_KB_URL};
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600});
JS
```

服务名必须恰好是 `survey-kb`。保持现有项目与插件位置，两者可以是同一个目录；每次调研位于 `$PROJECT_DIR/workspaces/<slug>`。原 `.mcp.json` 如已存在，会先保存一份副本到 `~/.local/state/survey-kb-upgrade/`，再合并 KB 服务，其他 MCP 保留。不要在调研子目录另配同名 MCP，也不要用全局 MCP 超时覆盖其他服务。

## 3. 先验证客户端能力，再启用接入

```bash
node "$PLUGIN_DIR/scripts/kb-native-probe.mjs" "$PROJECT_DIR"
node "$PLUGIN_DIR/scripts/kb-preflight.mjs" "$PROJECT_DIR" --connect
```

第一个命令会调用服务器上已经登录的 Claude Code，使用临时的本地模拟 MCP。**会消耗少量模型额度，不连接或写入真实知识库**。它验证模型收到的是替换后的标记，并测量一个故意延迟 35 秒的请求是否约 20 秒超时。正常需要数十秒，整体 120 秒超时。只有两项都成功，才写入项目 `.slr-kb-capabilities.json`。

第二个命令检查项目配置、令牌、插件 Hook、同一 Claude 版本的能力验证记录，并对真实 KB 做一次只读搜索。预期两个命令均输出 `status: passed`。未验证或 Claude 更新后版本不一致，preflight 会报错，不能据此开始启用 KB 的正式调研。

若探针失败：先检查 `claude --version`、模型登录和网络，然后执行 `claude update`，重新运行探针。若仍然不支持响应替换或超时，本次先用“这次不需要 survey kb”运行主流程，不删改验证记录冒充通过。本机只检查过插件配置和探针判定逻辑，真实探针需要在云端执行。

接口依据：[MCP 输出替换](https://code.claude.com/docs/en/hooks#posttooluse-decision-control)、[单服务超时](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)。真实 Agent 的绑定与轨迹路径还要经过第 6 节的小调研验收。

## 4. 同步方式：整次调研成功后运行一次

本轮不需要安装任何常驻上传服务。知识库自己的队列与蒸馏 worker 继续照常运行。

- 执行过程中只保存轨迹、缓存和已验收论文的冻结内容；检索仍正常调用 MCP，三类材料均不上传。
- 整体成功要求当前最终审稿通过、稿件/证据一致、任务和子 Agent 均结束，并有正常 Stop 收尾记录。
- 第 5 节的启动脚本在 Claude 正常退出后，处理本次会话中新完成的调研。失败、暂停、取消或关闭 KB 的调研不会上传。Claude 退出码为 0 本身不构成调研成功。
- 一次同步会处理全部待提交项，串行提交论文、最终审稿经验、轨迹，并按原 job ID 跟踪。没有工作时结束，不常驻、不定时重启。
- 本轮默认等待 30 分钟，达到上限后不再发起新请求，正在执行的请求结束后退出；未完成项保留本地。下一次运行继续，已成功项跳过。
- 同步错误独立报告，不改变已通过的调研状态。手动恢复用第 7 节命令。

可直接检查脚本的入口（不联网）：

```bash
node --check "$PLUGIN_DIR/scripts/kb-run.mjs"
node --check "$PLUGIN_DIR/scripts/kb-sync.mjs"
```

## 5. 让 Claude 加载更新后的插件

如果之前使用 `claude --plugin-dir <仓库路径>`，插件路径仍不变；现在建议用下面的 kb-run 启动脚本，它会替你传入同一个 --plugin-dir，并在会话正常退出后执行一次同步。不要同时加上发布包解压路径。

如果之前通过 marketplace 安装插件，已安装的缓存副本不会随这个源码仓库的 git pull 自动更新。本手册统一从现有源码仓库加载。先运行 `claude plugin list`，仅在列表里确实有已启用的 slr-harness 安装项时，执行下面的可选步骤；普通 --plugin-dir 用户跳过：

```bash
cd "$PROJECT_DIR"
claude plugin list
read -r -p "需停用的旧 slr-harness 完整插件 ID（按列表填写，无则直接回车）: " OLD_PLUGIN_ID
if [ -n "$OLD_PLUGIN_ID" ]; then claude plugin disable "$OLD_PLUGIN_ID"; fi
```

保留其他检索插件。停用命令会修改该安装项的启用状态；这里只填 slr-harness，不能填其他插件。然后退出旧会话，在同一个已 export 令牌的终端启动：

```bash
cd "$PROJECT_DIR"
node "$PLUGIN_DIR/scripts/kb-run.mjs" "$PROJECT_DIR"
```

保留原先需要的其他插件和检索服务，避免同时加载两个版本的 slr-harness。在 Claude 中通过 `/mcp` 确认 `survey-kb` 已连接，通过 `/hooks` 确认插件 Hook 已加载；首次项目 MCP 信任提示按实际项目确认。

调研成功交付后，在 Claude 中执行 `/exit` 正常退出，随后终端显示 `sync-start`、各项处理状态和最终同步摘要。同步完成后返回 shell。恢复 Claude 会话可执行 `node "$PLUGIN_DIR/scripts/kb-run.mjs" "$PROJECT_DIR" -- --resume`，其他 Claude 参数也放在 `--` 后。

如果你继续用原来的 `claude --plugin-dir` 启动也可以；正常退出后，按第 7 节手动执行 `kb-sync once`。主会话不调用上传脚本，也不需要在上下文里等待同步。

启动例子：

```text
/slr-harness:review 检索增强生成中的证据选择方法，做一次范围较小的调研，使用 survey kb。
```

关闭例子：

```text
/slr-harness:review 检索增强生成中的证据选择方法，做一次小型调研，这次不需要 survey kb。
```

主会话先初始化工作区、附着实际会话，再初始化并绑定 Scoper。开关写入 `.slr/survey-kb.json`，默认 true；关闭时为 false。恢复读取原值，不能中途切换。范围批准、Manager 验收、Checker 检查、分阶段写作及最终审稿仍照常执行。

仅 Worker 检索/读取论文；worker、manager、scoper、paper 检索/读取各自角色策略。主会话、Checker、Reviewer 无 KB 读取权限。角色不能直接提交；论文验收后只在本地冻结内容。论文、最终审稿经验和原生轨迹全部等整个调研成功后统一上传；失败调研不上传任何一类材料。

检索失败后继续原流程，不自动重复查询。相同查询已有缓存时，Hook 给出受限展示文件；更长内容由 `kb-control cache-read` 按角色、任务分片读取。策略展示 ≤3 条/4500 字符，论文 ≤5 条/8000 字符，完整记录单次展示 ≤24000 字符；缓存保留完整响应。

## 6. 云端验收：三种模式和两个相关小调研

**本节的启用调研会向真实 KB 写入论文、经验和轨迹。默认不清空数据库。** `kb-cloud-check` 自身只做本地校验和远端回读，不写 KB。

先执行一次关闭模式的小调研；检查开关为 false，恢复后仍为 false。然后选择实际工作区：

```bash
read -r -p "这次调研的实际 slug（workspaces 下的目录名）: " SURVEY_SLUG
export WORKSPACE="$PROJECT_DIR/workspaces/$SURVEY_SLUG"
test -f "$WORKSPACE/.slr/state.json" || { echo "未找到该调研，请核对 slug"; exit 1; }
node "$PLUGIN_DIR/scripts/kb-control.mjs" status "$WORKSPACE"
node "$PLUGIN_DIR/scripts/kb-cloud-check.mjs" "$WORKSPACE"
```

预期 `mode: disabled`，没有 KB 检索缓存和提交队列。项目 MCP 握手可能仍发生；关闭保证不执行 KB 业务工具，不要求卸载整个项目连接。

再进行启用模式调研 A（将 WORKSPACE 改为 A 的实际目录，避免继续指向关闭模式的调研）：在批准范围后完成研究、写作及最终审稿。抽查 Worker 的 KB 命中元信息（包括 DOI）、修订和片段；Manager 仍执行验收。不要把 KB 命中自动标记为全文核验。流程最终成功并正常交付后，执行 /exit，等待启动脚本的单次同步结束，再检查：

```bash
read -r -p "调研 A 的实际 slug: " SURVEY_SLUG
export WORKSPACE="$PROJECT_DIR/workspaces/$SURVEY_SLUG"
node "$PLUGIN_DIR/scripts/kb-sync.mjs" status "$WORKSPACE"
cat "$WORKSPACE/.slr/kb/last-sync.json"
node "$PLUGIN_DIR/scripts/kb-cloud-check.mjs" "$WORKSPACE" --complete
```

知识库的处理任务需要时间。单次脚本退出后不会在后台继续查询；若返回 pending/tracking，按第 7 节再次执行 once 继续跟踪。成功预期所有同步项为 succeeded，轨迹清单 sealed；脚本回读轨迹及蒸馏策略来源。没有可复用策略时允许空结果，不要求模型输出固定文本。

再进行与 A 相关的小调研 B，在 prompt 中要求 Worker 优先尝试复用 A 涉及的论文，并对真实缺口定向补读。主会话不代替 Worker 检索。完成后：

```bash
read -r -p "调研 B 的实际 slug: " SURVEY_SLUG
export WORKSPACE="$PROJECT_DIR/workspaces/$SURVEY_SLUG"
node "$PLUGIN_DIR/scripts/kb-cloud-check.mjs" "$WORKSPACE" --complete --require-reuse
```

抽查 `.slr/kb/imports.json`：本地 ID、导入的 KB ID/修订和 cacheKey 存在；提交后的 ID/修订单独保存在 outbox 结果中，原引用历史未覆盖。若要验证补充，应提出真实缺失维度，让 Worker 补读、Manager 重新验收；仅当验收内容变化时生成新的冻结提交。

故障模式用单独测试项目与调研测试，不要停掉正在使用的 KB。另开终端为 Claude 设置错误 token（使检索快速报认证错误），启动一次启用 KB 的小调研；预期简短提示不可用、继续普通检索与工作，不把错误缓存为空结果。要测试上传故障，在已经整体成功的测试调研上，用错误 token 执行一次 `kb-sync once`；预期认证错误只尝试一次，记录 failed 并退出。修正终端中的 token 后执行 `resume`，恢复成功。不要修改原生轨迹或冻结 payload。

实际端到端验收还需确认：Scoper READY 绑定成功，Paper 当前写作阶段可检索策略，Checker/Reviewer 没有 KB 调用，主/子轨迹各用自己的文件。能力探针通过不能代替这些检查。

## 7. 查询、恢复、故障处理

```bash
node "$PLUGIN_DIR/scripts/kb-sync.mjs" status "$WORKSPACE"
# 整个调研成功、Claude 正常退出后：扫描补漏并处理全部待提交项
node "$PLUGIN_DIR/scripts/kb-sync.mjs" once "$WORKSPACE"
# 修复原因后：恢复失败项并执行一次完整同步；已有 job ID 只查原任务
node "$PLUGIN_DIR/scripts/kb-sync.mjs" resume "$WORKSPACE"
```

once 不自动重启 failed 项；它继续 pending/retry/tracking/waiting 项并跳过 succeeded。resume 会重新启用 failed 项，然后执行同样的单次批处理。可以给 once/resume 增加 `--max-wait-seconds 120` 等待两分钟；默认 1800 秒。

输出 complete/disabled 时退出码 0；未完成、失败或尚未满足成功条件时为 2；脚本/配置错误为 1。最新批次摘要保存到 `.slr/kb/last-sync.json`，逐项状态在 outbox。启动脚本分别报告 Claude 和同步结果，KB 故障不会改写调研验收。

连接与工具调用各有 20 秒超时；暂时错误最多尝试 3 次，间隔 2、5 秒。认证、参数和 16 MiB 超限直接失败。得到 job ID 后每 15 秒查询，单轮跟踪最多 30 分钟，随后为 waiting；resume 可继续。任务失败先按知识库原运行手册重试**原 job**，再 resume；重复上传不会修复已失败后台任务。

| 现象 | 检查与处理 |
| --- | --- |
| preflight 失败 | 检查 Node、项目 `.mcp.json`、当前终端 token；更新 Claude 后重新跑能力探针 |
| 检索无缓存 | 检查角色真实绑定、任务是否 active、MCP 名称、Hook 日志；缓存为空不代表远端无论文 |
| pending 长期不动 | 无常驻服务自动处理；退出 Claude 后对正确 WORKSPACE 执行 once |
| tracking | 远端任务进行中；再次运行 once 跟踪原 job，必要时查看知识库 worker 日志 |
| failed | outbox 有简短错误；检查凭据、输入或 KB 服务，不要手改 payload |
| waiting / time_limit | 等待窗口到期，重新执行 once 继续跟踪；不会重新提交已有 job 的内容 |
| not_ready | 调研尚未成功、稿件证据已变化或缺少正常 Stop；不上传，不要手改成功记录 |
| 成功交付却未 sealed | 检查 `.slr/kb/warnings/`、runtime 活动 Agent、轨迹半行/缺失、Stop 是否触发 |
| 轨迹前缀改变 | 旧归档保留，错误单独记录；原生新路径会作为新段，不能猜测或拼接缺失事件 |
| 模型/索引失败 | KB 层修复，Pipeline 保留原 job 和冻结内容；不撤销研究交付 |

原生轨迹路径和复制范围在 `.slr/kb/trajectories.json`；runtime 保存实际 Agent、session、任务和可验证父子关系。半行等待后续追加完成；源文件丢失不伪造完整轨迹。保留 Claude 原生数据目录直到同步结束。

如果 Claude 异常退出导致 SubagentStop 缺失：先在 Claude 任务界面确认该 Agent 已停止，按原 Pipeline 恢复其活动任务，再由操作者运行：

```bash
node "$PLUGIN_DIR/scripts/kb-control.mjs" confirm-stopped "$WORKSPACE" '<实际agent-id>' --confirmed-stopped
```

该命令拒绝尚有活动 Worker/写作/审稿分配的 Agent，并记录人工确认。恢复调研，让主会话检查已完成交付并正常结束，重新触发 Stop；正常退出 Claude 后，启动脚本或手动 once 再采集、封存和上传。无法确认停止就不要运行。缺少原始文件时保留警告和未完成同步，不影响已交付论文。

## 8. 再次运行、升级与数据保留

无需 systemctl 启动或重启。正常流程使用 kb-run 启动；已经成功但尚未同步的调研直接执行一次 once。脚本退出后不留下上传进程。

意外中断后，重新执行 once。未过期租约最多等待 120 秒，过期后接管；连续中断达到上限时标记失败，再由 resume 明确恢复。不要手工删除活动锁或修改冻结内容。相同内容复用本地哈希及远端幂等结果，已有 job ID 的条目只查原任务。

以后升级时：结束活动调研并退出 Claude，重复第 1 节 Git 更新与 npm ci，然后通过第 5 节启动。更新 Claude 本身后重新跑能力探针。保留整个 PROJECT_DIR（含每个工作区的 .slr、缓存、队列）及原生轨迹。新版不撤回旧版已经上传的数据，也不把旧任务自动迁移成新任务。

本手册是已有环境的升级流程。之前提供的 tar.gz 是可选离线代码快照，Git 更新方式无需使用它；也不需要从中复制文件覆盖仓库。

本轮未执行真实云端探针、Agent 调研、KB 写入或模型调用。离线通过项见 [Sprint2-B 验证记录](sprint2-b-validation.md)；请把上面的实际云端输出另存为部署验收记录。

## 附录 A：仅宿主机 Node 不满足要求时执行

已有合适版本请跳过本节；不要重复安装 Docker 或修改知识库容器。

尚未安装 Node 22 时，可以使用官方发布目录安装。以下适用于 x86_64/aarch64；会在 `/usr/local/bin` 建立 node/npm/npx 链接，请先确认不会影响其他服务。

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils
mkdir -p "$HOME/node-install"
cd "$HOME/node-install"
case "$(uname -m)" in x86_64) NODE_ARCH=x64;; aarch64) NODE_ARCH=arm64;; *) echo '不支持的架构'; exit 1;; esac
curl --fail --location --retry 2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o SHASUMS256.txt
NODE_FILE=$(awk -v suffix="-linux-${NODE_ARCH}.tar.xz" '$2 ~ suffix"$" {print $2}' SHASUMS256.txt)
test -n "$NODE_FILE" || exit 1
NODE_DIR="${NODE_FILE%.tar.xz}"
NODE_VERSION="${NODE_FILE%-linux-*}"
curl --fail --location --retry 2 "https://nodejs.org/dist/${NODE_VERSION#node-}/$NODE_FILE" -o "$NODE_FILE"
awk -v name="$NODE_FILE" '$2 == name' SHASUMS256.txt | sha256sum -c -
sudo tar -xJf "$NODE_FILE" -C /opt
for bin in node npm npx; do sudo ln -sfn "/opt/$NODE_DIR/bin/$bin" "/usr/local/bin/$bin"; done
hash -r
node --version
```

官方目录：[Node.js 22 发布文件](https://nodejs.org/dist/latest-v22.x/)。下载失败时先解决网络，或在可联网机器下载同版本文件及校验和后上传，不要跳过校验。
