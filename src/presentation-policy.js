const CHOICE_TYPES = new Set(["single-choice", "multi-choice"]);

const DEFAULT_LEAD_FORM = Object.freeze({
  type: "lead-form",
  id: "contact-form",
  title: "保持联系",
  subtitle: "我们将尽快联系您",
  namePlaceholder: "请输入姓名",
  contactPlaceholder: "请输入手机号或微信号",
  submitLabel: "提交"
});

export function applyPresentationPolicy({ decision, account, inboundMessage }) {
  const sanitizedDecision = convertReplyLinksToCards({
    ...decision,
    reply: redactSubmittedContact(decision?.reply, inboundMessage?.content)
  });
  const attachments = Array.isArray(sanitizedDecision.attachments) ? sanitizedDecision.attachments : [];
  const configuredLeadForm = attachments.find((item) => item?.type === "lead-form");
  if (!leadFormEnabled(account)) {
    return { ...sanitizedDecision, attachments: attachments.filter((item) => item?.type !== "lead-form") };
  }

  const shouldShowLeadForm = Boolean(configuredLeadForm) || requestsLeadForm({
    message: inboundMessage?.content,
    reply: sanitizedDecision.reply
  });
  if (!shouldShowLeadForm) return { ...sanitizedDecision, attachments };

  const leadForm = {
    ...DEFAULT_LEAD_FORM,
    ...(configuredLeadForm || {}),
    type: "lead-form"
  };
  return {
    ...sanitizedDecision,
    attachments: [
      ...attachments.filter((item) => item?.type !== "lead-form" && !CHOICE_TYPES.has(item?.type)),
      leadForm
    ]
  };
}

export function convertReplyLinksToCards(decision = {}) {
  const attachments = (Array.isArray(decision.attachments) ? structuredClone(decision.attachments) : []).map((item) => {
    const url = normalizeHttpUrl(item?.url);
    if (!url || !["link", "url"].includes(String(item?.type || "").toLowerCase())) return item;
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    return {
      ...item,
      type: "card",
      title: item.title || item.name || hostname || "查看详情",
      subtitle: item.subtitle || hostname,
      name: item.name || "查看详情",
      url
    };
  });
  const cardUrls = new Set(attachments
    .map((item) => normalizeHttpUrl(item?.url))
    .filter(Boolean));
  const discovered = [];
  const addCard = (urlValue, label = "") => {
    const url = normalizeHttpUrl(urlValue);
    if (!url || cardUrls.has(url)) return;
    cardUrls.add(url);
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const cleanLabel = String(label || "").trim();
    const title = cleanLabel && normalizeHttpUrl(cleanLabel) !== url ? cleanLabel : hostname;
    discovered.push({
      type: "card",
      title: title || "查看详情",
      subtitle: hostname,
      name: "查看详情",
      url
    });
  };

  let reply = String(decision.reply || "");
  reply = reply.replace(/\[([^\]\n]{1,500})\]\((https?:\/\/[^\s)]+)\)/giu, (_match, label, url) => {
    addCard(url, label);
    return "";
  });
  reply = reply.replace(/https?:\/\/[^\s<>{}\[\]"']+/giu, (match) => {
    const trailing = match.match(/[),.!?;:，。！？；：]+$/u)?.[0] || "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    addCard(url);
    return trailing;
  });
  reply = reply
    .replace(/[ \t]+([，。！？；：,.!?;:])/gu, "$1")
    .replace(/^[ \t]+|[ \t]+$/gmu, "")
    .replace(/^\s*(?:链接|查看链接|详情链接|网址|地址)[：:]?\s*$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return { ...decision, reply, attachments: [...attachments, ...discovered] };
}

export function redactSubmittedContact(reply, inboundMessage) {
  const submission = /客户已同意后续联系；姓名：[^；]{1,120}；联系方式：(.{1,200})$/u.exec(String(inboundMessage || "").trim());
  const contact = submission?.[1]?.trim();
  if (!contact) return String(reply || "");
  return String(reply || "").split(contact).join("已提交的联系方式");
}

export function requestsLeadForm({ message = "", reply = "" } = {}) {
  const customerText = compactText(message);
  const agentText = compactText(reply);
  const contact = "(?:微信(?:号)?|手机号|手机号码|电话号码|电话|联系方式)";
  const leave = "(?:留(?:下)?|填写|提交|登记|提供)";
  const customerPatterns = [
    new RegExp(`(?:我|本人|客户).{0,8}${leave}.{0,10}${contact}`),
    new RegExp(`(?:哪里|在哪|怎么|如何|可以|能否|想|需要).{0,10}${leave}.{0,10}${contact}`),
    new RegExp(`${contact}.{0,8}(?:可以|能|要|想)?${leave}.{0,8}(?:吗|呢|这里|这边|给你|给您|给客服|在)`),
    /(?:请|让|安排|希望).{0,12}(?:联系我|加我微信|给我打电话|和我沟通|与我沟通)/,
    /(?:我想|我希望|我需要).{0,12}(?:合作|预约|咨询|沟通|对接).{0,12}(?:联系|沟通|对接)/
  ];
  if (customerPatterns.some((pattern) => pattern.test(customerText))) return true;

  const agentPatterns = [
    new RegExp(`(?:请|可以|建议|方便的话).{0,12}${leave}.{0,10}${contact}`),
    new RegExp(`${leave}.{0,8}${contact}.{0,12}(?:后续联系|安排联系|与您联系|联系您|方便沟通)`)
  ];
  return agentPatterns.some((pattern) => pattern.test(agentText));
}

function leadFormEnabled(account) {
  const candidates = [
    account?.person?.profile?.leadFormEnabled,
    account?.assistantProfile?.leadFormEnabled,
    account?.config?.leadFormEnabled
  ];
  const configured = candidates.find((value) => typeof value === "boolean");
  return configured ?? true;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, "").slice(0, 2000);
}

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}
