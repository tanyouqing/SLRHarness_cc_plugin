当前已有部署升级请先阅读 [Git 升级手册](../../docs/trajectory-git-upgrade.zh-CN.md)。本手册以下从零部署与历史故障记录继续保留。

# Ubuntu 22.04.4 LTS：从零部署、使用与验收

本手册默认服务器为 x86_64、8 核、32GB、无 GPU，有 sudo 权限，可访问 Docker 软件源、镜像源、模型下载源和你的大模型 API。建议预留至少 30GB 空闲磁盘用于镜像、权重、数据库及备份。镜像构建与模型下载需要时间，无法预先承诺 CPU 查询速度。

以下命令除明确标注为 Windows 本机的步骤外均在服务器终端执行；所有 Compose 命令在项目目录运行。离线模型的挂载配置保存到 `.env`，无需每次登录重新 export。首次验收使用独立测试数据，勿在有其他运行任务时做故障注入。

2026-10-26 部署记录：用户已在目标服务器完成正常流程、重启持久化和 CPU 基准测试，并确认清空测试数据。具体结果及未验证范围见 [验证记录](VALIDATION.md)。

## 1. 检查系统并安装 Docker

```bash
cat /etc/os-release
uname -m
nproc
free -h
df -h "$HOME"
```

应看到 Ubuntu 22.04、x86_64 和预期资源。Ubuntu 的补丁版本可能在系统升级后变化，不影响本手册的 22.04 jammy 基线。

已有 Docker 时先执行 `docker version`、`docker compose version` 和 `docker info`。Engine 可用且 Compose 插件存在即可沿用，无需重复安装；本次服务器使用 Docker 29.6.2 完成部署。

仅在尚未安装时，按 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/) 安装：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl python3 jq openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

退出 SSH 并重新登录，使 docker 用户组生效，然后执行：

```bash
docker version
docker compose version
docker run --rm hello-world
```

应看到 Docker Engine/Compose 版本以及 hello-world 成功提示。若服务器已有其他版本 Docker，先按官方说明检查冲突包，不要卸载正在承载其他业务的服务。

## 2. 本机打包和上传

在 Windows 项目的 `knowledge-base` 目录执行：

```powershell
python scripts/package-release.py
scp ..\knowledge-base-release.tar.gz YOUR_USER@YOUR_SERVER:~/
```

替换 SSH 用户名和服务器地址，使用你自己已配置的 SSH 登录方式。打包程序只包含知识库源文件，排除依赖、缓存、实际密钥配置和测试结果，不读取父目录的任何私钥。

然后在服务器执行：

```bash
mkdir -p ~/survey-kb
tar -xzf ~/knowledge-base-release.tar.gz -C ~/survey-kb
cd ~/survey-kb/knowledge-base
python3 scripts/init-env.py
```

初始化脚本生成随机数据库密码和 MCP token，复制配置模板。输出 `Configuration files prepared. Edit .env, config/models.json and config/agents.json before starting.` 表示准备成功。重复运行不会覆盖已有配置。

## 3. 配置两个 Agent 的模型

```bash
nano .env
nano config/models.json
nano config/agents.json
```

需要修改：

| 文件 | 必填内容 |
|---|---|
| `.env` | 将 KB_LLM_API_KEY 替换为你自己的 API key；保留生成的数据库密码和 MCP_TOKEN |
| `config/models.json` | 填入服务 baseUrl、API 协议和真实模型 ID；模板适用于支持工具调用的 OpenAI-compatible `/v1` 服务 |
| `config/agents.json` | manager/distiller 的 provider 和 model 与上表对应；可分别选择不同模型 |

模板中的模型上下文窗口和输出上限必须改为服务实际支持的值；`cost` 为 Pi 的本地记账配置，填写 0 不表示服务免费。两个 Agent 都需要工具调用能力。外部模型调用可能产生费用。

`.env` 与 compose.yaml 同级，models.json 位于 config/，位置不同是正常的。Compose 的 env_file 将变量传入容器，Pi 再解析 models.json 的引用。密钥按下面方式填写，不要把真实密钥放进 `${...}`：

```dotenv
# .env：仅在服务器填写真实密钥
KB_LLM_API_KEY=你的完整真实密钥
```

```json
"apiKey": "${KB_LLM_API_KEY}"
```

