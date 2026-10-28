# 轨迹角色、克制蒸馏与旧数据清理（2026-10-29）

适用已有部署：Pipeline `/root/JiahaoCAO/SLRHarness_cc_plugin`，知识库源码 `/root/survey-kb-source/knowledge-base`，私有配置 `/root/survey-kb/knowledge-base`。通过 Git 更新，不用安装包，不重建数据库或 Embedding。

## 行为变化

- 轨迹经验的 role 必须等于来源元信息中的 agentRole，只自动蒸馏 worker/manager/scoper/paper。多个来源必须一致；不根据正文猜角色。审稿 JSON 仍可以给四类角色分别提出建议。
- 无可信角色的轨迹可保存，返回 `job_id:null, distillation:"skipped", reason`；不会自动产生任务。`stored` 只代表原文保存。
- 提示词软目标：每段通常 0–1 条、整条通常 0–5 条。允许独立且有依据的例外，允许零策略。不得从一次失败概括出普遍禁用某工具。
- 分段结束后先进行整条轨迹归并，再入库。完整候选通过 12000 字符窗口读取；先评估价值，再逐项比较。合并保留真实来源并重新比较，每次合并减少条数。
- 内部去重按 role/sourceType 筛选，不按自由文本 stage 硬过滤。同源最多 12 条（范围重叠/邻近优先）与混合检索最多 12 条共同比较。对外显式 stage 查询不变。
- checkpoints 保存 segments/consolidating/submitting/waiting 阶段、游标、决策及逐项提交回执。恢复只继续未完成步骤；已提交旧子任务继续原 ID。
- get_job.progress 增加 phase、consolidated_count、strategy_count。candidate_count 是原始分段候选数，不能当作最终入库条数。

## 清理规则

删除来源未知、角色冲突、不支持角色的蒸馏任务及不合规策略。策略关联的任一来源不合规即删除该策略；同一任务中已经入库且角色正确的策略保留。相关待处理子任务和依赖任务纳入清单，防止继续发布旧候选。

角色正确的旧相似策略本轮不做批量语义清理。论文、审稿经验、原始轨迹保留。冲突任务行完全删除；清理标记留在轨迹上，重复上传不重建任务。相关分段回执不再返回被删任务 ID。

Pipeline outbox 对应项变为 `removed`，提示“已按角色规则清理”。`once/resume` 不会查询或重传这些项。`retained` 表示远程保存但未蒸馏；两者都不算蒸馏成功。批次只有这些排除项时显示 `complete_with_exclusions`，退出码 0。

## 升级与执行清理

先退出正在使用此目录的 Claude 会话。不要启动新调研或同步命令。以下清理会删除符合上述规则的数据，备份只供人工恢复。

```bash
set -euo pipefail
source /root/.config/survey-kb/env.sh
PIPE=/root/JiahaoCAO/SLRHarness_cc_plugin
KB=/root/survey-kb-source/knowledge-base
STATE=/root/survey-kb/knowledge-base
BACKUP=/root/survey-kb/backups/roles-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
git -C "$PIPE" status --short
git -C /root/survey-kb-source status --short
git -C "$PIPE" pull --ff-only origin auto-survey
git -C /root/survey-kb-source pull --ff-only origin auto-survey
bash "$KB/scripts/compose-git.sh" build api
```

预期两个 checkout 同一提交，构建成功；如果有本地改动或不能 fast-forward，先排查，不使用 reset 覆盖。

检查并停止**准确对应的**同步进程；不要用宽泛的 `pkill node`：

```bash
ps -eo pid,args | grep -E '[k]b-sync.mjs|[k]b-stop.mjs run|[c]laude'
# 若仍有同步进程：kill -TERM <核对后的PID>，等待其退出。
bash "$KB/scripts/compose-git.sh" stop api worker
docker inspect survey-kb-api-1 survey-kb-worker-1 --format '{{.Name}} {{.State.Status}}'
```

预期 api/worker exited。停止期间不要重启客户端。记录镜像、备份 DB、私有配置及 outbox：

