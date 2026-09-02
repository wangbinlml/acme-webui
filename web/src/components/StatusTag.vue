<script setup lang="ts">
import { computed } from 'vue';
import type { DisplayStatus } from '../types';
import { statusMeta } from '../utils';

const props = defineProps<{ status: DisplayStatus }>();
const meta = computed(() => statusMeta(props.status));
</script>

<template>
  <el-tag :type="meta.type" size="small">
    {{ meta.label }}
  </el-tag>
</template>
