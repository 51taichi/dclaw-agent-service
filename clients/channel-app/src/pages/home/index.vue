<template>
  <view class="home-page">
    <view class="home-header" :style="headerStyle">
      <view class="safe-area"></view>
      <view class="brand-row">
        <image v-if="workspace.logoUrl" class="company-logo" :src="asset(workspace.logoUrl)" mode="aspectFit" />
        <view v-else class="company-mark">{{ companyInitial }}</view>
        <view class="brand-copy">
          <text class="company-name">{{ workspace.name || "团队名片" }}</text>
          <text class="page-label">团队名片</text>
        </view>
      </view>
    </view>

    <view class="home-content">
      <view class="section-heading">
        <view>
          <text class="section-title">团队成员</text>
          <text class="section-meta">{{ cards.length }} 位</text>
        </view>
        <text class="section-caption">选择联系人</text>
      </view>

      <view v-if="loading" class="home-state"><view class="loading-dot"></view><text>正在加载...</text></view>
      <view v-else-if="error" class="home-state error-state"><text>{{ error }}</text><button class="retry-button" @tap="loadHome">重新加载</button></view>
      <view v-else-if="!cards.length" class="home-state"><text>暂无已发布名片</text></view>

      <view v-else class="member-list">
        <button v-for="card in cards" :key="card.id" class="member-card" @tap="openCard(card.publicSlug)">
          <image class="member-avatar" :src="asset(card.person.avatarUrl)" mode="aspectFill" />
          <view class="member-copy">
            <view class="member-name-row"><text class="member-name">{{ card.person.name }}</text><text class="online-badge">在线</text></view>
            <text class="member-title">{{ card.person.title || "智能员工" }}</text>
            <text v-if="card.profile.biography" class="member-summary">{{ card.profile.biography }}</text>
          </view>
          <text class="member-arrow">›</text>
        </button>
      </view>
    </view>

    <view class="home-footer"><text>{{ workspace.name || "" }}</text></view>
  </view>
</template>

<script setup>
import { computed, ref } from "vue";
import { onLoad, onPullDownRefresh, onShareAppMessage } from "@dcloudio/uni-app";
import { currentMiniappAppId, request, resolveAssetUrl } from "../../runtime/index.js";

const workspace = ref({ name: "", logoUrl: "", accent: "#2457d6" });
const cards = ref([]);
const loading = ref(true);
const error = ref("");
const appId = ref("");

const companyInitial = computed(() => String(workspace.value.name || "名").slice(0, 1));
const headerStyle = computed(() => `--workspace-accent:${safeColor(workspace.value.accent)}`);

onLoad((query = {}) => {
  appId.value = String(query.appId || currentMiniappAppId()).trim();
  loadHome();
});

onPullDownRefresh(async () => {
  await loadHome();
  uni.stopPullDownRefresh();
});

onShareAppMessage(() => ({
  title: `${workspace.value.name || "团队"}名片`,
  path: "/pages/home/index"
}));

function asset(value) {
  return resolveAssetUrl(value || "/static/brand/bot-avatar.png");
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#2457d6";
}

async function loadHome() {
  loading.value = true;
  error.value = "";
  try {
    if (!appId.value) throw new Error("无法识别当前小程序");
    const data = await request(`/api/public/miniapps/${encodeURIComponent(appId.value)}`);
    workspace.value = data.workspace || workspace.value;
    cards.value = Array.isArray(data.cards) ? data.cards : [];
  } catch (loadError) {
    error.value = loadError.message || "名片列表加载失败";
  } finally {
    loading.value = false;
  }
}

function openCard(publicSlug) {
  if (!publicSlug) return;
  uni.navigateTo({ url: `/pages/card/index?slug=${encodeURIComponent(publicSlug)}` });
}
</script>

<style scoped>
.home-page { min-height: 100vh; background: #f3f5f8; color: #20283a; }
.home-header { min-height: 164px; padding: 0 22px 26px; background: linear-gradient(145deg, #17243b 0%, var(--workspace-accent) 72%, #168b7a 135%); box-sizing: border-box; }
.safe-area { height: calc(env(safe-area-inset-top) + 18px); }
.brand-row { display: flex; align-items: center; gap: 14px; }
.company-logo, .company-mark { width: 58px; height: 58px; flex: 0 0 auto; border-radius: 8px; background: #fff; }
.company-logo { padding: 7px; box-sizing: border-box; }
.company-mark { display: flex; align-items: center; justify-content: center; color: var(--workspace-accent); font-size: 27px; font-weight: 800; }
.brand-copy { display: grid; gap: 4px; min-width: 0; }
.company-name { overflow: hidden; color: #fff; font-size: 23px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.page-label { color: rgba(255, 255, 255, .74); font-size: 13px; }
.home-content { padding: 22px 16px 28px; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; padding: 0 2px; }
.section-heading > view { display: flex; align-items: baseline; gap: 8px; }
.section-title { font-size: 19px; font-weight: 800; }
.section-meta, .section-caption { color: #7a8497; font-size: 12px; }
.member-list { display: grid; gap: 10px; }
.member-card { display: grid; grid-template-columns: 64px minmax(0, 1fr) 20px; align-items: center; gap: 13px; width: 100%; min-height: 94px; margin: 0; padding: 14px; border: 1px solid #e0e5ee; border-radius: 7px; background: #fff; box-shadow: 0 7px 20px rgba(37, 51, 78, .06); text-align: left; }
.member-card::after { border: 0; }
.member-card:active { background: #f8faff; }
.member-avatar { width: 64px; height: 64px; border-radius: 7px; background: #e9edf4; }
.member-copy { display: grid; gap: 4px; min-width: 0; }
.member-name-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.member-name { overflow: hidden; font-size: 17px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.online-badge { flex: 0 0 auto; padding: 2px 5px; border-radius: 4px; background: #e8f7ef; color: #168253; font-size: 10px; font-weight: 700; }
.member-title { overflow: hidden; color: #536078; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.member-summary { display: -webkit-box; overflow: hidden; color: #8a93a4; font-size: 11px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.member-arrow { color: #77839a; font-size: 26px; text-align: right; }
.home-state { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 10px; color: #7a8497; font-size: 13px; }
.error-state { flex-direction: column; }
.loading-dot { width: 8px; height: 8px; border-radius: 50%; background: #2457d6; box-shadow: 14px 0 #15a58b, -14px 0 #ef6b45; }
.retry-button { min-width: 96px; padding: 8px 14px; border: 1px solid #cdd5e2; border-radius: 6px; background: #fff; color: #2f4f82; font-size: 13px; }
.retry-button::after { border: 0; }
.home-footer { padding: 2px 16px calc(env(safe-area-inset-bottom) + 18px); color: #a1a8b5; font-size: 11px; text-align: center; }
</style>
