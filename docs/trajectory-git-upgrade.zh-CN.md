# 轨迹上传与知识库 Git 升级手册

适用于 Ubuntu 22.04.4 LTS，Pipeline 与知识库已经部署的服务器。本轮不用发布包；源码统一位于 auto-survey 分支。

## 行为变化

- 所有原始轨迹继续归档在工作区。新任务仅上传 worker/manager/scoper/paper 的确定性投影；Reviewer 最终 experiences.json 仍提交。
- 投影保留任务、决策、错误、修复和结果，删除 progress/file-history-snapshot/queue-operation；未知事件保留。精确重复的 2000 字符以上内容引用首次原始行；工具正文超过 12000 字符保留首尾各 6000 字符。原始文件不改写。
- metadata 包括运行、Agent、会话、来源角色、可选任务和阶段、原始哈希及投影版本。投影每行含 originalLine。策略 event_range 指向服务端保存的投影行；通过 originalLine 回查本地原文。
- submit_trajectory 继续接受旧 {content}，新调用可附 metadata。超限时增加 transfer={id,index,count,contentHash}，index 从 0 开始。分段不超过 4 MiB，检查 JSON 请求总长度；未齐返回 accepted，到齐返回 stored/duplicate、id、job_id。16 MiB 是请求上限，不是整个逻辑轨迹上限。
- 传输内容 SHA-256 按原始 UTF-8 字节计算。轨迹实体沿用规范化 JSON 内容去重；相同内容的新来源追加关联，不修改已有来源或重建任务。
- 分段进度、冻结投影和任务 ID 持久保存。服务端未完成传输不会自动过期。
- 一次同步默认最多 6 小时，30 秒轮询；不会因旧 trackUntil 到期停止。单次网络请求仍为 20 秒。时间预算耗尽退出码为 0，状态仍为 pending/time_limit，不能报告蒸馏成功。
- worker 每处理一个分段就让出队列；优先最多 5 个入库任务，再给可运行蒸馏任务一次机会。旧任务检查点、重试次数和来源关系保留。失败项不会因升级自动重试。

## 首次转为 Git 部署

更新前暂停新调研，等正在运行的单次同步结束；不要删除本地队列。以下命令不启动补传或测试。已有 KB 后台任务会在 worker 更新后继续。

```bash
source "$HOME/.config/survey-kb/env.sh"
cd /root/JiahaoCAO/SLRHarness_cc_plugin
git status --short
git fetch origin auto-survey
# 有本地源码改动时停止，不要 reset --hard。
git pull --ff-only origin auto-survey
# 仅首次创建知识库源码 checkout，保留旧部署目录：
test ! -e /root/survey-kb-source && git clone --no-hardlinks --branch auto-survey --single-branch /root/JiahaoCAO/SLRHarness_cc_plugin /root/survey-kb-source
git -C /root/survey-kb-source remote set-url origin git@github.com:tanyouqing/SLRHarness_cc_plugin.git
cd /root/survey-kb-source
export KB_STATE_DIR=/root/survey-kb/knowledge-base
export BGE_MODEL_DIR=/root/survey-kb/bge-m3
bash knowledge-base/scripts/compose-git.sh config --quiet
```

首次克隆复用服务器现有 Git 对象，避免重复下载历史；它是独立 checkout，origin 随后设回 GitHub，后续正常 git pull。预期无配置错误。该包装脚本固定 Compose 项目 survey-kb，使用旧 .env 和 config，保持原命名卷，挂载已有离线模型。源码/构建上下文在新 checkout。不要运行 init-env.py，不要复制令牌到仓库，不要执行 down -v。如果真实路径不同，先修正上面的两个绝对路径。

## 每次升级（首次也执行）

```bash
cd /root/survey-kb-source
git status --short
git pull --ff-only origin auto-survey
# 同步 Pipeline；工作区目录不变。
git -C /root/JiahaoCAO/SLRHarness_cc_plugin pull --ff-only origin auto-survey
source "$HOME/.config/survey-kb/env.sh"
node --version
# 本轮 Pipeline 锁文件未变，无需重装依赖；将来锁文件改变时在插件目录执行 npm ci --ignore-scripts。
bash knowledge-base/scripts/compose-git.sh config --quiet
bash knowledge-base/scripts/compose-git.sh build api
```

镜像以 Git 短提交号命名。构建失败时旧服务继续运行；修复网络或构建问题后重试，不要先停数据库。

备份与更新（root 执行，备份可能含密钥，不要分享）：

