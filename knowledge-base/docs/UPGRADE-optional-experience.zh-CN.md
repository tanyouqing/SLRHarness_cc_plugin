# 已部署知识库：经验可选字段、角色枚举与 Agent 提示词升级（2026-10-26）

本次将 stage、task、applicability 改为可选，缺失时省略键，不传 null、空字符串或空白字符串。sourceType、role、executionSummary、strategy 仍必填。字段名为 applicability。审稿经验与轨迹蒸馏候选使用同一格式，轨迹经验仍必须提供来源。stage 暂不设枚举。

本累计更新进一步限定 role 为 worker、manager、scoper、paper（适用角色）。两个 Agent 增加共享 SLR Harness 项目流程和角色职责、各自的判断步骤、观察与推测的区别、字段解释及示例；输出工具展示完整嵌套结构。新增 prompts/project-context.md 是运行必需文件，不能只复制单个角色提示词。

当前知识库已由用户确认清空。若升级其他非空实例，可先只读检查历史角色：`docker compose exec -T db psql -U kb -d kb -c "SELECT DISTINCT content->>'role' AS role FROM experiences;"`。已有四类合法记录无需迁移；其他历史值不会被自动重分类或删除，须人工根据内容确认后另行处理。新提交、搜索过滤、蒸馏输出和排队入库均拒绝非枚举值；旧的非法角色排队任务会失败，不能通过重试绕过校验。历史记录仍可按 ID 读取。

API 校验、两个 Agent 提示词、Embedding 分块和检索均已适配。指定 stage 检索会包含匹配阶段及未标注阶段的经验，按原有 RRF 排序；未标注不表示普遍适用。旧的完整字段记录保持兼容，已有经验不需要重新编码，数据库无需迁移。

## 1. 上传增量源码包（Windows 本机）

在工作区根目录执行，替换实际 SSH 用户与服务器地址：

```powershell
scp .\knowledge-base-agent-context-update.tar.gz .\knowledge-base-agent-context-update.tar.gz.sha256 YOUR_USER@YOUR_SERVER:~/
```

也可以通过 VS Code 上传这两个文件到服务器用户主目录。包内仅含本次更新的 knowledge-base 源码、提示词、示例、测试和文档；不包含 .env、config/、compose.yaml、数据卷或模型文件，不覆盖你的密钥与离线挂载设置。

该包包含前一轮可选字段改动，未安装旧包也可直接更新；不要在此版本之后覆盖旧的 optional-fields 更新包。

## 2. 校验、解压并构建（云服务器）

```bash
cd ~
sha256sum -c knowledge-base-agent-context-update.tar.gz.sha256
```

应输出 OK，再执行：

```bash
tar -xzf ~/knowledge-base-agent-context-update.tar.gz -C ~/survey-kb
cd ~/survey-kb/knowledge-base
docker compose config --quiet
docker compose build api embedding
```

api 与 worker 共用 survey-kb:0.1.0 镜像，构建 api 会更新两者使用的应用镜像。Embedding 也有 Python 分块修改，因此必须构建。依赖清单和 Dockerfile 未改；原构建缓存存在时依赖层可复用，只更新代码。不要加 --no-cache，无需下载 BGE-M3。构建失败时先排查，不继续替换运行容器。

## 3. 更新三个服务

先停止写入，避免新 API 的可选字段进入旧版 Embedding：

```bash
docker compose stop api worker
docker compose up -d --no-deps --force-recreate \
  --wait --wait-timeout 600 embedding api worker
curl -fsS http://127.0.0.1:3000/readyz
```

预期三个服务就绪，readyz 返回 `{"ready":true}`。模型冷启动需等待；出错先看 `docker compose logs --tail=80 embedding api worker`。不要执行 down -v，不需要运行 migrate。保留 `.env` 中的 COMPOSE_FILE 与 BGE_MODEL_DIR，避免再次丢失离线模型挂载。

## 4. 检查接口与实际入库

先查看工具定义，不写数据库：

```bash
docker compose --profile tools run --rm client list
```

在 submit_experience 的 experience 对象 required 列表中，应只看到 sourceType、role、executionSummary、strategy；stage、task、applicability 仍在 properties 中，但不在 required 中。连接中的 Agent 客户端需重新连接或刷新工具列表。

experience.properties.role.enum 和 search_strategies 的角色过滤枚举应均为 worker、manager、scoper、paper。还可运行 `docker compose exec -T worker test -r /app/prompts/project-context.md`，成功时无输出，确认共享背景文件已打入镜像。提示词质量仍需真实轨迹抽查，结构校验通过不代表策略已经被验证有效。此次未增加跨段最终复核或自动撤回旧候选的机制。

以下验收会写入一条合成测试经验：

```bash
docker compose --profile tools run --rm client submit_experience @examples/review-minimal.json
```

应返回 pending 与 job_id（重复执行可能返回 duplicate）。用返回的实际任务 ID 等待：

```bash
docker compose --profile tools run --rm client wait YOUR_JOB_UUID
```

应成功返回经验 ID，随后验证读取与带阶段过滤的检索：

```bash
docker compose --profile tools run --rm client read '{"type":"experience","id":"YOUR_EXPERIENCE_UUID"}'
docker compose --profile tools run --rm client search_strategies '{"query":"核对数据集、评价指标和实验设置","filters":{"role":"worker","stage":"paper_reading","sourceType":"review"}}'
```

新空库中的最小样例应成功保存且 content 不含那三个可选字段，并可被上述阶段检索召回。若已有其他经验，管理 Agent 可能去重或合并；需结合返回的决定和实际记录判断，不能要求合并结果删除原有可选字段。

如需完整回归，可运行 `docker compose --profile tools run --rm --entrypoint node client dist/smoke.js`，新脚本增加了最小经验及阶段过滤召回检查。它会写入多条测试数据。需要恢复空库时使用运行手册第 12 节；该操作会清除全部业务记录，不能用于只删除单条测试经验。

本机仅执行类型检查、构建与无外部服务测试；本次更新的真实入库和检索由服务器执行上述步骤验证。
