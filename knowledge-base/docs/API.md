# MCP 接口约定

HTTP `POST /mcp`，遵循 MCP Streamable HTTP；使用官方客户端处理初始化、协议版本和请求封装，不直接把普通 JSON POST 到工具名路径。

所有调用携带 `Authorization: Bearer <MCP_TOKEN>`。无需浏览器，浏览器 Origin 请求被拒绝。默认请求上限 16 MiB，配置项 `MAX_REQUEST_BYTES`；超限返回 HTTP 413。

## 提交工具

完整提交返回 `{status, id, job_id}`；轨迹分段尚未收齐时返回 `{status:"accepted", transfer_id, received, part_count}`。`stored` 表示已保存，`duplicate` 表示复用记录，`pending` 表示等待处理。初次提交论文和经验通常返回 `pending`，其 `id` 为 null；应查询后台任务取得最终 ID。

### submit_paper

输入见 `examples/paper.json`：

```json
{
  "metadata": {
    "title": "Title", "authors": ["Author"], "year": 2025,
    "canonicalUrl": "https://example.org/paper", "doi": null,
    "arxivId": null, "venue": null
  },
  "note": "# Markdown note\n..."
}
```

字段必须齐全；未知元信息用 null，未知作者用空数组。title、note 非空。不接受 PDF、调用方生成的 ID 或未声明字段。DOI 前缀和大小写被规范化；arXiv 身份匹配忽略版本后缀，但保存的元信息保留后缀。

### submit_experience

```json
{
  "experience": {
    "sourceType": "review",
    "role": "worker", "stage": "paper_reading",
    "task": "具体任务", "executionSummary": "当时的行动、结果与问题",
    "strategy": "可执行建议", "applicability": "适用条件与限制"
  }
}
```

必填字段为 `sourceType`、`role`、`executionSummary`、`strategy`；`stage`、`task`、`applicability` 可分别省略。无法确定时省略键，不接受 null、空字符串或空白字符串，也不要求 Reviewer 推测。字段名为 `applicability`。

role 必须为 `worker`、`manager`、`scoper`、`paper` 四选一，表示经验的适用角色，不是产出建议的 Agent。worker 负责单篇发现/阅读/核验，manager 负责任务拆分/验收/综合，scoper 负责范围探索和规划，paper 负责全文组织/写作/引用一致性。Reviewer 和 Checker 的建议按实际纠正动作归到这四类；不接收 reviewer、checker、assistant 等值，也不自动改写错误值。

提供时的 stage 为非空字符串，尚未设枚举；正文可包含 Markdown。省略适用条件不代表策略适用于所有场景。最小示例见 `examples/review-minimal.json`：

```json
{
  "experience": {
    "sourceType": "review",
    "role": "worker",
    "executionSummary": "比较论文时混用了不同数据集上的指标。",
    "strategy": "比较结果前先核对数据集、指标和实验设置。"
  }
}
```

审稿 JSON 直接去重，不经过蒸馏。sourceType 为 trajectory 时必须提供至少一条真实来源：

```json
"sources": [
  {"type":"trajectory","id":"数据库返回的 UUID","event_range":{"start":2,"end":5}}
]
```

event_range 可省略，否则为闭区间、从 1 开始的 JSONL 行号。后端检查轨迹存在及行号范围。外部提交和内部蒸馏走同一入库流程。

### submit_trajectory

输入为 `{"content":"一行 JSON 对象\n另一行 JSON 对象\n"}`。每行必须是 JSON 对象，不接受空白中间行、数组或 JSON 原始值。服务端保留收到的完整文本；Pipeline 新上传使用确定性投影，本地另保留原始轨迹。

可信来源角色唯一且为 worker/manager/scoper/paper 时，轨迹落库与任务创建在同一事务完成，返回：

```json
{"status":"stored","id":"轨迹 UUID","job_id":"自动创建的蒸馏任务 UUID"}
```

重复上传复用原轨迹和任务。`stored` 不代表策略已经生成；即使蒸馏失败，原轨迹仍可读取。调用方仅应在整个调研成功后提交。缺少来源身份、角色冲突或不支持自动蒸馏时，仍保存轨迹，返回 `job_id:null, distillation:"skipped", reason`。旧的仅 content 调用保持可保存，不再自动推测角色或蒸馏。被运维清理的轨迹也不会因重复提交重建任务。

### 轨迹来源与分段协议

`metadata` 可选；提供时必须包含 runId、agentId、sessionId、agentRole、originalHash（原始文件 SHA-256）、projectionVersion、lineMapping="embedded-originalLine"，task/stage 可省略。agentRole 允许 worker/manager/scoper/paper/checker/reviewer/main/other；只有前四类可自动蒸馏，产出经验的 role 必须与来源完全相同。多个来源必须角色一致。审稿经验 sourceType=review 保持四类适用角色自由选择。

`transfer` 可选，格式 `{id,index,count,contentHash}`：id/contentHash 为 64 位小写十六进制 SHA-256，index 从 0 开始且小于 count，count 范围 1..10000。分段 content 不超过 4 MiB UTF-8 字节；完整请求仍受 16 MiB 限制。contentHash 对完整连接文本的 UTF-8 字节计算，不先规范化。每段的 metadata 必须相同。

