import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPONENT_TYPES, renderConversationComponent } from "../public/components/cards.js";

test("conversation component catalog exposes every supported renderer", () => {
  assert.deepEqual(COMPONENT_TYPES, [
    "assistant-response", "assistant-loading", "suggestion-chips", "single-choice",
    "multi-choice", "action-button", "resource-list",
    "lead-form", "message", "voice-message", "attachment"
  ]);
  for (const type of COMPONENT_TYPES) assert.match(renderConversationComponent(type), /data-component=/);
});

test("agent loading state is accessible and stable across both conversation surfaces", () => {
  const loading = renderConversationComponent("assistant-loading");
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.match(loading, /data-component="assistant-loading"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, />正在思考<\/span>/);
  assert.match(previewSource, /withAgentLoading\(stream, scrollToBottom/);
  assert.match(previewSource, /withAgentLoading\(companyConversation, scrollCompanyToLatest/);
});

test("business cards no longer inject a lead form by default", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(previewSource, /leadFormEnabled|renderConversationComponent\("lead-form"\)|data-more-action="contact"/);
});

test("reused conversations advance the outbox cursor before sending a new message", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const clientSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.match(previewSource, /primeOutboxCursor\(data\.endpoints\.publicOutbox, conversationId\)/);
  assert.match(previewSource, /await outboxReady;\s+const response = await fetch\(data\.endpoints\.publicMessages/);
  assert.match(previewSource, /await companyOutboxReady;\s+const response = await fetch\(data\.endpoints\.assistantMessages/);
  assert.match(clientSource, /primeOutboxCursor\(data\.value\?\.endpoints\?\.publicOutbox, conversationId, outboxAfter\)/);
  assert.match(clientSource, /const syncError = await \(company \? companyOutboxReady : outboxReady\);/);
});

test("wechat business cards use login plus official nickname and avatar controls", () => {
  const clientSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.doesNotMatch(clientSource, /uni\.getUserProfile\(\{/);
  assert.match(clientSource, /uni\.login\(\{ provider: "weixin"/);
  assert.match(clientSource, /dclaw:uni:wechat-profile/);
  assert.match(clientSource, /dclaw:uni:wechat-session/);
  assert.match(clientSource, /wechatLoginVisible\.value = !wechatNickname\.value/);
  assert.match(clientSource, /type="nickname"/);
  assert.match(clientSource, /open-type="chooseAvatar"/);
  assert.match(clientSource, /\/api\/public\/wechat\/login/);
  assert.match(clientSource, /\/api\/public\/wechat\/profile/);
  assert.match(clientSource, /displayName: conversationDisplayName\(company\)/);
  assert.match(clientSource, /return wechatNickname\.value \|\| \(company \? "公司名片访客" : "名片访客"\)/);
  assert.match(clientSource, />暂不授权<\/button>/);
});

test("agent responses render as plain answer cards and message defaults to customer", () => {
  const answer = renderConversationComponent("assistant-response", { content: "这是 Agent 的直接回复。" });
  const message = renderConversationComponent("message", { content: "这是客户消息。" });
  assert.match(answer, /dclaw-answer-content/);
  assert.doesNotMatch(answer, /component-kicker|<h2>|<p>/);
  assert.match(message, /customer-message/);
  assert.doesNotMatch(message, /agent-message/);
  assert.match(answer, /data-response-action="copy"/);
  assert.match(answer, /aria-label="重新生成回复"/);
  assert.match(answer, /aria-pressed="false"/);
});

test("suggested questions have a clear prompt label", () => {
  const suggestions = renderConversationComponent("suggestion-chips", { items: ["你是谁", "怎么合作"] });
  assert.match(suggestions, /dclaw-suggestion-title/);
  assert.match(suggestions, />快捷提问<\/span>/);
  assert.match(suggestions, /data-question="你是谁"/);
});

test("choice components require an explicit reusable submit button", () => {
  const single = renderConversationComponent("single-choice", { options: [{ label: "方案 A", value: "a" }, { label: "方案 B", value: "b" }] });
  const multiple = renderConversationComponent("multi-choice", { options: ["业务咨询", "案例资料"] });
  assert.match(single, /type="radio"/);
  assert.match(multiple, /type="checkbox"/);
  assert.match(single, /data-component="action-button"/);
  assert.match(multiple, /data-action="submit-choice"/);
  assert.match(single, / disabled/);
});

test("submitted choices render a locked gray state with the selected answer", () => {
  const submitted = renderConversationComponent("multi-choice", {
    options: [{ label: "方案 A", value: "a" }, { label: "方案 B", value: "b" }],
    selectedValues: ["a"],
    submitted: true
  });
  assert.match(submitted, /is-submitted/);
  assert.match(submitted, /value="a"[^>]* checked disabled/);
  assert.match(submitted, /value="b"[^>]* disabled/);
  assert.match(submitted, />已提交<\/button>/);
});

test("rich card attachments use the shared visual component and escape content", () => {
  const markup = renderConversationComponent("attachment", {
    attachment: {
      type: "card",
      title: "方案 <script>",
      subtitle: "企业智能化服务",
      name: "查看方案",
      url: "https://example.test/plan",
      pictureUrl: "https://example.test/cover.jpg"
    }
  });
  assert.match(markup, /dclaw-link-card/);
  assert.match(markup, /方案 &lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("unsafe attachment links are replaced with inert anchors", () => {
  const markup = renderConversationComponent("attachment", { attachment: { type: "file", name: "资料", url: "javascript:alert(1)" } });
  assert.match(markup, /href="#"/);
  assert.doesNotMatch(markup, /javascript:/);
});

test("person and company conversations use the same component renderer", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.match(previewSource, /companyConversation\.insertAdjacentHTML\("beforeend", renderConversationComponent\("message"/);
  assert.match(previewSource, /companyConversation\.insertAdjacentHTML\("beforeend", renderConversationComponent\("assistant-response"/);
  assert.doesNotMatch(previewSource, /assistant-user-message|assistant-agent-message|data-assistant-response-action/);
});

test("website roster opens the shared card renderer instead of a separate chat UI", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.match(previewSource, /parameters\.get\("surface"\) === "card"/);
  assert.match(previewSource, /data\.cardPresentation\?\.config \|\| data\.channel\.config/);
  assert.match(previewSource, /<iframe data-widget-card-frame/);
  assert.match(previewSource, /frame\.src = `\/channels\/\$\{encodeURIComponent\(deployment\.publicSlug \|\| "channel-preview"\)\}/);
  assert.match(previewSource, /parameters\.set\("channel", data\.channel\.id\)/);
  assert.doesNotMatch(previewSource, /function showChat\(/);
});

test("admin preview uses a real deployment for every channel provider", () => {
  const adminSource = readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  assert.match(adminSource, /if \(deployment\) \{\s*return `\/channels\/\$\{encodeURIComponent\(deployment\.publicSlug\)\}/);
  assert.doesNotMatch(adminSource, /provider === "miniapp" && deployment/);
});

test("admin workspace title stays on one line and uses the company name instead of its slug", () => {
  const adminSource = readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  const adminMarkup = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.match(adminSource, /workspaceTitle\.textContent = `工作区 \/ \$\{state\.workspace\.name\}`/);
  assert.doesNotMatch(adminSource, /workspaceTitle\.textContent = state\.workspace\.name/);
  assert.doesNotMatch(adminMarkup, /id="workspaceSlug"/);
});

test("admin browser and header use the website card management title", () => {
  const adminMarkup = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.match(adminMarkup, /<title>官网名片智能体管理后台<\/title>/);
  assert.match(adminMarkup, /<h1>官网名片智能体管理后台<\/h1>/);
  assert.doesNotMatch(adminMarkup, /DClaw Agent 管理后台/);
});

test("channel publishing and miniapp credential saving stay visible near their settings", () => {
  const adminMarkup = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  assert.match(adminMarkup, /data-publish-provider="miniapp"[^>]*>[\s\S]*?发布配置/);
  assert.match(adminMarkup, /id="saveMiniappCredential"[^>]*>[\s\S]*?保存小程序配置/);
  assert.match(adminMarkup, /后台显示名称/);
  assert.match(adminSource, /async function saveMiniappCredential\(\)/);
  assert.match(adminSource, /saveMiniappCredential\.addEventListener/);
  assert.match(adminSource, /async function publishProviderConfig\(provider\)/);
  assert.match(adminSource, /await persistProviderConfig\(provider, form\)/);
});