```bash
docker inspect survey-kb-api-1 --format '{{.Image}}' > "$BACKUP/old-image-id"
docker exec survey-kb-db-1 pg_dump -U kb -d kb -Fc > "$BACKUP/kb.dump"
tar -C "$STATE" -czf "$BACKUP/config.tar.gz" .env config
find "$PIPE/workspaces" -type d -path '*/.slr/kb/outbox' -print0 |
  tar --null -T - -czf "$BACKUP/outboxes.tar.gz"
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps migrate </dev/null
```

预期新增 `003_distillation_roles.sql`。数据库和 Embedding 保持运行。非交互执行时必须使用 `-T` 和 `</dev/null`，避免 Compose 吞掉后续脚本输入。

生成清理清单并核对数量，清单无模型调用：

```bash
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  --entrypoint node migrate dist/role-cleanup-cli.js preview </dev/null > "$BACKUP/role-cleanup.json"
python3 - "$BACKUP/role-cleanup.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
for key in ['trajectories','experiences','jobs','ingestions','decisions','transfers']:
    print(key,len(p[key]))
print('snapshotHash:',p['snapshotHash'])
PY
node "$PIPE/scripts/kb-cleanup-queue.mjs" preview "$PIPE" "$BACKUP/role-cleanup.json"
```

执行已确认规则的清理，然后同步本地队列：

```bash
bash "$KB/scripts/compose-git.sh" --profile tools run --rm -T --no-deps \
  -v "$BACKUP/role-cleanup.json:/tmp/role-cleanup.json:ro" \
  --entrypoint node migrate dist/role-cleanup-cli.js apply /tmp/role-cleanup.json --writers-stopped </dev/null
node "$PIPE/scripts/kb-cleanup-queue.mjs" apply "$PIPE" "$BACKUP/role-cleanup.json"
```

清理在单个数据库事务中执行，并核对清单和当前数据。出现 `stale or altered` 时未执行删除：确认写入已停止后重新预览。修订保护触发器仅在维护事务内临时停用；失败回滚会恢复数据与触发器。若 DB 清理成功、本地命令失败，使用**原清单**重跑本地命令即可，操作幂等。

维护事务会先执行 `SET CONSTRAINTS ALL IMMEDIATE`，避免 current_revision 的延迟外键留下待执行事件，使 PostgreSQL 拒绝切换修订保护触发器。旧版脚本若报 `pending trigger events`，事务会回滚；更新代码后核对原清单仍匹配再执行，不能绕过外键约束。

静态检查与恢复服务：

```bash
docker exec survey-kb-db-1 psql -U kb -d kb -c "SELECT tgname,tgenabled FROM pg_trigger WHERE tgname='immutable_revisions';"
docker exec survey-kb-db-1 psql -U kb -d kb -c "SELECT name FROM schema_migrations ORDER BY name;"
node --check "$PIPE/scripts/kb-sync.mjs"
node --check "$PIPE/scripts/kb-cleanup-queue.mjs"
bash "$KB/scripts/compose-git.sh" up -d --no-deps api worker
docker ps --format '{{.Names}} {{.Status}}'
```

预期 immutable_revisions 的 tgenabled 为 `O`；迁移 003 已记录；api/worker 就绪。worker 会自然继续处理保留任务。本轮不要运行 smoke、once、resume 或真实上传；后续质量验收需用新运行检查角色、归并前后条数和具体建议质量。

## 回退

优先修复后向前升级。紧急回退时先停止 API/worker，再以 `KB_APP_IMAGE=$(cat "$BACKUP/old-image-id")` 运行 compose-git.sh 启动命令，源码切回事先记录的 Git 提交。新增数据库字段无需删除。旧代码没有角色和克制蒸馏保护，不应长期恢复 worker。

镜像回退不能恢复清理掉的记录。需要恢复数据时停止所有写入，使用已验证的备份恢复流程人工恢复数据库及相应 outbox；避免仅恢复一侧导致任务 ID 和本地状态不一致。

## 本机与云端验证边界

本机只使用模拟数据库、模型和 MCP，验证角色、分页归并、检查点、去重召回、事务失败回滚和本地队列终态。云端只执行备份、兼容迁移、明确清理和静态一致性检查。真实模型的归并质量、策略数量及处理耗时留待用户验证。
