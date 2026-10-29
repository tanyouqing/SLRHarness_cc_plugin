# 全库快照与恢复

每次完整调研成功、Stop 同步完成全部远程任务后，保存一个全库版本。恢复粒度为整个知识库；现有策略停用、反馈和内部不可变修订机制保留，不新增单条策略或笔记回退入口。

## 自动保存时机与内容

流程为：最终审稿通过 → Stop Hook 冻结本轮材料 → 上传及跟踪 → 服务端蒸馏、入库完成 → 保存全库快照。仅收到 trajectory 的 stored 回执不能触发快照。禁用 Survey KB 的调研不保存快照。

保存前同时检查本轮回执、未发送反馈，以及全库任务和分段传输。其他运行仍在处理、存在失败任务或未收齐传输时返回 waiting，不生成“完整完成”版本。先按现有运维流程解决这些项目，然后执行 once/resume。已明确清理或无需蒸馏的项目记录为 exclusions，可生成快照，清单保留排除情况。

快照包含整个 PostgreSQL 数据库：论文、笔记、经验、状态、历史修订、轨迹、向量、来源、任务、检查点、反馈、审计和幂等回执。使用数据库容器内的 PostgreSQL 16 `pg_dump -Fc`，不运行模型、不重新生成向量。保存期间短暂停止 API/worker，数据库与 Embedding 保持原容器；完成后只恢复原先运行的服务。并行客户端在此期间可能暂时不可用，按原有逻辑回退。

文件默认位于 `/root/survey-kb/snapshots/v-<32位UUID>/`：

- `database.dump`：完整数据库归档。
- `manifest.json`：版本 ID、时间、运行与批次、上传回执、内容校验和、数量及摘要、代码提交、数据库迁移和模型配置。
- 目录外的 `control.json`：当前库代次、未完成保存/恢复记录，不能随数据库一起回退或手动删除。

模型权重、API 密钥、私有配置、Docker 镜像和 Pipeline 原始工作区不包含在数据库快照中，继续保留现有部署目录及运维备份。快照记录兼容信息，不等于自动备份了这些外部文件。

同一库代次、同一 runId/batchId 只生成一个自动版本；响应丢失后恢复会返回已有快照。手工 create 每次生成新版本。所有快照保留，没有自动删除策略；需监控磁盘并定期复制快照和 control.json 到独立存储。同盘快照不能应对整盘损坏。

## 现有部署升级与初始版本

适用当前同机部署：Pipeline 位于 `/root/JiahaoCAO/SLRHarness_cc_plugin`，知识库 Git checkout 位于 `/root/survey-kb-source`，实际配置和模型仍在 `/root/survey-kb`。Python 使用 Ubuntu 自带 Python 3.10+ 标准库，Docker 调用使用现有权限，不需要新依赖、MCP 工具或数据库迁移。

先结束使用此插件的调研和同步进程。以下只适用于本次“宿主机脚本”升级；未来修改知识库应用代码时仍需按对应手册构建镜像。

```bash
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
# 有本地改动先处理；不强制覆盖。
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
node --check "$PIPE/scripts/kb-sync.mjs"
node --check "$PIPE/scripts/kb-snapshot.mjs"
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read()); print("snapshot syntax OK")' "$KB/scripts/snapshot.py"
# 本次没有容器应用代码变化，给现有镜像增加当前 Git 别名即可。
docker image tag "$(docker inspect survey-kb-api-1 --format '{{.Image}}')" \
  "survey-kb:git-$(git -C /root/survey-kb-source rev-parse --short HEAD)"
bash "$KB/scripts/compose-git.sh" config --quiet

# 首次启用时建立基线；会短暂停止并恢复 API/worker，保留全部数据。
python3 "$KB/scripts/snapshot.py" create --label '启用全库快照后的初始版本'
python3 "$KB/scripts/snapshot.py" list
```

预期 `status=saved`，result 中有 `id/sha256/database`；四个容器恢复原运行状态。若返回 waiting，库中还有任务或传输没有结束；不要为强行保存而删除任务。修复或明确清理后再执行。此前已经结束的运行不会因升级自动重放，基线保存当前全库。

默认路径无需配置。自定义时，在 Claude、Stop 子进程和管理员终端使用相同环境变量：

```bash
export SURVEY_KB_SNAPSHOT_DIR=/root/survey-kb/snapshots
export KB_SOURCE_DIR=/root/survey-kb-source/knowledge-base
# 可选：export SURVEY_KB_PYTHON=python3
```

自动保存要求 Pipeline 与 KB 位于同一 Docker 主机且 MCP URL 为 localhost/127.0.0.1/::1。异地主机不会自动保存；本版不提供远程备份代理。运行用户需要现有 Docker 权限及快照目录读写权限。

