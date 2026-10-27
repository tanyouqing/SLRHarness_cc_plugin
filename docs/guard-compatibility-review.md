# Guard 误拦截检查与本地修正

2026-10-27；基于 `7ed55b6`（0.9.2）的修正。本次通过 Git 交付，暂不部署云服务器，不改变知识库服务、数据库和已有调研数据。

## 截图中的六项问题

| 问题 | 本地核实 | 修正 |
| --- | --- | --- |
| 工作区定位依赖项目根目录 | 可复现。直接以工作区为 project_dir 时绑定查找失败 | 共用工作区解析，支持项目、工作区及其子目录；多个工作区出现相同绑定时拒绝猜测 |
| 普通 Glob/Grep 被缓存保护拦截 | 可复现。原规则把包含工作区的搜索整体拒绝 | 允许明确避开 `.slr/kb` 的路径或文件 glob，如 `workspaces/*/SCOPE.md`、`papers/*/metadata.json`；Grep 的内容正则不充当路径过滤 |
| stage 存储与检索契约冲突 | 可复现。检索限制六个名称且自动补过滤条件 | stage 可省略或使用自定义非空字符串；六个名称保留为推荐用词；实际任务阶段继续用于缓存隔离 |
| 缓存命中返回工具错误 | 可复现 | 增加 `cache-query` 正常 hit/miss 返回，重复 MCP 请求不再因命中缓存被拒绝 |
| Manager 缺少后台 Worker 工具 | 工具声明和 Guard 均缺少 TaskOutput/TaskStop | 加入两项工具，限定同一 Manager、会话、主题及 lease 的宿主已记录 Worker；不授权任意后台命令 |
| 学术 MCP 工具别名不兼容 | `tavily_search` 被拒绝 | 按检索服务放行工具，不再逐个登记方法名；只拦截名称明确表示写入、删除、执行等操作的工具 |

前四项通过文件和 Hook 输入离线复现。后两项的权限路径也有模拟覆盖；服务器实际工具清单、原生后台任务输出格式还需运行时验证，不能由离线测试证明。

## 附带修正

- Read/Glob/Grep 的相对路径按 Hook 的 `cwd` 解释，避免读错位置而漏掉长度或缓存权限检查。
- 缓存路径的符号链接别名不能绕过保护。
- 缓存读取比较真实执行阶段；Paper 直接读取缓存视图也检查当前证据指纹；Manager 策略访问遵守当前返修主题范围。
- 会话附件和恢复摘要使用统一工作区定位。
- Reviewer 补充原已允许的学术 MCP 工具声明，仍禁止 Survey KB 访问；其本地输入隔离保持不变。
- Paper 的通用 Shell/MCP 禁令明确保留受限 KB helper 例外；Manager 上传说明更新为成功 Stop 自动同步。

## 缓存的实际行为

角色先执行以下受限命令，替换路径、实际 Agent ID 和查询内容：

```sh
node "<plugin>/scripts/kb-control.mjs" cache-query "<workspace>" "<actual-agent-id>" search_strategies '{"query":"compare evidence","filters":{"role":"worker"},"limit":3}'
```

命中返回 `hit:true`、受预算限制的结果、cacheKey 和视图路径；未命中返回 `hit:false`，随后调用相同参数的 MCP 工具。参数按与 MCP 相同的默认值规范化，恢复或重试可以复用同一逻辑任务的缓存。缓存失败不当成空检索结果。

PreToolUse 没有“跳过调用并合成成功工具结果”的接口，所以直接重复 MCP 调用仍可能访问网络。本轮采用正常本地查询入口，避免用权限错误表达缓存命中；没有增加代理服务或改变七个知识库接口。参见 [Claude Code PreToolUse 规则](https://code.claude.com/docs/en/hooks#pretooluse-decision-control)。

## 后台 Worker 与学术 MCP

后台任务映射保存在 `.slr/native-tasks.json`，独立于 KB 开关。仅接受宿主 `PostToolUse:Agent` 的结构化 `status=async_launched`、`agentId`，以及存在时的 `task_id`/`taskId`；无独立任务 ID 时使用宿主 Agent ID。启动 lease 必须属于当前 Manager。响应正文中自称的任务 ID 不建立授权。

TaskOutput 默认不阻塞，显式等待最多 30 秒；TaskStop 只处理仍活动的所属 Worker，不自动释放 pipeline lease。观察到 SubagentStop 后禁止再次停止该任务。旧会话或未记录的后台任务交主会话处理，不根据文本补造归属。宿主字段依据 [Claude Code Agent 工具输出说明](https://code.claude.com/docs/en/hooks#agent)。

按用户“优先放宽检索限制”的要求，取消初稿中的精确方法白名单。`deploy/scholarly-mcp.json` 只登记可信检索服务：默认 `arxiv`、`tavily`、`scholar`。这些服务的 search、fetch、extract、crawl、map、download、引用查询及新工具名称均可使用，无需逐个修改 Guard。新增服务只登记一次服务名；Reviewer 还需在工具声明中加入该服务通配符。

名称中明确出现 delete、update、upload、execute 等操作词时仍拦截；这只是兼容策略，不能仅凭工具名称保证其内部只读，因此按已配置可信服务授权。Worker 的活动任务、Reviewer 的审稿绑定、Manager/Checker/Paper 的外部检索边界保持不变。Survey KB 仍使用单独的角色与工具规则。

## 验证与部署状态

上轮完整离线测试 **164 项通过、0 失败**；插件校验、41 个 scripts/evals 模块语法检查及 `git diff --check` 通过。本次放宽服务工具权限后，相关 Guard、KB、Reviewer 共 **66 项离线测试通过、0 失败**，脚本语法及 diff 检查通过。新增 12 项用例覆盖工作区入口、搜索过滤、相对路径、符号链接、缓存命中与隔离、stage、任务归属及 MCP 服务别名；已有论文验收、分阶段写作、Reviewer 隔离与成功 Stop 同步测试一并回归。测试日志见 [上轮全量报告](guard-offline-tests.txt) 和 [本次放宽检索权限报告](guard-relaxed-tests.txt)。

本轮只修改本地代码和文档，不连接服务器，不调用真实数据库、Embedding、大模型或 MCP 服务。云端仍运行此前代码。之后部署前应先结束或暂停活动调研，再更新插件并重新加载会话；无需迁移知识库。实际服务名和后台任务字段应在用户安排的真实测试中确认。
