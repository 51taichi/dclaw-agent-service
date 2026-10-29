<template>
  <image class="app-icon" :src="source" mode="aspectFit" :style="iconStyle" />
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  name: { type: String, required: true },
  tone: { type: String, default: "dark" },
  size: { type: Number, default: 20 }
});

const source = computed(() => `/static/icons/${props.name}-${props.tone}.svg`);
const iconStyle = computed(() => `width:${props.size}px;height:${props.size}px;`);
</script>

<style scoped>
.app-icon { display: block; flex: 0 0 auto; }
</style>
