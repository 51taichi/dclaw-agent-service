import test from "node:test";
import assert from "node:assert/strict";
import { applyPresentationPolicy, convertReplyLinksToCards, redactSubmittedContact, requestsLeadForm } from "../src/presentation-policy.js";

test("Markdown and bare HTTP links become rich link cards", () => {
  const markdown = convertReplyLinksToCards({ reply: "方案在这里：[https://example.test/plan](https://example.test/plan)", attachments: [] });
  assert.equal(markdown.reply, "方案在这里：");
  assert.deepEqual(markdown.attachments, [{
    type: "card",
    title: "example.test",
    subtitle: "example.test",
    name: "查看详情",
    url: "https://example.test/plan"
  }]);

  const bare = convertReplyLinksToCards({ reply: "请查看 https://example.test/case。" });
  assert.equal(bare.reply, "请查看。");
  assert.equal(bare.attachments[0].url, "https://example.test/case");
});

test("structured card metadata wins and duplicate reply links are removed", () => {
  const existing = {
    type: "card",
    title: "完整服务方案",
    subtitle: "企业智能化服务与落地案例",
    name: "查看完整方案",
    url: "https://example.test/plan",
    pictureUrl: "https://example.test/cover.jpg"
  };
  const decision = convertReplyLinksToCards({
    reply: "[服务方案](https://example.test/plan)\nhttps://example.test/plan",
    attachments: [existing]
  });
  assert.equal(decision.reply, "");
  assert.deepEqual(decision.attachments, [existing]);
});

test("a generic Agent link attachment is upgraded instead of duplicated", () => {
  const decision = convertReplyLinksToCards({
    reply: "https://example.test/docs",
    attachments: [{ type: "link", url: "https://example.test/docs", name: "产品文档" }]
  });
  assert.equal(decision.attachments.length, 1);
  assert.deepEqual(decision.attachments[0], {
    type: "card",
    url: "https://example.test/docs",
    name: "产品文档",
    title: "产品文档",
    subtitle: "example.test"
  });
});

test("non-HTTP links do not create rich cards", () => {
  const decision = convertReplyLinksToCards({ reply: "[内部操作](javascript:alert(1)) 与 ftp://example.test/file" });
  assert.equal(decision.attachments.length, 0);
});

test("explicit customer intent to leave contact details requests a lead form", () => {
  assert.equal(requestsLeadForm({ message: "哪里可以留微信号" }), true);
  assert.equal(requestsLeadForm({ message: "请安排老师联系我" }), true);
  assert.equal(requestsLeadForm({ message: "你们公司的联系电话是多少" }), false);
  assert.equal(requestsLeadForm({ message: "把你们的微信号发给我" }), false);
});

test("presentation policy adds one lead form and removes conflicting choices", () => {
  const decision = applyPresentationPolicy({
    decision: {
      reply: "可以，请留下联系方式。",
      attachments: [{ type: "single-choice", id: "contact-way", options: [{ label: "微信", value: "wechat" }] }]
    },
    account: { config: {} },
    inboundMessage: { content: "哪里可以留微信号" }
  });
  assert.deepEqual(decision.attachments, [{
    type: "lead-form",
    id: "contact-form",
    title: "保持联系",
    subtitle: "我们将尽快联系您",
    namePlaceholder: "请输入姓名",
    contactPlaceholder: "请输入手机号或微信号",
    submitLabel: "提交"
  }]);
});

test("an explicit channel setting can disable lead forms", () => {
  const decision = applyPresentationPolicy({
    decision: { reply: "请留下联系方式", attachments: [{ type: "lead-form", id: "contact" }] },
    account: { person: { profile: { leadFormEnabled: false } } },
    inboundMessage: { content: "请联系我" }
  });
  assert.deepEqual(decision.attachments, []);
});

test("submitted contact details are not echoed in the Agent reply", () => {
  assert.equal(
    redactSubmittedContact("已收到微信号 wx_test_001，我们会联系您", "客户已同意后续联系；姓名：测试用户；联系方式：wx_test_001"),
    "已收到微信号 已提交的联系方式，我们会联系您"
  );
});
