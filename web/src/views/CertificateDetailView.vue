<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { CertInfo, CertificateView, DistributeTarget } from '../types';
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

/** 安装命令里的管理机地址取自当前浏览器地址栏——管理员怎么访问，目标机器就怎么访问 */
const distributeCmd = computed(() => {
  const domain = cert.value?.primaryDomain ?? '';
  const token = distributeToken.value;
  if (!domain || !token) return '';
  const qs = new URLSearchParams({ domain });
  return `curl -fsSL -H 'Authorization: Bearer ${token}' '${window.location.origin}/api/distribute/install.sh?${qs.toString()}' | sudo bash`;
});
const distributeDockerCmd = computed(() => (distributeCmd.value ? `${distributeCmd.value} -s -- --docker <nginx容器名>` : ''));

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
    ElMessage.success('Token 已生成');
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    distributeLoading.value = false;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败，请手动选择复制');
  }
}

async function deleteDistributeTarget(id: number, ip: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除分发目标 ${ip}？`, '删除目标', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.deleteDistributeTarget(id);
    ElMessage.success('已删除');
    await loadDistributeTargets();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function editDistributeTargetTags(target: DistributeTarget): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('多个标签用逗号分隔', '编辑标签', {
      inputValue: target.tags.join(', '),
      confirmButtonText: '保存',
    });
    const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
    await api.updateDistributeTargetTags(target.id, tags);
    ElMessage.success('标签已更新');
    await loadDistributeTargets();
  } catch {
    // 用户取消
  }
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
        <el-button v-if="canWrite()" plain @click="openDistribute">分发到其他服务器</el-button>
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
              <div class="path-block">
                <span class="mono">{{ cert.hostCertPath ?? cert.certPath ?? '-' }}</span>
                <div v-if="cert.hostCertPath && cert.hostCertPath !== cert.certPath" class="mono path-sub">
                  容器内：{{ cert.certPath }}
                </div>
              </div>
            </el-descriptions-item>
            <el-descriptions-item label="私钥路径">
              <div class="path-block">
                <span class="mono">{{ cert.hostKeyPath ?? cert.keyPath ?? '-' }}</span>
                <div v-if="cert.hostKeyPath && cert.hostKeyPath !== cert.keyPath" class="mono path-sub">
                  容器内：{{ cert.keyPath }}
                </div>
              </div>
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

    <el-dialog v-model="distributeVisible" title="分发到其他服务器" width="720px">
      <div v-loading="distributeLoading">
        <template v-if="distributeToken">
          <div v-if="distributeTargets.length > 0" class="dist-targets">
            <div class="dist-targets-head">
              <span>已分发服务器（{{ distributeTargets.length }}）</span>
              <el-button link type="primary" size="small" :loading="distributeLoading" @click="loadDistributeTargets">刷新</el-button>
            </div>
            <el-table :data="distributeTargets" size="small" class="dist-table">
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
                  <span v-if="row.tags.length > 0" class="tag-cell" @click="canWrite() && editDistributeTargetTags(row)">
                    <el-tag v-for="t in row.tags" :key="t" size="small" style="margin: 2px">{{ t }}</el-tag>
                  </span>
                  <el-button v-else-if="canWrite()" link type="primary" size="small" @click="editDistributeTargetTags(row)">+标签</el-button>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="最后同步" width="155">
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
                  <el-button link type="danger" size="small" @click="deleteDistributeTarget(row.id, row.ip)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="dist-step">
            <span class="dist-step-num">1</span>
            <div class="dist-step-body">
              <div class="dist-step-title">按场景复制命令</div>
              <div class="dist-scenario">
                <div class="dist-scenario-head">
                  <span>nginx / Caddy 直接安装在服务器上</span>
                  <el-button link type="primary" size="small" @click="copyText(distributeCmd)">
                    <el-icon><DocumentCopy /></el-icon><span>复制</span>
                  </el-button>
                </div>
                <div class="dist-cmd"><code>{{ distributeCmd }}</code></div>
              </div>
              <div class="dist-scenario">
                <div class="dist-scenario-head">
                  <span>nginx / Caddy 跑在 Docker 容器里（需替换 &lt;nginx容器名&gt;）</span>
                  <el-button link type="primary" size="small" @click="copyText(distributeDockerCmd)">
                    <el-icon><DocumentCopy /></el-icon><span>复制</span>
                  </el-button>
                </div>
                <div class="dist-cmd"><code>{{ distributeDockerCmd }}</code></div>
              </div>
            </div>
          </div>

          <div class="dist-step">
            <span class="dist-step-num">2</span>
            <div class="dist-step-body">
              <div class="dist-step-title">到目标服务器上以 root 执行</div>
              <div class="dist-note">执行后立即同步一次；以后每天 04:35 自动检查，证书有变化才会 reload</div>
            </div>
          </div>

          <el-collapse class="dist-help">
            <el-collapse-item title="证书装到哪里？同一台机器多张证书？怎么卸载？" name="detail">
              <ul class="help-list">
                <li>证书默认装到 <code>/etc/nginx/certs/{{ cert.primaryDomain }}/</code>，加 <code>-s -- --dir 目录</code> 可改（<code>目录</code> 需含域名，如 <code>/etc/nginx/certs/{{ cert.primaryDomain }}</code>）</li>
                <li>Docker 场景记得让容器挂载证书目录（如 <code>./nginx-certs:/etc/nginx/certs</code>）</li>
                <li>同一台机器装多张证书：对每张证书分别执行一次命令（定时任务只装一份，不会重复）</li>
                <li>卸载：<code>rm -rf /etc/acme-distribute /usr/local/bin/acme-distribute-pull /etc/cron.d/acme-distribute</code></li>
              </ul>
            </el-collapse-item>
          </el-collapse>
        </template>
        <el-empty v-else-if="!distributeLoading" description="尚未创建分发 Token（在「设置 → 多主机分发」创建）" :image-size="60">
          <el-button type="primary" @click="createDistributeToken">立即创建</el-button>
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
.path-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.path-sub {
  color: #909399;
  font-size: 11px;
}
.help-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: #606266;
  line-height: 1.8;
}
.help-list code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: #f4f4f5;
  padding: 1px 4px;
  border-radius: 3px;
}
.fingerprint {
  color: #909399;
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
  color: #606266;
  line-height: 1.6;
}
.dist-scenario {
  border: 1px solid #e4e7ed;
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
  background: #f5f7fa;
  font-size: 13px;
  color: #303133;
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
  border-top: 1px solid #ebeef5;
}
.dist-help :deep(.el-collapse-item__header) {
  font-size: 12px;
  color: #909399;
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
