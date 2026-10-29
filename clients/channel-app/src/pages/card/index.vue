<template>
  <view class="page-shell">
    <view v-if="loading" class="center-state"><text>正在加载名片...</text></view>
    <view v-else-if="error" class="center-state error-state"><text>{{ error }}</text><button class="retry-button" @tap="loadChannel">重新加载</button></view>

    <view v-else class="card-stage">
      <view class="face front-face" :class="{ hidden: face !== 'front' }">
        <view class="hero" :class="{ compact: !heroExpanded }" :style="heroStyle">
          <view class="miniapp-chrome">
            <button class="back-button">‹</button>
            <!-- #ifdef H5 -->
            <text class="preview-menu">•••　◉</text>
            <!-- #endif -->
          </view>
          <view class="identity">
            <image class="profile-avatar" :src="profile.avatar" mode="aspectFill" />
            <view class="identity-copy"><view class="name-row"><text>{{ profile.name }}</text><text class="online">在线</text></view><text class="identity-meta">{{ profile.title }} · {{ companyName }}</text></view>
          </view>
          <view class="compact-identity">
            <image class="compact-avatar" :src="profile.avatar" mode="aspectFill" />
            <view class="identity-copy"><view class="name-row"><text>{{ profile.name }}</text><text class="online">在线</text></view><text class="identity-meta">{{ profile.title }} · {{ companyName }}</text></view>
          </view>
          <view class="contact-panel">
            <view class="contact-row first-row"><view v-if="config.website" class="contact"><AppIcon name="link" tone="white" :size="15" /><text class="contact-value">{{ cleanWebsite }}</text></view><view v-if="config.email" class="contact"><AppIcon name="mail" tone="white" :size="15" /><text class="contact-value">{{ config.email }}</text></view></view>
            <view class="contact-row second-row"><view v-if="config.address" class="contact"><AppIcon name="map-pin" tone="white" :size="15" /><text class="contact-value">{{ config.address }}</text></view><view v-if="config.phone" class="contact"><AppIcon name="phone" tone="white" :size="15" /><text class="contact-value">{{ config.phone }}</text></view><button v-if="config.qrCodeUrl" class="qr-button" aria-label="放大联系二维码" @tap="openQr"><image class="qr-image" :src="asset(config.qrCodeUrl)" mode="aspectFit" /></button></view>
          </view>
          <button class="hero-toggle" :aria-label="heroExpanded ? '收起名片' : '展开名片'" @tap="heroExpanded = !heroExpanded"><text class="toggle-chevron" :class="{ down: !heroExpanded }"></text></button>
        </view>

        <view v-if="qrOpen" class="qr-lightbox" role="dialog" aria-label="联系二维码">
          <button class="qr-lightbox-backdrop" aria-label="关闭二维码" @tap="qrOpen = false"></button>
          <view class="qr-lightbox-card">
            <button class="qr-lightbox-close" aria-label="关闭二维码" @tap="qrOpen = false">×</button>
            <image class="qr-lightbox-image" :src="asset(config.qrCodeUrl)" mode="aspectFit" show-menu-by-longpress />
            <text class="qr-lightbox-title">扫码联系</text>
            <text class="qr-lightbox-hint">长按或截图保存二维码</text>
          </view>
        </view>

        <scroll-view class="conversation-scroll" scroll-y :scroll-into-view="frontScrollTarget">
          <view class="conversation-list">
            <ConversationItem v-for="item in frontMessages" :key="item.id" :item="item" @action="handleAction" @question="sendFrontText" @choice="submitFrontChoice" @lead="submitFrontLead" @open="openResource" />
            <view id="front-bottom" class="scroll-anchor"></view>
          </view>
        </scroll-view>

        <view class="composer" :class="{ 'is-recording': recording }">
          <view v-if="recording" class="recording-status" :class="{ 'will-cancel': recordingCanceled }"><view class="recording-dot"></view><text>{{ recordingCanceled ? '松开取消' : '松开发送，上滑取消' }}</text><text class="recording-time">00:{{ String(recordingSeconds).padStart(2, '0') }}</text></view>
          <view class="composer-shell" :class="{ 'has-text': frontInput.trim(), 'voice-mode': inputMode === 'voice', 'voice-disabled': !voiceEnabled }">
            <button v-if="!frontInput.trim()" class="tool-button" aria-label="拍照或选择图片" @tap="chooseImage"><AppIcon name="camera" tone="dark" :size="22" /></button>
            <input v-if="inputMode === 'text'" class="message-input" v-model="frontInput" confirm-type="send" placeholder="发消息..." @confirm="sendFrontText(frontInput)" />
            <button v-else class="voice-hold" :class="{ active: recording }" @touchstart.prevent="startRecording" @touchmove.stop.prevent="moveRecording" @touchend.prevent="finishRecording(false)" @touchcancel.prevent="finishRecording(true)" @mousedown.prevent="startRecording" @mouseup.prevent="finishRecording(false)" @mouseleave="finishRecording(true)">按住说话</button>
            <button v-if="frontInput.trim()" class="send-button" aria-label="发送消息" @tap="sendFrontText(frontInput)"><AppIcon name="send" tone="white" :size="21" /></button>
            <button v-else-if="inputMode === 'text' && voiceEnabled" class="tool-button" aria-label="切换语音输入" @tap="enterVoiceMode"><AppIcon name="mic" tone="dark" :size="22" /></button>
            <button v-else class="tool-button" aria-label="切换文字输入" @tap="setTextInputMode"><AppIcon name="keyboard" tone="dark" :size="22" /></button>
            <button v-if="!frontInput.trim()" class="tool-button" aria-label="更多功能"><AppIcon name="plus" tone="dark" :size="22" /></button>
          </view>
        </view>
      </view>

      <view class="face back-face" :class="{ hidden: face !== 'back', 'has-video': assistant.video }">
        <video
          v-if="assistant.video && face === 'back'"
          class="scene-video"
          :src="assistant.video"
          :poster="assistant.poster"
          autoplay
          loop
          muted
          :controls="false"
          :show-center-play-btn="false"
          :show-play-btn="false"
          :enable-progress-gesture="false"
          object-fit="cover"
        />
        <image v-else class="scene-image" :src="assistant.image" mode="aspectFit" />
        <scroll-view class="assistant-scroll" scroll-y :scroll-into-view="backScrollTarget">
          <view class="assistant-content">
            <view class="assistant-scene">
              <view class="scene-overlay">
                <view class="miniapp-chrome">
                  <button class="back-button" @tap="face = 'front'">‹</button>
                  <!-- #ifdef H5 -->
                  <text class="preview-menu">•••　◉</text>
                  <!-- #endif -->
                </view>
                <text class="scene-brand">{{ assistant.brand }}</text>
                <view class="speech"><text>{{ assistant.greeting }}</text></view>
                <view class="topic-cloud"><button v-for="topic in assistant.topics" :key="topic" class="topic-button" @tap="sendCompanyText(topic)">{{ topic }} ›</button></view>
              </view>
            </view>

            <view class="shortcut-area">
              <text class="shortcut-prompt">{{ assistant.prompt }}</text>
              <view class="shortcut-grid"><view class="shortcut-group"><text class="shortcut-title primary-title">{{ assistant.primaryTitle }}</text><button v-for="item in assistant.primaryItems" :key="item" class="shortcut-button" @tap="sendCompanyText(item)"><text>{{ item }}</text><text>›</text></button></view><view class="shortcut-group"><text class="shortcut-title secondary-title">{{ assistant.recommendedTitle }}</text><button v-for="item in assistant.recommendedItems" :key="item" class="shortcut-button" @tap="sendCompanyText(item)"><text>{{ item }}</text><text>›</text></button></view></view>
            </view>

            <view v-if="companyMessages.length" class="company-conversation">
              <ConversationItem v-for="item in companyMessages" :key="item.id" :item="item" @action="handleAction" @question="sendCompanyText" @choice="submitCompanyChoice" @lead="submitCompanyLead" @open="openResource" />
              <view id="back-bottom" class="scroll-anchor"></view>
            </view>
          </view>
        </scroll-view>

        <view v-if="voiceEnabled" class="voice-dock"><button class="voice-button" :class="{ active: recording && recordingFace === 'back' }" @touchstart.prevent="startRecording" @touchmove.stop.prevent="moveRecording" @touchend.prevent="finishRecording(false)" @touchcancel.prevent="finishRecording(true)" @mousedown.prevent="startRecording" @mouseup.prevent="finishRecording(false)" @mouseleave="finishRecording(true)"><AppIcon name="mic" tone="white" :size="20" /><text>{{ recording && recordingFace === 'back' ? (recordingCanceled ? '松开取消' : '松开发送，上滑取消') : assistant.voiceLabel }}</text><AppIcon name="keyboard" tone="white" :size="20" /></button><text class="voice-hint">{{ assistant.voiceHint }}</text></view>
      </view>

      <button class="face-switch" :style="faceSwitchStyle" :aria-label="face === 'front' ? `查看${companyName}公司名片` : `返回${profile.name}的名片`" @tap="toggleFace" @touchstart="startFaceDrag" @touchmove.stop.prevent="moveFaceDrag" @touchend="endFaceDrag"><text class="switch-label">{{ face === 'front' ? assistant.name : profile.name }}</text><image class="switch-avatar" :src="face === 'front' ? assistant.avatar : profile.avatar" mode="aspectFill" /><view class="switch-badge"><AppIcon name="rotate" tone="white" :size="11" /></view></button>

      <!-- #ifdef MP-WEIXIN -->
      <view v-if="wechatLoginVisible && !loading" class="wechat-login" role="dialog" aria-label="微信登录">
        <button class="wechat-login-backdrop" aria-label="暂不授权" @tap="skipWechatLogin"></button>
        <view class="wechat-login-panel">
          <button v-if="wechatProfileStep === 'profile'" class="wechat-avatar-picker" open-type="chooseAvatar" aria-label="选择微信头像" @chooseavatar="chooseWechatAvatar"><image class="wechat-login-avatar" :src="wechatAvatarDraft || profile.avatar" mode="aspectFill" /><text>选择头像</text></button>
          <image v-else class="wechat-login-avatar" :src="profile.avatar" mode="aspectFill" />
          <text class="wechat-login-title">{{ wechatProfileStep === 'profile' ? '确认微信资料' : `欢迎查看${profile.name}的名片` }}</text>
          <text class="wechat-login-copy">{{ wechatProfileStep === 'profile' ? '请选择头像并确认用于本次会话的微信昵称' : '登录后将在会话中显示你确认的微信昵称' }}</text>
          <input v-if="wechatProfileStep === 'profile'" class="wechat-nickname-input" v-model="wechatNicknameDraft" type="nickname" maxlength="32" placeholder="微信昵称" confirm-type="done" @confirm="saveWechatProfile" />
          <button v-if="wechatProfileStep === 'login'" class="wechat-login-primary" :loading="wechatLoginPending" :disabled="wechatLoginPending" @tap="authorizeWechatProfile">微信登录</button>
          <button v-else class="wechat-login-primary" :loading="wechatLoginPending" :disabled="wechatLoginPending || !wechatNicknameDraft.trim()" @tap="saveWechatProfile">进入名片</button>
          <button class="wechat-login-secondary" :disabled="wechatLoginPending" @tap="skipWechatLogin">暂不授权</button>
        </view>
      </view>
      <!-- #endif -->
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import { onLoad, onReady, onShareAppMessage } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import ConversationItem from "../../components/conversation/ConversationItem.vue";
import { copyText, createId, createVoiceRecorder, persistentId, prepareImageAsset, request, requestRecordPermission, resolveAssetUrl, showToast, uploadBinary } from "../../runtime/index.js";