## 查看与重试

```bash
KB=/root/survey-kb-source/knowledge-base
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
WORKSPACE="$PIPE/workspaces/替换为实际调研目录"
python3 "$KB/scripts/snapshot.py" list
python3 "$KB/scripts/snapshot.py" status
node "$PIPE/scripts/kb-sync.mjs" status "$WORKSPACE"
node "$PIPE/scripts/kb-snapshot.mjs" status "$WORKSPACE"
# 若本轮数据均已保存，仅快照待保存：继续原批次，不重传成功数据。
node "$PIPE/scripts/kb-sync.mjs" once "$WORKSPACE"
# 需恢复原同步项时沿用已有 resume 规则。
node "$PIPE/scripts/kb-sync.mjs" resume "$WORKSPACE"
```

本轮回执保存在 `.slr/kb/snapshot.json`。同步状态 `pending / snapshot_pending` 表示还未保存完整快照；查看 uploadStatus 可区分上传已完成。等待其他运行的检查间隔为 15 秒，沿用同步总预算（默认 6 小时）。预算耗尽后需显式 once/resume，不启动常驻服务；已经开始的数据库备份不会被总预算强制杀死。

快照工具退出码：0 成功，3 条件未满足/其他快照正在操作，1 错误。存储空间至少需大于当前数据库大小加 64 MiB，此检查不能保证并发磁盘写入后仍够用。磁盘写满或备份失败不会登记成功版本。

若 status 出现 pending_save，表示保存过程中被中断或服务恢复失败。修复磁盘/Docker 问题后重复 create（自动运行则重复 once），工具先恢复原服务状态。`.partial-*` 不列入可恢复版本；确认没有正在执行的快照操作后，可人工清理失败留下的 partial 目录，不能删除 control.json。

## 恢复指定全库版本

恢复会撤销目标版本之后的所有知识库变动，包括其他调研的新增内容及后续状态反馈。若某次运行有问题，应选择它之前的版本。多个调研交错运行时，版本代表保存时刻的全库，不提供逐运行撤销。

先正常退出所有使用 Survey KB 的 Claude 会话、同步和反馈发送进程，并暂停外部客户端。恢复工具会阻止本机接入层的新调用并停 API/worker，但不能撤回已经进入 Agent 上下文的材料，也不能管理其他机器的本地队列。不要在运行中的调研上执行恢复。

先 list 获取准确 ID，再执行以下**恢复命令**；不要为了验证部署直接执行它：

```bash
KB=/root/survey-kb-source/knowledge-base
SNAPSHOT_ID='替换为list返回的完整v-版本ID'
python3 "$KB/scripts/snapshot.py" restore "$SNAPSHOT_ID" --confirm "$SNAPSHOT_ID"
python3 "$KB/scripts/snapshot.py" status
bash "$KB/scripts/compose-git.sh" ps
```

工具先验证 SHA-256、PostgreSQL 主版本、迁移列表和模型配置；兼容后停写，自动保存当前全库的 pre_restore 安全备份，再用单事务恢复。恢复后检查实体、修订、轨迹、来源、向量和任务摘要，匹配才恢复服务。不会下载模型或重跑成功任务。安全备份即使含未完成任务也保留，供故障恢复；若主动恢复该备份，worker 启动后可能继续其中任务。

迁移列表不同会拒绝恢复。需要先依据 manifest 对齐应用/数据库结构和模型环境；不能仅降低 Git 版本就强行覆盖。镜像、配置和模型目录仍由管理员保留。

若中途失败，API/worker 保持停止，control.json 保存原目标和安全备份。修复原因后**重复同一个 restore 命令**即可，不覆盖第一次安全备份，不累计增加库代次。不要手工删除 pending_restore 或直接启动写入服务。

恢复后库代次增加。所有恢复前创建的工作区都会停止 KB 调用、缓存注入和补传，即使它们持有成功回执；工作区文件仍保留。后续请新建调研工作区，不要手改 snapshotGeneration 来放行旧队列。已在旧会话上下文里的知识不能自动撤回，需开启新会话。外部客户端需要管理员自行清理旧缓存和待发送队列。

## 验证边界

离线测试使用临时文件与模拟 Docker/数据库，覆盖完成门槛、保存幂等、回执变化、校验和、备份失败、恢复中断、原安全备份复用、恢复摘要不一致和旧工作区隔离。真实部署仅检查语法、版本、挂载、数据一致性及基线归档可读取；没有在生产库执行真实回退。完整恢复演练应另建隔离数据库进行，不能把 `pg_restore --list` 当作已通过恢复演练。
