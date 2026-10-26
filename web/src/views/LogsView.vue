<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { AuditLog, PersistedLog } from '../types';
import LiveLog from '../components/LiveLog.vue';
import { canWrite } from '../auth';
import { errMessage, formatDate } from '../utils';

const { t } = useI18n();
const activeTab = ref('live');
const logs = ref<PersistedLog[]>([]);
const levelFilter = ref('');
const loading = ref(false);

const retentionDays = ref(30);
const savingRetention = ref(false);
const cleaning = ref(false);

// ---- 审计日志 ----
const auditLogs = ref<AuditLog[]>([]);
const auditLoading = ref(false);
const auditUser = ref('');
const auditAction = ref('');
const auditActions = ref<string[]>([]);

async function loadHistory(): Promise<void> {
  loading.value = true;
  try {
    logs.value = (await api.listLogs({ limit: 300, level: levelFilter.value || undefined })).logs;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    loading.value = false;
  }
}

async function loadAudit(): Promise<void> {
  auditLoading.value = true;
  try {
    auditLogs.value = (
      await api.listAuditLogs({
        limit: 300,
        username: auditUser.value.trim() || undefined,
        action: auditAction.value || undefined,
      })
    ).logs;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    auditLoading.value = false;
  }
}

async function loadAuditActions(): Promise<void> {
  try {
    auditActions.value = (await api.listAuditActions()).actions;
  } catch {
    // 筛选项加载失败不影响主列表
  }
}

function onTabChange(name: string | number): void {
  if (name === 'history') loadHistory();
  if (name === 'audit') {
    loadAudit();
    loadAuditActions();
  }
}

onMounted(async () => {
  loadHistory();
  try {
    retentionDays.value = (await api.getSettings()).logRetentionDays;
  } catch {
    // 设置加载失败时用默认值展示
  }
});

function levelTagType(level: string): 'success' | 'warning' | 'danger' | 'info' {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'info';
}

async function saveRetention(): Promise<void> {
  savingRetention.value = true;
  try {
    await api.saveSettings({ logRetentionDays: retentionDays.value });
    ElMessage.success(
      retentionDays.value === 0 ? t('logs.retentionPermanentSaved') : t('logs.retentionSaved', { n: retentionDays.value }),
    );
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    savingRetention.value = false;
  }
}

async function cleanupNow(): Promise<void> {
  if (retentionDays.value <= 0) {
    ElMessage.warning(t('logs.cleanupDisabled'));
    return;
  }
  try {
    await ElMessageBox.confirm(t('logs.cleanupConfirm', { n: retentionDays.value }), t('logs.cleanupTitle'), {
      type: 'warning',
      confirmButtonText: t('logs.cleanupNow'),
    });
  } catch {
    return; // 用户取消
  }
  cleaning.value = true;
  try {
    const res = await api.cleanupLogs();
    ElMessage.success(res.message);
    if (activeTab.value === 'history') await loadHistory();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    cleaning.value = false;
  }
}
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane :label="t('logs.live')" name="live">
        <LiveLog height="560px" />
      </el-tab-pane>
      <el-tab-pane :label="t('logs.history')" name="history">
        <div class="history-toolbar">
          <el-select v-model="levelFilter" :placeholder="t('common.all')" clearable style="width: 140px" @change="loadHistory">
            <el-option label="INFO" value="info" />
            <el-option label="WARN" value="warn" />
            <el-option label="ERROR" value="error" />
          </el-select>
          <el-button @click="loadHistory" icon="Refresh">{{ t('common.refresh') }}</el-button>
          <div v-if="canWrite()" class="retention-bar">
            <span class="retention-label">{{ t('logs.retention') }}</span>
            <el-input-number v-model="retentionDays" :min="0" :max="3650" size="small" style="width: 110px" />
            <span class="retention-label">{{ t('logs.retentionUnit') }}</span>
            <el-button size="small" :loading="savingRetention" @click="saveRetention">{{ t('common.save') }}</el-button>
            <el-button size="small" type="warning" plain :loading="cleaning" @click="cleanupNow">
              {{ t('logs.cleanupNow') }}
            </el-button>
          </div>
        </div>
        <el-table v-loading="loading" :data="logs" style="margin-top: 12px">
          <el-table-column :label="t('common.time')" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column :label="t('logs.level')" width="90">
            <template #default="{ row }">
              <el-tag :type="levelTagType(row.level)" size="small">{{ row.level.toUpperCase() }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('logs.relatedCert')" width="180">
            <template #default="{ row }">{{ row.domain ?? '-' }}</template>
          </el-table-column>
          <el-table-column :label="t('logs.message')" min-width="320">
            <template #default="{ row }">
              <span class="msg">{{ row.message }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('logs.empty')" :image-size="60" />
          </template>
        </el-table>
      </el-tab-pane>
      <el-tab-pane v-if="canWrite()" :label="t('logs.audit')" name="audit">
        <div class="history-toolbar">
          <el-input
            v-model="auditUser"
            :placeholder="t('logs.auditUserPlaceholder')"
            clearable
            style="width: 180px"
            @keyup.enter="loadAudit"
            @clear="loadAudit"
          />
          <el-select v-model="auditAction" :placeholder="t('logs.auditActionPlaceholder')" clearable style="width: 200px" @change="loadAudit">
            <el-option v-for="a in auditActions" :key="a" :label="t(`audit.${a}`)" :value="a" />
          </el-select>
          <el-button @click="loadAudit" icon="Refresh">{{ t('common.refresh') }}</el-button>
        </div>
        <el-table v-loading="auditLoading" :data="auditLogs" style="margin-top: 12px">
          <el-table-column :label="t('logs.auditColTime')" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column :label="t('logs.auditColUser')" width="120">
            <template #default="{ row }">{{ row.username }}</template>
          </el-table-column>
          <el-table-column :label="t('logs.auditColAction')" width="160">
            <template #default="{ row }">
              <el-tag size="small">{{ t(`audit.${row.action}`) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('logs.auditColDetail')" min-width="320">
            <template #default="{ row }">
              <span class="msg">{{ row.detail ?? '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('logs.auditColIp')" width="140">
            <template #default="{ row }">{{ row.ip ?? '-' }}</template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('logs.auditEmpty')" :image-size="60" />
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<style scoped>
.history-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.retention-bar {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.retention-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.msg {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
