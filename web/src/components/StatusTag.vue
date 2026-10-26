<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DisplayStatus } from '../types';

const props = defineProps<{ status: DisplayStatus }>();
const { t } = useI18n();

const TYPE_MAP: Record<DisplayStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  issuing: 'info',
  ok: 'success',
  expiring: 'warning',
  expired: 'danger',
  error: 'danger',
};

const meta = computed(() => ({ type: TYPE_MAP[props.status], label: t(`status.${props.status}`) }));
</script>

<template>
  <el-tag :type="meta.type" size="small">
    {{ meta.label }}
  </el-tag>
</template>