`provider` 是 models.json 的 providers 对象中的配置名称，例如 `kb-provider`；agents.json 两个角色的 provider 必须与之匹配，model 必须匹配模型 id。本次用户采用豆包配置：baseUrl 为 `https://ark.cn-beijing.volces.com/api/v3`，api 为 `openai-completions`，model id 为 `doubao-seed-2-1-turbo-260628`。模型可用性与额度由用户账号决定。

可以沿用你已有 Pi 的 `models.json` 和 `auth.json`。本服务通过 Pi ModelRuntime 加载配置，但不会启动 Pi 的 Shell、文件编辑或编码工具。首次部署推荐 API key 环境变量方式。Pi 即使只读取 auth.json，也会在同目录创建 auth.json.lock，因此 config 挂载必须可写，目录须允许容器 GID 1000 创建锁。OAuth 刷新还需要 auth.json 文件可写；本手册的默认文件权限面向 API key 部署。

检查占位符和 JSON 格式：

```bash
grep -nE 'REPLACE_|YOUR_' .env config/models.json config/agents.json
python3 -m json.tool config/models.json >/dev/null
python3 -m json.tool config/agents.json >/dev/null
```

三条命令分行执行。第一条没有输出表示没有匹配到占位符，后两条没有输出且退出码为 0 表示 JSON 语法正确；它们不验证模型服务是否可调用。grep 命中时会输出整行，不要公开包含密钥的配置行。填写包含特殊字符的 API key 时遵守 `.env` 引号规则；无需把 `.env` 导出到整个终端。

容器以 UID/GID 1000 运行，授予配置读取和报告写入权限：

```bash
sudo chgrp -R 1000 config reports
chmod 770 config
chmod 640 config/*.json
chmod 2775 reports
chmod 600 .env
```

不要将实际 `.env`、auth.json 或 models.json 提交到代码仓库。数据库密码使用初始化生成的十六进制值，避免在连接 URL 中额外转义。

## 4. 构建镜像和准备 BGE-M3

首次构建可能因 apt/pip 下载慢而持续较久。本次部署出现约几十 KB/s 的下载速度。建议在构建前开启 tmux，断开 SSH 后可重新连接：

```bash
sudo apt-get update
sudo apt-get install -y tmux
tmux new -s kb-deploy
cd ~/survey-kb/knowledge-base
```

在 tmux 中执行后面的构建命令。按 Ctrl+B 后按 D 可离开会话；重新登录后用 `tmux attach -t kb-deploy` 恢复。已经在普通终端运行的构建不会因为另开 tmux 自动迁入。VS Code 断连或电脑睡眠不应作为任务持续运行的保证。

```bash
docker compose build api embedding
docker compose config --quiet
docker compose --profile tools run --rm download-model
```

最后一条完成后应输出 `BGE-M3 model files are ready.`，权重保存在 `model-data` 持久卷。该步骤只下载 Embedding 权重，不调用大模型 API。首次下载可能很慢；中断后可重新执行。

区分镜像依赖安装和模型下载：当前 Dockerfile 的 pip 安装使用 `--no-cache-dir`，若中断尚未完成的 RUN，该步骤内已下载的包可能需要重下；已经完成的镜像层通常可复用。模型下载失败后重试 download-model 即可，不需要重建已成功的镜像。

固定版本为 `BAAI/bge-m3@5617a9f`，只使用 dense embedding。运行容器关闭模型联网下载，缺文件会直接报错。

### 下载受限时：离线目录

本次服务器访问 huggingface.co 与 hf-mirror.com 均连接超时，curl 显示 HTTP 000。下载器最终的 LocalEntryNotFoundError 表示联网失败且本地没有所需快照；不能据此判断模型 revision 错误。元信息地址可访问也不保证大权重下载地址可达。

在能访问 Hugging Face 的 Windows 电脑上，进入项目的 knowledge-base 目录执行。下载工具虚拟环境放在项目外，避免混入发布包或 Docker 构建上下文；不会安装或运行本地推理模型：

```powershell
python -m venv "$env:USERPROFILE\kb-download-venv"
& "$env:USERPROFILE\kb-download-venv\Scripts\python.exe" -m pip install huggingface_hub==0.30.2
$env:HF_ENDPOINT = "https://huggingface.co"
$env:MODEL_PATH = "$PWD\models\bge-m3"
$env:MODEL_REVISION = "5617a9f"
$env:HF_HUB_DOWNLOAD_TIMEOUT = "120"
& "$env:USERPROFILE\kb-download-venv\Scripts\python.exe" embedding/download.py
scp -r .\models\bge-m3 YOUR_USER@YOUR_SERVER:~/survey-kb/
```

