# Sprint2-B：已有 Pipeline 与知识库的升级手册（0.9.2）

适用当前服务器：Ubuntu 22.04.4 LTS，Pipeline 和 Survey KB 已部署。0.9.2 改为 **成功 Stop 自动启动一次同步**，会话无需退出。沿用现有 Git 仓库、知识库服务、模型和数据。

本次升级只执行第 1～3 节的配置与静态校验。第 4、6 节会调用真实服务或模型，由用户后续自行执行。不得生成伪造的能力验证记录。

## 1. 路径与升级前检查

当前部署路径固定为：

```bash
export PLUGIN_DIR=/root/JiahaoCAO/SLRHarness_cc_plugin
export PROJECT_DIR=/root/JiahaoCAO/SLRHarness_cc_plugin
export KB_DIR=/root/survey-kb/knowledge-base
cd "$PLUGIN_DIR"
git status --short --branch
git log -1 --oneline
```

PROJECT_DIR 是 workspaces 的父目录。不要移动现有工作区，不要将其设成单次调研目录。

先正常退出旧 Claude 会话；等待正在运行的单次同步结束。更新期间不要启动新的调研。有本地源码改动时先检查，不能 reset --hard、强制覆盖或删除数据。

以下项目均跳过：

- Docker 安装、Compose build/up、数据库初始化、模型下载。
- KB 模型、provider、Agent 与数据库配置。
- 旧任务迁移、数据库清空、发布包解压。
- systemd 安装、定时任务设置、常驻上传服务。

知识库自身的 worker 继续运行。若曾安装旧的 Pipeline 上传服务，才执行：

```bash
if systemctl cat survey-kb-sync.service >/dev/null 2>&1; then
  sudo systemctl disable --now survey-kb-sync.service
fi
```

## 2. 拉取代码并安装依赖

现有服务器已准备好两个私有配置文件。在启动 Claude 的同一终端加载：

```bash
source "$HOME/.local/state/survey-kb-upgrade/paths.sh"
source "$HOME/.config/survey-kb/env.sh"
node --version
claude --version
```

env.sh 设置 SURVEY_KB_URL、SURVEY_KB_TOKEN 和可用 Node 的 PATH。当前服务器复用已有 Node 26.10.0（满足 >=22.19.0）和 Claude 2.1.311，没有改变系统默认 Node 或 nvm 默认版本。通用环境推荐 Node 22 LTS。Node 12/20 不满足本项目要求。

令牌文件权限为 600、父目录为 700；只保存 MCP 访问令牌，不能将模型 API Key 填到这里。不要打印、提交 Git 或分享该文件。

```bash
bash <<'SH'
set -e
cd "$PLUGIN_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo '仓库存在本地改动，先检查处理'; exit 1
fi
git fetch origin auto-survey
git switch auto-survey
git merge --ff-only origin/auto-survey
npm ci --ignore-scripts --no-audit --no-fund
git log -1 --oneline
SH
```

预期插件版本 0.9.2，依赖 MCP SDK 1.32.2、zod 4.6.7。快进失败时停止处理分支差异，不强制重置。忽略的 workspaces 和私有配置不受 Git 更新影响。

## 3. MCP 配置与静态校验

上次升级已创建项目 .mcp.json，保持如下服务条目，保留其他 MCP：

```json
{
  "mcpServers": {
    "survey-kb": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "timeout": 20000,
      "headers": { "Authorization": "Bearer ${SURVEY_KB_TOKEN}" }
    }
  }
}
```