const DEFAULTS = {
  cover: "/console/assets/moosee-work-serious-scene.png",
  avatar: "/console/assets/bot-avatar.png",
  mascot: "/console/assets/ddeer.png",
  scene: "/console/assets/ddeer-transparent.png",
  video: "/console/assets/ddeer-office-greeting-rig-v3.mp4",
  poster: "/console/assets/ddeer-office-greeting-rig-poster-v3.jpg"
};
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const options = reactive({ slug: "wuhe-assistant", deployment: "" });
const data = ref(null);
const loading = ref(true);
const error = ref("");
const face = ref("front");
const heroExpanded = ref(true);
const qrOpen = ref(false);
const frontInput = ref("");
const inputMode = ref("text");
const frontMessages = ref([]);
const companyMessages = ref([]);
const preparedAssets = reactive({});
const frontScrollTarget = ref("");
const backScrollTarget = ref("");
const outboxAfter = ref(0);
const companyOutboxAfter = ref(0);
const recording = ref(false);
const recordingCanceled = ref(false);
const recordingSeconds = ref(0);
const recordingFace = ref("front");
const recordPermissionGranted = ref(false);
const requestingRecordPermission = ref(false);
const WECHAT_PROFILE_STORAGE_KEY = "dclaw:uni:wechat-profile";
const WECHAT_SESSION_STORAGE_KEY = "dclaw:uni:wechat-session";
const WECHAT_LOGIN_SKIPPED_KEY = "dclaw:uni:wechat-login-skipped";
const storedWechatProfile = uni.getStorageSync(WECHAT_PROFILE_STORAGE_KEY) || {};
const wechatNickname = ref(String(storedWechatProfile.nickName || "").trim());
const wechatNicknameDraft = ref("");
const wechatAvatarDraft = ref(String(storedWechatProfile.avatarUrl || ""));
const wechatLoginVisible = ref(false);
const wechatLoginPending = ref(false);
const wechatProfileStep = ref("login");
const faceSwitchRatio = ref(Number(uni.getStorageSync("dclaw:face-switch-ratio")) || 0.54);
const conversationId = persistentId("dclaw:uni:conversation");
const userId = persistentId("dclaw:uni:user");
const companyConversationId = persistentId("dclaw:uni:company-conversation");
const companyUserId = persistentId("dclaw:uni:company-user");
let recorder = null;
let recordingStartedAt = 0;
let recordingStartY = 0;
let recordingTimer = null;
let lastTouchStartedAt = 0;
let stageRect = null;
let dragStartY = 0;
let dragStartRatio = 0;
let faceSwitchDragged = false;
let outboxReady = Promise.resolve(null);
let companyOutboxReady = Promise.resolve(null);