下载应输出 `BGE-M3 model files are ready.`。复制完整目录，包括权重、config.json、tokenizer 文件、modules.json 和 1_Pooling 目录，不要只复制权重。

在服务器项目目录编辑 `.env`，添加或修改下面两行。本次 root 用户的实际模型位置为 `/root/survey-kb/bge-m3`，其他部署填写自己的绝对路径：

```dotenv
COMPOSE_FILE=compose.yaml:compose.offline.yaml
BGE_MODEL_DIR=/root/survey-kb/bge-m3
```

保存后在服务器终端执行：

```bash
unset COMPOSE_FILE BGE_MODEL_DIR
ls -lh /root/survey-kb/bge-m3/config.json /root/survey-kb/bge-m3/modules.json
docker compose config --quiet
```

unset 清除可能覆盖 `.env` 的临时环境变量。两个文件应存在，config 检查成功时无输出。跳过 download-model，继续下一节。所有启动、重启及测试命令从项目目录执行，会自动采用这份持久配置；不要仅依赖当前终端中的 export。

## 5. 初始化数据库并启动

```bash
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose up -d --wait --wait-timeout 600 embedding api worker
docker compose ps
curl -fsS http://127.0.0.1:3000/readyz
```

迁移成功时输出 `Applied 001_initial.sql`；再次运行不会重复建表。`readyz` 应返回 `{"ready":true}`。worker 健康检查还需等待一次心跳，通常十几秒。首次模型加载可等待数分钟，查看日志判断是否仍在加载。

```bash
docker compose logs --tail 100 embedding api worker
docker compose exec -T db psql -U kb -d kb -c 'SELECT extversion FROM pg_extension WHERE extname = '\''vector'\'';'
docker compose exec -T worker node dist/admin.js status
```

不要把数据库或 Embedding 端口加入云服务器安全组；Compose 没有映射它们。MCP 只监听宿主机回环地址，后续通过 SSH 隧道访问。

## 6. 调用七个工具

所有命令使用随项目提供的官方 MCP 客户端；它自动读取容器中的 MCP_TOKEN，不需把 token 粘贴到命令行。

```bash
docker compose --profile tools run --rm client list
docker compose --profile tools run --rm client submit_paper @examples/paper.json
docker compose --profile tools run --rm client submit_experience @examples/review.json
```

预期 list 返回七个工具。论文/经验通常返回 pending 和 job_id。复制实际 job_id：

经验仅要求 sourceType、role、executionSummary、strategy 必填；role 必须为 worker、manager、scoper、paper 四选一，表示适用角色。stage、task、applicability 无法确定时省略键，不传 null 或空字符串。最小输入见 examples/review-minimal.json。旧部署需先按 [经验格式与提示词升级说明](UPGRADE-optional-experience.zh-CN.md) 更新 API、worker 和 Embedding；只改客户端输入会导致旧版校验或分块失败。

```bash
docker compose --profile tools run --rm client wait YOUR_JOB_UUID
docker compose --profile tools run --rm client get_job '{"job_id":"YOUR_JOB_UUID"}'
```

成功结果包含最终 ids。把轨迹 JSONL 包装为工具参数：

```bash
jq -Rs '{content:.}' examples/trajectory.jsonl > examples/trajectory-request.json
docker compose --profile tools run --rm client submit_trajectory @examples/trajectory-request.json
```

预期返回 stored、轨迹 ID 和自动创建的蒸馏任务 ID；用 wait 等待策略处理。再次提交相同轨迹应返回相同 ID 和任务，状态为 duplicate。

检索和读取：

```bash
docker compose --profile tools run --rm client search_papers '{"query":"retrieval evaluation","filters":{"year_from":2025},"limit":5}'
docker compose --profile tools run --rm client search_strategies '{"query":"比较不同论文的实验条件","filters":{"role":"worker"},"limit":5}'
docker compose --profile tools run --rm client read '{"type":"paper","id":"YOUR_PAPER_UUID"}'
docker compose --profile tools run --rm client read '{"type":"experience","id":"YOUR_EXPERIENCE_UUID"}'
docker compose --profile tools run --rm client read '{"type":"trajectory","id":"YOUR_TRAJECTORY_UUID","event_range":{"start":1,"end":3}}'
```

替换 YOUR_* 为实际 UUID。提交返回成功和语义内容正确是两项检查，阅读生成的策略与来源，判断建议是否忠于轨迹。

