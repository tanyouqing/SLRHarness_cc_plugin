> 2026-10-29 更新：[角色约束、克制蒸馏和旧数据清理](../docs/distillation-role-upgrade.zh-CN.md)。

# 当前代码与升级方式

本项目已纳入 auto-survey 仓库的 knowledge-base/。已有服务器请使用 [Git 升级手册](../docs/trajectory-git-upgrade.zh-CN.md)，不再运行 package-release.py 或解压增量包。下文保留从零部署说明。

# Survey Knowledge Base · Sprint2-A

独立于 auto-survey pipeline 的知识库服务：PostgreSQL 存储、两个 pi-agent-core Agent、MCP 接口。部署目标为 **Ubuntu 22.04.4 LTS，8 核、32GB、无 GPU**。

**从零部署请按 [中文运行手册](docs/RUNBOOK.zh-CN.md) 操作。** 手册包含 Docker 安装、模型配置、启动、工具调用、故障恢复、备份和验收命令。

## 本轮实现

- 论文：元信息 JSON＋Markdown 笔记，不保存 PDF。
- 审稿经验：JSON 直接提交，去重、索引完成后可检索，无需其他材料。
- 经验必填 sourceType、role、executionSummary、strategy；role 为 worker/manager/scoper/paper 四选一，stage、task、applicability 可省略。两个知识库 Agent 使用共享项目与角色背景及各自任务提示词。更新步骤见 [经验格式与提示词升级说明](docs/UPGRADE-optional-experience.zh-CN.md)。
- 运行经验：可信四类角色新轨迹先判别结果；普通直接成功通常跳过，失败/纠错成功/独特成功进入提炼，证据不足时分段检查。策略 role 继承来源；只归并真正重复建议，再由管理 Agent 去重入库。身份不明的轨迹只保存。
- 轨迹内部归并统一检索相关候选后一次判断，默认混合召回 Top-5；候选索引不对外公开。完成队列与分段提炼按 2:1 调度，保留旧任务进度。已部署用户见 [检索归并升级手册](../docs/retrieval-consolidation-upgrade.zh-CN.md)。
- BGE-M3 CPU dense embedding＋PostgreSQL 关键词检索；论文与策略各有搜索接口。
- 数据库分配 ID，保存历史修订、策略来源和处理任务，支持重复提交及后台重试。

pipeline 接入属于后续 Sprint2-B，本轮没有修改现有插件。调用方应仅上传成功结束的调研轨迹；知识库不会从单条轨迹推断整次调研是否成功。

## 目录

| 目录 | 用途 |
|---|---|
| `src/` | TypeScript 存储、任务处理、Agent、MCP、客户端与云端测试 |
| `migrations/` | PostgreSQL schema 和修订保护 |
| `embedding/` | CPU BGE-M3 服务、分块和无模型单元测试 |
| `prompts/`、`config/` | 两个 Agent 的提示词和配置模板 |
| `examples/` | 明确标为合成数据的调用示例 |
| `scripts/`、`tests/cloud/` | 部署准备、云端故障恢复与性能验证 |
| `docs/` | 操作手册、接口说明、验证记录 |

## 接口

`submit_paper`、`submit_experience`、`submit_trajectory`、`search_papers`、`search_strategies`、`read`、`get_job`。

地址为 `/mcp`，Streamable HTTP，Bearer token 认证。默认只映射服务器的 `127.0.0.1:3000`。详细输入、状态与例子见 [接口说明](docs/API.md)。

## 开发检查

Node.js ≥22.19，Python ≥3.10：

```bash
npm ci --ignore-scripts
npm run check
npm run build
npm test
python3 -m unittest discover -s embedding -p test_chunking.py
```

这些检查不需要 PostgreSQL、Docker、BGE-M3 或模型密钥。测试使用内存 MCP 连接和替身；Python 分块测试使用假 tokenizer，不下载模型。

2026-10-26 用户已完成云端部署、首轮正常流程、重启持久化和 CPU 基准测试，并确认清空测试数据，准备讨论 Sprint2-B。完整故障注入、备份恢复和较大负载验证尚无云端证据；具体结果与边界见 [VALIDATION.md](docs/VALIDATION.md)。

## 运行假设

- 两个 Agent 调用用户配置的外部推理服务；BGE-M3 在本机 CPU 运行。32GB 内存的估计不包含本地生成式大模型。
- 首版共用一个知识库和服务令牌，不提供多租户权限隔离、网页 UI、PDF 解析或 pipeline 自动接入。
- SQL 将公共实体及不可变修订集中存储；`papers` 和 `experiences` 是便于查询的当前版本视图，`trajectories` 是原始轨迹表。
- 蒸馏按单条轨迹执行；长轨迹分段并携带有界运行总结，不做整批跨 Agent 轨迹的联合推理。重复策略可通过去重合并来源。
- 查询和入库必须使用相同模型版本；更换模型需重新编码已有数据。本版固定 BGE-M3 revision，不提供在线模型迁移。
- 模型和数据库均由用户在云端运行验证。开发过程不读取工作区的 SSH 私钥，也不自动连接服务器。

已部署用户本次请按 [选择性蒸馏 Git 升级手册](../docs/selective-distillation-upgrade.zh-CN.md) 更新。旧任务固定旧提示词，调度和快速收尾优化对全部任务生效，无需新增迁移。

策略管理新增第八个工具 `report_strategy_feedback`。默认检索只返回 active；停用保留历史，修订经独立调用核验后启用。升级及恢复见[中文手册](../docs/strategy-governance-upgrade.zh-CN.md)。

全库版本由宿主机 `scripts/snapshot.py` 管理，覆盖 PostgreSQL 全部数据与向量；Pipeline 成功同步后自动保存，管理员可恢复指定版本。模型文件、密钥与 Pipeline 工作区继续独立保留。见[全库快照与 Git 升级手册](../docs/knowledge-base-snapshots.zh-CN.md)。

论文新入库与补充现增加 L1/L2 门控。管理 Agent 可取公开 HTML/PDF，数据库强制核验通过才能发布；工具输入仍为元信息和 Markdown。只有有证据的矛盾待定；证据不足/原文不可达放行并标为 admitted_with_gaps，不能声称已核验。可导入 Claude 的搜索 MCP 供 Pi 核验使用。报告通过 get_job 查看，管理员可重查待定原任务。迁移 006、旧数据规则及真实验收见[论文门控手册](../docs/paper-admission.zh-CN.md)。
