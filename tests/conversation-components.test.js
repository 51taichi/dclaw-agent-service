import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPONENT_TYPES, renderConversationComponent } from "../public/components/cards.js";
import { getChannelType } from "../src/channel-catalog.js";

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
  assert.match(previewSource, /async function submitLead\(form\)/);
  assert.match(previewSource, /content: "已提交联系信息"/);
});

test("web business cards omit the miniapp-only phone action", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(previewSource, /href="tel:|<span>打电话<\/span>/);
  assert.match(previewSource, /data-more-action="image"/);
  assert.match(previewSource, /data-more-action="file"/);
});

test("profile avatars open the same lightbox treatment as contact QR codes", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const previewStyles = readFileSync(new URL("../public/channel-preview/styles.css", import.meta.url), "utf8");
  const clientSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.match(previewSource, /data-avatar-open/);
  assert.match(previewSource, /data-avatar-lightbox/);
  assert.match(previewSource, /class="qr-lightbox avatar-lightbox"/);
  assert.match(previewStyles, /\.avatar-lightbox section > img/);
  assert.match(clientSource, /@tap="avatarOpen = true"/);
  assert.match(clientSource, /v-if="avatarOpen" class="qr-lightbox avatar-lightbox"/);
});

test("business card face toggle defaults below the contact QR area", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const previewStyles = readFileSync(new URL("../public/channel-preview/styles.css", import.meta.url), "utf8");
  const adminStyles = readFileSync(new URL("../public/admin/styles.css", import.meta.url), "utf8");
  assert.match(previewSource, /const DEFAULT_FACE_TRIGGER_TOP = 218;/);
  assert.match(previewStyles, /\.card-face-trigger\s*\{[^}]*top:\s*218px/);
  assert.match(adminStyles, /\.map-front-flip-entry\s*\{[^}]*top:\s*196px/);
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

test("miniapp opens on a workspace roster and navigates to independently shareable cards", () => {
  const pages = readFileSync(new URL("../clients/channel-app/src/pages.json", import.meta.url), "utf8");
  const homeSource = readFileSync(new URL("../clients/channel-app/src/pages/home/index.vue", import.meta.url), "utf8");
  const cardSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  const productionBuildSource = readFileSync(new URL("../clients/channel-app/scripts/build-mp-weixin-production.mjs", import.meta.url), "utf8");
  assert.ok(pages.indexOf('"pages/home/index"') < pages.indexOf('"pages/card/index"'));
  assert.match(homeSource, /currentMiniappAppId\(\)/);
  assert.match(homeSource, /\/api\/public\/miniapps\/\$\{encodeURIComponent\(appId\.value\)\}/);
  assert.match(homeSource, /uni\.navigateTo\(\{ url: `\/pages\/card\/index\?slug=/);
  assert.match(cardSource, /uni\.reLaunch\(\{ url: "\/pages\/home\/index" \}\)/);
  assert.doesNotMatch(cardSource, /query\.slug \|\| "dingmai-assistant"/);
  assert.match(cardSource, /open-type="share"/);
  assert.match(cardSource, /uni\.showShareMenu\?\.\(\{ menus: \["shareAppMessage", "shareTimeline"\] \}\)/);
  assert.match(cardSource, /onShareAppMessage\(\(\) =>/);
  assert.match(cardSource, /onShareTimeline\(\(\) =>/);
  assert.match(cardSource, /path: slug \? `\/pages\/card\/index\?slug=\$\{encodeURIComponent\(slug\)\}`/);
  assert.match(cardSource, /canvas-id="share-card-canvas"/);
  assert.match(cardSource, /async function prepareShareCard\(\)/);
  assert.match(cardSource, /destWidth: 1000/);
  assert.match(cardSource, /shareCardImage\.value \? \{ imageUrl: shareCardImage\.value \}/);
  assert.doesNotMatch(cardSource, /imageUrl: profile\.value\.avatar/);
  assert.match(productionBuildSource, /VITE_DEFAULT_API_BASE: apiBase/);
  assert.match(productionBuildSource, /dist\/production\/mp-weixin-\$\{appId\}/);
  assert.match(productionBuildSource, /projectConfig\.miniprogramRoot = "\.\/"/);
  assert.match(productionBuildSource, /pathName: "pages\/home\/index"/);
});

test("website custom frame keeps a fixed transparent skin while the employee list grows independently", () => {
  const website = getChannelType("website");
  const skinField = website.channelFields.find((field) => field.key === "panelSkinImageUrl");
  const adminSource = readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const previewStyles = readFileSync(new URL("../public/channel-preview/styles.css", import.meta.url), "utf8");
  const embedSource = readFileSync(new URL("../public/embed/dclaw-agent.js", import.meta.url), "utf8");
  const miniappSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");

  assert.deepEqual(skinField.imageSpec, { width: 490, height: 472, transparent: true, topSlice: 262, maxVisibleItems: 3 });
  assert.match(adminSource, /定制客服框必须为 \$\{width\}×\$\{height\}px/);
  assert.match(adminSource, /定制客服框必须包含透明区域/);
  assert.match(previewSource, /Math\.max\(1, Math\.min\(agents\.length, 3\)\)/);
  assert.match(previewSource, /width: state === "open" \? Math\.ceil\(panel\.getBoundingClientRect\(\)\.width\)/);
  assert.match(previewSource, /height: state === "open" \? Math\.ceil\(panel\.getBoundingClientRect\(\)\.height\)/);
  assert.match(previewStyles, /border-image-slice:\s*262 6 6 6 fill/);
  assert.match(previewStyles, /width:\s*138px;[^}]*height:\s*calc\(83px \+ var\(--visible-agents, 1\) \* 48px\)/);
  assert.match(previewStyles, /\.widget-panel\.has-custom-skin\.card-open\s*\{[^}]*box-shadow:[^}]*0 36px 90px/);
  assert.doesNotMatch(previewStyles, /\.widget-panel\.has-custom-skin\.card-open::after/);
  assert.match(previewStyles, /\.embed-mode \.widget-panel\.has-custom-skin\.card-open\s*\{\s*inset:\s*6px/);
  assert.match(previewStyles, /grid-auto-rows:\s*44px;[^}]*padding:\s*5px/);
  assert.match(previewStyles, /agent-option > span[^}]*height:\s*30px/);
  assert.match(previewSource, /function detectSkinTone\(imageUrl\)/);
  assert.match(previewSource, /function detectSkinPalette\(imageUrl\)/);
  assert.match(previewSource, /palette\.brand/);
  assert.match(previewSource, /channel\.employeeItemColorAuto !== false/);
  assert.match(adminSource, /function syncWebsiteColorControls\(\)/);
  assert.match(previewSource, /for \(let y = 23; y < 38; y \+= 1\)/);
  assert.match(previewSource, /data-skin-tone="dark"/);
  assert.match(previewSource, /--website-brand:\$\{websiteBrand\}/);
  assert.match(previewStyles, /data-skin-tone="dark"[^}]*--skin-item-bg:\s*color-mix\(in srgb, var\(--website-brand/);
  assert.match(previewStyles, /data-skin-tone="light"[^}]*--skin-item-bg:\s*color-mix\(in srgb, var\(--website-brand/);
  assert.match(adminSource, /--map-brand-color/);
  assert.doesNotMatch(previewStyles, /has-custom-skin:not\(\.card-open\) \.agent-option[^}]*background:\s*rgba\(255,255,255,\.9\)/);
  assert.match(adminSource, /function detectMapSkinTone\(imageUrl\)/);
  assert.doesNotMatch(previewStyles, /has-custom-skin:not\(\.card-open\)[^{]*\{[^}]*transform:\s*scale/);
  assert.match(previewStyles, /header\s*\{\s*display:\s*none/);
  assert.match(previewStyles, /\.widget-drag-handle\s*\{/);
  assert.match(previewSource, /type:\s*"dclaw:embed-drag"/);
  assert.match(previewSource, /parameters\.set\("previewPerson", deployment\.id\)/);
  assert.match(previewSource, /classList\.toggle\("website-card-surface", cardSurface\)/);
  assert.match(previewSource, /class="chrome-back unified-back-button" title="返回" aria-label="返回"/);
  assert.doesNotMatch(previewSource, /miniapp-menu/);
  assert.doesNotMatch(previewSource, /assistant-company-name/);
  assert.match(previewStyles, /\.unified-back-button::after\s*\{\s*content:\s*"返回"/);
  assert.doesNotMatch(miniappSource, /preview-menu/);
  assert.match(embedSource, /rosterWidth = clamp\(Number\(message\.width\)/);
  assert.match(embedSource, /rosterHeight = clamp\(Number\(message\.height\)/);
  assert.match(embedSource, /message\.type === "dclaw:embed-drag"/);
});

test("agent responses render as plain answer cards and message defaults to customer", () => {
  const answer = renderConversationComponent("assistant-response", { content: "这是 Agent 的直接回复。" });
  const message = renderConversationComponent("message", { content: "这是客户消息。" });
  const miniappCard = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.match(answer, /dclaw-answer-content/);
  assert.doesNotMatch(answer, /component-kicker|<h2>|<p>/);
  assert.match(message, /customer-message/);
  assert.doesNotMatch(message, /agent-message/);
  assert.match(answer, /data-response-action="copy"/);
  assert.match(answer, /aria-label="重新生成回复"/);
  assert.match(answer, /aria-pressed="false"/);
  assert.doesNotMatch(answer, /data-response-action="share"|aria-label="分享回复"/);
  assert.equal(miniappCard.match(/本服务为AI生成内容，结果仅供参考/g)?.length, 2);
  assert.match(miniappCard, /class="ai-page-disclosure front-disclosure" role="note">本服务为AI生成内容，结果仅供参考<\/text>\s*<scroll-view class="conversation-scroll"/);
  assert.match(miniappCard, /class="voice-hint" role="note">本服务为AI生成内容，结果仅供参考/);
  assert.match(miniappCard, /grid-template-rows: auto minmax\(0,1fr\)/);
  assert.doesNotMatch(miniappCard, /company-disclosure/);
});

test("suggested questions have a clear prompt label", () => {
  const suggestions = renderConversationComponent("suggestion-chips", { items: ["你是谁", "怎么合作"] });
  const componentStyles = readFileSync(new URL("../public/components/cards.css", import.meta.url), "utf8");
  assert.match(suggestions, /dclaw-suggestion-title/);
  assert.match(suggestions, />快捷提问<\/span>/);
  assert.match(suggestions, /data-question="你是谁"/);
  assert.match(componentStyles, /\.dclaw-suggestion-group \.question-list\s*\{[^}]*display:\s*grid/);
  assert.match(componentStyles, /\.dclaw-suggestion-group \.question-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(componentStyles, /\.dclaw-suggestion-group \.question-list button\s*\{[^}]*white-space:\s*normal/);
  assert.doesNotMatch(componentStyles, /\.dclaw-suggestion-group \.question-list\s*\{[^}]*overflow-x:\s*auto/);
});

test("business card cover inherits the miniapp channel default across web and miniapp clients", () => {
  const miniapp = getChannelType("miniapp");
  const coverField = miniapp.channelFields.find((field) => field.key === "coverUrl");
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const clientSource = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.equal(coverField?.type, "image");
  assert.equal(coverField?.default, "/console/assets/xiaoding-card-hero-v1.webp");
  assert.equal(miniapp.channelFields.some((field) => ["assistantMascotImageUrl", "assistantScenePosterUrl"].includes(field.key)), false);
  assert.match(previewSource, /config\.coverUrl \|\| channel\.coverUrl \|\| DEFAULT_COVER/);
  assert.match(clientSource, /config\.value\.coverUrl \|\| channel\.value\.coverUrl \|\| DEFAULTS\.cover/);
  assert.doesNotMatch(previewSource, /LEGACY_DEFAULT_COVER/);
  assert.doesNotMatch(clientSource, /LEGACY_DEFAULT_COVER/);
});

test("business card contact fields use address instead of a redundant wechat number", () => {
  const miniapp = getChannelType("miniapp");
  const profileKeys = miniapp.personFields.map((field) => field.key);
  const deploymentKeys = miniapp.deploymentFields.map((field) => field.key);
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  assert.equal(profileKeys.includes("wechat"), false);
  assert.equal(deploymentKeys.includes("wechat"), false);
  assert.equal(profileKeys.indexOf("address"), profileKeys.indexOf("phone") + 1);
  assert.equal(deploymentKeys.indexOf("address"), deploymentKeys.indexOf("phone") + 1);
  assert.doesNotMatch(previewSource, /config\.wechat/);
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
  const miniappComponent = readFileSync(new URL("../clients/channel-app/src/components/conversation/ConversationItem.vue", import.meta.url), "utf8");
  const miniappPage = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.match(miniappComponent, /item\.type === 'attachment-card'/);
  assert.match(miniappComponent, /link-card-image/);
  assert.match(miniappPage, /attachment\.type === "card"/);
});

test("lead-form attachments use the shared interactive lead component", () => {
  const markup = renderConversationComponent("attachment", {
    attachment: { type: "lead-form", id: "contact-form", title: "保持联系", subtitle: "我们将尽快联系您" }
  });
  const miniappCard = readFileSync(new URL("../clients/channel-app/src/pages/card/index.vue", import.meta.url), "utf8");
  assert.match(markup, /data-component="lead-form"/);
  assert.match(markup, /data-action="submit-lead"/);
  assert.match(markup, /component-title dclaw-lead-title/);
  assert.match(miniappCard, /\["single-choice", "multi-choice", "lead-form"\]/);
  assert.match(miniappCard, /displayText: "已提交联系信息"/);
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
  assert.match(previewSource, /data-assistant-text-composer/);
  assert.match(previewSource, /companyKeyboard\?\.addEventListener\("click", \(\) => setCompanyInputMode\("text"\)\)/);
  assert.match(previewSource, /companyTextSend\?\.addEventListener\("click", sendCompanyText\)/);
  assert.match(previewSource, /await appendCompanyConversation\(value\)/);
  assert.doesNotMatch(previewSource, /assistant-user-message|assistant-agent-message|data-assistant-response-action/);
});

test("website roster opens the shared card renderer instead of a separate chat UI", () => {
  const previewSource = readFileSync(new URL("../public/channel-preview/app.js", import.meta.url), "utf8");
  const embedSource = readFileSync(new URL("../public/embed/dclaw-agent.js", import.meta.url), "utf8");
  assert.match(previewSource, /parameters\.get\("surface"\) === "card"/);
  assert.match(previewSource, /data\.cardPresentation\?\.config \|\| data\.channel\.config/);
  assert.match(previewSource, /<iframe data-widget-card-frame/);
  assert.match(previewSource, /data-widget-card-frame title="智能员工名片" allow="microphone;/);
  assert.match(previewSource, /麦克风已授权，请重新按住说话/);
  assert.match(previewSource, /frame\.src = `\/channels\/\$\{encodeURIComponent\(deployment\.publicSlug \|\| "channel-preview"\)\}/);
  assert.match(previewSource, /parameters\.set\("channel", data\.channel\.id\)/);
  assert.match(previewSource, /showRoster\(\);/);
  assert.doesNotMatch(previewSource, /data-widget-launcher|function closeWidget\(/);
  assert.match(embedSource, /var state = "open"/);
  assert.match(embedSource, /state === "card" \? 420 : Math\.min\(rosterWidth/);
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
  assert.match(adminMarkup, /class="primary"[^>]*data-publish-provider="miniapp"[^>]*>[\s\S]*?发布配置/);
  assert.match(adminMarkup, /id="saveMiniappCredential"[^>]*>[\s\S]*?保存小程序配置/);
  assert.match(adminMarkup, /后台显示名称/);
  assert.match(adminSource, /async function saveMiniappCredential\(\)/);
  assert.match(adminSource, /saveMiniappCredential\.addEventListener/);
  assert.match(adminSource, /async function publishProviderConfig\(provider\)/);
  assert.match(adminSource, /await persistProviderConfig\(provider, form\)/);
});
