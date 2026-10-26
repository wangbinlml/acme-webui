<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { DashboardData } from '../types';
import StatusTag from '../components/StatusTag.vue';
import { formatDateOnly, keyTypeLabel } from '../utils';

const router = useRouter();
const { t } = useI18n();
const data = ref<DashboardData | null>(null);
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    data.value = await api.dashboard();
  } catch {
    // 轮询失败时保持上次数据
  }
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(refresh, 5000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const cards = computed(() => [
  { label: t('dashboard.total'), value: data.value?.stats.total ?? 0, cls: 'card-total' },
  { label: t('dashboard.ok'), value: data.value?.stats.ok ?? 0, cls: 'card-ok' },
  { label: t('dashboard.expiring'), value: data.value?.stats.expiring ?? 0, cls: 'card-warn' },
  {
    label: t('dashboard.bad'),
    value: (data.value?.stats.expired ?? 0) + (data.value?.stats.error ?? 0),
    cls: 'card-bad',
  },
]);
</script>

<template>
  <div>
    <el-row :gutter="16">
      <el-col v-for="card in cards" :key="card.label" :span="6">
        <el-card shadow="never" class="stat-card">
          <div :class="['stat-value', card.cls]">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="recent-card">
      <template #header>
        <div class="card-header">
          <span>{{ t('dashboard.recent') }}</span>
          <el-button text type="primary" @click="router.push('/certificates')">{{ t('dashboard.viewAll') }}</el-button>
        </div>
      </template>
      <el-table
        v-loading="!data"
        :data="data?.recent ?? []"
        @row-click="(row: any) => router.push(`/certificates/${row.id}`)"
        class="clickable-table"
      >
        <el-table-column :label="t('dashboard.primaryDomain')" min-width="200">
          <template #default="{ row }">
            <span class="domain">{{ row.primaryDomain }}</span>
            <span v-if="row.domains.length > 1" class="san-count">+{{ row.domains.length - 1 }} SAN</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('dashboard.domains')" min-width="220">
          <template #default="{ row }">
            <span class="muted">{{ row.domains.join('、') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('dashboard.ca')" width="130">
          <template #default="{ row }">{{ t(`ca.${row.ca}`) }}</template>
        </el-table-column>
        <el-table-column :label="t('dashboard.algo')" width="100">
          <template #default="{ row }">{{ keyTypeLabel(row.keyType) }}</template>
        </el-table-column>
        <el-table-column :label="t('dashboard.expiresAt')" width="120">
          <template #default="{ row }">{{ formatDateOnly(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('dashboard.left')" width="100">
          <template #default="{ row }">
            {{ row.daysLeft === null ? '-' : row.daysLeft < 0 ? t('days.expiredAgo', { n: -row.daysLeft }) : t('days.left', { n: row.daysLeft }) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('dashboard.status')" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.displayStatus" />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('dashboard.empty')">
            <el-button type="primary" @click="router.push('/certificates/create')">{{ t('dashboard.create') }}</el-button>
          </el-empty>
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.stat-card {
  text-align: center;
}
.stat-value {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.2;
}
.card-total {
  color: var(--el-text-color-primary);
}
.card-ok {
  color: #67c23a;
}
.card-warn {
  color: var(--el-color-warning);
}
.card-bad {
  color: #f56c6c;
}
.stat-label {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.recent-card {
  margin-top: 16px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.domain {
  font-weight: 600;
}
.san-count {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.clickable-table :deep(tbody tr) {
  cursor: pointer;
}
</style>
