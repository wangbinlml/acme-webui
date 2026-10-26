<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertInfo, CertificateView, DistributeTarget } from '../types';
import { canWrite } from '../auth';
import StatusTag from '../components/StatusTag.vue';
import LiveLog from '../components/LiveLog.vue';
import { errMessage, formatDate, formatDateOnly, keyTypeLabel } from '../utils';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const certId = Number(route.params.id);

const cert = ref<CertificateView | null>(null);
const certInfo = ref<CertInfo | null>(null);
const renewBeforeDays = ref(30);
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    const res = await api.getCert(certId);
    cert.value = res.certificate;
    certInfo.value = res.certInfo;
    renewBeforeDays.value = res.certificate.renewBeforeDays;
  } catch {
    // 轮询失败时保持上次数据
  }
}

onMounted(async () => {
  await refresh();
  timer = window.setInterval(refresh, 3000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const isIssuing = computed(() => cert.value?.status === 'issuing');
const providerName = ref('');
onMounted(async () => {
  try {
    const providers = (await api.listProviders()).providers;
    const match = providers.find((p) => p.id === cert.value?.dnsProviderId);
    providerName.value = match ? `${match.name}（${match.typeName}）` : '';
  } catch {
    providerName.value = '';
  }
});

async function renew(): Promise<void> {
  if (!cert.value) return;
  await ElMessageBox.confirm(
    t('certDetail.renewConfirm', { domain: cert.value.primaryDomain }),
    t('certDetail.renewTitle'),
    { type: 'warning' },
  );
  try {
    await api.renewCert(certId);
    ElMessage.success(t('certDetail.renewSubmitted'));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function reissue(): Promise<void> {
  if (!cert.value) return;
  await ElMessageBox.confirm(
    t('certDetail.reissueConfirm', { ca: t(`ca.${cert.value.ca}`) }),
    t('certDetail.reissueTitle'),
    { type: 'warning', confirmButtonText: t('certDetail.reissueBtn') },
  );
  try {
    await api.reissueCert(certId);
    ElMessage.success(t('certDetail.reissueSubmitted'));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function remove(): Promise<void> {
  if (!cert.value) return;
  await ElMessageBox.confirm(
    t('certDetail.deleteConfirm', { domain: cert.value.primaryDomain }),
    t('certDetail.deleteTitle'),
    { type: 'error', confirmButtonText: t('certDetail.deleteBtn') },
  );
  try {
    await api.deleteCert(certId);
    ElMessage.success(t('certDetail.deleted'));
    router.push('/certificates');
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function saveAutoRenew(value: boolean): Promise<void> {
  try {
    await api.updateCert(certId, { autoRenew: value });
    ElMessage.success(t(value ? 'certDetail.autoRenewOn' : 'certDetail.autoRenewOff'));
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function saveThreshold(): Promise<void> {
  try {
    await api.updateCert(certId, { renewBeforeDays: renewBeforeDays.value });
    ElMessage.success(t('certDetail.thresholdUpdated'));
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

function download(type: string): void {
  window.open(`/api/certificates/${certId}/download?type=${type}`, '_blank');
}

const distributeVisible = ref(false);
const distributeLoading = ref(false);
const distributeToken = ref<string | null>(null);
const distributeTargets = ref<DistributeTarget[]>([]);

/** 同步状态 → 标签类型映射 */
function syncStatusType(status: string | null): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'success') return 'success';
  if (status === 'no_change') return 'info';
  if (status === 'error') return 'danger';
  return 'warning';
}
function syncStatusLabel(status: string | null): string {
  const key = status === 'success' || status === 'no_change' || status === 'error' ? status : 'unknown';
  return t(`certDetail.syncStatus.${key}`);
}
function reloadModeLabel(mode: string | null, container: string | null): string {
  if (mode === 'docker') return container ? t('certDetail.reloadModeDocker', { container }) : 'Docker';
  if (mode === 'nginx') return t('certDetail.reloadModeNginx');
  return '—';
}

/** 安装命令里的管理机地址取自当前浏览器地址栏——管理员怎么访问，目标机器就怎么访问 */
const distributeCmd = computed(() => {
  const domain = cert.value?.primaryDomain ?? '';
  const token = distributeToken.value;
  if (!domain || !token) return '';
  const qs = new URLSearchParams({ domain });
  return `curl -fsSL -H 'Authorization: Bearer ${token}' '${window.location.origin}/api/distribute/install.sh?${qs.toString()}' | sudo bash`;
});
const distributeDockerCmd = computed(() =>
  distributeCmd.value ? `${distributeCmd.value} -s -- --docker <${t('certDetail.dockerContainerPlaceholder')}>` : '',
);

async function loadDistributeTargets(): Promise<void> {
  if (!cert.value) return;
  try {
    distributeTargets.value = (await api.listDistributeTargets(cert.value.primaryDomain)).targets;
  } catch {
    distributeTargets.value = [];
  }
}

async function openDistribute(): Promise<void> {
  distributeVisible.value = true;
  distributeLoading.value = true;
  try {
    distributeToken.value = (await api.getDistributeToken()).token;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    distributeLoading.value = false;
  }
  await loadDistributeTargets();
}

async function createDistributeToken(): Promise<void> {
  distributeLoading.value = true;
  try {
    distributeToken.value = (await api.createDistributeToken()).token;
    ElMessage.success(t('certDetail.tokenCreated'));
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    distributeLoading.value = false;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(t('common.copied'));
  } catch {
    ElMessage.error(t('common.copyFailed'));
  }
}

async function deleteDistributeTarget(id: number, ip: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('certDetail.deleteTargetConfirm', { ip }), t('certDetail.deleteTargetTitle'), {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await api.deleteDistributeTarget(id);
    ElMessage.success(t('certDetail.targetDeleted'));
    await loadDistributeTargets();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function editDistributeTargetTags(target: DistributeTarget): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(t('certDetail.tagDialogTip'), t('certDetail.tagDialogTitle'), {
      inputValue: target.tags.join(', '),
      confirmButtonText: t('common.save'),
    });
    const tags = value.split(',').map((s) => s.trim()).filter(Boolean);
    await api.updateDistributeTargetTags(target.id, tags);
    ElMessage.success(t('certDetail.tagsUpdated'));
    await loadDistributeTargets();
  } catch {
    // 用户取消
  }
}
</script>

<template>
  <div v-if="cert">
    <div class="detail-header">
      <el-button text icon="ArrowLeft" @click="router.push('/certificates')">{{ t('certDetail.back') }}</el-button>
      <span class="detail-domain">{{ cert.primaryDomain }}</span>
      <StatusTag :status="cert.displayStatus" />
      <div class="detail-actions">
        <el-button v-if="canWrite()" type="primary" :disabled="isIssuing" @click="renew">{{ t('certDetail.renewNow') }}</el-button>
        <el-button v-if="canWrite()" type="warning" plain :disabled="isIssuing" @click="reissue">{{ t('certDetail.reissue') }}</el-button>
        <el-button v-if="canWrite()" plain @click="openDistribute">{{ t('certDetail.distribute') }}</el-button>
        <el-dropdown @command="download">
          <el-button>
            {{ t('certDetail.download') }} <el-icon><ArrowDown /></el-icon>
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
        <el-button v-if="canWrite()" type="danger" plain :disabled="isIssuing" @click="remove">{{ t('certDetail.delete') }}</el-button>
      </div>
    </div>

    <el-alert
      v-if="cert.lastError"
      :title="cert.status === 'error' ? t('certDetail.lastOpFailed') : t('certDetail.historyError')"
      type="error"
      :closable="false"
      class="detail-alert"
    >
      <pre class="error-pre">{{ cert.lastError }}</pre>
    </el-alert>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never" class="detail-card">
          <template #header>{{ t('certDetail.certInfo') }}</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item :label="t('certDetail.domains')">{{ cert.domains.join('、') }}</el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.ca')">{{ t(`ca.${cert.ca}`) }}</el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.keyType')">{{ keyTypeLabel(cert.keyType) }}</el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.challenge')">{{ t(`challenge.${cert.challengeType}`) }}</el-descriptions-item>
            <el-descriptions-item v-if="cert.challengeType === 'dns01'" :label="t('certDetail.dnsProvider')">
              {{ providerName || t('certDetail.unknown') }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.issuedAt')">{{ formatDate(cert.issuedAt) }}</el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.expiresAt')">
              {{ formatDate(cert.expiresAt) }}
              <span class="muted">{{ t('certDetail.leftDays', { text: cert.daysLeft === null ? '-' : cert.daysLeft < 0 ? t('days.expiredAgo', { n: -cert.daysLeft }) : t('days.left', { n: cert.daysLeft }) }) }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.certPath')">
              <div class="path-block">
                <span class="mono">{{ cert.hostCertPath ?? cert.certPath ?? '-' }}</span>
                <div v-if="cert.hostCertPath && cert.hostCertPath !== cert.certPath" class="mono path-sub">
                  {{ t('certDetail.inContainer', { path: cert.certPath }) }}
                </div>
              </div>
            </el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.keyPath')">
              <div class="path-block">
                <span class="mono">{{ cert.hostKeyPath ?? cert.keyPath ?? '-' }}</span>
                <div v-if="cert.hostKeyPath && cert.hostKeyPath !== cert.keyPath" class="mono path-sub">
                  {{ t('certDetail.inContainer', { path: cert.keyPath }) }}
                </div>
              </div>
            </el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.createdAt')">{{ formatDate(cert.createdAt) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>{{ t('certDetail.certContent') }}</template>
          <el-descriptions v-if="certInfo" :column="1" border>
            <el-descriptions-item label="Subject">
              <span class="mono">{{ certInfo.subject }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="Issuer">
              <span class="mono">{{ certInfo.issuer }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="SAN">{{ certInfo.sans.join('、') || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="t('certDetail.fingerprint')">
              <span class="mono fingerprint">{{ certInfo.fingerprint256 }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-empty v-else :description="t('certDetail.noCertYet')" :image-size="60" />
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never" class="detail-card">
          <template #header>{{ t('certDetail.renewSettings') }}</template>
          <el-form label-width="90px" label-position="left">
            <el-form-item :label="t('certDetail.autoRenew')">
              <el-switch :model-value="cert.autoRenew" :disabled="isIssuing || !canWrite()" @change="(v: any) => saveAutoRenew(Boolean(v))" />
              <span class="muted small">{{ t('certDetail.autoRenewTip') }}</span>
            </el-form-item>
            <el-form-item :label="t('certDetail.renewThreshold')">
              <el-input-number v-model="renewBeforeDays" :min="1" :max="89" :disabled="!canWrite()" />
              <span class="muted small">{{ t('certDetail.daysBefore') }}</span>
              <el-button v-if="canWrite()" size="small" style="margin-left: 8px" @click="saveThreshold">{{ t('common.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>{{ t('certDetail.liveLog') }}</template>
          <LiveLog :certificate-id="certId" height="420px" />
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="distributeVisible" :title="t('certDetail.distTitle')" width="720px">
      <div v-loading="distributeLoading">
        <template v-if="distributeToken">
          <div v-if="distributeTargets.length > 0" class="dist-targets">
            <div class="dist-targets-head">
              <span>{{ t('certDetail.distTargets', { n: distributeTargets.length }) }}</span>
              <el-button link type="primary" size="small" :loading="distributeLoading" @click="loadDistributeTargets">{{ t('common.refresh') }}</el-button>
            </div>
            <el-table :data="distributeTargets" size="small" class="dist-table">
              <el-table-column :label="t('certDetail.colIp')" width="140">
                <template #default="{ row }">
                  {{ row.ip }}
                  <el-tag v-if="row.stale" type="warning" size="small" style="margin-left: 4px">{{ t('certDetail.stale') }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="t('certDetail.colMode')" width="130">
                <template #default="{ row }">{{ reloadModeLabel(row.reloadMode, row.container) }}</template>
              </el-table-column>
              <el-table-column :label="t('certDetail.colTags')" width="120">
                <template #default="{ row }">
                  <span v-if="row.tags.length > 0" class="tag-cell" @click="canWrite() && editDistributeTargetTags(row)">
                    <el-tag v-for="tag in row.tags" :key="tag" size="small" style="margin: 2px">{{ tag }}</el-tag>
                  </span>
                  <el-button v-else-if="canWrite()" link type="primary" size="small" @click="editDistributeTargetTags(row)">{{ t('certDetail.addTag') }}</el-button>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('certDetail.colLastSync')" width="155">
                <template #default="{ row }">
                  <span v-if="row.lastSyncAt">{{ formatDate(row.lastSyncAt) }}</span>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('common.status')" width="80">
                <template #default="{ row }">
                  <el-tag v-if="row.lastSyncStatus" :type="syncStatusType(row.lastSyncStatus)" size="small">
                    {{ syncStatusLabel(row.lastSyncStatus) }}
                  </el-tag>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column v-if="canWrite()" :label="t('common.actions')" width="60">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="deleteDistributeTarget(row.id, row.ip)">{{ t('certDetail.delete') }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="dist-step">
            <span class="dist-step-num">1</span>
            <div class="dist-step-body">
              <div class="dist-step-title">{{ t('certDetail.step1') }}</div>
              <div class="dist-scenario">
                <div class="dist-scenario-head">
                  <span>{{ t('certDetail.step1a') }}</span>
                  <el-button link type="primary" size="small" @click="copyText(distributeCmd)">
                    <el-icon><DocumentCopy /></el-icon><span>{{ t('common.copy') }}</span>
                  </el-button>
                </div>
                <div class="dist-cmd"><code>{{ distributeCmd }}</code></div>
              </div>
              <div class="dist-scenario">
                <div class="dist-scenario-head">
                  <span>{{ t('certDetail.step1b') }}</span>
                  <el-button link type="primary" size="small" @click="copyText(distributeDockerCmd)">
                    <el-icon><DocumentCopy /></el-icon><span>{{ t('common.copy') }}</span>
                  </el-button>
                </div>
                <div class="dist-cmd"><code>{{ distributeDockerCmd }}</code></div>
              </div>
            </div>
          </div>

          <div class="dist-step">
            <span class="dist-step-num">2</span>
            <div class="dist-step-body">
              <div class="dist-step-title">{{ t('certDetail.step2') }}</div>
              <div class="dist-note">{{ t('certDetail.step2Tip') }}</div>
            </div>
          </div>

          <el-collapse class="dist-help">
            <el-collapse-item :title="t('certDetail.helpTitle')" name="detail">
              <ul class="help-list">
                <li>{{ t('certDetail.help1', { domain: cert.primaryDomain }) }}</li>
                <li>{{ t('certDetail.help2') }}</li>
                <li>{{ t('certDetail.help3') }}</li>
                <li>{{ t('certDetail.help4') }}</li>
              </ul>
            </el-collapse-item>
          </el-collapse>
        </template>
        <el-empty v-else-if="!distributeLoading" :description="t('certDetail.noToken')" :image-size="60">
          <el-button type="primary" @click="createDistributeToken">{{ t('certDetail.createToken') }}</el-button>
        </el-empty>
      </div>
    </el-dialog>
  </div>
  <el-skeleton v-else :rows="6" animated />
</template>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.detail-domain {
  font-size: 20px;
  font-weight: 700;
}
.detail-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.detail-alert {
  margin-bottom: 16px;
}
.error-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.detail-card {
  margin-bottom: 16px;
}
.muted {
  color: var(--el-text-color-secondary);
}
.small {
  font-size: 12px;
  margin-left: 8px;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}
.path-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.path-sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.help-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}
.help-list code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: var(--el-fill-color);
  padding: 1px 4px;
  border-radius: 3px;
}
.fingerprint {
  color: var(--el-text-color-secondary);
}
.dist-step {
  display: flex;
  gap: 10px;
}
.dist-step + .dist-step {
  margin-top: 18px;
}
.dist-step-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.dist-step-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
}
.dist-note {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.dist-scenario {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}
.dist-scenario + .dist-scenario {
  margin-top: 14px;
}
.dist-scenario-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: var(--el-fill-color-light);
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.dist-cmd {
  padding: 8px 12px;
}
.dist-cmd code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
}
.dist-targets {
  margin-bottom: 18px;
}
.dist-targets-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.dist-table {
  border-radius: 6px;
  overflow: hidden;
}
.tag-cell {
  cursor: pointer;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
}
.dist-help {
  margin-top: 18px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.dist-help :deep(.el-collapse-item__header) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  height: 36px;
  line-height: 36px;
  border-bottom: none;
}
.dist-help :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}
.dist-help :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
}
</style>
