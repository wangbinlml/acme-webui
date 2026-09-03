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
    syncDeployFormOnce(res.certificate);
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

/** 安装命令里的管理机地址取自当前浏览器地址栏——管理员怎么访问，目标机器就怎么访问 */
const distributeCmd = computed(() => {
  const domain = cert.value?.primaryDomain ?? '';
  const token = distributeToken.value;
  if (!domain || !token) return '';
  const qs = new URLSearchParams({ domain });
  return `curl -fsSL -H 'Authorization: Bearer ${token}' '${window.location.origin}/api/distribute/install.sh?${qs.toString()}' | sudo bash`;
});
const distributeDockerCmd = computed(() => (distributeCmd.value ? `${distributeCmd.value} -s -- --docker <nginx容器名>` : ''));

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

// ── 自动部署（多目标） ────────────────────────────────────
interface TargetForm {
  id: string;
  name: string;
  enabled: boolean;
  mode: string;
  targetDir: string;
  cmd: string;
  container: string;
}
const targetForms = ref<TargetForm[]>([]);
let deployFormInit = false;

function syncFormsFrom(c: CertificateView): void {
  targetForms.value = c.deployTargets.map((t) => ({
    id: t.id,
    name: t.name,
    enabled: t.enabled,
    mode: t.mode,
    targetDir: t.targetDir,
    cmd: t.cmd,
    container: t.container,
  }));
}

function syncDeployFormOnce(c: CertificateView): void {
  if (deployFormInit) return; // 避免轮询刷新覆盖正在编辑的内容
  deployFormInit = true;
  syncFormsFrom(c);
}

const hasEnabledTarget = computed(() => targetForms.value.some((t) => t.enabled));

function addTarget(): void {
  targetForms.value.push({
    id: '', // 保存后由服务端分配
    name: `目标 ${targetForms.value.length + 1}`,
    enabled: true,
    mode: 'none',
    targetDir: '',
    cmd: '',
    container: '',
  });
}

function removeTarget(index: number): void {
  targetForms.value.splice(index, 1);
}

/** 从轮询数据里取某目标最近的执行状态（编辑表单里不含状态字段） */
function statusOf(id: string): { lastRunAt: string | null; lastError: string | null } | null {
  const t = cert.value?.deployTargets.find((x) => x.id === id);
  return t ? { lastRunAt: t.lastRunAt, lastError: t.lastError } : null;
}

