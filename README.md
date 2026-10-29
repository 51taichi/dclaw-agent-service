# DClaw Agent Service

独立、渠道中立的 DClaw Agent 运行时。它复用一套会话、消息、状态机、标签、提醒、人工接管与 Agent Gateway 机制，并把渠道差异限制在 Channel Adapter 和渠道展示层。

## 管理边界

- 管理后台 `/admin/`：平台管理员维护公司工作区、渠道公共效果、公司助手、智能员工、人设、渠道开关和平台 Agent 配置库。
- 管理中台 `/console/?workspace={workspaceId}`：公司客户处理会话、状态机、标签、激活、提醒与人工接管；人物和渠道配置只读。
- 渠道预览 `/channels/channel-preview?channel={channelId}`：后台 iframe 使用渠道草稿和“张三”占位资料预览公共效果。
- 渠道公开页 `/channels/{publicSlug}`：官网 iframe 与小程序 `web-view` 使用已发布配置，与后台预览共用同一渲染器和样式。

领域关系为：

```text
工作区 / 公司
├── 已开通渠道（1-N）
│   └── 公司公共助手 -> 可选绑定 Agent，否则继承平台默认
├── 智能员工 / 人物（1-N）
│   ├── 通过开关启用 0-N 个现有渠道
│   └── 可选绑定 Agent，否则继承平台默认
└── 平台 Agent 配置库（1-N）
    └── 必须指定一个全局默认 Agent
```

人物资料独立于渠道并由所有已开通渠道共享，渠道之间不互相读取配置。会话和消息按渠道隔离，状态机与标签配置按人物共用。API 地址、密钥和 Agent ID 只在平台 Agent 配置库维护；人物和渠道只保存配置引用。并发与计费使用 DClaw Open API 的平台默认策略。Agent 请求会携带服务端生成的工作区、人物或公司助手上下文，并记录实际生效的绑定。

## 本地运行

```bash
cp .env.example .env
npm install
npm start
```

- 管理中台：`http://127.0.0.1:4310/console/?workspace=dingmai`
- 管理后台：`http://127.0.0.1:4310/admin/`
- 健康检查：`http://127.0.0.1:4310/health`

Node.js 需为 24 或更高版本，数据库使用 Node 内置 SQLite。首次启动会创建 `data/dclaw-agent.sqlite`，预置伍合工作区、一个智能员工，以及官网客服和智能名片两个渠道部署。旧的 `fake-demo` 本地演示数据会在迁移时清理。

微信真机预览不能使用 `127.0.0.1` 访问电脑上的服务。电脑与手机连接同一局域网后，服务需监听 `0.0.0.0`，小程序需使用自动识别局域网地址的构建命令：

```bash
HOST=0.0.0.0 PORT=4313 PUBLIC_BASE_URL=http://$(ipconfig getifaddr en0):4313 npm start
npm --prefix clients/channel-app run build:mp-weixin:lan
```

随后在微信开发者工具重新编译或预览 `clients/channel-app/dist/build/mp-weixin`。如自动识别的网卡不正确，可通过 `DCLAW_LAN_HOST` 指定电脑地址。

微信登录只用 `wx.login` 获取临时凭证，真实昵称和头像由用户通过微信官方昵称输入框与头像选择器确认。每个工作区在管理后台维护自己的小程序 AppID 和 AppSecret，AppSecret 使用服务端主密钥加密后保存到数据库：

```bash
CREDENTIAL_ENCRYPTION_KEY=your-random-master-key
WECHAT_SESSION_TTL_DAYS=30
```

主加密密钥只配置在 Agent Service 环境变量中，不能放入小程序代码或提交到仓库。旧版全局 AppID/AppSecret 可通过 `npm run credentials:migrate-wechat -- dingmai` 一次性迁移到指定工作区；迁移完成后脚本会清空 `.env` 中的旧凭证。

### 语音转文字

名片录音会先上传到 Agent Service，再通过兼容标准 multipart 转写协议的语音服务生成文字，最后把文字和原始音频附件一起交给 Agent。配置以下环境变量后重启服务：

```bash
SPEECH_API_URL=https://your-speech-provider.example/v1/audio/transcriptions
SPEECH_API_KEY=your-key
SPEECH_MODEL=your-model
SPEECH_LANGUAGE=zh
```

