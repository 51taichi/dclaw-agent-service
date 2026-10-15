import test from "node:test";
import assert from "node:assert/strict";
import { adjudicateTagDecision, normalizeStoredTagSchema } from "../src/tags.js";
import { compactFlowForAgent, defaultFlowConfig, normalizeFlowConfig, validateFlowDecision } from "../src/flow-machine.js";
import { validateTagAuditContract } from "../src/tag-audit.js";

test("exclusive one-way tags can advance but cannot regress", () => {
  const schema = normalizeStoredTagSchema({ groups: [{ id: "intent", name: "意向", exclusive: true, oneWay: true, tags: [
    { id: "low", name: "低", condition: "低意向" },
    { id: "high", name: "高", condition: "高意向" }
  ] }] });
  const advanced = adjudicateTagDecision({ schema, currentTags: [{ groupId: "intent", tagId: "low" }], decision: { add: [{ groupId: "intent", tagId: "high", reason: "升级" }] } });
  assert.equal(advanced.nextTags[0].tagId, "high");
  const regressed = adjudicateTagDecision({ schema, currentTags: advanced.nextTags, decision: { add: [{ groupId: "intent", tagId: "low", reason: "降级" }] } });
  assert.equal(regressed.nextTags[0].tagId, "high");
  assert.equal(regressed.rejected[0].reason, "one_way_regression");
});

test("tag audit requires exact customer evidence for every matched customer tag", () => {
  const tagContext = { groups: [{ id: "intent", exclusive: true, oneWay: false, tags: [{ id: "high", evidenceMode: "customer" }] }], currentTags: [] };
  const invalid = validateTagAuditContract({
    tagContext,
    evidenceCandidates: [{ id: "11", text: "我想购买" }],
    evaluation: [{ groupId: "intent", tagId: "high", matched: true, reason: "购买意向", evidenceMessageId: "11", evidenceText: "文本不一致" }],
    decision: { add: [{ groupId: "intent", tagId: "high" }], remove: [] }
  });
  assert.match(invalid.errors.map((item) => item.message).join(" "), /exactly match/);
});

test("flow decision only collects configured fields and follows the configured next node", () => {
  const config = normalizeFlowConfig(defaultFlowConfig("测试"));
  const flowContext = compactFlowForAgent({ machine: { enabled: true, config }, session: { currentNodeId: config.entryNodeId, collectedData: {} } });
  const decision = validateFlowDecision({ nodeCompleted: true, nextNodeId: "invite_next_step", collectedDataPatch: { "客户需求": "报价", "联系方式": "13800000000" }, reason: "信息完整" }, { flowContext });
  assert.equal(decision.nextNodeId, "invite_next_step");
  assert.throws(() => validateFlowDecision({ nodeCompleted: true, nextNodeId: "close_deal", collectedDataPatch: {}, reason: "跳级" }, { flowContext }), /configured next node/);
  assert.throws(() => validateFlowDecision({ nodeCompleted: false, nextNodeId: "", collectedDataPatch: { "未配置字段": "x" } }, { flowContext }), /not configured/);
});