async function saveDeploy(): Promise<void> {
  try {
    const res = await api.saveDeploy(certId, { targets: targetForms.value });
    ElMessage.success('部署配置已保存');
    syncFormsFrom(res.certificate); // 回填服务端分配的目标 id，状态才能对上
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

const deploying = ref(false);
const deployResult = ref('');
const deployOk = ref(true);
async function runDeployNow(): Promise<void> {
  if (!hasEnabledTarget.value) {
    ElMessage.warning('请先添加并启用至少一个部署目标');
    return;
  }
  deploying.value = true;
  deployResult.value = '';
  try {
    const res = await api.runDeploy(certId);
    deployOk.value = res.ok;
    if (res.ok) ElMessage.success('部署成功');
    else ElMessage.error('部署存在异常，见下方结果');
    deployResult.value = res.message;
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    deploying.value = false;
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
          <template #header>自动部署（签发/续期成功后）</template>

          <el-empty v-if="targetForms.length === 0" description="尚未配置部署目标" :image-size="60">
            <el-button v-if="canWrite()" type="primary" size="small" @click="addTarget">添加目标</el-button>
          </el-empty>

          <div v-for="(t, i) in targetForms" :key="i" class="target-block">
            <div class="target-head">
              <el-input v-model="t.name" class="target-name" placeholder="目标名称" :disabled="!canWrite()" />
              <el-switch v-model="t.enabled" :disabled="!canWrite()" />
              <el-button v-if="canWrite()" link type="danger" size="small" @click="removeTarget(i)">删除</el-button>
            </div>
            <el-form label-width="80px" label-position="left">
              <el-form-item label="目标目录">
                <el-input v-model="t.targetDir" class="mono-input" placeholder="/deploy/nginx-certs" :disabled="!canWrite()" />
                <div class="muted small form-hint">容器内绝对路径，需在 docker-compose.yml 挂载对应宿主目录</div>
              </el-form-item>
              <el-form-item label="reload">
                <el-radio-group v-model="t.mode" :disabled="!canWrite()">
                  <el-radio value="none">仅复制</el-radio>
                  <el-radio value="command">容器内命令</el-radio>
                  <el-radio value="docker">Docker 容器</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item v-if="t.mode === 'command'" label="命令">
                <el-input v-model="t.cmd" class="mono-input" placeholder="curl -fsS http://宿主:9090/reload" :disabled="!canWrite()" />
                <div class="muted small form-hint">在本工具容器内执行，可 curl 宿主侧钩子或 ssh 触发宿主 nginx reload</div>
              </el-form-item>
              <template v-if="t.mode === 'docker'">
                <el-form-item label="容器名">
                  <el-input v-model="t.container" placeholder="如 webserver" :disabled="!canWrite()" />
                </el-form-item>
                <el-form-item label="容器命令">
                  <el-input v-model="t.cmd" class="mono-input" placeholder="nginx -s reload" :disabled="!canWrite()" />
                  <div class="muted small form-hint">需挂载 /var/run/docker.sock；Caddy 容器可填 caddy reload --config /etc/caddy/Caddyfile</div>
                </el-form-item>
              </template>
            </el-form>
            <div v-if="statusOf(t.id)?.lastRunAt" class="muted small deploy-status">
              上次部署：{{ formatDate(statusOf(t.id)?.lastRunAt ?? null) }}<template v-if="!statusOf(t.id)?.lastError">（成功）</template>
            </div>
            <el-alert v-if="statusOf(t.id)?.lastError" type="error" :title="`目标「${t.name}」部署异常`" :closable="false" class="detail-alert">
              <pre class="error-pre">{{ statusOf(t.id)?.lastError }}</pre>
            </el-alert>
          </div>

          <div v-if="canWrite() && targetForms.length > 0" class="deploy-actions">
            <el-button size="small" @click="addTarget">+ 添加目标</el-button>
            <el-button type="primary" size="small" @click="saveDeploy">保存配置</el-button>
            <el-button size="small" :loading="deploying" :disabled="!hasEnabledTarget" @click="runDeployNow">立即部署</el-button>
          </div>

          <el-alert v-if="deployResult" :type="deployOk ? 'success' : 'error'" :title="'本次部署结果'" :closable="false" class="detail-alert">
            <pre class="error-pre">{{ deployResult }}</pre>
          </el-alert>
          <el-collapse class="deploy-help">
            <el-collapse-item title="各场景怎么配？（宿主机 nginx / 容器 nginx / Caddy）" name="help">
              <ul class="help-list">
                <li>可添加多个部署目标（如同时发宿主机目录和容器共享目录），每个目标独立目录、reload 方式与执行状态，签发/续期成功后依次执行，任一失败不影响其他目标。</li>
                <li><b>宿主机 nginx（非 Docker）</b>：compose 里加卷 <code>- ./deploy:/deploy</code>，目标目录填 <code>/deploy/nginx-certs</code>；nginx 配置引用宿主机 <code>./deploy/nginx-certs/&lt;域名&gt;/fullchain.pem</code>。reload 选「仅复制」，宿主侧用 systemd path / cron 触发 <code>nginx -s reload</code>（详见 README），或选「容器内命令」用 curl 调宿主钩子。</li>
                <li><b>nginx / Caddy 跑在容器里</b>：compose 挂载 <code>/var/run/docker.sock</code>，reload 选「Docker 容器」填容器名，命令默认 <code>nginx -s reload</code>；证书目录让两个容器共享同一个挂载。</li>
                <li>证书会复制到 <code>&lt;目标目录&gt;/&lt;主域名&gt;/</code>（通配符为 <code>&lt;域名&gt;-wildcard</code>），含 fullchain / privkey / cert / chain 四个文件。</li>
                <li>每次部署完成后会自动连 <code>&lt;主域名&gt;:443</code> 比对线上证书指纹：reload 由本工具触发时，线上仍是旧证书会标记为部署异常；「仅复制」模式下仅提示参考。域名不出网或 443 不可达时自动跳过。</li>
              </ul>
            </el-collapse-item>
          </el-collapse>
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
          <el-alert
            type="info"
            :closable="false"
            style="margin-bottom: 12px"
            title="到目标服务器上以 root 执行命令即可：自动下载证书、每天 04:35 检查更新、内容有变化才 reload"
          />
          <div class="dist-label">nginx / Caddy 直接安装在机器上：</div>
          <div class="dist-cmd">
            <code>{{ distributeCmd }}</code>
            <el-button link type="primary" size="small" @click="copyText(distributeCmd)">复制</el-button>
          </div>
          <div class="dist-label dist-label-gap">nginx / Caddy 跑在 Docker 容器里（把容器名替换掉）：</div>
          <div class="dist-cmd">
            <code>{{ distributeDockerCmd }}</code>
            <el-button link type="primary" size="small" @click="copyText(distributeDockerCmd)">复制</el-button>
          </div>
          <ul class="help-list dist-label-gap">
            <li>证书默认装到 <code>/etc/nginx/certs/{{ cert.primaryDomain }}/</code>，命令后加 <code>-s -- --dir 目录</code> 可改</li>
            <li>Docker 场景记得让容器挂载证书目录（如 <code>./nginx-certs:/etc/nginx/certs</code>）</li>
            <li>同一台机器装多张证书：对每张证书分别执行一次命令（定时任务只装一份，不会重复）</li>
            <li>卸载：<code>rm -rf /etc/acme-distribute /usr/local/bin/acme-distribute-pull /etc/cron.d/acme-distribute</code></li>
          </ul>
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
.mono-input :deep(input) {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.form-hint {
  width: 100%;
  line-height: 1.5;
}
.deploy-status {
  margin-bottom: 4px;
}
.target-block {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}
.target-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.target-name {
  width: 220px;
}
.deploy-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.deploy-help :deep(.el-collapse-item__header) {
  font-size: 12px;
  color: #909399;
  height: 32px;
  line-height: 32px;
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
.dist-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.dist-label-gap {
  margin-top: 10px;
}
.dist-cmd {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #f5f7fa;
  border-radius: 4px;
  padding: 8px 10px;
}
.dist-cmd code {
  flex: 1;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
