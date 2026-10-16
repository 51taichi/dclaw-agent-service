# DClaw Agent Service

独立、渠道中立的 DClaw Agent 运行时。它复用一套会话、消息、状态机、标签、提醒、人工接管与 Agent Gateway 机制，并把渠道差异限制在 Channel Adapter 和渠道展示层。

## 管理边界

- 管理后台 `/admin/`：平台管理员维护公司工作区、智能员工、人设、渠道、发布配置，以及平台级/工作区级/人物级 Agent API 继承。
- 管理中台 `/console/?workspace={workspaceId}`：公司客户处理会话、状态机、标签、激活、提醒与人工接管；人物和渠道配置只读。
- 渠道预览 `/channel-preview/?deployment={deploymentId}`：使用渠道草稿配置渲染官网客服或智能名片预览。

领域关系为：

```text
工作区 / 公司
├── 智能员工 / 人物（1-N）
├── 已开通渠道（1-N）
├── 人物渠道部署（N-N）
└── Agent API：人物覆盖 -> 工作区覆盖 -> 平台默认
```

同一人物部署到多个渠道时，会话和消息按渠道隔离，状态机与标签配置按人物共用。Agent 请求会携带服务端生成的工作区、人物和部署上下文，并记录实际生效的绑定，便于并发和计费归集。

## 本地运行

```bash
cp .env.example .env
npm install
npm start
```

- 管理中台：`http://127.0.0.1:4310/console/?workspace=wuhe`
- 管理后台：`http://127.0.0.1:4310/admin/`
- 健康检查：`http://127.0.0.1:4310/health`

Node.js 需为 24 或更高版本，数据库使用 Node 内置 SQLite。首次启动会创建 `data/dclaw-agent.sqlite`，预置伍合工作区、一个智能员工，以及官网客服和智能名片两个渠道部署。旧的 `fake-demo` 本地演示数据会在迁移时清理。

## Docker 本地测试

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f agent-service
```

默认访问地址仍为：

- 管理中台：`http://127.0.0.1:4310/console/?workspace=wuhe`
- 管理后台：`http://127.0.0.1:4310/admin/`
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
会话 -> Agent Gateway -> 任务流/标签判定 -> 提醒/接管 -> delivery.send()
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

OpenAPI URL、API Key 与 Agent ID 采用人物级、工作区级、平台级的逐级继承。兼容期内，旧渠道账号上的 Agent 配置只在三级配置均不可用时生效。请求使用：

- Bearer API Key
- `Idempotency-Key`
- `external_user_id`
- `external_session_id`
- SSE 或 JSON 响应

当任务流或标签规则启用时，Agent 必须返回完整的结构化判定。服务端会校验节点跳转、可收集字段、标签全集评价、客户证据、组内互斥和单向升级规则；不符合契约的响应不会落库或发送。

示例响应：

```json
{
  "reply": "给客户的回复",
  "flowDecision": {
    "nodeCompleted": true,
    "nextNodeId": "invite_next_step",
    "collectedDataPatch": {
      "客户需求": "产品报价",
      "联系方式": "13800000000"
    },
    "reason": "基础信息已收集完整"
  },
  "tagEvaluation": [
    {
      "groupId": "intent_level",
      "tagId": "high_intent",
      "matched": true,
      "reason": "客户明确询价并留下联系方式",
      "evidenceMessageId": "42",
      "evidenceText": "请给我报价，电话是 13800000000"
    }
  ],
  "tagDecision": {
    "add": [{ "groupId": "intent_level", "tagId": "high_intent", "reason": "明确购买意向" }],
    "remove": []
  },
  "attentionAlert": null,
  "handoff": false
}
```

未配置 Agent 时，服务使用明确的兜底回复，便于在接通真实 OpenAPI 前完整测试渠道链路。

任务流支持节点目标、完成条件、收集字段、交流技巧、顺序拖拽、客户激活和末节点静默回复。标签机支持日期标签、分组、互斥、单向变更、证据、语音提醒、自动人工接管及标签触发任务。两者的配置接口分别是 `GET/PUT /api/flow-machines/{accountId}` 和 `GET/PUT /api/tag-schemas/{accountId}`；服务端会把同一人物的不同渠道账号解析到同一个人物配置源。

## 渠道草稿与发布

后台保存的是草稿配置，实时预览读取草稿。只有执行“发布配置”后，公开读取接口才会返回新版本：

```text
GET /api/admin/deployments/{deploymentId}/preview
POST /api/admin/channels/{channelId}/publish
GET /api/public/channels/{publicSlug}
```

官网渠道的交付形态为植入脚本创建的隔离 iframe；智能名片渠道的交付形态为响应式 H5 URL，并可在后续由微信小程序 `web-view` 承载。当前工程先提供共享配置协议和后台预览渲染器。

## 验证

```bash
npm test
npm run check
```