传输 ID 固定，重复同序号内容幂等，不同内容或元信息冲突报错。最后收齐时完整验证 JSONL、保存轨迹并按上述角色条件创建唯一蒸馏任务；此前仅保存传输分段。完成后重传任意原分段可重新获得最终回执。read trajectory 返回 origins 数组；get_job 对蒸馏返回 progress，包括 completed_segments、total_segments（旧检查点可能为 null）、waiting_for_children、candidate_count，以及 phase（segments/consolidating/submitting/waiting）、consolidated_count、strategy_count。candidate_count 为分段候选数，consolidated_count 为整条归并后的候选数，strategy_count 为任务完成时关联的去重策略数。不返回原始模型错误或检查点正文。

分段保存、清理及升级命令见 [Git 升级手册](../../docs/trajectory-git-upgrade.zh-CN.md)。

## 检索与读取

### search_papers

```json
{"query":"retrieval evaluation","filters":{"year_from":2023,"year_to":2026,"author":"Author","venue":"Venue"},"limit":10}
```

filters 和其字段均可省略，另外支持 doi、arxivId 身份过滤。author 和 venue 为不区分大小写的完整值匹配；年份为含端点范围。

结果为 `{"results":[...]}`，包含论文 ID、revision、metadata、snippet、location、score。snippet 是最佳命中片段，全文通过 read 获取。

### search_strategies

```json
{"query":"如何避免比较不同评价指标","filters":{"role":"worker","stage":"paper_reading","sourceType":"review"},"limit":10}
```

过滤项均可省略。role 过滤也只接受上述四个值，role、sourceType 精确匹配；指定 stage 时召回该阶段及未标注阶段的经验，再按现有混合检索排序，不会把缺失阶段解释为已确认适用。Sprint2-B 接入设计仅允许 worker、manager、scoper、paper 检索策略及读取经验，且固定过滤自身 role；Checker/Reviewer 不具备这些权限。该限制将在 pipeline 的权限层实施，当前知识库接口的可选过滤参数及服务级令牌认证保持不变。调用方需判断具体内容的适用性。结果包含 ID、revision、role、snippet、sources、score；task、stage、applicability 仅在原记录存在时返回。策略与经验是同一实体类型，读取时用 `type="experience"`。

管理 Agent 的补充修订仍保留原记录的 sourceType、role、stage（包括 stage 未标注的状态），不得通过省略字段移除既有阶段限制。已有完整字段的经验保持兼容，无需数据库迁移或重新编码。

两类检索默认返回 10 条，limit 范围 1–50。关键词与向量两路各取最多 50 个片段，RRF 常数为 60，按实体只返回最佳片段。score 是融合排序值，不是概率或内容正确性的判断。

### read

```json
{"type":"paper","id":"UUID","revision":1}
```

type 为 paper、experience 或 trajectory。省略 revision 时读取当前已完成索引的修订；指定修订可读取历史。trajectory 不支持 revision，支持可选 event_range，返回的原始 line_count 不变。知识记录同时返回来源和冲突关系。片段 location 中的 Python 字符偏移按 Unicode 码点计数。

## 后台任务与失败

`get_job({"job_id":"UUID"})` 返回 queued、running、succeeded、failed，以及 attempts、result、error 和时间。

ingest 任务的成功结果包含 `ids`、revision 和 decision；distill 结果包含 `ids`、trajectory_id、candidate_count。没有值得保留的策略时，distill 成功返回空 ids。蒸馏任务在所有子经验完成去重与索引后才成功。

worker 默认一次处理一个任务，最多尝试 3 次；每 15 秒续租，租约默认 120 秒。崩溃后重新启动会接管过期任务。候选和子任务进度已保存，无需从头生成所有策略。

决策动作：new、duplicate、supplement、keep_separate。管理 Agent 对冲突做最终决断，keep_separate 保存不同版本/策略及冲突关系；没有人工审批门槛。索引和当前修订切换在同一事务发布。

失败任务不会无限循环，也不会伪装成成功。修复依赖后由运维在 worker 容器运行 `node dist/admin.js retry UUID`；该命令只重排失败任务，保留已完成阶段，并重排失败的子任务。没有对外的重试/删除管理 MCP 接口。

工具参数错误以 MCP `isError=true` 返回；认证失败 HTTP 401，超限 HTTP 413。`/healthz` 检查进程，`/readyz` 检查数据库迁移与 Embedding 可达性；二者均不验证模型凭据，凭据由实际任务验证。

## 内部蒸馏与去重

分段候选在整条轨迹结束后统一归并，通常每段 0–1 条、整条 0–5 条为软目标，允许零条和有依据的例外。归并保留来源与条件，再经管理 Agent 入库。内部去重不按 stage 硬过滤：同源邻近策略最多 12 条，加同 role/sourceType 的混合检索最多 12 条。对外搜索的显式过滤语义不变。清理及恢复见 [角色升级手册](../../docs/distillation-role-upgrade.zh-CN.md)。


## 检索归并进度（retrieval-v1）

七个工具名称和输入不变。get_job.progress 新增 consolidation_algorithm、processed_candidates、retained_count、retrieval_count、agent_decision_count、wait_reason。retained_count 是尚未正式入库的保留数，strategy_count 仍为最终关联策略数，未完成时为 null。retrieval_count / agent_decision_count 只统计新算法已保存的检索快照和决策，不统计失败的模型调用或旧算法历史。

轨迹候选在任务内部的私有索引中，以同角色、内容版本和模型版本进行关键词＋向量召回（两路各 20，RRF 后默认 5 条），不按 stage/task 过滤。Agent 一次比较检索出的集合；多目标合并后保留真实来源、更新索引并重新检索。没有全量逐对比较分支。公开 search_strategies 只返回已发布实体，外部 stage 过滤语义不变。

配置、调度、旧任务迁移及恢复见[检索归并升级手册](../../docs/retrieval-consolidation-upgrade.zh-CN.md)。
