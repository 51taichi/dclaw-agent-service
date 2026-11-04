const assistantFields = [
  { key: "assistantName", label: "公司助手名称", type: "text", default: "D仔", colorKey: "assistantNameColor", colorDefault: "#29466f" },
  { key: "assistantBrandText", label: "助手页品牌文字", type: "text", default: "DClaw", colorKey: "assistantBrandColor", colorDefault: "#244f92" },
  { key: "assistantAvatarUrl", label: "助手头像", type: "image", default: "/console/assets/ddeer.png" },
  { key: "assistantSceneVideoUrl", label: "公仔动画视频", type: "video", default: "/console/assets/ddeer-office-greeting-rig-v3.mp4" },
  { key: "assistantGreeting", label: "助手欢迎语", type: "text", default: "你好，我是D仔，很高兴为你服务", colorKey: "assistantGreetingColor", colorDefault: "#315078" },
  { key: "assistantPrompt", label: "快捷项目提示", type: "text", default: "你可以这样对我说：", colorKey: "assistantPromptColor", colorDefault: "#60718d" },
  { key: "assistantTopics", label: "环绕快捷话题", type: "list", default: ["集团业务介绍", "课程与服务", "合作咨询", "联系我们"], colorKey: "assistantTopicsColor", colorDefault: "#426086" },
  { key: "assistantPrimaryTitle", label: "左侧项目标题", type: "text", default: "D仔小助手", colorKey: "assistantPrimaryTitleColor", colorDefault: "#ffffff" },
  { key: "assistantPrimaryItems", label: "左侧快捷项目", type: "list", default: ["了解集团服务", "查看课程体系", "领取合作资料"], colorKey: "assistantPrimaryItemsColor", colorDefault: "#28344b" },
  { key: "assistantRecommendedTitle", label: "右侧项目标题", type: "text", default: "专题推荐", colorKey: "assistantRecommendedTitleColor", colorDefault: "#ffffff" },
  { key: "assistantRecommendedItems", label: "右侧快捷项目", type: "list", default: ["热门方案推荐", "企业合作咨询", "预约专属服务"], colorKey: "assistantRecommendedItemsColor", colorDefault: "#28344b" },
  { key: "assistantVoiceLabel", label: "语音按钮文案", type: "text", default: "按住 说话", colorKey: "assistantVoiceLabelColor", colorDefault: "#ffffff" },
  { key: "assistantVoiceHint", label: "语音区提示", type: "text", default: "回答由 AI 生成，内容仅供参考", colorKey: "assistantVoiceHintColor", colorDefault: "#a2a7b1" },
  { key: "leadFormEnabled", label: "启用留资表单", type: "boolean", default: true },
  { key: "voiceEnabled", label: "启用语音入口", type: "boolean", default: true }
];

const profileFields = [
  { key: "coverUrl", label: "顶部背景图", type: "image", default: "/console/assets/moosee-work-serious-scene.png" },
  { key: "companyName", label: "公司名称", type: "text", default: "" },
  { key: "phone", label: "联系电话", type: "text", default: "" },
  { key: "address", label: "联系地址", type: "text", default: "" },
  { key: "email", label: "电子邮箱", type: "text", default: "" },
  { key: "website", label: "官方网站", type: "url", default: "" },
  { key: "qrCodeUrl", label: "联系二维码", type: "image", default: "" },
  { key: "welcomeMessage", label: "欢迎语", type: "textarea", default: "您好，很高兴认识您。" },
  { key: "biography", label: "个人介绍", type: "textarea", default: "" },
  { key: "suggestedQuestions", label: "推荐问题", type: "list", default: [] },
  { key: "resources", label: "资料列表", type: "resources", default: [] },
  { key: "leadFormEnabled", label: "留资表单", type: "optional-boolean", default: "" }
];

const catalog = [
  {
    provider: "website",
    name: "官网智能客服",
    description: "通过一段植入脚本在官网右下角展示多人物客服模块。",
    delivery: "embed-script",
    channelFields: [
      { key: "homepageImageUrl", label: "官网背景图", type: "image", default: "/console/assets/moosee-work-serious-scene.png" },
      { key: "panelSkinImageUrl", label: "定制客服框图片", type: "image", default: "", fullWidth: true, imageSpec: { width: 490, height: 472, transparent: true, topSlice: 262, maxVisibleItems: 3 } },
      { key: "employeeItemColorAuto", label: "自动适配员工卡片配色", type: "boolean", default: true },
      { key: "employeeItemColor", label: "员工卡片主色", type: "color", default: "#315ee8" },
      { key: "employeeActionLabel", label: "员工状态文案", type: "text", default: "在线", colorKey: "employeeActionColor", colorDefault: "#176b54" },
      { key: "employeeAvatarShape", label: "员工头像形状", type: "select", options: ["圆形", "圆角方形"], default: "圆形" },
      { key: "panelBorderColor", label: "标准模板边框", type: "color", default: "#d7deea" },
      { key: "panelShape", label: "标准模板窗口形状", type: "select", options: ["轻圆角", "圆角", "直角"], default: "轻圆角" },
      { key: "allowedDomains", label: "允许接入域名", type: "textarea", default: "", fullWidth: true },
      ...assistantFields
    ],
    personFields: profileFields,
    deploymentFields: [
      { key: "displayName", label: "渠道展示名称", type: "text", default: "" },
      { key: "title", label: "渠道展示职务", type: "text", default: "" },
      { key: "avatarUrl", label: "渠道头像", type: "image", default: "" },
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
      { key: "coverUrl", label: "名片默认顶部背景图", type: "image", default: "/console/assets/xiaoding-card-hero-v1.webp", fullWidth: true },
      ...assistantFields
    ],
    personFields: profileFields,
    deploymentFields: [
      { key: "coverUrl", label: "顶部背景图", type: "image", default: "/console/assets/moosee-work-serious-scene.png" },
      { key: "displayName", label: "渠道展示名称", type: "text", default: "" },
      { key: "title", label: "渠道展示职务", type: "text", default: "" },
      { key: "avatarUrl", label: "渠道头像", type: "image", default: "" },
      { key: "companyName", label: "公司名称", type: "text", default: "" },
      { key: "phone", label: "联系电话", type: "text", default: "" },
      { key: "address", label: "联系地址", type: "text", default: "" },
      { key: "email", label: "电子邮箱", type: "text", default: "" },
      { key: "website", label: "官方网站", type: "url", default: "" },
      { key: "qrCodeUrl", label: "联系二维码", type: "image", default: "" },
      { key: "welcomeMessage", label: "欢迎语", type: "textarea", default: "您好，很高兴认识您。" },
      { key: "biography", label: "个人介绍", type: "textarea", default: "" },
      { key: "suggestedQuestions", label: "推荐问题", type: "list", default: [] },
      { key: "resources", label: "资料列表", type: "resources", default: [] },
      { key: "leadFormEnabled", label: "留资表单", type: "optional-boolean", default: "" }
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