`SPEECH_API_KEY` 对无需鉴权的本地服务可留空。没有配置转写服务时，录音仍可上传，但 Agent 只能收到语音时长占位信息，无法理解录音内容。

## Docker 本地测试

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f agent-service
```

默认访问地址仍为：

- 管理中台：`http://127.0.0.1:4310/console/?workspace=dingmai`
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

## 生产部署

生产环境使用 `compose.production.yaml`，容器端口只绑定服务器回环地址，由 Nginx 提供 HTTPS。代码通过 Git 管理，SQLite、上传媒体和 `.env` 始终保留在仓库外：

```bash
git clone https://github.com/51taichi/dclaw-agent-service.git /opt/dclaw-agent-service/source
cd /opt/dclaw-agent-service/source
cp .env.example .env
install -d -o 1000 -g 1000 /opt/dclaw-agent-service/data
docker compose -f compose.production.yaml up -d --build
```

生产 `.env` 至少需要配置 `CREDENTIAL_ENCRYPTION_KEY`，并使用以下宿主机参数：

```bash
DCLAW_AGENT_PORT=14313
DCLAW_AGENT_PUBLIC_BASE_URL=https://agent.deepmega.cn
DCLAW_AGENT_DATA_DIR=/opt/dclaw-agent-service/data
```

后续发布代码时执行：

```bash
git pull --ff-only
docker compose -f compose.production.yaml up -d --build
docker compose -f compose.production.yaml ps
```

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

OpenAPI Base URL、API Key 和 Agent ID（即 Open API Public ID）统一保存在平台 Agent 配置库；并发与计费使用 DClaw Open API 的平台默认策略。Base URL 填写 DClaw 实例地址（例如 `https://dclaw.example.com`），服务会按 Agent ID 调用 `/api/open/v1/targets/{public_id}/messages`；为兼容已有配置，也可以直接填写完整消息接口 URL。平台必须指定一个默认 Agent；智能员工与渠道公司助手默认继承该配置，也可以分别打开独立绑定开关后选择其他 Agent。兼容期内，旧层级配置只在新配置不可用时生效。请求使用：

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
GET /api/admin/channels/{channelId}/preview
POST /api/admin/channels/{channelId}/publish
GET /api/public/channels/{publicSlug}
GET /channels/{publicSlug}
```

后台 iframe、官网植入 iframe 和智能名片 H5 共用 `channel-preview` 渲染器。渠道页通过渠道 ID 预览公共效果，人物页通过人物与渠道关联读取真实名片草稿，公开页面通过公开标识读取已发布渠道配置；三者使用同一个最终渲染页面。智能名片页面同时作为 uni-app 小程序实现的视觉与行为基准。

公开名片的文字、图片、文件和语音消息通过公开标识映射到真实渠道账号。媒体先上传到部署服务的数据目录，再以附件进入 Channel Adapter、状态机、标签和 Agent Gateway，回复通过该会话的 outbox 返回页面。浏览器不会接触内部账号密钥或 Webhook Secret。

## 会话组件库

`/components/` 是会话组件的完整可视化目录。组件结构由 `public/components/cards.js` 统一生成，样式由 `public/components/cards.css` 统一维护；智能名片、小程序 WebView 和 Agent outbox 富消息均直接复用这两个文件。新增组件时需要同时登记组件类型、Demo 数据和渲染测试，禁止在具体渠道页面复制一份独立实现。

会话组件的使用场景、控制权、提交状态、客户气泡、留资隐私、Agent 返回协议和变更同步要求统一记录在 [`docs/conversation-component-rules.md`](docs/conversation-component-rules.md)。该文档是 Agent 与页面开发的共同规则来源；任何交互或协议变化都必须同步更新规则文档、组件 Demo 和测试。

Agent 可通过 `attachments` 返回图片、文件或 `type=card` 的富链接卡片。富链接卡片支持 `url`、`name`、`title`、`subtitle` 和 `pictureUrl`，最终由共享附件组件渲染。交互回答使用 `type=single-choice` 或 `type=multi-choice`，并提供 `id`、`title`、`options` 和 `submitLabel`；前端只在客户点击组件右下角的提交按钮后发送所选答案。

## 验证

```bash
npm test
npm run check
```
