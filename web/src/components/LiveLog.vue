<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LogLine } from '../types';
import { formatTimeOnly } from '../utils';

const { t } = useI18n();

const props = withDefaults(defineProps<{ certificateId?: number | null; height?: string }>(), {
  certificateId: null,
  height: '420px',
});

const lines = ref<LogLine[]>([]);
const paused = ref(false);
const connected = ref(false);
const boxRef = ref<HTMLElement | null>(null);
let es: EventSource | null = null;

function onMessage(event: MessageEvent): void {
  if (paused.value) return;
  try {
    const line = JSON.parse(event.data) as LogLine;
    if (props.certificateId != null && line.certificateId !== props.certificateId) return;
    lines.value.push(line);
    if (lines.value.length > 800) lines.value.splice(0, lines.value.length - 800);
    void nextTick(() => {
      const el = boxRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  } catch {
    // 忽略无法解析的行
  }
}

onMounted(() => {
  es = new EventSource('/api/events');
  es.onopen = () => {
    connected.value = true;
  };
  es.onerror = () => {
    connected.value = false;
  };
  es.onmessage = onMessage;
});

onUnmounted(() => {
  es?.close();
});
</script>

<template>
  <div class="live-log">
    <div class="live-log-toolbar">
      <el-tag :type="connected ? 'success' : 'info'" size="small">
        {{ connected ? t('logs.connected') : t('logs.connecting') }}
      </el-tag>
      <el-button size="small" :disabled="paused" @click="paused = true">{{ t('logs.pause') }}</el-button>
      <el-button size="small" :disabled="!paused" @click="paused = false">{{ t('logs.resume') }}</el-button>
      <el-button size="small" @click="lines = []">{{ t('logs.clear') }}</el-button>
    </div>
    <div ref="boxRef" class="live-log-box" :style="{ height }">
      <div v-for="(line, i) in lines" :key="i" class="log-line" :class="`level-${line.level} src-${line.source}`">
        <span class="log-ts">{{ formatTimeOnly(line.ts) }}</span>
        <span class="log-src">{{ line.source === 'acme' ? 'ACME' : 'SYS' }}</span>
        <span class="log-msg">{{ line.message }}</span>
      </div>
      <div v-if="lines.length === 0" class="log-empty">{{ t('logs.emptyTip') }}</div>
    </div>
  </div>
</template>

<style scoped>
.live-log-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.live-log-box {
  overflow-y: auto;
  background: #10151d;
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line {
  display: flex;
  gap: 10px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #c9d4e0;
}
.log-ts {
  color: #5a6a7d;
  flex-shrink: 0;
}
.log-src {
  flex-shrink: 0;
  font-weight: 600;
}
.src-acme .log-src {
  color: var(--el-color-success);
}
.src-system .log-src {
  color: var(--el-color-primary);
}
.level-warn .log-msg {
  color: var(--el-color-warning);
}
.level-error .log-msg {
  color: var(--el-color-danger);
}
.log-empty {
  color: #5a6a7d;
}
</style>
