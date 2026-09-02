<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertificateView } from '../types';
import StatusTag from '../components/StatusTag.vue';
import { caLabel, challengeLabel, daysLeftText, errMessage, formatDateOnly, keyTypeLabel } from '../utils';

const router = useRouter();
const certs = ref<CertificateView[]>([]);
const loading = ref(true);
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    certs.value = (await api.listCerts()).certificates;
  } catch {
    // 轮询失败时保持上次数据
  }
}

onMounted(async () => {
  await refresh();
  loading.value = false;
  timer = window.setInterval(refresh, 4000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

async function toggleAutoRenew(row: CertificateView, value: boolean): Promise<void> {
  try {
    await api.updateCert(row.id, { autoRenew: value });
    ElMessage.success(`已${value ? '开启' : '关闭'} ${row.primaryDomain} 的自动续期`);
  } catch (e) {
    ElMessage.error(errMessage(e));
    await refresh();
  }
}

async function renew(row: CertificateView): Promise<void> {
  await ElMessageBox.confirm(`确定立即续期 ${row.primaryDomain}？`, '续期证书', { type: 'warning' });
  try {
    await api.renewCert(row.id);
    ElMessage.success('已提交续期，执行过程可在日志中查看');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function reissue(row: CertificateView): Promise<void> {
  await ElMessageBox.confirm(
    `将向 ${caLabel(row.ca)} 重新申请 ${row.primaryDomain} 的证书。注意 Let's Encrypt 对同一域名组合的重复签发有每周次数限制。`,
    '重新签发',
    { type: 'warning', confirmButtonText: '重新签发' },
  );
  try {
    await api.reissueCert(row.id);
    ElMessage.success('已提交重新签发，执行过程可在日志中查看');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function remove(row: CertificateView): Promise<void> {
  await ElMessageBox.confirm(
    `删除 ${row.primaryDomain} 将同时移除本地证书文件和 acme.sh 中的记录，该操作不可恢复。`,
    '删除证书',
    { type: 'error', confirmButtonText: '删除' },
  );
  try {
    await api.deleteCert(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

function download(row: CertificateView, type: string): void {
  window.open(`/api/certificates/${row.id}/download?type=${type}`, '_blank');
}
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>全部证书</span>
          <el-button type="primary" icon="Plus" @click="router.push('/certificates/create')">创建证书</el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="certs">
        <el-table-column label="主域名" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="router.push(`/certificates/${row.id}`)">
              {{ row.primaryDomain }}
            </el-link>
            <span v-if="row.domains.length > 1" class="san-count">+{{ row.domains.length - 1 }} SAN</span>
          </template>
        </el-table-column>
        <el-table-column label="CA" width="120">
          <template #default="{ row }">{{ caLabel(row.ca) }}</template>
        </el-table-column>
        <el-table-column label="算法" width="100">
          <template #default="{ row }">{{ keyTypeLabel(row.keyType) }}</template>
        </el-table-column>
        <el-table-column label="验证" width="90">
          <template #default="{ row }">{{ challengeLabel(row.challengeType) }}</template>
        </el-table-column>
        <el-table-column label="到期时间" width="110">
          <template #default="{ row }">{{ formatDateOnly(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column label="剩余" width="100">
          <template #default="{ row }">{{ daysLeftText(row.daysLeft) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="95">
          <template #default="{ row }">
            <StatusTag :status="row.displayStatus" />
          </template>
        </el-table-column>
        <el-table-column label="自动续期" width="90">
          <template #default="{ row }">
            <el-switch
              :model-value="row.autoRenew"
              :disabled="row.status === 'issuing'"
              @change="(value: any) => toggleAutoRenew(row, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="router.push(`/certificates/${row.id}`)">详情</el-button>
            <el-button link type="primary" size="small" :disabled="row.status === 'issuing'" @click="renew(row)">
              续期
            </el-button>
            <el-button link type="warning" size="small" :disabled="row.status === 'issuing'" @click="reissue(row)">
              重新签发
            </el-button>
            <el-dropdown @command="(cmd: string) => download(row, cmd)">
              <el-button link type="primary" size="small">
                下载 <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="fullchain">证书（fullchain）</el-dropdown-item>
                  <el-dropdown-item command="cert">证书（仅域名）</el-dropdown-item>
                  <el-dropdown-item command="ca">CA 证书链</el-dropdown-item>
                  <el-dropdown-item command="key" divided>私钥</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button link type="danger" size="small" :disabled="row.status === 'issuing'" @click="remove(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有证书">
            <el-button type="primary" @click="router.push('/certificates/create')">创建证书</el-button>
          </el-empty>
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.san-count {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
