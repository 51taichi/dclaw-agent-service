# DClaw Agent Service

独立、渠道中立的 DClaw 客服运行时。它复用一套会话、消息、状态机、标签、提醒、人工接管与 Agent Gateway 机制，并把渠道差异限制在 Channel Adapter 层。

## 本地运行

```bash
cp .env.example .env
npm install
npm start
```

- 管理中台：`http://127.0.0.1:4310/console/`
- 渠道管理：`http://127.0.0.1:4310/admin/`
- 健康检查：`http://127.0.0.1:4310/health`

Node.js 需为 24 或更高版本，数据库使用 Node 内置 SQLite。首次启动会创建 `data/dclaw-agent.sqlite`，并预置 `website`、`miniapp`、`fake` 三个示例账号。

## Docker 本地测试

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f agent-service
```

默认访问地址仍为：

- 管理中台：`http://127.0.0.1:4310/console/`
- 渠道管理：`http://127.0.0.1:4310/admin/`
- 健康检查：`http://127.0.0.1:4310/health`

SQLite 数据保存在命名卷 `dclaw-agent-service-data`。停止容器不会删除数据：

```bash
docker compose down
```

只有明确需要清空本地测试数据时才删除数据卷：

```bash
docker compose down --volumes
```

如需改用其他宿主机端口，可在 `.env` 设置 `DCLAW_AGENT_PORT` 和对应的 `DCLAW_AGENT_PUBLIC_BASE_URL`。

## Channel Adapter 边界

核心业务只处理标准入站事件和标准投递命令，不判断具体渠道名称：

```text
渠道 webhook / SDK
        |
        v
normalizeInbound()
        |
        v
会话 -> 状态机 -> 标签 -> 提醒 -> Agent Gateway -> delivery.send()
                                                        |
                                                        v
                                                   Adapter.send()
```

Adapter 必须声明能力并实现：

- `normalizeInbound({ accountId, payload })`
- `send(command)`
- `health()`

注册位置为 `src/channels/index.js`。增加新渠道时新增 Adapter 并注册即可，消息服务、状态机和 UI 接口无需增加渠道分支。

## 入站与出站协议

发送一条官网消息：

```bash
curl -X POST http://127.0.0.1:4310/api/channels/website/website-default/events \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id": "evt-001",
    "occurred_at": "2026-10-15T08:00:00.000Z",
    "conversation": {
      "id": "web-session-001",
      "user_id": "visitor-001",
      "display_name": "官网访客"
    },
    "message": {
      "id": "msg-001",
      "type": "text",
      "text": "你好"
    }
  }'
```

官网或小程序通过以下接口拉取待发送消息：

```text
GET /api/channels/{provider}/{accountId}/conversations/{externalConversationId}/outbox?after=0
```

完成发送后可上报 `queued`、`sent`、`delivered`、`read` 或 `failed`：

```text
POST /api/channels/{provider}/{accountId}/receipts
{"providerMessageId":"...","status":"delivered"}
```

如果账号配置了 Webhook Secret，入站请求需要携带 `X-Channel-Secret`。

## Agent Gateway

每个渠道账号独立配置 OpenAPI URL、API Key 与 Agent ID。请求使用：

- Bearer API Key
- `Idempotency-Key`
- `external_user_id`
- `external_session_id`
- SSE 或 JSON 响应

推荐 Agent 返回：

```json
{
  "reply": "给客户的回复",
  "state": "engaged",
  "tags": ["高意向"],
  "attention": null,
  "handoff": false
}
```

未配置 Agent 时，服务使用明确的兜底回复，便于在接通真实 OpenAPI 前完整测试渠道链路。

## 验证

```bash
npm test
npm run check
```
