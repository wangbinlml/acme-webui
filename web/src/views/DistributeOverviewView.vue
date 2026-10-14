<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { DistributeTarget } from '../types';
import { canWrite } from '../auth';
import { errMessage, formatDate } from '../utils';

const router = useRouter();
const targets = ref<DistributeTarget[]>([]);
const loading = ref(true);
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    targets.value = (await api.listAllDistributeTargets()).targets;
  } catch {
    // 轮询失败时保持上次数据
  }
}

onMounted(async () => {
  await refresh();
  loading.value = false;
  timer = window.setInterval(refresh, 10000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const stats = computed(() => {
  const total = targets.value.length;
  const stale = targets.value.filter((t) => t.stale).length;
  const failed = targets.value.filter((t) => t.lastSyncStatus === 'error').length;
  const ok = total - stale - failed;
  return [
    { label: '分发目标', value: total, cls: 'card-total' },
    { label: '正常同步', value: ok, cls: 'card-ok' },
    { label: '失联', value: stale, cls: 'card-warn' },
    { label: '同步失败', value: failed, cls: 'card-err' },
  ];
});

function syncStatusType(status: string | null): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'success') return 'success';
  if (status === 'no_change') return 'info';
  if (status === 'error') return 'danger';
  return 'warning';
}
function syncStatusLabel(status: string | null): string {
  if (status === 'success') return '已更新';
  if (status === 'no_change') return '无变化';
  if (status === 'error') return '失败';
  return '未知';
}
function reloadModeLabel(mode: string | null, container: string | null): string {
  if (mode === 'docker') return container ? `Docker（${container}）` : 'Docker';
  if (mode === 'nginx') return 'nginx';
  return '—';
}

async function deleteTarget(id: number, ip: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除分发目标 ${ip}？`, '删除目标', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.deleteDistributeTarget(id);
    ElMessage.success('已删除');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}
</script>

<template>
  <div v-loading="loading">
    <div class="stat-cards">
      <div v-for="s in stats" :key="s.label" :class="['stat-card', s.cls]">
        <span class="stat-value">{{ s.value }}</span>
        <span class="stat-label">{{ s.label }}</span>
      </div>
    </div>

    <el-card shadow="never">
      <template #header>全部分发目标</template>
      <el-table :data="targets" style="width: 100%">
        <el-table-column label="域名" width="150">
          <template #default="{ row }">
            <el-link v-if="row.certId" type="primary" :underline="false" @click="router.push(`/certificates/${row.certId}`)">
              {{ row.primaryDomain }}
            </el-link>
            <span v-else>{{ row.primaryDomain }}</span>
          </template>
        </el-table-column>
        <el-table-column label="服务器 IP" width="140">
          <template #default="{ row }">
            {{ row.ip }}
            <el-tag v-if="row.stale" type="warning" size="small" style="margin-left: 4px">失联</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="部署模式" width="130">
          <template #default="{ row }">{{ reloadModeLabel(row.reloadMode, row.container) }}</template>
        </el-table-column>
        <el-table-column label="标签" width="120">
          <template #default="{ row }">
            <el-tag v-for="t in row.tags" :key="t" size="small" style="margin: 2px">{{ t }}</el-tag>
            <span v-if="row.tags.length === 0" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="最后同步" width="160">
          <template #default="{ row }">
            <span v-if="row.lastSyncAt">{{ formatDate(row.lastSyncAt) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.lastSyncStatus" :type="syncStatusType(row.lastSyncStatus)" size="small">
              {{ syncStatusLabel(row.lastSyncStatus) }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canWrite()" label="操作" width="60">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="deleteTarget(row.id, row.ip)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有分发目标（在证书详情页点「分发到其他服务器」开始）" :image-size="60" />
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.stat-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
}
.stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}
.card-total .stat-value { color: #303133; }
.card-ok .stat-value { color: #67c23a; }
.card-warn .stat-value { color: #e6a23c; }
.card-err .stat-value { color: #f56c6c; }
.muted {
  color: #909399;
}
</style>