### 从自己的电脑连接

服务器宿主机上的 Agent 使用 `http://127.0.0.1:3000/mcp`；加入相同 Compose 网络的容器使用 `http://api:3000/mcp`。其他容器中的 localhost 指向其自身，需要配置网络连接。两者都使用 MCP_TOKEN 认证，不能用模型 API key 替代。

在电脑上运行并保持 SSH 窗口开启：

```bash
ssh -N -L 3300:127.0.0.1:3000 YOUR_USER@YOUR_SERVER
```

客户端 MCP 地址为 `http://127.0.0.1:3300/mcp`，请求头为 `Authorization: Bearer <服务器 .env 中的 MCP_TOKEN>`。用支持 Streamable HTTP 和自定义请求头的 MCP 客户端配置该地址。本轮不自动配置 auto-survey pipeline。

## 7. 云端验收

### 正常流程、去重、修订与冲突

```bash
docker compose --profile tools run --rm --entrypoint node client dist/smoke.js
cat reports/smoke.json
```

脚本使用明确标识的合成论文和轨迹，实际调用 BGE-M3、PostgreSQL、两个 Agent。检查工具列表、重复提交、历史修订、审稿 JSON、轨迹自动蒸馏、来源及中英文检索。结构检查通过时 status 为 `passed_structural_checks`。

`decisions` 保存补充与冲突案例的管理 Agent 结论，请阅读 reason/evidence。模型可能选择保留差异，不应为了通过测试硬编码某个语义决策。轨迹若返回零条策略，脚本会记录该情况；这只说明流程完成，需要人工判断该测试轨迹是否本应产生可复用策略。

### 依赖失败与任务恢复

只在空闲测试部署运行。此脚本会临时重建 worker，分别注入不可达 Embedding 地址和缺失的模型配置，等待任务失败，恢复配置并重试。数据库和原轨迹保持保存：

```bash
KB_ALLOW_FAULT_TESTS=yes bash scripts/cloud-faults.sh
```

成功后输出 `Fault injection and task recovery passed`，报告位于 `reports/fault-*.json`。若中途失败，脚本仍会恢复正常 worker 配置；检查日志与失败 job_id，再按第 9 节手动重试。

### 重启后持久化

先确保正常 smoke 已成功，再执行：

```bash
KB_ALLOW_RESTART_TEST=yes bash scripts/cloud-persistence.sh
```

预期输出 `{"persistence":"passed"}`。该测试重启服务后读取先前记录，不删除持久卷。

### CPU 性能与内存

```bash
bash scripts/cloud-benchmark.sh
cat reports/benchmark.json
cat reports/embedding-memory-peak.txt
```

benchmark.json 记录预热后 10 次查询的 p50/p95 及批量片段编码速度。查询走完整 MCP search_papers 调用，使用两个固定问题和当时的小型测试库；编码输入是重复的合成短段落，测量分块与编码，不包含 Agent 去重耗时。不能直接外推长论文、数据库扩大或并发场景的速度。

embedding-memory-samples.jsonl 是同期 Docker 采样；embedding-memory-peak.txt 为容器生命周期的 cgroup 内存峰值，可能包含之前加载时的峰值。若显示 `cgroup v2 memory.peak unavailable; inspect sampled docker stats`，表示该指标不可用，不表示 OOM。读取采样：

```bash
python3 - <<'PY'
import json
with open('reports/embedding-memory-samples.jsonl') as f:
    for line in f:
        if line.strip():
            r = json.loads(line)
            print('CPU:', r.get('CPUPerc'), '内存:', r.get('MemUsage'))
PY
```

