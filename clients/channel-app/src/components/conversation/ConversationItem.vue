<template>
  <view v-if="item.type === 'assistant-response'" class="component-card answer-card">
    <text class="answer-content">{{ item.content }}</text>
    <view class="card-actions">
      <view class="action-group">
        <button class="icon-button" aria-label="复制回复" @tap="$emit('action', 'copy', item)"><AppIcon name="copy" tone="blue" :size="18" /></button>
        <button class="icon-button" aria-label="朗读回复" @tap="$emit('action', 'speak', item)"><AppIcon name="volume" tone="blue" :size="18" /></button>
        <button class="icon-button" :class="{ active: item.feedback === 'like' }" aria-label="有帮助" @tap="$emit('action', 'like', item)"><AppIcon name="thumbs-up" :tone="item.feedback === 'like' ? 'white' : 'blue'" :size="18" /></button>
        <button class="icon-button" :class="{ active: item.feedback === 'dislike' }" aria-label="没有帮助" @tap="$emit('action', 'dislike', item)"><AppIcon name="thumbs-down" :tone="item.feedback === 'dislike' ? 'white' : 'blue'" :size="18" /></button>
        <button class="icon-button" aria-label="分享回复" @tap="$emit('action', 'share', item)"><AppIcon name="share" tone="blue" :size="18" /></button>
      </view>
      <button class="icon-button" aria-label="重新生成回复" @tap="$emit('action', 'regenerate', item)"><AppIcon name="refresh" tone="blue" :size="18" /></button>
    </view>
  </view>

  <view v-else-if="item.type === 'assistant-loading'" class="agent-loading" role="status" aria-label="正在思考">
    <text>正在思考</text><text class="loading-dot">•</text><text class="loading-dot">•</text><text class="loading-dot">•</text>
  </view>

  <view v-else-if="item.type === 'message'" class="message" :class="item.role === 'agent' ? 'agent-message' : 'customer-message'">
    <text>{{ item.content }}</text>
  </view>

  <view v-else-if="item.type === 'suggestion-chips'" class="suggestions">
    <text class="suggestion-label">✦ 快捷提问</text>
    <scroll-view class="suggestion-scroll" scroll-x :show-scrollbar="false">
      <button v-for="question in item.items || []" :key="question" class="suggestion-chip" @tap="$emit('question', question)">{{ question }}</button>
    </scroll-view>
  </view>

  <view v-else-if="isChoice" class="component-card choice-card" :class="{ submitted: item.submitted }">
    <view v-if="item.title" class="choice-title">
      <text>{{ item.title }}</text><text v-if="item.subtitle" class="muted">{{ item.subtitle }}</text>
    </view>
    <view class="choice-grid">
      <view v-for="option in normalizedOptions" :key="option.value" class="choice-option" :class="{ selected: selected.includes(option.value) }" @tap="toggleChoice(option.value)">
        <view class="choice-control"><text v-if="selected.includes(option.value)">✓</text></view>
        <view class="choice-copy"><text class="choice-name">{{ option.label }}</text><text v-if="option.description" class="muted">{{ option.description }}</text></view>
      </view>
    </view>
    <view class="choice-footer"><button class="primary-button" :class="{ 'is-disabled': !selected.length || item.submitted }" :disabled="!selected.length || item.submitted" @tap="submitChoice">{{ item.submitted ? '已提交' : item.submitLabel || '提交回答' }}</button></view>
  </view>

  <view v-else-if="item.type === 'lead-form'" class="component-card lead-card">
    <view class="component-title"><text>保持联系</text><text class="muted">我们将尽快联系您</text></view>
    <view class="lead-fields">
      <view class="lead-field"><text>怎么称呼您</text><input class="lead-input" v-model="lead.name" placeholder="请输入姓名" /></view>
      <view class="lead-field"><text>怎么联系到您</text><input class="lead-input" v-model="lead.contact" placeholder="手机号或微信号" /></view>
    </view>
    <view class="choice-footer"><button class="primary-button" :class="{ 'is-disabled': item.submitted }" :disabled="item.submitted" @tap="submitLead">{{ item.submitted ? '已提交' : '提交' }}</button></view>
  </view>

  <view v-else-if="item.type === 'resource-list'" class="component-card resource-card">
    <view class="component-title"><text>{{ item.title || '资料中心' }}</text><text class="muted">{{ (item.items || []).length }} 项</text></view>
    <view v-for="resource in item.items || []" :key="resource.url" class="resource-row" @tap="$emit('open', resource.url)">
      <text class="resource-type">{{ resource.type || '资料' }}</text><text class="resource-name">{{ resource.name || resource.title }}</text><text>↗</text>
    </view>
  </view>

  <view v-else-if="item.type === 'attachment'" class="message agent-message attachment" @tap="$emit('open', attachment.url)">
    <image v-if="attachment.type === 'image'" class="attachment-image" :src="attachmentImage" mode="aspectFill" />
    <template v-else><view class="attachment-icon"><AppIcon :name="attachment.type === 'card' ? 'link' : 'file'" tone="blue" :size="18" /></view><view class="attachment-copy"><text>{{ attachment.title || attachment.name || '查看资料' }}</text><text v-if="attachment.subtitle" class="muted">{{ attachment.subtitle }}</text></view></template>
  </view>

  <view v-else-if="item.type === 'voice-message'" class="message voice-message" :class="item.role === 'customer' ? 'customer-message' : 'agent-message'">
    <text>)))</text><text>{{ item.duration || 1 }}''</text>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import AppIcon from "../AppIcon.vue";
