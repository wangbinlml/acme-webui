<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { PersistedLog } from '../types';
import LiveLog from '../components/LiveLog.vue';
import { canWrite } from '../auth';
import { errMessage, formatDate } from '../utils';

const activeTab = ref('live');
const logs = ref<PersistedLog[]>([]);
const levelFilter = ref('');
const loading = ref(false);

const retentionDays = ref(30);
const savingRetention = ref(false);
const cleaning = ref(false);

async function loadHistory(): Promise<void> {
  loading.value = true;
  try {
    logs.value = (
      await api.listLogs({ limit: 300, level: levelFilter.value || undefined })
    ).logs;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    loading.value = false;
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
      retentionDays.value === 0 ? '已设为永久保留（不再自动清理）' : `已设置保留 ${retentionDays.value} 天，每天自动清理`,
    );
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    savingRetention.value = false;
  }
}

async function cleanupNow(): Promise<void> {
  if (retentionDays.value <= 0) {
    ElMessage.warning('当前为永久保留模式，请先把保留天数设为大于 0');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将立即删除 ${retentionDays.value} 天前的日志、已过期的登录会话，并检查轮转 acme.sh 运行日志。`,
      '清理日志',
      { type: 'warning', confirmButtonText: '立即清理' },
    );
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
    <el-tabs v-model="activeTab" @tab-change="(name: string | number) => name === 'history' && loadHistory()">
      <el-tab-pane label="实时日志" name="live">
        <LiveLog height="560px" />
      </el-tab-pane>
      <el-tab-pane label="历史日志" name="history">
        <div class="history-toolbar">
          <el-select v-model="levelFilter" placeholder="全部级别" clearable style="width: 140px" @change="loadHistory">
            <el-option label="INFO" value="info" />
            <el-option label="WARN" value="warn" />
            <el-option label="ERROR" value="error" />
          </el-select>
          <el-button @click="loadHistory" icon="Refresh">刷新</el-button>
          <div v-if="canWrite()" class="retention-bar">
            <span class="retention-label">保留</span>
            <el-input-number v-model="retentionDays" :min="0" :max="3650" size="small" style="width: 110px" />
            <span class="retention-label">天前的日志，每天自动清理（0 = 永久保留）</span>
            <el-button size="small" :loading="savingRetention" @click="saveRetention">保存</el-button>
            <el-button size="small" type="warning" plain :loading="cleaning" @click="cleanupNow">立即清理</el-button>
          </div>
        </div>
        <el-table v-loading="loading" :data="logs" style="margin-top: 12px">
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="级别" width="90">
            <template #default="{ row }">
              <el-tag :type="levelTagType(row.level)" size="small">{{ row.level.toUpperCase() }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="关联证书" width="180">
            <template #default="{ row }">{{ row.domain ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="消息" min-width="320">
            <template #default="{ row }">
              <span class="msg">{{ row.message }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="还没有历史日志" :image-size="60" />
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
  color: #909399;
}
.msg {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
