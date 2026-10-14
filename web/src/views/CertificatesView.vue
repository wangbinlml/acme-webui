<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertificateView } from '../types';
import { canWrite } from '../auth';
import StatusTag from '../components/StatusTag.vue';
import { caLabel, challengeLabel, daysLeftText, errMessage, formatDateOnly, keyTypeLabel } from '../utils';

const router = useRouter();
const certs = ref<CertificateView[]>([]);
const loading = ref(true);
const selectedCerts = ref<CertificateView[]>([]);
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
  try {
    await ElMessageBox.confirm(
      `删除 ${row.primaryDomain} 将同时移除本地证书文件和 acme.sh 中的记录，该操作不可恢复。\n\n如需同时向 CA 吊销证书（使其立即失效），请点击「吊销并删除」。`,
      '删除证书',
      {
        type: 'error',
        confirmButtonText: '吊销并删除',
        cancelButtonText: '仅删除',
        distinguishCancelAndClose: true,
      },
    );
    await doDelete(row, true);
  } catch (action: unknown) {
    if (action === 'cancel') {
      await doDelete(row, false);
    }
  }
}

async function doDelete(row: CertificateView, revoke: boolean): Promise<void> {
  try {
    const res = await api.deleteCert(row.id, revoke);
    if (revoke) {
      if (res.revoked) ElMessage.success(`已吊销并删除 ${row.primaryDomain}`);
      else ElMessage.warning(`已删除 ${row.primaryDomain}，但吊销未成功${res.revokeError ? `（${res.revokeError}）` : ''}`);
    } else {
      ElMessage.success('已删除');
    }
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

function download(row: CertificateView, type: string): void {
  window.open(`/api/certificates/${row.id}/download?type=${type}`, '_blank');
}

function handleSelectionChange(rows: CertificateView[]): void {
  selectedCerts.value = rows;
}

async function batchRenew(): Promise<void> {
  const targets = selectedCerts.value.filter((c) => c.status !== 'issuing');
  if (targets.length === 0) {
    ElMessage.info('没有可续期的证书（已排除签发中的）');
    return;
  }
  await ElMessageBox.confirm(`确定批量续期 ${targets.length} 个证书？`, '批量续期', { type: 'warning' });
  let ok = 0;
  let fail = 0;
  for (const cert of targets) {
    try {
      await api.renewCert(cert.id);
      ok++;
    } catch {
      fail++;
    }
  }
  ElMessage.success(`已提交 ${ok} 个续期${fail > 0 ? `，${fail} 个失败` : ''}`);
  await refresh();
}

async function batchDelete(): Promise<void> {
  const targets = selectedCerts.value.filter((c) => c.status !== 'issuing');
  if (targets.length === 0) {
    ElMessage.info('没有可删除的证书（已排除签发中的）');
    return;
  }
  await ElMessageBox.confirm(
    `确定批量删除 ${targets.length} 个证书？此操作不可恢复。`,
    '批量删除',
    { type: 'error', confirmButtonText: '删除' },
  );
  let ok = 0;
  let fail = 0;
  for (const cert of targets) {
    try {
      await api.deleteCert(cert.id);
      ok++;
    } catch {
      fail++;
    }
  }
  ElMessage.success(`已删除 ${ok} 个${fail > 0 ? `，${fail} 个失败` : ''}`);
  await refresh();
}
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>全部证书</span>
          <div v-if="canWrite()" class="header-actions">
            <el-button type="primary" icon="Plus" @click="router.push('/certificates/create')">创建证书</el-button>
            <el-button icon="Upload" @click="router.push('/certificates/import')">导入证书</el-button>
          </div>
        </div>
      </template>
      <div v-if="selectedCerts.length > 0 && canWrite()" class="batch-bar">
        <span>已选 {{ selectedCerts.length }} 项</span>
        <el-button size="small" type="primary" @click="batchRenew">批量续期</el-button>
        <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
      </div>
      <el-table v-loading="loading" :data="certs" @selection-change="handleSelectionChange">
        <el-table-column v-if="canWrite()" type="selection" width="40" />
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
              :disabled="row.status === 'issuing' || !canWrite()"
              @change="(value: any) => toggleAutoRenew(row, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="router.push(`/certificates/${row.id}`)">详情</el-button>
            <el-button v-if="canWrite()" link type="primary" size="small" :disabled="row.status === 'issuing'" @click="renew(row)">
              续期
            </el-button>
            <el-button v-if="canWrite()" link type="warning" size="small" :disabled="row.status === 'issuing'" @click="reissue(row)">
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
            <el-button v-if="canWrite()" link type="danger" size="small" :disabled="row.status === 'issuing'" @click="remove(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有证书">
            <el-button v-if="canWrite()" type="primary" @click="router.push('/certificates/create')">创建证书</el-button>
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
.header-actions {
  display: flex;
  gap: 8px;
}
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #ecf5ff;
  border-radius: 4px;
  font-size: 13px;
  color: #409eff;
}
.san-count {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
