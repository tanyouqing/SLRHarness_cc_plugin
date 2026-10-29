# 策略反馈、状态与自动修订：现有部署升级

适用环境：已有 Pipeline 和 Survey KB 的 Ubuntu 22.04 服务器。通过 Git 更新，不使用增量安装包，不重装 Docker、数据库或 Embedding。

## 行为

所有审稿经验和轨迹策略都有 active、disabled、need_revised 状态。active 表示尚未确认问题，不保证有效。状态与 reason、具体说明、状态版本及时间在独立元信息中维护；公开经验正文格式不变。

四类执行角色用第八个 MCP 工具 report_strategy_feedback 提交实际使用版本的问题，主会话、Checker、Reviewer 不开放该工具。反馈立即提交，无需调研成功。建议状态不直接写入实体，管理 Agent 判断后才变更状态。

反馈示例（接口说明，不会自动执行）：

```json
{
  "strategy_id": "实际策略UUID",
  "revision": 1,
  "suggested_status": "need_revised",
  "reason": "建议与此任务的明确要求冲突，具体见下面证据",
  "context": {
    "runId": "实际运行ID", "agentId": "实际Agent ID", "role": "worker",
    "task": "topic/task", "situation": "实际适用条件",
    "action": "实际执行的建议", "outcome": "观察到的结果",
    "evidence": ["实际任务要求与输出中的相关片段"]
  }
}
```

四类角色的 Hook 检查真实绑定并补齐身份信息，只能反馈同任务检索过的 ID/修订。独立 MCP 客户端需提供全部身份字段；服务端检查实体、修订、角色，不能凭共享令牌证明外部客户端报告的任务真实性。不要把 MCP 令牌交给不可信客户端。

管理 Agent 使用原 manager 模型配置：核对反馈 → 设置状态 → 起草 → 独立调用核验 → 准备索引 → 原子启用。反馈不明确时返回 evidenceNeeded；不足以起草或核验失败时继续待修订。独立核验属于模型判断，不等于真实运行验证。草稿不可变，单独保存在 strategy_drafts；核验通过才创建正式 revisions 版本，不占用旧版本编号。状态、草稿和核验事件均可审计，本轮不提供人工回退命令。

公开搜索只返回 active；read 可查看停用内容与历史，附当前状态和版本。内部去重看到停用原因，相同内容不重新启用，语义重复且有新证据的补充进入复核任务。正常入库不得把停用策略换 ID 重新发布。语义判断仍需后续抽查。

Pipeline 缓存助手每次展示策略前用 read 重新检查状态。不可用时跳过策略，不用旧缓存代替；已进入上下文的内容无法撤回。查询结果再次展示时采用最新正文；完整记录切换修订时从开头重读，避免续读偏移错位。

## 升级命令

先结束使用此插件的 Claude 调研与同步进程。非 Survey KB 会话可继续，但不要同时改同一 checkout。检查 git status；有本地改动时先解决，不能强制覆盖。

```bash
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
cd "$PIPE"
npm ci --ignore-scripts
bash "$KB/scripts/compose-git.sh" config --quiet
bash "$KB/scripts/compose-git.sh" build api </dev/null

umask 077
BACKUP=/root/survey-kb/backups/governance-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP/old-image-id"
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-before"
bash "$KB/scripts/compose-git.sh" stop -t 330 api worker </dev/null
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP/database.dump"
docker exec -i survey-kb-db-1 pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database-toc.txt"
tar -C /root/survey-kb/knowledge-base -czf "$BACKUP/private-config.tar.gz" .env config
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
 "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-before"

# 兼容迁移 005；现有策略为 active，90 天从此刻开始计时。
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps migrate </dev/null
# 只读 SQL 规划和一致性检查，不执行模型、反馈、搜索或上传。
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
 --entrypoint node migrate dist/check-governance-sql.js </dev/null
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
 --entrypoint node migrate dist/check-retrieval-sql.js </dev/null
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
 "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-after"
cmp "$BACKUP/jobs-before" "$BACKUP/jobs-after"
bash "$KB/scripts/compose-git.sh" up -d --no-deps api worker </dev/null
bash "$KB/scripts/compose-git.sh" ps
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-after"
cmp "$BACKUP/containers-before" "$BACKUP/containers-after"
```

预期：005 仅执行一次；missing_current_revisions=0；新反馈任务为空；原任务摘要相同；DB/Embedding 容器不变。健康检查需要几十秒。检查失败先保持 API/worker 停止并看错误，不删除数据。