import { prepareImageAsset, resolveAssetUrl } from "../../runtime/index.js";

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(["action", "question", "choice", "lead", "open"]);
const selected = ref([]);
const lead = reactive({ name: "", contact: "" });
const isChoice = computed(() => props.item.type === "single-choice" || props.item.type === "multi-choice");
const normalizedOptions = computed(() => (props.item.options || []).map((option) => typeof option === "string" ? { label: option, value: option, description: "" } : { ...option, value: String(option.value ?? option.label) }));
const attachment = computed(() => props.item.attachment || props.item);
const attachmentImage = ref("");

watch(() => props.item.selectedValues, (value) => { selected.value = Array.isArray(value) ? value.map(String) : []; }, { immediate: true });
watch(() => attachment.value.url, async (value) => { attachmentImage.value = value ? await prepareImageAsset(value) : resolveAssetUrl(value); }, { immediate: true });

function toggleChoice(value) {
  if (props.item.submitted) return;
  if (props.item.type === "single-choice") selected.value = [value];
  else selected.value = selected.value.includes(value) ? selected.value.filter((item) => item !== value) : [...selected.value, value];
}

function submitChoice() {
  if (!selected.value.length || props.item.submitted) return;
  const labels = normalizedOptions.value.filter((option) => selected.value.includes(option.value)).map((option) => option.label);
  emit("choice", { item: props.item, values: [...selected.value], labels });
}

function submitLead() {
  if (!lead.name.trim() || !lead.contact.trim()) return uni.showToast({ title: "请完整填写联系信息", icon: "none" });
  emit("lead", { item: props.item, name: lead.name.trim(), contact: lead.contact.trim() });
}
</script>

