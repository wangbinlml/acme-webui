<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { PersistedLog } from '../types';
import LiveLog from '../components/LiveLog.vue';
import { errMessage, formatDate } from '../utils';

const activeTab = ref('live');
const logs = ref<PersistedLog[]>([]);
const levelFilter = ref('');
const loading = ref(false);

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

onMounted(loadHistory);

function levelTagType(level: string): 'success' | 'warning' | 'danger' | 'info' {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'info';
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
  gap: 8px;
}
.msg {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