迁移及新功能启用后，旧 API 不认识 disabled 状态，旧 worker 不认识 feedback 任务。不要直接降级到旧镜像继续服务；保持新写入暂停并向前修复。数据库备份用于灾难恢复，不能用来覆盖升级后的新数据。

## 管理与恢复

以下 history、status 为只读；policy、reactivate、retry、resume 会写入状态或提交/处理任务，按需要手动执行。

```bash
KB=/root/survey-kb-source/knowledge-base
STRATEGY_ID='替换为实际策略UUID'
JOB_ID='替换为实际任务UUID'
WORKSPACE='/root/JiahaoCAO/SLRHarness_cc_plugin/workspaces/替换为实际调研目录'

# 查看当前状态、历次修订、草稿和审计记录。
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js strategy-history "$STRATEGY_ID"
# 单条期限 180 天，或豁免（true）；使用 default 继承全局期限。
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js strategy-policy "$STRATEGY_ID" 180 false '低频重要策略，延长观察期限'
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js strategy-policy "$STRATEGY_ID" default true '低频重要边界，排除自动弃用'
# 请求复核现有策略；此操作会调用管理模型，不直接恢复 active。
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js strategy-reactivate "$STRATEGY_ID" '提供具体新证据及重新启用理由'

cd /root/JiahaoCAO/SLRHarness_cc_plugin
source /root/.config/survey-kb/env.sh
node scripts/kb-feedback.mjs status "$WORKSPACE"
node scripts/kb-feedback.mjs resume "$WORKSPACE"
# 服务端 failed 时先排查配置/证据，再恢复原任务；随后 resume 继续查询。
bash "$KB/scripts/compose-git.sh" exec -T worker node dist/admin.js retry "$JOB_ID"
```

反馈本地队列位于 `.slr/kb/feedback/`。accepted 表示已接收，succeeded 表示已处理，server_failed 表示服务端失败；具体决定以 result 为准。resume 每个条目执行一次发送或查询，已有 jobId 只查询原任务。成功项跳过，进程租约过期后可接管。请求丢失通过稳定反馈内容复用服务端任务。补充材料时用 related_feedback_id 引用原反馈，不能修改已冻结的请求。

自动弃用默认 KB_INACTIVITY_ENABLED=true、KB_INACTIVITY_DAYS=90，配置放在原私有 `.env`，修改后用 compose helper 重建 worker。无需修改默认部署配置即可启用。worker 每分钟查看是否已到每日检查时间，实际弃用扫描最多每天一次；模型调用运行期间要等当前调用结束。首次扫描按迁移/新建/重新启用时间计时，内部检索、read、缓存状态校验和管理检查均不续期。只统计对外 search_strategies 最终返回的当前活跃版本。

## 验证边界

本机只运行离线 TypeScript、Node 和 Python 测试，覆盖实际工具 schema、模拟事务、版本冲突、独立核验、失败恢复、角色权限、缓存失效和自动弃用时钟。没有启动真实 DB/Embedding/模型。

服务器升级只运行迁移、静态 SQL 规划、版本/挂载/数据一致性检查，不主动提交真实反馈或触发模型验证。后续需用户用专门测试策略检查一次有效反馈、证据不足、修订核验、重新启用与缓存刷新。不要用生产策略随意试验停用；不要将模型核验或策略数量减少当作质量已验证。


### 服务器部署核验（2026-10-29）

- 实现提交 `3a77bfb` 已通过 Git 更新两个 checkout；API/worker 使用 `survey-kb:git-3a77bfb`，镜像中 Node.js 22。Pipeline 保留服务器已有 Node.js 26.10.0（依赖要求 >=22），通过语法与 SDK 导入静态检查，未改服务器运行时。
- 备份：`/root/survey-kb/backups/governance-20261029-213023-3a77bfb/`，包含数据库 dump、可读目录清单、私有配置、旧镜像、挂载和升级前后摘要。
- 迁移 005 成功。28 篇论文、51 条经验、93 条轨迹保留；全部原任务、修订内容哈希、轨迹哈希及清理标记、来源关联逐项比较一致。51 条经验均 active、status_version=1，last_retrieved_at 为空，期限从迁移时开始。
- 公开功能相关新 SQL 与原检索/调度 SQL 的只读规划检查通过；当前修订缺失为 0。历史修订、草稿和审计记录的不可变触发器均启用。
- API/worker/DB/Embedding 均 healthy，重启计数 0；DB/Embedding 原容器和所有持久挂载保持不变。未完成任务、反馈、草稿、策略状态事件均为 0。只执行迁移、静态及数据一致性检查，未执行真实搜索、反馈、上传、模型测试或恢复旧任务。