const channel = computed(() => data.value?.channel?.config || {});
const config = computed(() => data.value?.deployment?.config || {});
const companyName = computed(() => config.value.companyName || data.value?.workspace?.name || "公司");
const profile = computed(() => ({
  name: config.value.displayName || data.value?.person?.name || data.value?.deployment?.personName || "智能员工",
  title: config.value.title || data.value?.person?.title || data.value?.deployment?.personTitle || "智能员工",
  avatar: asset(config.value.avatarUrl || data.value?.person?.avatarUrl || data.value?.deployment?.avatarUrl || DEFAULTS.avatar)
}));
const cleanWebsite = computed(() => String(config.value.website || "").replace(/^https?:\/\//, "").replace(/\/$/, ""));
const heroStyle = computed(() => `background-image:linear-gradient(180deg,rgba(4,12,31,.1),rgba(4,12,31,.88)),url('${asset(config.value.coverUrl || DEFAULTS.cover)}')`);
const faceSwitchStyle = computed(() => `top:${Math.round(faceSwitchRatio.value * 1000) / 10}%;`);
const voiceEnabled = computed(() => channel.value.voiceEnabled !== false);
const assistant = computed(() => {
  const name = channel.value.assistantName || "D仔";
  return {
    name,
    brand: channel.value.assistantBrandText || "DClaw",
    avatar: asset(channel.value.assistantAvatarUrl || DEFAULTS.mascot),
    video: asset(hasOwn(channel.value, "assistantSceneVideoUrl") ? channel.value.assistantSceneVideoUrl : DEFAULTS.video),
    poster: asset(hasOwn(channel.value, "assistantScenePosterUrl") ? channel.value.assistantScenePosterUrl : DEFAULTS.poster),
    image: asset(channel.value.assistantMascotImageUrl || channel.value.assistantSceneImageUrl || DEFAULTS.scene),
    greeting: channel.value.assistantGreeting || `你好，我是${name}，很高兴为你服务`,
    prompt: channel.value.assistantPrompt || "你可以这样对我说：",
    topics: channel.value.assistantTopics || ["集团业务介绍", "课程与服务", "合作咨询", "联系我们"],
    primaryTitle: channel.value.assistantPrimaryTitle || `${name}小助手`,
    primaryItems: channel.value.assistantPrimaryItems || ["了解集团服务", "查看课程体系", "领取合作资料"],
    recommendedTitle: channel.value.assistantRecommendedTitle || "专题推荐",
    recommendedItems: channel.value.assistantRecommendedItems || ["热门方案推荐", "企业合作咨询", "预约专属服务"],
    voiceLabel: channel.value.assistantVoiceLabel || "按住 说话",
    voiceHint: channel.value.assistantVoiceHint || "回答由 AI 生成，内容仅供参考"
  };
});

onLoad((query = {}) => {
  options.slug = query.slug || "wuhe-assistant";
  options.deployment = query.deployment || "";
  // #ifdef MP-WEIXIN
  wechatLoginVisible.value = !wechatNickname.value && uni.getStorageSync(WECHAT_LOGIN_SKIPPED_KEY) !== true;
  // #endif
  loadChannel();
});

onReady(measureStage);

onShareAppMessage(() => ({ title: `${profile.value.name} · ${companyName.value}`, path: `/pages/card/index?slug=${encodeURIComponent(options.slug)}` }));

function asset(value) { return preparedAssets[value] || resolveAssetUrl(value); }
function message(type, payload = {}) { return { id: createId(), type, ...payload }; }
function conversationDisplayName(company) { return wechatNickname.value || (company ? "公司名片访客" : "名片访客"); }

function persistWechatProfile(nickName, avatarUrl = "") {
  const normalizedName = String(nickName || "").trim().slice(0, 32);
  if (!normalizedName) return false;
  uni.setStorageSync(WECHAT_PROFILE_STORAGE_KEY, { nickName: normalizedName, avatarUrl: String(avatarUrl || "") });
  uni.removeStorageSync(WECHAT_LOGIN_SKIPPED_KEY);
  wechatNickname.value = normalizedName;
  wechatLoginVisible.value = false;
  return true;
}

function requestWechatLogin() {
  return new Promise((resolve, reject) => {
    if (typeof uni.login !== "function") return reject(new Error("当前微信版本不支持登录"));
    uni.login({ provider: "weixin", success: resolve, fail: reject });
  });
}

async function authorizeWechatProfile() {
  if (wechatLoginPending.value) return;
  wechatLoginPending.value = true;
  try {
    const loginResult = await requestWechatLogin();
    const session = await request("/api/public/wechat/login", {
      method: "POST",
      data: { code: loginResult.code, publicSlug: options.slug, deploymentId: options.deployment }
    });
    uni.setStorageSync(WECHAT_SESSION_STORAGE_KEY, session.sessionToken);
    const nickName = String(session.profile?.nickName || "").trim();
    if (nickName) persistWechatProfile(nickName, session.profile?.avatarUrl || "");
    else {
      wechatNicknameDraft.value = "";
      wechatAvatarDraft.value = "";
      wechatProfileStep.value = "profile";
    }
  } catch (loginError) {
    showToast(loginError.message || "微信登录失败，请重试");
  } finally {
    wechatLoginPending.value = false;
  }
}

function chooseWechatAvatar(event) {
  wechatAvatarDraft.value = String(event?.detail?.avatarUrl || "");
}

async function saveWechatProfile() {
  const nickName = String(wechatNicknameDraft.value || "").trim().slice(0, 32);
  if (!nickName) return showToast("请先选择或填写微信昵称");
  const sessionToken = String(uni.getStorageSync(WECHAT_SESSION_STORAGE_KEY) || "");
  if (!sessionToken) {
    wechatProfileStep.value = "login";
    return showToast("微信登录状态已失效，请重新登录");
  }
  wechatLoginPending.value = true;
  try {
    let avatarUrl = wechatAvatarDraft.value;
    if (avatarUrl && !/^https?:/i.test(avatarUrl) && !avatarUrl.startsWith("/media/")) {
      const uploaded = await uploadBinary(data.value?.endpoints?.publicMedia, {
        filePath: avatarUrl,
        name: `wechat-avatar-${Date.now()}.jpg`,
        mimeType: "image/jpeg"
      });
      avatarUrl = uploaded.attachment?.url || "";
    }
    const saved = await request("/api/public/wechat/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { nickName, avatarUrl }
    });
    wechatAvatarDraft.value = saved.profile?.avatarUrl || avatarUrl;
    persistWechatProfile(saved.profile?.nickName || nickName, wechatAvatarDraft.value);
  } catch (profileError) {
    showToast(profileError.message || "微信资料保存失败");
  } finally {
    wechatLoginPending.value = false;
  }
}

function skipWechatLogin() {
  if (wechatLoginPending.value) return;
  uni.setStorageSync(WECHAT_LOGIN_SKIPPED_KEY, true);
  wechatLoginVisible.value = false;
}

async function preparePageImages() {
  const values = [
    config.value.coverUrl || DEFAULTS.cover,
    config.value.avatarUrl || data.value?.person?.avatarUrl || data.value?.deployment?.avatarUrl || DEFAULTS.avatar,
    config.value.qrCodeUrl,
    channel.value.assistantAvatarUrl || DEFAULTS.mascot,
    channel.value.assistantMascotImageUrl || channel.value.assistantSceneImageUrl || DEFAULTS.scene,
    hasOwn(channel.value, "assistantScenePosterUrl") ? channel.value.assistantScenePosterUrl : DEFAULTS.poster
  ].filter(Boolean);
  await Promise.all([...new Set(values)].map(async (value) => { preparedAssets[value] = await prepareImageAsset(value); }));
}

async function loadChannel() {
  loading.value = true;
  error.value = "";
  try {
    const endpoint = options.deployment ? `/api/admin/deployments/${encodeURIComponent(options.deployment)}/preview` : `/api/public/channels/${encodeURIComponent(options.slug)}`;
    data.value = await request(endpoint);
    outboxReady = primeOutboxCursor(data.value?.endpoints?.publicOutbox, conversationId, outboxAfter).catch((syncError) => syncError);
    companyOutboxReady = primeOutboxCursor(data.value?.endpoints?.assistantOutbox, companyConversationId, companyOutboxAfter).catch((syncError) => syncError);
    await preparePageImages();
    const welcome = config.value.welcomeMessage || `您好，我是${profile.value.name}，很高兴认识您。`;
    const biography = config.value.biography || `我是${profile.value.name}，将结合${companyName.value}的业务资料，为您提供清晰、准确的解答。`;
    frontMessages.value = [
      message("assistant-response", { content: `${welcome}\n\n${biography}` }),
      ...(config.value.suggestedQuestions?.length ? [message("suggestion-chips", { items: config.value.suggestedQuestions })] : []),
      ...(config.value.resources?.length ? [message("resource-list", { items: config.value.resources })] : [])
    ];
  } catch (loadError) {
    error.value = loadError.message || "名片加载失败";
  } finally {
    loading.value = false;
    nextTick(measureStage);
  }
}

function measureStage() {
  uni.createSelectorQuery().select(".card-stage").boundingClientRect((rect) => { if (rect) stageRect = rect; }).exec();
}

function touchY(event) { return Number(event?.touches?.[0]?.clientY ?? event?.changedTouches?.[0]?.clientY ?? 0); }

function startFaceDrag(event) {
  if (!stageRect) measureStage();
  dragStartY = touchY(event);
  dragStartRatio = faceSwitchRatio.value;
  faceSwitchDragged = false;
}

function moveFaceDrag(event) {
  if (!stageRect?.height || !dragStartY) return;
  const delta = touchY(event) - dragStartY;
  if (Math.abs(delta) > 5) faceSwitchDragged = true;
  faceSwitchRatio.value = Math.min(0.88, Math.max(0.14, dragStartRatio + delta / stageRect.height));
}

function endFaceDrag() {
  if (faceSwitchDragged) uni.setStorageSync("dclaw:face-switch-ratio", faceSwitchRatio.value);
  dragStartY = 0;
}

function toggleFace() {
  if (faceSwitchDragged) { faceSwitchDragged = false; return; }
  face.value = face.value === "front" ? "back" : "front";
}

function scrollConversation(targetRef, target) {
  targetRef.value = "";
  nextTick(() => { targetRef.value = target; });
}

function appendAgentReply(target, content, attachments = []) {
  if (content) target.value.push(message("assistant-response", { content }));
  for (const attachment of attachments || []) {
    if (["single-choice", "multi-choice"].includes(attachment.type)) target.value.push(message(attachment.type, { ...attachment }));
    else target.value.push(message("attachment", { attachment }));
  }
}

function conversationOutboxUrl(endpoint, activeConversationId, after) {
  return endpoint.replace("{conversationId}", encodeURIComponent(activeConversationId)).replace(/after=\d+/, `after=${after}`);
}

async function primeOutboxCursor(endpoint, activeConversationId, after) {
  if (!endpoint || !activeConversationId) return;
  let cursor = 0;
  while (true) {
    const outbox = await request(conversationOutboxUrl(endpoint, activeConversationId, cursor));
    const items = Array.isArray(outbox.items) ? outbox.items : [];
    const next = items.reduce((value, item) => Math.max(value, Number(item.id || 0)), cursor);
    after.value = next;
    if (items.length < 100 || next <= cursor) return;
    cursor = next;
  }
}

async function withAgentLoading(target, scrollTarget, scrollAnchor, task) {
  const loadingMessage = message("assistant-loading");
  target.value.push(loadingMessage);
  scrollConversation(scrollTarget, scrollAnchor);
  try {
    return await task();
  } finally {
    const index = target.value.findIndex((item) => item.id === loadingMessage.id);
    if (index >= 0) target.value.splice(index, 1);
    scrollConversation(scrollTarget, scrollAnchor);
  }
}

async function deliver({ text, type = "text", attachments = [] }, surface = "front") {
  const company = surface === "back";
  const messageEndpoint = company ? data.value?.endpoints?.assistantMessages : data.value?.endpoints?.publicMessages;
  const outboxEndpoint = company ? data.value?.endpoints?.assistantOutbox : data.value?.endpoints?.publicOutbox;
  const activeConversationId = company ? companyConversationId : conversationId;
  const activeUserId = company ? companyUserId : userId;
  if (!messageEndpoint || !outboxEndpoint) return { content: company ? `我是${assistant.value.name}，已收到你的语音。` : config.value.welcomeMessage || "收到，我会继续为您介绍。", attachments: [] };
  const syncError = await (company ? companyOutboxReady : outboxReady);
  if (syncError) throw new Error("会话同步失败，请重试");
  const result = await request(messageEndpoint, { method: "POST", data: { conversationId: activeConversationId, userId: activeUserId, displayName: conversationDisplayName(company), message: { id: createId(), type, text, attachments } } });
  const failed = result.items?.find((item) => item.handledBy === "error");
  if (failed) throw new Error(failed.error || "Agent 暂时无法回复");
  const after = company ? companyOutboxAfter : outboxAfter;
  const outboxUrl = conversationOutboxUrl(outboxEndpoint, activeConversationId, after.value);
  const outbox = await request(outboxUrl);
  const replies = outbox.items || [];
  replies.forEach((item) => { after.value = Math.max(after.value, Number(item.id || 0)); });
  return { content: replies.map((item) => item.content).filter(Boolean).join("\n\n"), attachments: replies.flatMap((item) => item.attachments || []) };
}

async function sendFrontText(raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  frontInput.value = "";
  heroExpanded.value = false;
  frontMessages.value.push(message("message", { role: "customer", content: text }));
  scrollConversation(frontScrollTarget, "front-bottom");
  try {
    const reply = await withAgentLoading(frontMessages, frontScrollTarget, "front-bottom", () => deliver({ text }));
    appendAgentReply(frontMessages, reply.content || "收到，我会继续为您介绍。", reply.attachments);
  } catch (sendError) { showToast(sendError.message); }
  scrollConversation(frontScrollTarget, "front-bottom");
}

async function sendCompanyText(raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  companyMessages.value.push(message("message", { role: "customer", content: text }));
  scrollConversation(backScrollTarget, "back-bottom");
  try {
    const reply = await withAgentLoading(companyMessages, backScrollTarget, "back-bottom", () => deliver({ text }, "back"));
    appendAgentReply(companyMessages, reply.content || `关于“${text}”，${assistant.value.name}可以结合${companyName.value}的资料为你继续介绍。`, reply.attachments);
  } catch (sendError) { showToast(sendError.message); }
  scrollConversation(backScrollTarget, "back-bottom");
}

function submitChoice(target, payload) {
  payload.item.selectedValues = payload.values;
  payload.item.submitted = true;
  const answer = payload.labels.join("、");
  target === frontMessages ? sendFrontText(answer) : sendCompanyText(answer);
}
function submitFrontChoice(payload) { submitChoice(frontMessages, payload); }
function submitCompanyChoice(payload) { submitChoice(companyMessages, payload); }
function submitFrontLead(payload) { payload.item.submitted = true; sendFrontText(`姓名：${payload.name}；联系方式：${payload.contact}`); }
function submitCompanyLead(payload) { payload.item.submitted = true; sendCompanyText(`姓名：${payload.name}；联系方式：${payload.contact}`); }

async function handleAction(action, item) {
  if (action === "copy") { await copyText(item.content); return; }
  if (action === "like" || action === "dislike") { item.feedback = item.feedback === action ? "" : action; return; }
  if (action === "share") return showToast("请使用页面右上角分享");
  if (action === "speak") return showToast("朗读能力将在平台适配层接入");
  if (action === "regenerate") {
    const target = companyMessages.value.includes(item) ? companyMessages : frontMessages;
    appendAgentReply(target, item.content);
  }
}

function openQr() { if (config.value.qrCodeUrl) qrOpen.value = true; }
function openResource(url) { if (url) showToast("资料打开能力将在发布环境接入"); }
function chooseImage() { uni.chooseMedia?.({ count: 1, mediaType: ["image"], success: () => showToast("图片已选择，上传适配正在接入") }); }

function ensureRecorder() {
  if (recorder) return recorder;
  recorder = createVoiceRecorder({
    onStop: async (result) => {
      recording.value = false;
      clearInterval(recordingTimer);
      const canceled = recordingCanceled.value;
      const duration = Math.max(0, Date.now() - recordingStartedAt);
      const recordedFace = recordingFace.value;
      recordingCanceled.value = false;
      recordingSeconds.value = 0;
      if (canceled) return;
      if (duration < 350) return showToast("录音时间太短");
      const seconds = Math.max(1, Math.round((result.duration || duration) / 1000));
      const target = recordedFace === "front" ? frontMessages : companyMessages;
      const scrollTarget = recordedFace === "front" ? frontScrollTarget : backScrollTarget;
      const scrollAnchor = recordedFace === "front" ? "front-bottom" : "back-bottom";
      target.value.push(message("voice-message", { role: "customer", duration: seconds }));
      scrollConversation(scrollTarget, scrollAnchor);
      try {
        const reply = await withAgentLoading(target, scrollTarget, scrollAnchor, async () => {
          const uploaded = await uploadBinary(data.value?.endpoints?.publicMedia, {
            filePath: result.tempFilePath,
            name: `voice-${Date.now()}.mp3`,
            mimeType: "audio/mpeg"
          });
          return deliver({ text: `[语音消息 ${seconds} 秒]`, type: "audio", attachments: uploaded.attachment ? [uploaded.attachment] : [] }, recordedFace);
        });
        appendAgentReply(target, reply.content || "语音已收到。", reply.attachments);
      } catch (sendError) {
        showToast(sendError.message || "语音发送失败");
      }
      scrollConversation(scrollTarget, scrollAnchor);
    },
    onError: () => {
      recordPermissionGranted.value = false;
      recording.value = false;
      recordingCanceled.value = false;
      recordingSeconds.value = 0;
      clearInterval(recordingTimer);
      showToast("录音失败，请检查麦克风权限");
    }
  });
  return recorder;
}

async function prepareRecordPermission(guideToSettings = false) {
  if (recordPermissionGranted.value) return true;
  if (requestingRecordPermission.value) return false;
  requestingRecordPermission.value = true;
  try {
    recordPermissionGranted.value = await requestRecordPermission({ guideToSettings });
    return recordPermissionGranted.value;
  } finally {
    requestingRecordPermission.value = false;
  }
}

async function enterVoiceMode() {
  inputMode.value = "voice";
  const granted = await prepareRecordPermission(true);
  if (!granted) showToast("请开启麦克风权限后使用语音输入");
}

function eventY(event) {
  return Number(event?.touches?.[0]?.clientY ?? event?.changedTouches?.[0]?.clientY ?? event?.clientY ?? 0);
}

async function startRecording(event) {
  const eventType = String(event?.type || "");
  if (eventType === "touchstart") lastTouchStartedAt = Date.now();
  if (eventType === "mousedown" && Date.now() - lastTouchStartedAt < 700) return;
  if (recording.value) return;
  if (!recordPermissionGranted.value) {
    const granted = await prepareRecordPermission(true);
    if (granted) showToast("麦克风已开启，请重新按住说话");
    else showToast("请开启麦克风权限后使用语音输入");
    return;
  }
  const voiceRecorder = ensureRecorder();
  if (!voiceRecorder) return showToast("当前运行环境暂不支持录音");
  recordingStartY = eventY(event);
  recordingStartedAt = Date.now();
  recordingFace.value = face.value;
  recordingCanceled.value = false;
  recordingSeconds.value = 0;
  recording.value = true;
  clearInterval(recordingTimer);
  recordingTimer = setInterval(() => { recordingSeconds.value = Math.floor((Date.now() - recordingStartedAt) / 1000); }, 250);
  voiceRecorder.start();
}

function moveRecording(event) {
  if (!recording.value) return;
  recordingCanceled.value = recordingStartY - eventY(event) > 70;
}

function finishRecording(cancel = false) {
  if (!recording.value) return;
  recordingCanceled.value = cancel || recordingCanceled.value;
  clearInterval(recordingTimer);
  recorder?.stop();
}

function setTextInputMode() {
  if (recording.value) finishRecording(true);
  inputMode.value = "text";
}

</script>

<style scoped>
.page-shell, .card-stage, .face { width: 100%; height: 100%; min-height: 0; }
.page-shell { background: #eef1f5; }
.card-stage { position: relative; max-width: 840rpx; margin: 0 auto; overflow: hidden; background: #f5f6f8; }
.face { position: absolute; inset: 0; display: flex; flex-direction: column; background: #f5f6f8; opacity: 1; transform: rotateY(0); transition: opacity .22s ease, transform .35s ease; }
.face.hidden { z-index: -1; opacity: 0; pointer-events: none; transform: rotateY(180deg); }
.center-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24rpx; height: 100%; color: #687386; font-size: 26rpx; }
.retry-button { width: auto; padding: 8rpx 24rpx; background: #3864f4; color: #fff; font-size: 24rpx; }
.hero { position: relative; flex: 0 0 510rpx; padding: calc(var(--status-bar-height) + 66rpx) 34rpx 30rpx; overflow: hidden; background-color: #101827; background-position: center; background-size: cover; color: #fff; box-sizing: border-box; transition: flex-basis .24s ease, padding .24s ease; }
.hero::before { position: absolute; z-index: 2; right: 0; bottom: 30rpx; left: 0; height: 1px; background: linear-gradient(90deg, rgba(255,255,255,.84) 0 calc(50% - 42rpx), transparent calc(50% - 42rpx) calc(50% + 42rpx), rgba(255,255,255,.84) calc(50% + 42rpx)); content: ""; pointer-events: none; }
.miniapp-chrome { position: absolute; top: calc(var(--status-bar-height) + 12rpx); right: 22rpx; left: 22rpx; z-index: 3; display: flex; align-items: center; justify-content: space-between; color: #fff; font-size: 24rpx; }
.back-button { display: flex; align-items: center; justify-content: center; width: 56rpx; height: 56rpx; margin: 0; padding: 0; background: transparent; color: #fff; font-size: 52rpx; font-weight: 300; line-height: 52rpx; }
.preview-menu { padding: 12rpx 20rpx; border-radius: 30rpx; background: rgba(255,255,255,.88); color: #101724; font-size: 20rpx; font-weight: 900; }
.identity { display: flex; align-items: center; gap: 22rpx; margin-top: 10rpx; }
.compact-identity { position: absolute; right: 90rpx; bottom: 54rpx; left: 32rpx; display: flex; align-items: center; gap: 18rpx; opacity: 0; pointer-events: none; transform: translateY(12rpx); transition: opacity .18s ease, transform .18s ease; }
.compact-avatar { width: 84rpx; height: 84rpx; border: 4rpx solid rgba(255,255,255,.82); border-radius: 50%; background: #fff; }
.profile-avatar { width: 108rpx; height: 108rpx; border: 4rpx solid rgba(255,255,255,.82); border-radius: 50%; background: #fff; }
.identity-copy { display: flex; flex-direction: column; min-width: 0; gap: 8rpx; }
.name-row { display: flex; align-items: center; gap: 12rpx; font-size: 32rpx; font-weight: 800; }
.online { padding: 3rpx 10rpx; border-radius: 6rpx; background: rgba(35,207,124,.9); font-size: 18rpx; }
.identity-meta { font-size: 23rpx; }
.contact-panel { margin-top: 30rpx; overflow: hidden; border: 1rpx solid rgba(255,255,255,.2); border-radius: 12rpx; background: rgba(9,17,31,.22); }
.contact-row { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)) 58rpx; align-items: center; min-height: 62rpx; }
.contact-row.first-row { grid-template-columns: repeat(2, minmax(0,1fr)); }
.contact-row.first-row { border-bottom: 1rpx solid rgba(255,255,255,.2); }
.contact { display: flex; align-items: center; gap: 10rpx; min-width: 0; padding: 0 12rpx; border-right: 1rpx solid rgba(255,255,255,.2); font-size: 19rpx; }
.contact-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 28rpx; height: 28rpx; border: 1rpx solid rgba(255,255,255,.8); border-radius: 50%; font-size: 14rpx; }
.qr-button { display: flex; align-items: center; justify-content: center; width: 58rpx; height: 62rpx; margin: 0; padding: 8rpx; border-left: 1rpx solid rgba(255,255,255,.2); border-radius: 0; background: transparent; }
.qr-image { width: 42rpx; height: 42rpx; border-radius: 4rpx; background: #fff; }
.qr-lightbox { position: absolute; z-index: 50; inset: 0; display: flex; align-items: center; justify-content: center; padding: 48rpx; }
.qr-lightbox-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: rgba(13,18,28,.68); }
.qr-lightbox-card { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 584rpx; padding: 60rpx 52rpx 48rpx; border-radius: 16rpx; background: #fff; box-shadow: 0 44rpx 112rpx rgba(4,10,22,.34); box-sizing: border-box; }
.qr-lightbox-close { position: absolute; top: 16rpx; right: 16rpx; display: flex; align-items: center; justify-content: center; width: 60rpx; height: 60rpx; margin: 0; padding: 0 0 4rpx; border: 0; border-radius: 50%; background: #f0f2f5; color: #4d5562; font-size: 44rpx; font-weight: 300; line-height: 60rpx; }
.qr-lightbox-image { width: 440rpx; max-width: 100%; height: 440rpx; border-radius: 12rpx; object-fit: contain; }
.qr-lightbox-title { margin-top: 32rpx; color: #20242c; font-size: 32rpx; font-weight: 800; }
.qr-lightbox-hint { margin-top: 10rpx; color: #858b96; font-size: 22rpx; }
.hero-toggle { position: absolute; z-index: 4; bottom: 0; left: 50%; display: flex; align-items: center; justify-content: center; width: 86rpx; height: 70rpx; margin: 0; padding: 0; overflow: visible; border: 0; background: transparent; transform: translateX(-50%); }
.hero-toggle::before { position: absolute; top: 0; left: 0; width: 86rpx; height: 42rpx; box-sizing: border-box; border: 2rpx solid rgba(255,255,255,.84); border-bottom: 0; border-radius: 43rpx 43rpx 0 0; content: ""; }
.toggle-chevron { position: relative; z-index: 1; top: 10rpx; width: 14rpx; height: 14rpx; border-right: 3rpx solid #fff; border-bottom: 3rpx solid #fff; transform: translateY(-12rpx) rotate(225deg); transition: transform .18s ease; }
.toggle-chevron.down { transform: translateY(-12rpx) rotate(45deg); }
.hero.compact { flex-basis: 246rpx; padding-top: 88rpx; }
.hero.compact .identity, .hero.compact .contact-panel { opacity: 0; pointer-events: none; }
.hero.compact .compact-identity { opacity: 1; pointer-events: auto; transform: translateY(0); }
.conversation-scroll { flex: 1; min-height: 0; }
.conversation-list, .company-conversation { display: flex; flex-direction: column; padding: 24rpx 24rpx 36rpx; }
.scroll-anchor { width: 1rpx; height: 1rpx; }
.composer { position: relative; flex: 0 0 auto; padding: 14rpx 20rpx max(18rpx, env(safe-area-inset-bottom)); background: rgba(244,245,247,.96); }
.composer-shell { display: grid; grid-template-columns: 70rpx minmax(0,1fr) 70rpx 70rpx; align-items: center; gap: 8rpx; min-height: 104rpx; padding: 10rpx 14rpx; border: 1rpx solid #e3e5e8; border-radius: 44rpx; background: #fff; box-shadow: 0 10rpx 36rpx rgba(24,32,48,.13); box-sizing: border-box; }
.composer-shell.has-text { grid-template-columns: minmax(0,1fr) 70rpx; }
.composer-shell.voice-mode { grid-template-columns: 70rpx minmax(0,1fr) 70rpx 70rpx; }
.composer-shell.voice-disabled { grid-template-columns: 70rpx minmax(0,1fr) 70rpx; }
.message-input { height: 76rpx; padding: 0 12rpx; border: 0; background: transparent; font-size: 26rpx; }
.tool-button, .send-button { display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; margin: 0; padding: 0; border-radius: 50%; background: transparent; color: #202124; line-height: 64rpx; }
.send-button { background: #1478f2; }
.voice-hold { min-width: 0; height: 76rpx; margin: 0; padding: 0; border: 0; background: transparent; color: #202124; font-size: 28rpx; font-weight: 800; line-height: 76rpx; }
.voice-hold.active { border-radius: 28rpx; background: #edf4ff; color: #1478f2; }
.recording-status { position: absolute; z-index: 10; right: 36rpx; bottom: calc(100% + 20rpx); left: 36rpx; display: grid; grid-template-columns: 18rpx minmax(0,1fr) auto; align-items: center; gap: 18rpx; padding: 22rpx 26rpx; border-radius: 14rpx; background: #20242d; color: #fff; box-shadow: 0 16rpx 48rpx rgba(12,18,28,.22); font-size: 22rpx; }
.recording-status.will-cancel { background: #c93d45; }
.recording-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #ff4d4f; animation: record-pulse 1s infinite; }
.recording-time { font-variant-numeric: tabular-nums; }
@keyframes record-pulse { 50% { opacity: .35; transform: scale(.78); } }
.back-face { overflow: hidden; background: linear-gradient(180deg,#66b9f6 0%,#dff3ff 62%,#eef9ff 100%); }
.scene-video { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; pointer-events: none; }
.scene-image { position: absolute; z-index: 0; top: 0; right: 0; left: 0; width: 100%; height: 70%; background: linear-gradient(180deg,#c6e8ff,#f3fbff); object-position: center bottom; pointer-events: none; }
.assistant-scroll { position: relative; z-index: 1; flex: 1; min-height: 0; }
.assistant-content { display: grid; grid-template-rows: minmax(0,7fr) minmax(0,3fr) auto; min-height: calc(100vh - 152rpx - env(safe-area-inset-bottom)); }
.assistant-scene { position: relative; min-height: 0; overflow: hidden; background: linear-gradient(#c6e8ff, #f3fbff); }
.back-face.has-video .assistant-scene { background: linear-gradient(180deg,rgba(222,244,255,.08),rgba(223,243,255,.04)); }
.scene-overlay { position: absolute; inset: 0; z-index: 2; }
.scene-brand { position: absolute; top: calc(var(--status-bar-height) + 26rpx); left: 50%; color: #fff; font-size: 24rpx; font-weight: 800; transform: translateX(-50%); }
.speech { position: absolute; top: 180rpx; left: 50%; width: 70%; padding: 18rpx 24rpx; border-radius: 26rpx; background: rgba(255,255,255,.88); color: #28344b; font-size: 23rpx; text-align: center; transform: translateX(-50%); }
.topic-button { position: absolute; width: auto; min-height: 52rpx; padding: 6rpx 16rpx; border-radius: 26rpx; background: rgba(255,255,255,.86); color: #315176; font-size: 20rpx; line-height: 38rpx; }
.topic-button:nth-child(1) { top: 290rpx; left: 20rpx; }.topic-button:nth-child(2) { top: 320rpx; right: 26rpx; }.topic-button:nth-child(3) { bottom: 142rpx; left: 24rpx; }.topic-button:nth-child(4) { right: 34rpx; bottom: 72rpx; }
.shortcut-area { position: relative; z-index: 2; display: grid; grid-template-rows: auto minmax(0,1fr); min-height: 0; padding: 24rpx; background: rgba(239,248,255,.94); box-sizing: border-box; }
.shortcut-prompt { display: block; margin-bottom: 10rpx; color: #69758a; font-size: 21rpx; }
.shortcut-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); grid-template-rows: minmax(0,1fr); gap: 18rpx; min-height: 0; }
.shortcut-group { display: flex; flex-direction: column; overflow: hidden; border-radius: 14rpx; background: rgba(255,255,255,.95); box-shadow: 0 8rpx 26rpx rgba(41,62,92,.08); }
.shortcut-title { display: block; padding: 12rpx 18rpx; color: #fff; font-size: 21rpx; font-weight: 800; }.primary-title { background: linear-gradient(90deg,#4285e8,#6db7ed); }.secondary-title { background: linear-gradient(90deg,#7768e9,#a085f4); }
.shortcut-button { display: flex; flex: 1 1 0; align-items: center; justify-content: space-between; width: 100%; min-height: 58rpx; margin: 0; padding: 6rpx 18rpx; border-top: 1rpx solid #eef1f5; border-radius: 0; background: transparent; color: #28344b; font-size: 20rpx; line-height: 46rpx; text-align: left; }
.company-conversation { background: #f5f6f8; }
.voice-dock { position: relative; z-index: 3; flex: 0 0 auto; padding: 16rpx 24rpx calc(14rpx + env(safe-area-inset-bottom)); background: rgba(240,249,255,.96); text-align: center; }
.voice-button { display: grid; grid-template-columns: 44rpx minmax(0,1fr) 44rpx; align-items: center; width: 100%; min-height: 88rpx; margin: 0; padding: 0 28rpx; border-radius: 44rpx; background: linear-gradient(90deg,#1766da,#193cc9); color: #fff; font-size: 25rpx; font-weight: 700; line-height: 88rpx; }
.voice-hint { display: block; margin-top: 10rpx; color: #9aa3b0; font-size: 17rpx; }
.face-switch { position: absolute; z-index: 30; right: 24rpx; display: flex; align-items: center; width: 108rpx; height: 108rpx; margin: 0; padding: 6rpx; overflow: visible; border: 4rpx solid rgba(255,255,255,.92); border-radius: 50%; background: #fff; box-shadow: 0 18rpx 48rpx rgba(10,21,44,.28); touch-action: none; }
.switch-label { position: absolute; bottom: calc(100% - 4rpx); left: 50%; min-width: 58rpx; max-width: 180rpx; padding: 7rpx 14rpx; overflow: hidden; border: 4rpx solid #fff; border-radius: 24rpx; background: #1478f2; color: #fff; box-shadow: 0 8rpx 22rpx rgba(10,21,44,.2); font-size: 22rpx; font-weight: 800; line-height: 28rpx; text-align: center; text-overflow: ellipsis; white-space: nowrap; transform: translateX(-50%); }
.switch-avatar { width: 88rpx; height: 88rpx; border-radius: 50%; }.switch-badge { position: absolute; right: -6rpx; bottom: -6rpx; display: flex; align-items: center; justify-content: center; width: 42rpx; height: 42rpx; border: 4rpx solid #fff; border-radius: 50%; background: #1478f2; }
.wechat-login { position: absolute; z-index: 80; inset: 0; display: flex; align-items: center; justify-content: center; padding: 44rpx; box-sizing: border-box; }
.wechat-login-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: rgba(13,18,28,.66); }
.wechat-login-panel { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 620rpx; padding: 54rpx 44rpx 36rpx; border-radius: 16rpx; background: #fff; box-shadow: 0 36rpx 100rpx rgba(4,10,22,.3); box-sizing: border-box; }
.wechat-login-avatar { width: 112rpx; height: 112rpx; border: 4rpx solid #fff; border-radius: 50%; background: #edf1f6; box-shadow: 0 12rpx 32rpx rgba(24,39,70,.16); }
.wechat-avatar-picker { display: flex; flex-direction: column; align-items: center; gap: 10rpx; margin: 0; padding: 0; border: 0; background: transparent; color: #576274; font-size: 20rpx; line-height: 28rpx; }
.wechat-avatar-picker::after { border: 0; }
.wechat-login-title { margin-top: 28rpx; color: #1f2733; font-size: 32rpx; font-weight: 800; line-height: 46rpx; text-align: center; }
.wechat-login-copy { margin-top: 12rpx; color: #727b89; font-size: 23rpx; line-height: 36rpx; text-align: center; }
.wechat-nickname-input { width: 100%; height: 88rpx; margin-top: 32rpx; padding: 0 24rpx; border: 1rpx solid #d9dee7; border-radius: 8rpx; background: #f8f9fb; color: #1f2733; font-size: 28rpx; line-height: 88rpx; }
.wechat-login-primary { width: 100%; height: 88rpx; margin-top: 38rpx; border-radius: 8rpx; background: #07c160; color: #fff; font-size: 28rpx; font-weight: 700; line-height: 88rpx; }
.wechat-nickname-input + .wechat-login-primary { margin-top: 20rpx; }
.wechat-login-primary[disabled] { opacity: .68; }
.wechat-login-secondary { width: 100%; height: 74rpx; margin-top: 8rpx; background: transparent; color: #7c8490; font-size: 24rpx; line-height: 74rpx; }
/* H5 preview uses the same fixed canvas and pixel metrics as the approved legacy page. */
@media (min-width: 620px) {
  .card-stage { width: 420px; height: 760px; margin: 18px auto; border: 1px solid #cfd5e0; border-radius: 8px; box-shadow: 0 16px 40px rgba(28,38,65,.18); }
  .hero { flex-basis: 266px; padding: 66px 20px 28px; }
  .hero::before { bottom: 16px; background: linear-gradient(90deg, rgba(255,255,255,.84) 0 calc(50% - 23px), transparent calc(50% - 23px) calc(50% + 23px), rgba(255,255,255,.84) calc(50% + 23px)); }
  .miniapp-chrome { top: 14px; right: 14px; left: 14px; font-size: 12px; }
  .back-button { width: 34px; height: 34px; font-size: 36px; line-height: 34px; }
  .preview-menu { padding: 7px 13px; border-radius: 18px; font-size: 11px; }
  .identity { gap: 12px; margin-top: 0; }
  .profile-avatar { width: 64px; height: 64px; border-width: 2px; }
  .identity-copy { gap: 4px; }
  .name-row { gap: 7px; font-size: 22px; }
  .online { padding: 2px 6px; border-radius: 5px; font-size: 9px; }
  .identity-meta { font-size: 13px; }
  .contact-panel { margin-top: 10px; border-width: 1px; border-radius: 6px; }
  .contact-row { min-height: 34px; grid-template-columns: minmax(0,1.25fr) minmax(0,1fr) 38px; }
  .contact-row.first-row { border-bottom-width: 1px; }
  .contact-row.first-row { grid-template-columns: minmax(0,1.25fr) minmax(0,1fr); }
  .contact { gap: 6px; height: 34px; padding: 0 9px; border-right-width: 1px; font-size: 10px; }
  .contact-icon { width: 15px; height: 15px; border-width: 1px; font-size: 7px; }
  .qr-button { width: 38px; height: 34px; padding: 5px 7px; border-left-width: 1px; border-radius: 0; }
  .qr-image { width: 24px; height: 24px; border-radius: 3px; }
  .qr-lightbox { padding: 24px; }
  .qr-lightbox-card { max-width: 292px; padding: 30px 26px 24px; border-radius: 8px; box-shadow: 0 22px 56px rgba(4,10,22,.34); }
  .qr-lightbox-close { top: 8px; right: 8px; width: 30px; height: 30px; padding-bottom: 2px; font-size: 22px; line-height: 30px; }
  .qr-lightbox-image { width: 220px; height: 220px; border-radius: 6px; }
  .qr-lightbox-title { margin-top: 16px; font-size: 16px; }
  .qr-lightbox-hint { margin-top: 5px; font-size: 11px; }
  .compact-identity { right: 52px; bottom: 32px; left: 18px; gap: 12px; }
  .compact-avatar { width: 48px; height: 48px; border-width: 2px; }
  .hero-toggle { width: 48px; height: 40px; }
  .hero-toggle::before { width: 48px; height: 24px; border-width: 1px; border-radius: 24px 24px 0 0; }
  .toggle-chevron { top: 5px; width: 9px; height: 9px; border-width: 0 2px 2px 0; transform: translateY(-6px) rotate(225deg); }
  .toggle-chevron.down { transform: translateY(-6px) rotate(45deg); }
  .hero.compact { flex-basis: 138px; padding: 50px 18px 16px; }
  .conversation-list, .company-conversation { padding: 14px 14px 24px; }
  .composer { padding: 8px 12px 12px; }
  .composer-shell { grid-template-columns: 42px minmax(0,1fr) 42px 42px; gap: 4px; min-height: 58px; padding: 6px 8px; border-width: 1px; border-radius: 22px; box-shadow: 0 5px 18px rgba(24,32,48,.13); }
  .composer-shell.has-text { grid-template-columns: minmax(0,1fr) 42px; }
  .composer-shell.voice-mode { grid-template-columns: 42px minmax(0,1fr) 42px 42px; }
  .composer-shell.voice-disabled { grid-template-columns: 42px minmax(0,1fr) 42px; }
  .message-input { height: 42px; padding: 0 7px; font-size: 15px; }
  .tool-button, .send-button { width: 42px; height: 42px; font-size: 13px; line-height: 42px; }
  .send-button { font-size: 20px; }
  .voice-hold { height: 42px; font-size: 16px; line-height: 42px; }
  .voice-hold.active { border-radius: 16px; }
  .recording-status { right: 18px; bottom: calc(100% + 10px); left: 18px; gap: 10px; padding: 12px 14px; border-radius: 8px; font-size: 12px; }
  .recording-dot { width: 9px; height: 9px; }
  .face-switch { right: 12px; width: 54px; height: 54px; padding: 3px; border-width: 2px; box-shadow: 0 9px 24px rgba(10,21,44,.28); }
  .switch-label { bottom: calc(100% - 2px); min-width: 29px; max-width: 90px; padding: 4px 7px; border-width: 2px; border-radius: 12px; box-shadow: 0 4px 11px rgba(10,21,44,.2); font-size: 12px; line-height: 14px; }
  .switch-avatar { width: 44px; height: 44px; }
  .switch-badge { right: -3px; bottom: -3px; width: 21px; height: 21px; border-width: 2px; }
  .assistant-scene { min-height: 0; }
  .assistant-content { min-height: 100%; }
  .shortcut-area { min-height: 0; padding: 12px 14px; }
  .shortcut-grid { min-height: 0; }
  .voice-dock { padding: 10px 14px 11px; }
  .voice-button { min-height: 48px; padding: 0 16px; border-radius: 24px; font-size: 14px; line-height: 48px; }
}
</style>
