const catalog = [
  {
    provider: "website",
    name: "官网智能客服",
    description: "通过一段植入脚本在官网展示可展开的多人物客服入口。",
    delivery: "embed-script",
    channelFields: [
      { key: "themeColor", label: "主题色", type: "color", default: "#2a30d8" },
      { key: "position", label: "悬浮位置", type: "select", options: ["right", "left"], default: "right" },
      { key: "launcherLabel", label: "入口文案", type: "text", default: "在线咨询" },
      { key: "rosterLayout", label: "人物入口", type: "select", options: ["avatars", "list"], default: "avatars" },
      { key: "allowedDomains", label: "允许接入域名", type: "textarea", default: "" }
    ],
    deploymentFields: [
      { key: "displayName", label: "渠道展示名称", type: "text", default: "" },
      { key: "avatarUrl", label: "渠道头像", type: "url", default: "" },
      { key: "welcomeMessage", label: "欢迎语", type: "textarea", default: "您好，有什么可以帮您？" },
      { key: "suggestedQuestions", label: "推荐问题", type: "list", default: [] }
    ]
  },
  {
    provider: "miniapp",
    name: "智能体名片",
    description: "生成响应式名片 H5 地址和二维码，后续可由微信小程序 web-view 承载。",
    delivery: "public-url",
    channelFields: [
      { key: "themeColor", label: "主题色", type: "color", default: "#1677ff" },
      { key: "assistantName", label: "助手名称", type: "text", default: "智能助手" },
      { key: "assistantAvatarUrl", label: "助手头像", type: "url", default: "" },
      { key: "leadFormEnabled", label: "启用留资表单", type: "boolean", default: true },
      { key: "voiceEnabled", label: "启用语音入口", type: "boolean", default: false }
    ],
    deploymentFields: [
      { key: "coverUrl", label: "名片封面", type: "url", default: "" },
      { key: "displayName", label: "渠道展示名称", type: "text", default: "" },
      { key: "title", label: "渠道展示职务", type: "text", default: "" },
      { key: "avatarUrl", label: "渠道头像", type: "url", default: "" },
      { key: "welcomeMessage", label: "欢迎语", type: "textarea", default: "您好，很高兴认识您。" },
      { key: "biography", label: "个人介绍", type: "textarea", default: "" },
      { key: "suggestedQuestions", label: "推荐问题", type: "list", default: [] },
      { key: "resources", label: "资料列表", type: "resources", default: [] }
    ]
  }
];

export function listChannelTypes() {
  return structuredClone(catalog);
}

export function getChannelType(provider) {
  const result = catalog.find((item) => item.provider === provider);
  return result ? structuredClone(result) : null;
}