若该项目尚未配置，从 deploy/survey-kb.mcp.json 合并，先保存现有配置副本：

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const file=path.join(process.env.PROJECT_DIR,'.mcp.json');
const config=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
if(fs.existsSync(file)){
  const backup=path.join(process.env.HOME,'.local/state/survey-kb-upgrade',`mcp-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  fs.copyFileSync(file,backup);fs.chmodSync(backup,0o600);
}
const sample=JSON.parse(fs.readFileSync(path.join(process.env.PLUGIN_DIR,'deploy/survey-kb.mcp.json'),'utf8'));
config.mcpServers??={};
config.mcpServers['survey-kb']=sample.mcpServers['survey-kb'];
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');fs.chmodSync(file,0o600);
JS
```

只做以下静态校验，不执行测试脚本、同步或 MCP 调用：

```bash
cd "$PLUGIN_DIR"
claude plugin validate .
find scripts evals tests -type f -name '*.mjs' -print0 | xargs -0 -n 1 node --check
npm ls --depth=0
git diff --check
cd "$KB_DIR"
docker compose config --quiet
docker compose ps -a
```

预期语法/配置通过，KB 四个容器仍 healthy。plugin validate 可能提示缺少图标、隐私 URL 或 marketplace 安装说明；这些目录发布提示不改变校验通过结果。

开发机全量离线测试命令为 node --test tests/*.test.mjs；本轮不在服务器运行。既有 KB 的容器、卷、启动时间和现有工作区文件应保持不变。

## 4. 用户后续执行客户端能力验证

**以下命令会调用真实模型或服务，本轮升级不执行。**

```bash
source "$HOME/.local/state/survey-kb-upgrade/paths.sh"
source "$HOME/.config/survey-kb/env.sh"
cd "$PROJECT_DIR"
node "$PLUGIN_DIR/scripts/kb-native-probe.mjs" "$PROJECT_DIR"
node "$PLUGIN_DIR/scripts/kb-preflight.mjs" "$PROJECT_DIR" --connect
```

第一项调用真实 Claude 与临时本地模拟 MCP，验证输出替换和 20 秒超时，会消耗模型额度。通过后写入 .slr-kb-capabilities.json。第二项核对配置、同版本能力记录，并对真实 KB 做只读搜索。预期两项均 passed。

能力探针失败时检查 Claude 版本、模型登录和网络；确有版本兼容问题时再升级 Claude、重跑探针。不要删改验证记录冒充通过。Claude 升级后需重新验证。暂时无法通过时，可以明确“这次不需要 survey kb”运行原流程。

## 5. 直接启动 Claude 与自动同步

先确保只加载一个 slr-harness 版本。claude plugin list 可检查安装项；若确有旧 marketplace 缓存副本启用，仅停用那个完整插件 ID，保留其他检索插件。当前服务器已配置的 arxiv、tavily、scholar 继续使用。

验证完成后：

```bash
source "$HOME/.local/state/survey-kb-upgrade/paths.sh"
source "$HOME/.config/survey-kb/env.sh"
cd "$PROJECT_DIR"
claude --plugin-dir "$PLUGIN_DIR"
```

裸 claude 只有在新版插件已正确安装/启用时才加载这些 Hook；源码方式请保留 --plugin-dir。首次项目 MCP 信任提示由用户确认，通过 /mcp、/hooks 检查加载情况。

现有 ~/.local/state/survey-kb-upgrade/start-survey.sh 也可以作为便利入口；它做本地 preflight，再启动 Claude。kb-run 现仅为可选启动器，不再在退出时上传。

新调研示例：

```text
/slr-harness:review 检索增强生成中的证据选择方法，做一次范围较小的调研，使用 survey kb。
```

关闭示例：

```text
/slr-harness:review 检索增强生成中的证据选择方法，做一次小型调研，这次不需要 survey kb。
```

正常回复结束触发 Stop。仅当当前最终审稿通过、稿件与证据有效、所有任务与子 Agent 结束，并且原生 background_tasks/session_crons 明确为空时，才登记并启动同步：

- 本次批次由运行 ID、审稿 ID、成果指纹确定，同一批次只自动启动一次。
- Hook 只做本地登记和启动，不在 Hook 内等待网络。
- 独立子进程最多等待 30 秒确认最终回复写入原生轨迹，再冻结准确范围。后续聊天不会被纳入。
- 依次提交冻结论文、最终审稿经验和轨迹；后台任务按原 job ID 跟踪，默认最多 30 分钟后退出。
- 无需 /exit。可以继续聊天；无需常驻服务或额外唤醒模型。
- 同步失败单独记录，不改变研究交付结果；重复聊天不会悄悄重试失败批次。
- 成果开始修改或出现新审稿时，旧批次不再发起后续请求；已发送请求不能撤回，已上传结果保留。

详细设计见 [Stop 自动同步设计](survey-kb-stop-design.md)。主会话、Checker、Reviewer 不调用 KB 检索或上传工具；Worker 检索论文，四类执行角色检索自身策略，沿用既有权限。

## 6. 用户后续真实验收

**本节会调用真实模型、检索并可能写入 KB，由用户自行执行。默认不清空数据。**

先检查关闭模式，再做启用模式的小调研 A，保持 Claude 会话打开。另开终端：

```bash
source "$HOME/.local/state/survey-kb-upgrade/paths.sh"
source "$HOME/.config/survey-kb/env.sh"
read -r -p '实际调研 slug: ' SURVEY_SLUG
export WORKSPACE="$PROJECT_DIR/workspaces/$SURVEY_SLUG"
test -f "$WORKSPACE/.slr/state.json"
node "$PLUGIN_DIR/scripts/kb-sync.mjs" status "$WORKSPACE"
cat "$WORKSPACE/.slr/kb/last-sync.json"
```

最后一个文件在批次执行结束后才出现。status 的 automatic 字段给出批次状态及日志路径。检查：

1. 关闭模式不创建同步批次或业务工具调用；恢复沿用关闭状态。
2. A 整体成功后，未 /exit 就出现自动批次；三类材料只在此时上传。
3. 追加无关聊天，确认批次冻结轨迹未包含新增消息；重复 Stop 不启动第二批。
4. 自动同步期间手动 once 返回 sync_running，不并发上传。
5. Scoper 绑定、Paper 阶段检索、主子轨迹分离与四角色权限正常。
6. 完成相关调研 B，检查论文和策略复用、必要补读、Manager 验收及来源映射。

已有验收工具（只读远端，但仍属于真实验证）：

```bash
node "$PLUGIN_DIR/scripts/kb-cloud-check.mjs" "$WORKSPACE" --complete
# 对相关调研 B 设置正确 WORKSPACE 后：
node "$PLUGIN_DIR/scripts/kb-cloud-check.mjs" "$WORKSPACE" --complete --require-reuse
```

故障回退用独立测试项目及错误令牌，不停真实 KB。查询失败应继续原流程。自动上传认证失败后退出，不因后续 Stop 无限重试；恢复正确环境后手动 resume，确认已成功项不重发、有 job ID 的条目只查原任务。

## 7. 状态、日志与恢复

```bash
node "$PLUGIN_DIR/scripts/kb-sync.mjs" status "$WORKSPACE"
# 继续未完成批次，扫描补漏；同一工作区有同步进程时不启动第二次上传
node "$PLUGIN_DIR/scripts/kb-sync.mjs" once "$WORKSPACE"
# 修复原因后显式恢复失败项
node "$PLUGIN_DIR/scripts/kb-sync.mjs" resume "$WORKSPACE"
```

可加 --max-wait-seconds 120，默认 1800 秒。once 不重启 failed 项；resume 恢复 failed/waiting。已有 job ID 的失败任务必须先按 KB 运维流程修复并重试原任务，不通过重复上传创建新任务。

记录位置：

- .slr/kb/batches/<id>.json 与同名 .log：批次、原生边界和进程日志。
- .slr/kb/sync-process.json：同步进程所有权、PID 与心跳。
- .slr/kb/outbox/：冻结内容、哈希、尝试次数、远端 ID/job ID。
- .slr/kb/last-sync.json：最近一轮结果。
- .slr/kb/trajectories.json：原生来源、行号和冻结批次。

| 状态 | 处理 |
| --- | --- |
| running / sync_running | 已有进程运行，等待；不要删除锁 |
| complete | 本轮同步完成，查看结果；调研成功与同步成功分别报告 |
| pending / waiting / time_limit | 一次性进程退出后用 once 继续原任务 |
| launch_failed / scheduled 且无进程 | 启动失败或启动前中断；检查日志、Node、权限，再 once |
| failed | 检查令牌、服务及输入，修复后 resume |
| incomplete | 检查最终原生消息、半行、前缀改写或缺失文件；无法确认时不伪造完整轨迹 |
| not_ready | 当前成果已变化、活动任务未结束或没有成功收尾；不手工伪造状态 |

活同步进程不会被第二个命令抢占；已死进程可接管。逐项请求租约最多等待 120 秒，连续中断达到上限后需显式 resume。系统重启后不会自动常驻恢复，操作者运行 once/resume 即可。

如果异常退出导致 SubagentStop 缺失：先确认 Agent 已停止并按原 Pipeline 恢复任务，再执行：

```bash
node "$PLUGIN_DIR/scripts/kb-control.mjs" confirm-stopped "$WORKSPACE" '<实际agent-id>' --confirmed-stopped
```

该命令拒绝尚有活动分配的 Agent。恢复主流程并正常交付以触发 Stop；已经记录的失败批次需要手动恢复。保留整个工作区及 Claude 原生轨迹目录，不删除队列、修改冻结内容或清空数据库。

## 8. 后续升级与验证记录

升级前结束活动调研、等同步结束，再重复第 2～3 节。加载新插件后新建调研验收；不迁移旧任务。知识库不需要重新部署。

离线测试证据见 [Sprint2-B 验证记录](sprint2-b-validation.md)。真实 Stop/原生轨迹格式、独立进程生命周期、MCP 和模型联调均待用户验收；本轮服务器静态校验不能替代这些验证。
