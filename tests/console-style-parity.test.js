import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const agentStyles = readFileSync(new URL("../public/console/agent.css", import.meta.url), "utf8");

test("console toast keeps the AI customer-service layout and structured content", () => {
  assert.match(app, /className = `toast toast-\$\{config\.type\}`/);
  assert.match(app, /class="toast-icon"/);
  assert.match(app, /class="toast-message"/);
  assert.doesNotMatch(agentStyles, /\.toast\s*\{/);
  assert.match(html, /id="toast" class="toast" role="status" aria-live="polite"/);
});

test("console shell preserves the reference header and conversation workbench structure", () => {
  assert.match(html, /<title>官网名片智能体管理中台<\/title>/);
  assert.match(html, /class="brand-logo" src="\.\.\/admin\/assets\/dclaw-logo\.png" alt="DClaw"/);
  assert.match(html, /<h1>官网名片智能体管理中台<\/h1>/);
  assert.match(styles, /\.brand-logo\s*\{[\s\S]*?width:\s*auto;[\s\S]*?height:\s*44px;[\s\S]*?max-width:\s*min\(40vw, 190px\)/);
  assert.match(html, /id="flowSessionsPanel" class="panel bot-context-panel collapsible-panel"/);
  assert.match(html, /class="section-actions"><button id="refreshConversations"/);
  assert.match(html, /id="conversationChannelTabs" class="segmented flow-session-type-tabs channel-conversation-tabs" role="tablist" aria-label="消息渠道"/);
  assert.doesNotMatch(agentStyles, /height:\s*max\(600px, calc\(100vh - 108px\)\)/);
  assert.doesNotMatch(agentStyles, /\.workspace-tabs\s*\{\s*overflow-x:\s*auto/);
});

test("agent-specific panels do not inherit incompatible reference grids", () => {
  assert.match(agentStyles, /#activationTargets\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(agentStyles, /\.target-option\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(agentStyles, /\.audit-item\s*>\s*\*\s*\{\s*min-width:\s*0/);
  assert.match(agentStyles, /\.audit-item code\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(agentStyles, /@media \(max-width: 1100px\)[\s\S]*?\.console-shell\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(agentStyles, /@media \(max-width: 1100px\)[\s\S]*?\.workspace-tabs\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*auto/);
  assert.match(agentStyles, /@media \(max-width: 1100px\)[\s\S]*?\.flow-workbench\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("conversation workbench restores every supported reference control", () => {
  assert.match(html, /id="conversationDateFilter" type="date"/);
  assert.match(html, /id="conversationTagFilterButton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="conversationTagFilter" multiple hidden/);
  assert.match(app, /function groupEmployeeAccounts\(accounts\)/);
  assert.match(app, /accounts\.filter\(\(account\) => account\.personId && account\.person\)/);
  assert.match(app, /function renderConversationChannelTabs\(\)/);
  assert.match(app, /data-channel-account-id/);
  assert.match(app, /channelLabel\(account\.provider\)/);
  assert.doesNotMatch(app, /请选择一个私聊会话/);
  assert.match(agentStyles, /\.channel-badge\.is-website[^}]*color:\s*#315ee8/);
  assert.match(agentStyles, /\.channel-badge\.is-miniapp[^}]*color:\s*#16885f/);
  assert.match(html, /id="assetsButton"[\s\S]*?资产/);
  assert.match(html, /id="resetConversationButton"/);
  assert.match(html, /id="manualReplyEmojiBar" class="manual-reply-emoji-bar"/);
  assert.match(html, /id="manualReplyAttachmentButton"/);
  assert.match(html, /id="manualReplyAttachmentList"/);
  assert.match(html, /id="manualReplySendButton"/);
  assert.match(agentStyles, /\.session-filter-grid\s*\{[^}]*repeat\(3, minmax\(170px, 210px\)\)/);
  assert.match(app, /function conversationAssets\(conversation\)/);
  assert.match(app, /function uploadManualReplyFile\(file\)/);
  assert.match(app, /function resetConversation\(\)/);
});
