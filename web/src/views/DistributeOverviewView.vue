<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { DistributeTarget } from '../types';
import { canWrite } from '../auth';
import { errMessage, formatDate } from '../utils';

const { t } = useI18n();
const router = useRouter();
const targets = ref<DistributeTarget[]>([]);
const loading = ref(true);
const probingId = ref<number | null>(null);
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
  const stale = targets.value.filter((x) => x.stale).length;
  const failed = targets.value.filter((x) => x.lastSyncStatus === 'error').length;
  return [
    { label: t('distribute.total'), value: total, cls: 'card-total' },
    { label: t('distribute.ok'), value: total - stale - failed, cls: 'card-ok' },
    { label: t('distribute.stale'), value: stale, cls: 'card-warn' },
    { label: t('distribute.failed'), value: failed, cls: 'card-err' },
  ];
});

function syncStatusType(status: string | null): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'success') return 'success';
  if (status === 'no_change') return 'info';
  if (status === 'error') return 'danger';
  return 'warning';
}
function syncStatusLabel(status: string | null): string {
  if (status === 'success') return t('distribute.sync.success');
  if (status === 'no_change') return t('distribute.sync.no_change');
  if (status === 'error') return t('distribute.sync.error');
  return t('distribute.sync.unknown');
}
function reloadModeLabel(mode: string | null, container: string | null): string {
  if (mode === 'docker') return container ? t('distribute.modeDocker', { container }) : 'Docker';
  if (mode === 'nginx') return t('distribute.modeNginx');
  return t('common.none');
}
function probeLabel(status: string | null): string {
  if (status === 'match') return t('distribute.probeMatch');
  if (status === 'mismatch') return t('distribute.probeMismatch');
  if (status === 'unreachable') return t('distribute.probeUnreachable');
  return t('distribute.probeNotRun');
}
function probeType(status: string | null): 'success' | 'danger' | 'warning' | 'info' {
  if (status === 'match') return 'success';
  if (status === 'mismatch') return 'danger';
  if (status === 'unreachable') return 'warning';
  return 'info';
}

async function probe(row: DistributeTarget): Promise<void> {
  probingId.value = row.id;
  try {
    const res = await api.probeDistributeTarget(row.id);
    const label = res.status === 'match' ? t('distribute.probeMatch') : res.status === 'mismatch' ? t('distribute.probeMismatch') : t('distribute.probeUnreachable');
    if (res.status === 'match') ElMessage.success(t('distribute.probeDone', { status: label }));
    else if (res.status === 'mismatch') ElMessage.warning(t('distribute.probeDone', { status: label }));
    else ElMessage.error(t('distribute.probeDone', { status: label }));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    probingId.value = null;
  }
}

async function deleteTarget(id: number, ip: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('distribute.deleteConfirm', { ip }), t('distribute.deleteTitle'), { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.deleteDistributeTarget(id);
    ElMessage.success(t('distribute.deleted'));
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
      <template #header>{{ t('distribute.tableTitle') }}</template>
      <el-table :data="targets" style="width: 100%">
        <el-table-column :label="t('distribute.colDomain')">
          <template #default="{ row }">
            <el-link v-if="row.certId" type="primary" :underline="false" @click="router.push(`/certificates/${row.certId}`)">
              {{ row.primaryDomain }}
            </el-link>
            <span v-else>{{ row.primaryDomain }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colIp')">
          <template #default="{ row }">
            {{ row.ip }}
            <el-tag v-if="row.stale" type="warning" size="small" style="margin-left: 4px">{{ t('distribute.stale') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colHostname')">
          <template #default="{ row }">
            <span v-if="row.hostname">{{ row.hostname }}</span>
            <span v-else class="muted">{{ t('common.none') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colMode')">
          <template #default="{ row }">{{ reloadModeLabel(row.reloadMode, row.container) }}</template>
        </el-table-column>
        <el-table-column :label="t('distribute.colTags')">
          <template #default="{ row }">
            <el-tag v-for="tag in row.tags" :key="tag" size="small" style="margin: 2px">{{ tag }}</el-tag>
            <span v-if="row.tags.length === 0" class="muted">{{ t('common.none') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colLastSync')" width="160">
          <template #default="{ row }">
            <span v-if="row.lastSyncAt">{{ formatDate(row.lastSyncAt) }}</span>
            <span v-else class="muted">{{ t('common.none') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colStatus')" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.lastSyncStatus" :type="syncStatusType(row.lastSyncStatus)" size="small">
              {{ syncStatusLabel(row.lastSyncStatus) }}
            </el-tag>
            <span v-else class="muted">{{ t('common.none') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('distribute.colProbe')" width="130">
          <template #default="{ row }">
            <el-tooltip v-if="row.lastProbeMessage" :content="row.lastProbeMessage" placement="top">
              <el-tag :type="probeType(row.lastProbeStatus)" size="small">{{ probeLabel(row.lastProbeStatus) }}</el-tag>
            </el-tooltip>
            <el-tag v-else :type="probeType(row.lastProbeStatus)" size="small">{{ probeLabel(row.lastProbeStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="canWrite()" :label="t('common.actions')" width="130">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :loading="probingId === row.id" @click="probe(row)">
              {{ t('distribute.probeBtn') }}
            </el-button>
            <el-button link type="danger" size="small" @click="deleteTarget(row.id, row.ip)">
              {{ t('common.delete') }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('distribute.empty')" :image-size="60" />
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
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-lighter);
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
}
.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.card-total .stat-value { color: var(--el-text-color-primary); }
.card-ok .stat-value { color: var(--el-color-success); }
.card-warn .stat-value { color: var(--el-color-warning); }
.card-err .stat-value { color: var(--el-color-danger); }
.muted {
  color: var(--el-text-color-secondary);
}
</style>
