<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertificateView } from '../types';
import { canWrite } from '../auth';
import StatusTag from '../components/StatusTag.vue';
import { errMessage, formatDateOnly, keyTypeLabel } from '../utils';

const { t } = useI18n();
const router = useRouter();
const certs = ref<CertificateView[]>([]);
const loading = ref(true);
const selectedCerts = ref<CertificateView[]>([]);
const searchText = ref('');
const statusFilter = ref('');
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

const filteredCerts = computed(() => {
  const kw = searchText.value.trim().toLowerCase();
  return certs.value.filter((c) => {
    if (statusFilter.value && c.displayStatus !== statusFilter.value) return false;
    if (kw && !c.domains.some((d) => d.toLowerCase().includes(kw))) return false;
    return true;
  });
});

async function toggleAutoRenew(row: CertificateView, value: boolean): Promise<void> {
  try {
    await api.updateCert(row.id, { autoRenew: value });
    ElMessage.success(value ? t('certs.autoRenewOn', { domain: row.primaryDomain }) : t('certs.autoRenewOff', { domain: row.primaryDomain }));
  } catch (e) {
    ElMessage.error(errMessage(e));
    await refresh();
  }
}

async function renew(row: CertificateView): Promise<void> {
  await ElMessageBox.confirm(t('certs.renewConfirm', { domain: row.primaryDomain }), t('certs.renewConfirmTitle'), {
    type: 'warning',
  });
  try {
    await api.renewCert(row.id);
    ElMessage.success(t('certs.renewSubmitted'));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function reissue(row: CertificateView): Promise<void> {
  await ElMessageBox.confirm(t('certs.reissueConfirm', { ca: t(`ca.${row.ca}`), domain: row.primaryDomain }), t('certs.reissueTitle'), {
    type: 'warning',
    confirmButtonText: t('certs.reissueBtn'),
  });
  try {
    await api.reissueCert(row.id);
    ElMessage.success(t('certs.reissueSubmitted'));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function remove(row: CertificateView): Promise<void> {
  try {
    await ElMessageBox.confirm(t('certs.deleteConfirm', { domain: row.primaryDomain }), t('certs.deleteTitle'), {
      type: 'error',
      confirmButtonText: t('certs.revokeAndDelete'),
      cancelButtonText: t('certs.onlyDelete'),
      distinguishCancelAndClose: true,
    });
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
      if (res.revoked) ElMessage.success(t('certs.revokedDeleted', { domain: row.primaryDomain }));
      else
        ElMessage.warning(
          t('certs.deletedButRevokeFailed', { domain: row.primaryDomain, err: res.revokeError ? `（${res.revokeError}）` : '' }),
        );
    } else {
      ElMessage.success(t('certs.deleted'));
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
    ElMessage.info(t('certs.batchNoRenewable'));
    return;
  }
  await ElMessageBox.confirm(t('certs.batchRenewConfirm', { n: targets.length }), t('certs.batchRenewTitle'), {
    type: 'warning',
  });
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
  ElMessage.success(t('certs.batchRenewDone', { ok, fail }));
  await refresh();
}

async function batchDelete(): Promise<void> {
  const targets = selectedCerts.value.filter((c) => c.status !== 'issuing');
  if (targets.length === 0) {
    ElMessage.info(t('certs.batchNoDeletable'));
    return;
  }
  await ElMessageBox.confirm(t('certs.batchDeleteConfirm', { n: targets.length }), t('certs.batchDeleteTitle'), {
    type: 'error',
    confirmButtonText: t('common.confirm'),
  });
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
  ElMessage.success(t('certs.batchDeleteDone', { ok, fail }));
  await refresh();
}
</script>

<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ t('certs.title') }}</span>
          <div v-if="canWrite()" class="header-actions">
            <el-button type="primary" icon="Plus" @click="router.push('/certificates/create')">{{ t('certs.create') }}</el-button>
            <el-button icon="Upload" @click="router.push('/certificates/import')">{{ t('certs.import') }}</el-button>
          </div>
        </div>
      </template>

      <div class="toolbar">
        <el-input
          v-model="searchText"
          :placeholder="t('certs.searchPlaceholder')"
          clearable
          class="search-input"
          :prefix-icon="'Search'"
        />
        <el-select v-model="statusFilter" :placeholder="t('certs.filterAll')" clearable class="status-filter">
          <el-option :label="t('certs.filterAll')" value="" />
          <el-option :label="t('status.ok')" value="ok" />
          <el-option :label="t('status.expiring')" value="expiring" />
          <el-option :label="t('status.expired')" value="expired" />
          <el-option :label="t('status.error')" value="error" />
          <el-option :label="t('status.issuing')" value="issuing" />
        </el-select>
      </div>

      <div v-if="selectedCerts.length > 0 && canWrite()" class="batch-bar">
        <span>{{ t('certs.batchSelected', { n: selectedCerts.length }) }}</span>
        <el-button size="small" type="primary" @click="batchRenew">{{ t('certs.batchRenew') }}</el-button>
        <el-button size="small" type="danger" @click="batchDelete">{{ t('certs.batchDelete') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="filteredCerts" @selection-change="handleSelectionChange">
        <el-table-column v-if="canWrite()" type="selection" width="40" />
        <el-table-column :label="t('certs.colDomain')" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="router.push(`/certificates/${row.id}`)">
              {{ row.primaryDomain }}
            </el-link>
            <span v-if="row.domains.length > 1" class="san-count">{{ t('certs.sanSuffix', { n: row.domains.length - 1 }) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('certs.colCa')" width="120">
          <template #default="{ row }">{{ t(`ca.${row.ca}`) }}</template>
        </el-table-column>
        <el-table-column :label="t('certs.colAlgo')" width="100">
          <template #default="{ row }">{{ keyTypeLabel(row.keyType) }}</template>
        </el-table-column>
        <el-table-column :label="t('certs.colChallenge')" width="90">
          <template #default="{ row }">{{ t(`challenge.${row.challengeType}`) }}</template>
        </el-table-column>
        <el-table-column :label="t('certs.colExpires')" width="110">
          <template #default="{ row }">{{ formatDateOnly(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('certs.colLeft')" width="100">
          <template #default="{ row }">
            {{ row.daysLeft === null ? '-' : row.daysLeft < 0 ? t('days.expiredAgo', { n: -row.daysLeft }) : t('days.left', { n: row.daysLeft }) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('certs.colStatus')" width="95">
          <template #default="{ row }">
            <StatusTag :status="row.displayStatus" />
          </template>
        </el-table-column>
        <el-table-column :label="t('certs.colAutoRenew')" width="90">
          <template #default="{ row }">
            <el-switch
              :model-value="row.autoRenew"
              :disabled="row.status === 'issuing' || !canWrite()"
              @change="(value: any) => toggleAutoRenew(row, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('certs.colActions')" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="router.push(`/certificates/${row.id}`)">{{ t('certs.detail') }}</el-button>
            <el-button v-if="canWrite()" link type="primary" size="small" :disabled="row.status === 'issuing'" @click="renew(row)">
              {{ t('certs.renew') }}
            </el-button>
            <el-button v-if="canWrite()" link type="warning" size="small" :disabled="row.status === 'issuing'" @click="reissue(row)">
              {{ t('certs.reissue') }}
            </el-button>
            <el-dropdown @command="(cmd: string) => download(row, cmd)">
              <el-button link type="primary" size="small">
                {{ t('certs.download') }} <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="fullchain">{{ t('certs.downloadFullchain') }}</el-dropdown-item>
                  <el-dropdown-item command="cert">{{ t('certs.downloadCert') }}</el-dropdown-item>
                  <el-dropdown-item command="ca">{{ t('certs.downloadCa') }}</el-dropdown-item>
                  <el-dropdown-item command="key" divided>{{ t('certs.downloadKey') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button v-if="canWrite()" link type="danger" size="small" :disabled="row.status === 'issuing'" @click="remove(row)">
              {{ t('certs.deleteBtn') }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('certs.empty')">
            <el-button v-if="canWrite()" type="primary" @click="router.push('/certificates/create')">{{ t('certs.create') }}</el-button>
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
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search-input {
  width: 260px;
}
.status-filter {
  width: 150px;
}
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
  font-size: 13px;
  color: var(--el-color-primary);
}
.san-count {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