```bash
umask 077
BACKUP_DIR=/root/survey-kb/backups/git-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP_DIR/old-image-id"
docker tag "$(cat "$BACKUP_DIR/old-image-id")" survey-kb:before-git-upgrade
tar -czf "$BACKUP_DIR/private-config.tar.gz" -C /root/survey-kb/knowledge-base .env config compose.yaml compose.offline.yaml
# 只停止应用层；留足时间让当前模型调用和检查点完成。
bash knowledge-base/scripts/compose-git.sh stop -t 330 api worker
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP_DIR/kb.dump"
test -s "$BACKUP_DIR/kb.dump"
# 迁移是新增表/列，事务执行，保留所有现有数据。
bash knowledge-base/scripts/compose-git.sh --profile tools run --rm -T --no-deps migrate </dev/null
bash knowledge-base/scripts/compose-git.sh up -d --no-deps api worker
```

预期迁移首次输出 Applied 002_trajectory_transport.sql，重复执行不重做；API、worker 启动，数据库与 Embedding 容器 ID 保持原值。升级后 worker 会自然继续现有任务，这不是新测试。

如果迁移失败，不继续启动新版；保留错误日志，用下节旧镜像恢复应用。正常停机保留检查点；若超过宽限期被终止，按原有租约机制恢复，可能计入一次中断尝试。

## 静态检查与回退

```bash
cd /root/survey-kb-source
bash knowledge-base/scripts/compose-git.sh config --quiet
bash knowledge-base/scripts/compose-git.sh ps
bash knowledge-base/scripts/compose-git.sh exec -T api node --check dist/server.js
bash knowledge-base/scripts/compose-git.sh exec -T worker node --check dist/worker.js
docker exec survey-kb-db-1 psql -U kb -d kb -c 'SELECT name FROM schema_migrations ORDER BY name;'
cd /root/JiahaoCAO/SLRHarness_cc_plugin
node --check scripts/kb-sync.mjs
claude plugin validate .
git rev-parse HEAD
git -C /root/survey-kb-source rev-parse HEAD
```

预期两个 checkout 提交相同、语法与插件校验通过、存在迁移记录。上述步骤不提交论文/轨迹、不发起真实模型测试。自动健康检查与既有 worker 任务照常运行。

回退应用（保留新数据表）：

```bash
cd /root/survey-kb-source
KB_APP_IMAGE=survey-kb:before-git-upgrade bash knowledge-base/scripts/compose-git.sh up -d --no-deps api worker
```

需要回退 Pipeline 时，先暂停调研与同步，记录当前提交后切换到升级前已记录的提交。新分段上传不能调用旧 API，回退期间停止同步；数据库新增结构无需删除。恢复新版后使用原队列继续。

## 查看与恢复（由用户执行）

```bash
source "$HOME/.config/survey-kb/env.sh"
cd /root/JiahaoCAO/SLRHarness_cc_plugin
node scripts/kb-sync.mjs status "$PWD/workspaces/agent-context-compression-2026"
```

顶层 trajectories 显示 localRetained/uploading/stored/queued/running/succeeded/failed。stored 表示已有服务端回执；queued/running/failed 由最近查询更新，并非实时数据库快照。冻结数量不等于上传数量。

下面会真正补传/查询任务，升级验证阶段不自动执行：

```bash
export SURVEY_KB_SYNC_MAX_SECONDS=21600
node scripts/kb-sync.mjs resume "$PWD/workspaces/agent-context-compression-2026"
# 或本次覆盖为 12 小时：
node scripts/kb-sync.mjs once "$PWD/workspaces/agent-context-compression-2026" --max-wait-seconds 43200
```

Stop 与手动命令均读取 SURVEY_KB_SYNC_MAX_SECONDS，范围 1..86400 秒；可写入服务器私有 env.sh。resume 对已有 job_id 只查询原任务，不以重新上传代替服务端重试。服务端 failed 按知识库运行手册的原任务运维重试流程处理。

未完成分段传输的运维：

```bash
cd /root/survey-kb-source
bash knowledge-base/scripts/compose-git.sh exec -T api node dist/transfer-admin.js list
# 确认对应客户端已停止、明确放弃此传输后，才执行：
# bash knowledge-base/scripts/compose-git.sh exec -T api node dist/transfer-admin.js abandon <完整传输ID> --confirm-no-client-running
```

abandon 仅删除该未完成传输及分段，不删除已有轨迹/任务；执行后不能从客户端中间分段直接恢复，应保留原始与投影文件，由运维明确重置该传输的客户端分段游标为 0 后再传。常规故障恢复不需要清理。

## 验收边界

本机：两项目类型/构建/离线测试，覆盖投影、分段、幂等、原任务恢复和调度。服务器：版本、配置、挂载、迁移与启动状态检查。真实大轨迹传输、模型质量、长时间调度及吞吐留待云端验收，不能把 mock 测试当作数据库事务或模型联调已通过。
