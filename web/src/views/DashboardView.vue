<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import type { DashboardData } from '../types';
import StatusTag from '../components/StatusTag.vue';
import { caLabel, daysLeftText, formatDateOnly, keyTypeLabel } from '../utils';

const router = useRouter();
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
  { label: '证书总数', value: data.value?.stats.total ?? 0, cls: 'card-total' },
  { label: '正常', value: data.value?.stats.ok ?? 0, cls: 'card-ok' },
  { label: '即将过期', value: data.value?.stats.expiring ?? 0, cls: 'card-warn' },
  {
    label: '异常（过期 / 错误）',
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
          <span>最近证书</span>
          <el-button text type="primary" @click="router.push('/certificates')">查看全部</el-button>
        </div>
      </template>
      <el-table
        v-loading="!data"
        :data="data?.recent ?? []"
        @row-click="(row: any) => router.push(`/certificates/${row.id}`)"
        class="clickable-table"
      >
        <el-table-column label="主域名" min-width="200">
          <template #default="{ row }">
            <span class="domain">{{ row.primaryDomain }}</span>
            <span v-if="row.domains.length > 1" class="san-count">+{{ row.domains.length - 1 }} SAN</span>
          </template>
        </el-table-column>
        <el-table-column label="域名" min-width="220">
          <template #default="{ row }">
            <span class="muted">{{ row.domains.join('、') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="CA" width="130">
          <template #default="{ row }">{{ caLabel(row.ca) }}</template>
        </el-table-column>
        <el-table-column label="算法" width="100">
          <template #default="{ row }">{{ keyTypeLabel(row.keyType) }}</template>
        </el-table-column>
        <el-table-column label="到期时间" width="120">
          <template #default="{ row }">{{ formatDateOnly(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column label="剩余" width="100">
          <template #default="{ row }">{{ daysLeftText(row.daysLeft) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.displayStatus" />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有证书，去创建第一张吧">
            <el-button type="primary" @click="router.push('/certificates/create')">创建证书</el-button>
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
  color: #303133;
}
.card-ok {
  color: #67c23a;
}
.card-warn {
  color: #e6a23c;
}
.card-bad {
  color: #f56c6c;
}
.stat-label {
  margin-top: 6px;
  color: #909399;
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
  color: #909399;
}
.muted {
  color: #909399;
  font-size: 13px;
}
.clickable-table :deep(tbody tr) {
  cursor: pointer;
}
</style>