CPU 约 400% 对应约 4 个逻辑核，符合默认配置。16 GiB 为容器上限，不是预分配内存。[Docker 在 Linux 上的内存显示会扣除部分文件缓存](https://docs.docker.com/reference/cli/docker/container/stats/)，采样最大值不能当作模型全部内存或精确瞬时峰值。

先观察单请求延迟和内存，再决定是否接受当前配置。可调整 EMBEDDING_THREADS 后重建 embedding 容器；模型更换和量化不属于本轮默认设置。

## 8. 停止、重启与升级

```bash
docker compose stop
docker compose up -d --wait db embedding api worker
```

正常停止不会删除数据。`docker compose down` 也保留命名卷；**不要使用 `down -v`，它会删除数据库和模型卷**。

模型配置文件修改后执行 `docker compose restart worker`，重新加载 Pi 配置。修改 `.env` 后用 `docker compose up -d --force-recreate api worker`；更改 Embedding 环境变量时重建 embedding。改变 POSTGRES_PASSWORD 不会自动更新已存在数据库用户密码，首版部署后不要直接修改该项。

升级前先备份，保留旧发布包；依次停止 api/worker、构建新镜像、执行迁移、重新启动并跑 smoke。本版只有初始迁移，不提供自动回滚 schema，跨版本恢复须使用匹配版本的备份和应用。

## 9. 排错与任务重试

```bash
docker compose ps
docker compose logs --tail 200 api worker embedding db
docker compose exec -T worker node dist/admin.js status
docker compose --profile tools run --rm client get_job '{"job_id":"YOUR_JOB_UUID"}'
```

| 现象 | 检查与处理 |
|---|---|
| HTTP 401 | 检查客户端 token 与服务器一致，修改 .env 后重建 api/worker |
| HTTP 413 | 请求超过 16 MiB；可提高 MAX_REQUEST_BYTES 并重建 api，但同时检查内存；轨迹支持通过 submit_trajectory 的 transfer 参数分段上传，优先使用配套同步客户端 |
| embedding 无法启动 | 检查模型文件和目录权限；确认完成固定 revision 下载；OOM 时检查 docker inspect 的 OOMKilled |
| readyz 503 | 检查数据库迁移和 Embedding 健康；readyz 不验证大模型密钥 |
| worker 配置/模型错误 | 检查 Pi models.json、agents.json、API key、模型工具调用能力及实际上下文限制 |
| job 一直 queued | 检查 worker 是否健康，是否有较长的前置任务，或任务正在等待失败重试 |
| job failed | 查 error，修复依赖；失败不意味着轨迹丢失 |
| 重启后任务仍 running | 等待原租约过期，默认最长 120 秒；worker 会接管 |
| reports 写入 Permission denied | 检查 reports 目录的 GID 1000 写权限 |
| Availability refresh: EROFS，auth.json.lock | config 挂载去掉 :ro；执行 sudo chgrp 1000 config 与 chmod 770 config，然后重新创建 api、worker |
| 启动报告另一个 worker 正在运行 | 保持首版单 worker，停止多余实例后重试 |

修复故障后：

```bash
docker compose exec -T worker node dist/admin.js retry YOUR_FAILED_JOB_UUID
docker compose --profile tools run --rm client wait YOUR_FAILED_JOB_UUID
```

retry 只接受 failed 任务；对蒸馏父任务重试时也会重排失败子任务。已成功步骤不会被清空。

### 本次部署问题一：Pi 配置错误隐藏了只读挂载问题

`Pi model configuration is invalid; inspect config/models.json` 是应用的统一错误提示，不能直接推断 API key 无效。运行下面的诊断获取具体错误，不调用大模型；分享结果前检查是否包含敏感配置：

```bash
docker compose exec -T worker node --input-type=module <<'JS'
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
const runtime = await ModelRuntime.create({
  modelsPath: '/app/config/models.json',
  authPath: '/app/config/auth.json',
  modelsStorePath: '/data/models-store.json',
  allowModelNetwork: false,
});
console.log(runtime.getError() || 'Pi 配置加载正常');
JS
```

本次实际错误为 `Availability refresh: EROFS: read-only file system, mkdir '/app/config/auth.json.lock'`。旧发布包的修复命令如下；新版 compose.yaml 已取消该目录的只读标记：

```bash
cp -p compose.yaml compose.yaml.before-auth-fix
sed -i 's|./config:/app/config:ro|./config:/app/config|' compose.yaml
sudo chgrp 1000 config config/*.json
chmod 770 config
chmod 640 config/*.json
docker compose up -d --no-deps --force-recreate api worker
```

重新诊断应输出 `Pi 配置加载正常`。无需重建镜像或重新下载模型。另一个独立配置问题是把真实密钥写进 `${...}`：应按第 3 节改为变量名引用，真实值放在 `.env`。修改 `.env` 后需重新创建服务，普通 restart 不会更新容器环境变量。

### 本次部署问题二：重启后离线模型挂载丢失

现象：持久化脚本报 embedding unhealthy；日志显示 `No sentence-transformers model found with name /models/bge-m3`、`Unrecognized model in /models/bge-m3`，服务反复退出。不能只延长等待时间，也不要手工修改模型的 model_type。

```bash
docker compose logs --tail=80 embedding
docker inspect survey-kb-embedding-1 \
  --format '状态={{.State.Status}} OOMKilled={{.State.OOMKilled}} 重启次数={{.RestartCount}} 健康检查={{json .State.Health}}'
docker inspect survey-kb-embedding-1 \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
ls -lh /root/survey-kb/bge-m3/config.json /root/survey-kb/bge-m3/modules.json
```

上述容器名适用于默认项目名 survey-kb。本次 OOMKilled=false，服务器模型文件存在，但容器只挂载 model-data 到 /models，没有离线目录到 /models/bge-m3。原先仅在 shell export 的 COMPOSE_FILE 没有持续生效，后续 up 按默认配置创建了容器。

按第 4 节把 COMPOSE_FILE、BGE_MODEL_DIR 保存到 `.env` 后执行：

```bash
unset COMPOSE_FILE BGE_MODEL_DIR
docker compose up -d --no-deps --force-recreate \
  --wait --wait-timeout 600 embedding api worker
curl -fsS http://127.0.0.1:3000/readyz
KB_ALLOW_RESTART_TEST=yes bash scripts/cloud-persistence.sh
```

预期 readyz 为 ready=true，持久化检查通过；模型文件与数据库内容保留。本次用户完成该修复后确认持久化测试通过。

## 10. 备份和恢复

备份包含论文、经验、轨迹、索引、修订和后台任务：

```bash
mkdir -p backups
backup="backups/kb-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U kb -d kb -Fc > "$backup"
test -s "$backup"
sha256sum "$backup" > "$backup.sha256"
```

另行保存实际配置和模型 revision，配置含密钥应存入受控位置。BGE-M3 权重可按固定 revision 重下，不必每次备份。

恢复演练使用新的数据库名，避免覆盖当前数据。以下命令将指定备份恢复到 `kb_restore_check`，该数据库必须尚不存在：

```bash
docker compose exec -T db createdb -U kb kb_restore_check
docker compose exec -T db pg_restore -U kb -d kb_restore_check --no-owner --exit-on-error < backups/YOUR_BACKUP.dump
docker compose exec -T db psql -U kb -d kb_restore_check -c 'SELECT count(*) FROM entities; SELECT count(*) FROM trajectories;'
```

若需要把恢复库作为生产库，先停止 api/worker，再通过本地 Compose override 将 DATABASE_URL 的数据库名改为 kb_restore_check，启动并执行 smoke。保留原库，确认恢复结果后再自行制定清理安排。本手册不自动删除或覆盖现有数据库。

## 11. 验收记录

保存 `reports/`，补充服务器 CPU 型号、内存、测试时间、使用的两个模型、主要延迟及语义抽查结论。与仓库中本地验证记录分开记录。

云端验收通过后，再开始 Sprint2-B 的 pipeline 接入。

本次用户于 2026-10-26 结束首轮部署测试，决定继续讨论 Sprint2-B；已有证据与尚未覆盖的项目见 [VALIDATION.md](VALIDATION.md)，不将基础测试通过扩大为全面故障或语义质量验收。

## 12. 测试结束后清空知识库（不备份）

适用于明确要恢复空库的场景。会删除所有论文、经验、轨迹、历史修订、索引、来源关联及处理任务，正式数据也会删除。保留数据库结构、迁移记录、模型文件、配置和 reports/。本次用户明确选择不备份，并已确认执行后清空。

在服务器项目目录先停止写入并清空：

```bash
cd ~/survey-kb/knowledge-base
docker compose stop api worker
docker compose exec -T db psql -U kb -d kb -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  experience_sources, search_chunks, decisions, conflicts,
  ingestions, jobs, revisions, entities, trajectories;
SQL
```

看到 `TRUNCATE TABLE` 后再恢复服务；SQL 报错时先排查，不把清空视为成功：

```bash
docker compose up -d --wait api worker
docker compose exec -T db psql -U kb -d kb -c \
"SELECT
 (SELECT count(*) FROM entities) AS papers_and_experiences,
 (SELECT count(*) FROM trajectories) AS trajectories,
 (SELECT count(*) FROM jobs) AS jobs;"
```

三个值应均为 0。不要用 `down -v` 代替清空，也不要再次运行 smoke，否则会重新产生测试记录。旧的持久化报告引用已删除的 ID，清空后不能用它验证原记录；需要重新验收时先运行新一轮 smoke。
