export function toChineseErrorMessage(value, fallback = "服务处理失败，请稍后重试") {
  const message = String(value?.message || value || "").trim();
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}
