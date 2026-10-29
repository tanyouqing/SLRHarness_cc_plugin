# 检索驱动归并：设计与 Git 升级手册

适用：Ubuntu 上已经部署 Pipeline 和 Survey KB。无需重新安装、下载模型或上传轨迹。此版统一采用检索归并，没有小任务全量归并或逐对比较分支。

## 处理方式

同一轨迹分段产生的候选按稳定顺序处理。当前候选通过 BGE-M3 和关键词检索本任务已经保留的策略，两路各返回最多 20 条，RRF（k=60）融合后默认取 5 条。关键词采用统一 Unicode 分词、任意词匹配；向量使用精确余弦距离。只检索本任务、同角色、当前内容版本和模型版本，不以 stage/task 作硬过滤。

Agent 一次读取当前候选及全部召回结果，联合判断保留、舍弃低价值候选或与多个目标合并。完整内容通过连续 12000 字符窗口读取；检索用的文本窗口不代表 Agent 已完整阅读。合并引用 ID/版本，真实来源由服务端取并集；覆盖已有建议须合并来源，不能以 drop 丢掉证据。已经合入保留策略的当前候选禁止再 drop。

每次合并减少独立候选数。新内容建立索引后重新检索，没有全量逐对比较兜底。暂存索引在 `distillation_candidate_indexes` / `distillation_candidate_chunks`，不参与公开 search_strategies；删除任务时级联删除。正式入库仍由管理 Agent 使用同源 12 条＋全库混合检索 12 条去重。候选数少不代表质量已验证，需观察漏合并、误合并和条件/证据是否保留。

配置 `CONSOLIDATION_TOP_K=5`，允许 1–12；省略即使用默认值。可在 `/root/survey-kb/knowledge-base/.env` 修改后重新创建 API/worker。提高 K 会增加读取量和模型成本。BGE 模型版本固定；出现 `embedding model version changed` 时恢复原模型版本并调查，不能当作检索无结果继续或直接删除任务索引。

## 调度与恢复

- 单 worker；入库最多连续五次后让蒸馏执行一次。蒸馏内部完成队列（归并/索引/提交/等待检查）与提炼队列按 2:1 轮转；空队列不占配额。
- 可运行蒸馏任务若超过 15 分钟未调度，先选择等待最久者，再按队列配额选择。同队列按最近调度时间排序。该规则为调度优先级，不是任务完成时限。
- 每次调度最多一次归并 Agent 调用。决策落盘后直接推进保留列表、游标和阶段，取消只做本地状态更新的空调度；有效工作后的让出无额外三秒冷却，子任务等待检查间隔 15 秒。
- 决策、来源与版本更新在检查租约的事务中保存。Embedding 在事务外执行，每个候选的索引头和所有分块同事务提交。决策已保存而索引失败时只补索引；模型失败重用检索 ID/版本快照。事务未提交的模型调用可能重做，但不会重复发布结果。
- 保留最多三次失败尝试、心跳和入库幂等。正常让出不消耗失败次数，不增加并发来绕开 TPM 配额。

`get_job.progress` 新增 `consolidation_algorithm`、`processed_candidates`、`retained_count`、`retrieval_count`、`agent_decision_count`、`wait_reason`。新算法为 `retrieval-v1`；决策次数统计已提交的新算法决策，不含失败调用和旧算法历史决策。`retained_count` 是暂存数量，最终入库数量看 `strategy_count`，未完成时为 null。等待原因包括 scheduler、index_pending、child_ingestion、failed。

旧任务在下次执行时惰性转换：提炼继续原分段；归并保留 items/current、next、历史决策和已合并来源，旧 compare/assessed 留作审计，改用检索快照；已提交/等待/成功任务保持原回执流程。不会重新上传或重做已完成提炼，failed 不自动恢复。明确重试仍使用 `dist/admin.js retry <原job_id>`，先查错误再执行。

## 已部署服务器升级命令

先确认 Claude 调研和 kb-sync/kb-stop 同步进程均已退出。以下流程不运行 smoke、真实上传或模型测试；启动 worker 后它会自然处理原队列。

```bash
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
# 两处应无未提交改动；有改动时先保留并核对，不能 reset --hard。
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
bash "$KB/scripts/compose-git.sh" config --quiet
bash "$KB/scripts/compose-git.sh" build api

umask 077
BACKUP=/root/survey-kb/backups/retrieval-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP/old-image-id"
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-before"
bash "$KB/scripts/compose-git.sh" stop -t 330 api worker
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP/database.dump"
docker exec -i survey-kb-db-1 pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database-toc.txt"
tar -C /root/survey-kb/knowledge-base -czf "$BACKUP/private-config.tar.gz" .env config
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
  "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-before"

bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps migrate </dev/null
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
  "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-after"
cmp "$BACKUP/jobs-before" "$BACKUP/jobs-after"
docker exec survey-kb-db-1 psql -U kb -d kb -c 'SELECT name FROM schema_migrations ORDER BY name;'
# 应存在 004_retrieval_consolidation.sql；cmp 无输出表示原任务未被迁移脚本改写。
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  --entrypoint node migrate dist/check-retrieval-sql.js </dev/null
# 只读事务 EXPLAIN 实际检索和调度 SQL，不执行 ANALYZE、任务或模型调用。
bash "$KB/scripts/compose-git.sh" up -d --no-deps api worker
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-after"
cmp "$BACKUP/containers-before" "$BACKUP/containers-after"
bash "$KB/scripts/compose-git.sh" ps
bash "$KB/scripts/compose-git.sh" exec -T api node --check dist/server.js </dev/null
bash "$KB/scripts/compose-git.sh" exec -T worker node --check dist/worker.js </dev/null
claude plugin validate "$PIPE"
```

迁移失败时先保留日志，不启动新版。该迁移在事务中执行，只新增索引表和调度计数，不删除业务数据。若 worker 尚未运行新版，可用备份中的旧镜像恢复 API/worker；新表可保留。若已有检查点转换为 retrieval-v1，旧 worker 不理解它：停止 worker，保留数据库和新检查点，优先修复向前升级，不直接用旧 worker 接管，也不覆盖回旧检查点。备份恢复应作为独立的停写操作核对后执行。

## 只读观察与验收边界

```bash
docker exec survey-kb-db-1 psql -U kb -d kb -c "SELECT id,status,checkpoint->>'phase' AS phase,
 checkpoint#>>'{consolidation,algorithm}' AS algorithm,
 checkpoint#>>'{consolidation,next}' AS cursor,
 checkpoint#>>'{consolidation,agentDecisionCount}' AS decisions,
 result->>'strategy_count' AS stored_strategies,error
 FROM jobs WHERE kind='distill' ORDER BY created_at;"
docker logs --tail 40 survey-kb-worker-1
```

本机仅做模拟数据库、Embedding、模型和 MCP 的离线验证。对独立候选验证 N 条只需 N 次归并 Agent 调用；索引恢复、真实 schema、来源/版本、调度及旧检查点均有回归。服务器仅做备份、兼容迁移及静态/数据一致性检查。真实检索召回与归并质量、TPM 和总耗时由原任务运行结果或用户后续验收确认。