<style scoped>
.component-card { margin-bottom: 20rpx; padding: 26rpx; border: 1rpx solid #dfe3e9; border-radius: 14rpx; background: #fff; box-shadow: 0 10rpx 30rpx rgba(24,33,52,.05); }
.answer-content { color: #263247; font-size: 26rpx; line-height: 1.75; white-space: pre-wrap; }
.card-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 24rpx; padding-top: 20rpx; border-top: 1rpx solid #edf0f4; }
.action-group { display: flex; gap: 12rpx; }
.icon-button { display: flex; align-items: center; justify-content: center; width: 56rpx; height: 56rpx; margin: 0; padding: 0; border-radius: 12rpx; background: #eef5ff; color: #1478f2; font-size: 20rpx; line-height: 56rpx; }
.icon-button.active { background: #1478f2; color: #fff; }
.message { width: fit-content; max-width: 86%; margin-bottom: 18rpx; padding: 18rpx 22rpx; border-radius: 14rpx; font-size: 24rpx; line-height: 1.55; }
.customer-message { align-self: flex-end; margin-left: auto; background: #dcecff; }
.agent-message { align-self: flex-start; margin-right: auto; background: #fff; }
.agent-loading { display: flex; align-items: center; align-self: flex-start; gap: 8rpx; min-width: 224rpx; min-height: 84rpx; margin-bottom: 18rpx; padding: 18rpx 24rpx; border: 1rpx solid #e4e8ef; border-radius: 14rpx; background: #fff; color: #68758a; font-size: 22rpx; box-shadow: 0 10rpx 30rpx rgba(24,33,52,.05); box-sizing: border-box; }
.loading-dot { color: #5c82c5; animation: agent-loading-dot 1.15s ease-in-out infinite; }
.loading-dot:nth-child(3) { animation-delay: .14s; }
.loading-dot:nth-child(4) { animation-delay: .28s; }
@keyframes agent-loading-dot { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-6rpx); } }
.suggestions { display: flex; align-items: center; gap: 14rpx; min-width: 0; margin-bottom: 20rpx; overflow: hidden; }
.suggestion-label { flex: 0 0 auto; color: #707b8e; font-size: 20rpx; font-weight: 700; white-space: nowrap; }
.suggestion-scroll { flex: 1; min-width: 0; white-space: nowrap; }
.suggestion-chip { display: inline-flex; width: auto; min-height: 52rpx; margin: 0 10rpx 0 0; padding: 8rpx 16rpx; border: 1rpx solid #aebfe0; border-radius: 12rpx; background: #fff; color: #244f91; font-size: 22rpx; line-height: 34rpx; }
.choice-card.submitted { background: #f6f7f9; box-shadow: none; }
.choice-title, .component-title { display: flex; align-items: baseline; justify-content: space-between; gap: 20rpx; margin-bottom: 18rpx; font-size: 26rpx; font-weight: 700; }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12rpx; }
.choice-option { display: flex; align-items: flex-start; gap: 12rpx; min-height: 92rpx; padding: 16rpx; border: 2rpx solid #dce1ea; border-radius: 14rpx; background: #fff; box-sizing: border-box; }
.choice-option.selected { border-color: #3864f4; background: #f3f5ff; }
.submitted .choice-option { border-color: #d9dde4; background: #eef0f3; }
.choice-control { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32rpx; height: 32rpx; border: 3rpx solid #aeb8c8; border-radius: 50%; color: #fff; font-size: 20rpx; }
.choice-option.selected .choice-control { border-color: #3864f4; background: #3864f4; }
.choice-copy, .attachment-copy { display: flex; flex-direction: column; min-width: 0; }
.choice-name { color: #20283a; font-size: 23rpx; font-weight: 700; }
.muted { margin-top: 4rpx; color: #7b8596; font-size: 19rpx; font-weight: 400; }
.choice-footer { display: flex; justify-content: flex-end; margin-top: 18rpx; }
.primary-button { width: auto; min-width: 176rpx; min-height: 60rpx; margin: 0; padding: 10rpx 24rpx; border-radius: 14rpx; background: #3864f4; color: #fff; font-size: 23rpx; font-weight: 700; line-height: 40rpx; }
.primary-button.is-disabled { background: #dfe4ed; color: #8a94a6; }
.lead-fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 20rpx; }
.lead-field { color: #3d485f; font-size: 22rpx; font-weight: 700; }
.lead-input { height: 72rpx; margin-top: 8rpx; border-bottom: 1rpx solid #dce1ea; font-size: 22rpx; font-weight: 400; }
.resource-row { display: grid; grid-template-columns: 68rpx minmax(0,1fr) 40rpx; align-items: center; gap: 14rpx; padding: 18rpx 0; border-top: 1rpx solid #edf0f4; }
.resource-type { display: flex; align-items: center; justify-content: center; height: 64rpx; border-radius: 10rpx; background: #e7f0ff; color: #1f5ca8; font-size: 18rpx; font-weight: 800; }
.resource-name { overflow: hidden; font-size: 23rpx; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.attachment { display: flex; align-items: center; gap: 16rpx; }
.attachment-image { width: 280rpx; height: 220rpx; border-radius: 12rpx; }
.attachment-icon { display: flex; align-items: center; justify-content: center; width: 56rpx; height: 56rpx; border-radius: 10rpx; background: #e7f0ff; color: #1f5ca8; }
.voice-message { display: flex; justify-content: space-between; min-width: 180rpx; color: #185ca8; }

@media (min-width: 620px) {
  .component-card { margin-bottom: 12px; padding: 16px; border-width: 1px; border-radius: 7px; box-shadow: 0 5px 16px rgba(24,33,52,.05); }
  .answer-content { font-size: 13px; }
  .card-actions { margin-top: 15px; padding-top: 12px; border-top-width: 1px; }
  .action-group { gap: 7px; }
  .icon-button { width: 32px; height: 32px; border-radius: 7px; font-size: 10px; line-height: 32px; }
  .message { margin-bottom: 9px; padding: 10px 12px; border-radius: 7px; font-size: 12px; }
  .agent-loading { gap: 5px; min-width: 112px; min-height: 42px; margin-bottom: 9px; padding: 9px 12px; border-width: 1px; border-radius: 7px; font-size: 11px; box-shadow: 0 5px 16px rgba(24,33,52,.05); }
  .suggestions { gap: 8px; margin-bottom: 12px; }
  .suggestion-label { font-size: 10px; }
  .suggestion-chip { min-height: 30px; margin-right: 7px; padding: 4px 10px; border-width: 1px; border-radius: 6px; font-size: 11px; line-height: 20px; }
  .choice-title, .component-title { gap: 10px; margin-bottom: 9px; font-size: 13px; }
  .choice-grid { gap: 7px; }
  .choice-option { gap: 8px; min-height: 54px; padding: 9px 10px; border-width: 1px; border-radius: 7px; }
  .choice-control { width: 18px; height: 18px; border-width: 2px; font-size: 10px; }
  .choice-name { font-size: 12px; }
  .muted { margin-top: 3px; font-size: 9px; }
  .choice-footer { margin-top: 9px; }
  .primary-button { min-width: 88px; min-height: 32px; padding: 6px 12px; border-radius: 7px; font-size: 12px; line-height: 20px; }
  .lead-fields { gap: 12px; }
  .lead-field { font-size: 12px; }
  .lead-input { height: 38px; margin-top: 5px; border-bottom-width: 1px; font-size: 11px; }
  .resource-row { grid-template-columns: 38px minmax(0,1fr) 30px; gap: 8px; padding: 10px 0; border-top-width: 1px; }
  .resource-type { height: 36px; border-radius: 5px; font-size: 9px; }
  .resource-name { font-size: 12px; }
  .attachment { gap: 8px; }
  .attachment-image { width: 180px; height: 140px; border-radius: 6px; }
  .attachment-icon { width: 32px; height: 32px; border-radius: 5px; }
  .voice-message { min-width: 92px; }
}
</style>
