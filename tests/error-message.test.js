import test from "node:test";
import assert from "node:assert/strict";
import { toChineseErrorMessage } from "../src/error-message.js";

test("user-facing errors keep Chinese detail and hide raw English exceptions", () => {
  assert.equal(toChineseErrorMessage(new Error("fetch failed"), "网络连接失败"), "网络连接失败");
  assert.equal(toChineseErrorMessage(new Error("渠道账号不存在"), "服务处理失败"), "渠道账号不存在");
  assert.equal(toChineseErrorMessage("SQLITE_CONSTRAINT_UNIQUE", "保存失败，请检查填写内容"), "保存失败，请检查填写内容");
});
