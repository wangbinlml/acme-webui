<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertInfo, CertificateView } from '../types';
import { canWrite } from '../auth';
import StatusTag from '../components/StatusTag.vue';
import LiveLog from '../components/LiveLog.vue';
import { caLabel, challengeLabel, daysLeftText, errMessage, formatDate, formatDateOnly, keyTypeLabel } from '../utils';

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
  await ElMessageBox.confirm(`确定立即续期 ${cert.value.primaryDomain}？`, '续期证书', { type: 'warning' });
  try {
    await api.renewCert(certId);
    ElMessage.success('已提交续期');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function reissue(): Promise<void> {
  if (!cert.value) return;
  await ElMessageBox.confirm(
    `将重新向 ${caLabel(cert.value.ca)} 申请证书，注意重复签发的速率限制。`,
    '重新签发',
    { type: 'warning', confirmButtonText: '重新签发' },
  );
  try {
    await api.reissueCert(certId);
    ElMessage.success('已提交重新签发');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function remove(): Promise<void> {
  if (!cert.value) return;
  await ElMessageBox.confirm(
    `删除 ${cert.value.primaryDomain} 将同时移除本地证书文件和 acme.sh 中的记录，该操作不可恢复。`,
    '删除证书',
    { type: 'error', confirmButtonText: '删除' },
  );
  try {
    await api.deleteCert(certId);
    ElMessage.success('已删除');
    router.push('/certificates');
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function saveAutoRenew(value: boolean): Promise<void> {
  try {
    await api.updateCert(certId, { autoRenew: value });
    ElMessage.success(`已${value ? '开启' : '关闭'}自动续期`);
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function saveThreshold(): Promise<void> {
  try {
    await api.updateCert(certId, { renewBeforeDays: renewBeforeDays.value });
    ElMessage.success('续期阈值已更新');
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

function download(type: string): void {
  window.open(`/api/certificates/${certId}/download?type=${type}`, '_blank');
}
</script>

<template>
  <div v-if="cert">
    <div class="detail-header">
      <el-button text icon="ArrowLeft" @click="router.push('/certificates')">返回</el-button>
      <span class="detail-domain">{{ cert.primaryDomain }}</span>
      <StatusTag :status="cert.displayStatus" />
      <div class="detail-actions">
        <el-button v-if="canWrite()" type="primary" :disabled="isIssuing" @click="renew">立即续期</el-button>
        <el-button v-if="canWrite()" type="warning" plain :disabled="isIssuing" @click="reissue">重新签发</el-button>
        <el-dropdown @command="download">
          <el-button>
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
        <el-button v-if="canWrite()" type="danger" plain :disabled="isIssuing" @click="remove">删除</el-button>
      </div>
    </div>

    <el-alert
      v-if="cert.lastError"
      :title="cert.status === 'error' ? '最近一次操作失败' : '历史错误信息'"
      type="error"
      :closable="false"
      class="detail-alert"
    >
      <pre class="error-pre">{{ cert.lastError }}</pre>
    </el-alert>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never" class="detail-card">
          <template #header>证书信息</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="域名">{{ cert.domains.join('、') }}</el-descriptions-item>
            <el-descriptions-item label="CA">{{ caLabel(cert.ca) }}</el-descriptions-item>
            <el-descriptions-item label="密钥算法">{{ keyTypeLabel(cert.keyType) }}</el-descriptions-item>
            <el-descriptions-item label="验证方式">{{ challengeLabel(cert.challengeType) }}</el-descriptions-item>
            <el-descriptions-item v-if="cert.challengeType === 'dns01'" label="DNS Provider">
              {{ providerName || '未知' }}
            </el-descriptions-item>
            <el-descriptions-item label="签发时间">{{ formatDate(cert.issuedAt) }}</el-descriptions-item>
            <el-descriptions-item label="到期时间">
              {{ formatDate(cert.expiresAt) }}
              <span class="muted">（剩余 {{ daysLeftText(cert.daysLeft) }}）</span>
            </el-descriptions-item>
            <el-descriptions-item label="证书路径">
              <span class="mono">{{ cert.certPath ?? '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="私钥路径">
              <span class="mono">{{ cert.keyPath ?? '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatDate(cert.createdAt) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>证书文件内容</template>
          <el-descriptions v-if="certInfo" :column="1" border>
            <el-descriptions-item label="Subject">
              <span class="mono">{{ certInfo.subject }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="Issuer">
              <span class="mono">{{ certInfo.issuer }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="SAN">{{ certInfo.sans.join('、') || '-' }}</el-descriptions-item>
            <el-descriptions-item label="SHA-256 指纹">
              <span class="mono fingerprint">{{ certInfo.fingerprint256 }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="尚未签发成功，暂无证书文件" :image-size="60" />
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never" class="detail-card">
          <template #header>续期设置</template>
          <el-form label-width="90px" label-position="left">
            <el-form-item label="自动续期">
              <el-switch :model-value="cert.autoRenew" :disabled="isIssuing || !canWrite()" @change="(v: any) => saveAutoRenew(Boolean(v))" />
              <span class="muted small">每天 03:00 检查（服务器时区）</span>
            </el-form-item>
            <el-form-item label="续期阈值">
              <el-input-number v-model="renewBeforeDays" :min="1" :max="89" :disabled="!canWrite()" />
              <span class="muted small">天前触发</span>
              <el-button v-if="canWrite()" size="small" style="margin-left: 8px" @click="saveThreshold">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>实时日志（本证书）</template>
          <LiveLog :certificate-id="certId" height="420px" />
        </el-card>
      </el-col>
    </el-row>
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
  color: #909399;
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
.fingerprint {
  color: #909399;
}
</style>
