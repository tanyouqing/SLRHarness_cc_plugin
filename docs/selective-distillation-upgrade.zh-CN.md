# Sprint2：选择性蒸馏、严格去重和快速收尾

## 本次行为

新建任务在 payload 固定 `policyVersion=selective-v2`；缺少版本的任务按 `legacy-v1` 运行。旧任务的提炼、归并、管理 Agent 和共享背景从 `prompts/legacy-v1/` 读取，旧任务后续新建的入库子任务也携带旧版本。重复上传命中原任务时不改变版本，不重新提炼、不清理或重整已入库策略。内容相同的入库项仍复用原回执及其策略版本。未知版本报错，不能默默按新版执行。本次不修改 Pipeline 运行逻辑或经验公开格式，不新增 MCP 工具。

新轨迹先进入 `triage`。脚本扫描全部已保存 JSONL，生成首尾节选和错误/修复关键词的位置提示。提示有误报、漏报可能；它只帮助定位，不能证明失败、成功或无错误。Agent 可用每次 12000 字符的原文窗口继续读取，采用现有 distiller 的模型、轮次和超时配置。

| 判别 | 后续处理 |
| --- | --- |
| failure | 提炼明确任务失败的条件、未奏效做法与限制，不编造解决方案 |
| recovered_success | 提炼试错过程和有证据的有效修复 |
| routine_success | 正常完成、零策略，标记 skipped |
| unique_success | 记录具体独特价值后提炼；常规工具使用、写作和交接不算独特价值 |
| unknown | 分段检查，不凭片段推测最终结果 |

判别结果及证据先写检查点。调用失败走现有重试；已保存的判别不会重做。分段提炼接收判别和前段摘要，需要跟踪未解决问题及后续修复，不能把后来解决的错误当作最终失败。模型只能从可见证据得出限定结论，不能由一次限流、超时或权限拒绝推导永久禁用。语义判断仍依赖模型，本地测试不能保证模型总能正确识别结局。

归并要求同一具体问题、等价核心行动（或完整覆盖）、相容条件/结果/限制。互补操作、相同主题或相邻步骤不能作为合并理由；例如读取长度限制和引用完整性检查保持独立。多目标必须表达同一个核心建议。`duplicateBasis` 要逐目标说明 problem/coreAction/conditions，服务端校验对应 ID、版本及非空说明，真实来源取并集；这些结构校验不能替代语义验证。低价值候选直接舍弃，不用减少数量作为合并理由。正式入库使用相同原则，独立建议用 new；Reviewer JSON 不经过轨迹判别。

## 调度和状态

- 单 worker，最多连续 5 次入库后给蒸馏机会。
- 完成队列（归并、索引、提交）与提炼队列（triage、segments）按 2:1；队列为空立即使用另一队列。同队列按最近调度时间排序，等待超过 15 分钟不再跨队列覆盖配额。
- 最终候选在同一轮连续入队，每条提交前校验父任务租约，成功后立即保存回执。中断或回执丢失仍通过内容哈希复用，不重复创建策略。
- waiting 父任务退出模型工作队列。worker 在模型调用之间运行轻量扫描，扫描间隔至少 15 秒，每轮最多 100 个到期父任务。未完成项延后 15 秒，完成项直接收尾，不消耗调度配额；正在进行的模型调用不会被打断，所以 15 秒不是完成延迟的硬上限。
- 扫描使用行锁和事务，不接管有效租约。子任务失败/缺失按最多三次失败尝试终止父任务；不自动重试失败子任务。数据库事务失败回滚，下轮扫描重试。正常等待不消耗失败次数。

`get_job.progress` 新增 `policy_version`、`triage_kind`、`triage_reason`、`triage_evidence`、`skip_reason`。普通成功跳过时任务 `status=succeeded`，`phase=skipped`，result.ids 为空、策略数为 0，并返回 `distillation=skipped`。这表示已判别无需提炼，不表示模型错误。原有归并、策略数和来源字段不变。

## 已部署服务器的 Git 升级

不用安装包，不重装数据库、Embedding 或模型。先确认 Claude 调研及 kb-sync/kb-stop 进程退出，两个 checkout 没有未提交改动。构建阶段现有服务可继续运行；备份前平稳停止 API/worker。

```bash
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
bash "$KB/scripts/compose-git.sh" config --quiet
bash "$KB/scripts/compose-git.sh" build api

umask 077
BACKUP=/root/survey-kb/backups/selective-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP/old-image-id"
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-before"
bash "$KB/scripts/compose-git.sh" stop -t 330 api worker
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP/database.dump"
docker exec -i survey-kb-db-1 pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database-toc.txt"
tar -C /root/survey-kb/knowledge-base -czf "$BACKUP/private-config.tar.gz" .env config
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
  "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-before"

# 本轮无需新增数据库迁移。先只做 SQL 规划检查，不执行任务或模型。
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  --entrypoint node migrate dist/check-retrieval-sql.js </dev/null
# 预期关键词、向量、scheduler、waiting sweep 均显示 SQL plan valid。
docker exec survey-kb-db-1 psql -U kb -d kb -At -c \
  "SELECT id,kind,status,md5(payload::text),md5(checkpoint::text),md5(result::text) FROM jobs ORDER BY id" > "$BACKUP/jobs-after"
cmp "$BACKUP/jobs-before" "$BACKUP/jobs-after"
# cmp 无输出：静态检查未改写任务。
bash "$KB/scripts/compose-git.sh" up -d --no-deps api worker
docker inspect survey-kb-db-1 survey-kb-embedding-1 --format '{{.Name}} {{.Id}}' > "$BACKUP/containers-after"
cmp "$BACKUP/containers-before" "$BACKUP/containers-after"
bash "$KB/scripts/compose-git.sh" ps
bash "$KB/scripts/compose-git.sh" exec -T api node --check dist/server.js </dev/null
bash "$KB/scripts/compose-git.sh" exec -T worker node --check dist/worker.js </dev/null
```

启动后的 worker 自然继续旧任务，不重新上传，也不自动恢复 failed 任务。检查失败时保持 API/worker 停止，核对日志及配置；不要清空数据或改任务版本来绕过错误。

回退：尚未创建 selective-v2 任务时，可用备份的旧镜像 ID（`KB_APP_IMAGE=$(cat "$BACKUP/old-image-id")`）通过同一 compose helper 重建 API/worker。已有新版任务时，旧镜像不了解 triage/skipped 和新版提示词语义，应保持新版任务暂停并向前修复；不要让旧 worker 接管，也不要回灌备份覆盖新数据。

## 只读观察

```bash
docker exec survey-kb-db-1 psql -U kb -d kb -c "SELECT id,status,
 COALESCE(payload->>'policyVersion','legacy-v1') AS policy,
 checkpoint->>'phase' AS phase,checkpoint#>>'{triage,kind}' AS triage,
 result->>'strategy_count' AS strategies,error FROM jobs WHERE kind='distill' ORDER BY created_at;"
docker logs --tail 50 survey-kb-worker-1
```

日志 waiting_sweep 表示本地收尾扫描，job_processed 只代表一次处理结束。真实验收需后续新提交的任务；不要用旧任务评价新提炼规则。抽查失败条件、修复依据、普通成功跳过原因、独立建议是否误合并及重复建议是否漏合并。比对等待时间时同时记录服务时间与排队时间，不能仅凭策略数量下降宣称质量提升。
