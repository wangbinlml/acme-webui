<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { NotifyTestResult, SettingsData } from '../types';
import { canWrite, currentUser } from '../auth';
import { errMessage } from '../utils';

const router = useRouter();
const { t } = useI18n();
const settings = ref<SettingsData | null>(null);
const saving = ref(false);
const savingNotify = ref(false);
const testing = ref('');
const running = ref(false);
const testResults = ref<NotifyTestResult[]>([]);

const form = reactive({ accountEmail: '' });

const robotForm = reactive({ channel: '' as '' | 'wecom' | 'feishu', webhook: '', feishuSecret: '' });
const webhookForm = reactive({ url: '' });
const smtpForm = reactive({ host: '', port: 465, user: '', password: '', from: '', to: '' });

async function load(): Promise<void> {
  try {
    settings.value = await api.getSettings();
    form.accountEmail = settings.value.accountEmail;
    robotForm.channel = settings.value.notify.robot.channel;
    robotForm.webhook = settings.value.notify.robot.webhook;
    robotForm.feishuSecret = settings.value.notify.robot.feishuSecret;
    webhookForm.url = settings.value.notify.webhook.url;
    smtpForm.host = settings.value.notify.smtp.host;
    smtpForm.port = settings.value.notify.smtp.port;
    smtpForm.user = settings.value.notify.smtp.user;
    smtpForm.password = settings.value.notify.smtp.password;
    smtpForm.from = settings.value.notify.smtp.from;
    smtpForm.to = settings.value.notify.smtp.to;
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

onMounted(load);

async function save(): Promise<void> {
  saving.value = true;
  try {
    await api.saveSettings({ accountEmail: form.accountEmail.trim() });
    ElMessage.success(t('settings.emailSaved'));
    await load();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    saving.value = false;
  }
}

const MASK = '••••••••';

/** 地址/密码未改动时传回 MASK 哨兵，避免把脱敏显示值存进数据库 */
function untouched(current: string, saved: string | undefined): boolean {
  return saved !== undefined && current === saved;
}

async function saveNotifyTab(part: 'robot' | 'webhook' | 'smtp'): Promise<boolean> {
  const n = settings.value?.notify;
  const payload =
    part === 'robot'
      ? {
          robot: {
            channel: robotForm.channel,
            webhook: untouched(robotForm.webhook, n?.robot.webhook) ? MASK : robotForm.webhook.trim(),
            feishuSecret: robotForm.feishuSecret.trim(),
          },
        }
      : part === 'webhook'
        ? { webhook: { url: untouched(webhookForm.url, n?.webhook.url) ? MASK : webhookForm.url.trim() } }
        : {
            smtp: {
              host: smtpForm.host.trim(),
              port: smtpForm.port,
              user: smtpForm.user.trim(),
              password: untouched(smtpForm.password, n?.smtp.password) ? MASK : smtpForm.password,
              from: smtpForm.from.trim(),
              to: smtpForm.to.trim(),
            },
          };
  try {
    await api.saveSettings({ accountEmail: form.accountEmail.trim(), notify: payload });
    await load();
    return true;
  } catch (e) {
    ElMessage.error(errMessage(e));
    return false;
  }
}

async function saveNotify(part: 'robot' | 'webhook' | 'smtp'): Promise<void> {
  savingNotify.value = true;
  try {
    if (await saveNotifyTab(part)) ElMessage.success(t('settings.notifySaved'));
  } finally {
    savingNotify.value = false;
  }
}

async function testNotify(part: 'robot' | 'webhook' | 'smtp'): Promise<void> {
  testing.value = part;
  testResults.value = [];
  try {
    if (!(await saveNotifyTab(part))) return;
    const res = await api.testNotify(part);
    testResults.value = res.results ?? [];
    if (res.ok) ElMessage.success(t('settings.testSent'));
    else ElMessage.error(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    testing.value = '';
  }
}

function channelLabel(c: string): string {
  return c === 'robot' ? t('settings.robot') : c === 'webhook' ? t('settings.webhook') : t('settings.smtp');
}

async function createToken(): Promise<void> {
  if (settings.value?.hasDistributeToken) {
    try {
      await ElMessageBox.confirm(
        t('settings.regenConfirm'),
        t('settings.regenToken'),
        { type: 'warning' },
      );
    } catch {
      return;
    }
  }
  try {
    await api.createDistributeToken();
    ElMessage.success(t('settings.tokenCreated'));
    await load();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function revokeToken(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('settings.revokeConfirm'),
      t('settings.revokeToken'),
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await api.revokeDistributeToken();
    ElMessage.success(t('settings.tokenRevoked'));
    await load();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function runCheck(): Promise<void> {
  running.value = true;
  try {
    const res = await api.runRenewScan();
    ElMessage.success(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    running.value = false;
  }
}

const backupMode = ref<'full' | 'config'>('full');

/** 与证书下载一致：window.open 走 Cookie 鉴权，由浏览器直接落盘 */
function downloadBackup(): void {
  window.open(`/api/settings/backup?mode=${backupMode.value}`, '_blank');
}

const restoring = ref(false);
const restoreNote = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

function pickRestoreFile(): void {
  fileInput.value?.click();
}

/** 轮询等待服务重启完成（Docker 自动拉起；本地开发可能需手动重启） */
async function waitRestart(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await api.health();
      return;
    } catch {
      // 服务尚未重启完成，继续等待
    }
  }
  throw new Error(t('settings.restartTimeout'));
}

async function onRestoreFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;
  try {
    await ElMessageBox.confirm(
      t('settings.restoreConfirm', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }),
      t('settings.restoreConfirmTitle'),
      { type: 'warning', confirmButtonText: t('settings.restoreConfirmBtn') },
    );
  } catch {
    return; // 用户取消
  }
  restoring.value = true;
  restoreNote.value = t('settings.restoring');
  try {
    const res = await api.restoreBackup(file);
    restoreNote.value = `${res.message}${t('settings.waitRestart')}`;
    await waitRestart();
    currentUser.value = null;
    ElMessage.success(t('settings.restoreDone'));
    router.push('/login');
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    restoring.value = false;
    restoreNote.value = '';
  }
}
</script>

<template>
  <el-row :gutter="16">
    <el-col :span="12">
      <el-card shadow="never">
        <template #header>{{ t('settings.account') }}</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item :label="t('settings.accountEmail')">
            <el-input v-model="form.accountEmail" :placeholder="t('settings.accountEmailPlaceholder')" />
            <div class="form-tip">
              {{ t('settings.accountEmailTip') }}
            </div>
          </el-form-item>
          <el-form-item>
            <el-button v-if="canWrite()" type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card shadow="never">
        <template #header>{{ t('settings.autoRenew') }}</template>
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="t('settings.renewPlan')">
            <span class="mono">{{ settings?.renewCron ?? '-' }}</span>
            <span class="muted">{{ t('settings.renewCronTip') }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('settings.acmeStatus')">
            <el-tag :type="settings?.acmeAvailable ? 'success' : 'danger'" size="small">
              {{ settings?.acmeAvailable ? t('settings.acmeOk') : t('settings.acmeMissing') }}
            </el-tag>
            <div class="form-tip">{{ settings?.acmeBin }}</div>
          </el-descriptions-item>
          <el-descriptions-item :label="t('settings.version')">v{{ settings?.version ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <div style="margin-top: 16px">
          <el-button v-if="canWrite()" type="primary" :loading="running" @click="runCheck">{{ t('settings.runScan') }}</el-button>
          <span class="muted small">{{ t('settings.scanTip') }}</span>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never">
        <template #header>{{ t('settings.notify') }}</template>
        <el-alert
          type="info"
          :closable="false"
          style="margin-bottom: 16px"
          :title="t('settings.notifyAlert')"
        />
        <el-tabs>
          <el-tab-pane :label="t('settings.robot')">
            <el-form label-width="110px" label-position="left">
              <el-form-item :label="t('settings.robotChannel')">
                <el-radio-group v-model="robotForm.channel" :disabled="!canWrite()">
                  <el-radio value="">{{ t('settings.channelOff') }}</el-radio>
                  <el-radio value="wecom">{{ t('settings.wecom') }}</el-radio>
                  <el-radio value="feishu">{{ t('settings.feishu') }}</el-radio>
                </el-radio-group>
              </el-form-item>
              <template v-if="robotForm.channel">
                <el-form-item :label="t('settings.robotWebhook')">
                  <el-input
                    v-model="robotForm.webhook"
                    :disabled="!canWrite()"
                    :placeholder="robotForm.channel === 'wecom'
                      ? 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                      : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'"
                  />
                  <div class="form-tip">
                    {{ robotForm.channel === 'wecom'
                      ? t('settings.robotWecomTip')
                      : t('settings.robotFeishuTip') }}
                  </div>
                </el-form-item>
                <el-form-item v-if="robotForm.channel === 'feishu'" :label="t('settings.feishuSecret')">
                  <el-input v-model="robotForm.feishuSecret" :disabled="!canWrite()" :placeholder="t('settings.feishuSecretPlaceholder')" />
                  <div class="form-tip">{{ t('settings.robotKeywordTip') }}</div>
                </el-form-item>
              </template>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('robot')">{{ t('common.save') }}</el-button>
                <el-button :loading="testing === 'robot'" :disabled="!robotForm.channel" @click="testNotify('robot')">{{ t('settings.saveAndTest') }}</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane :label="t('settings.webhook')">
            <el-form label-width="110px" label-position="left">
              <el-form-item :label="t('settings.webhookUrl')">
                <el-input v-model="webhookForm.url" :disabled="!canWrite()" placeholder="https://your-hook.example.com/acme" />
                <div class="form-tip">
                  {{ t('settings.webhookTip') }}
                </div>
              </el-form-item>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('webhook')">{{ t('common.save') }}</el-button>
                <el-button :loading="testing === 'webhook'" :disabled="!webhookForm.url" @click="testNotify('webhook')">{{ t('settings.saveAndTest') }}</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane :label="t('settings.smtp')">
            <el-form label-width="110px" label-position="left">
              <el-form-item :label="t('settings.smtpHost')">
                <el-input v-model="smtpForm.host" :disabled="!canWrite()" :placeholder="t('settings.smtpHostPlaceholder')" />
                <el-input-number v-model="smtpForm.port" :min="1" :max="65535" :disabled="!canWrite()" style="margin-left: 8px" />
                <div class="form-tip">{{ t('settings.smtpStarttlsTip') }}</div>
              </el-form-item>
              <el-form-item :label="t('settings.smtpAuth')">
                <el-input v-model="smtpForm.user" :disabled="!canWrite()" :placeholder="t('settings.smtpUser')" style="width: 55%" />
                <el-input
                  v-model="smtpForm.password"
                  type="password"
                  show-password
                  :disabled="!canWrite()"
                  :placeholder="t('settings.smtpPass')"
                  style="width: 45%"
                />
                <div class="form-tip">{{ t('settings.smtpAuthTip') }}</div>
              </el-form-item>
              <el-form-item :label="t('settings.smtpFrom')">
                <el-input v-model="smtpForm.from" :disabled="!canWrite()" :placeholder="t('settings.smtpFromPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('settings.smtpTo')">
                <el-input v-model="smtpForm.to" :disabled="!canWrite()" :placeholder="t('settings.smtpToPlaceholder')" />
              </el-form-item>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('smtp')">{{ t('common.save') }}</el-button>
                <el-button :loading="testing === 'smtp'" :disabled="!smtpForm.host || !smtpForm.to" @click="testNotify('smtp')">{{ t('settings.saveAndTest') }}</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <div v-if="testResults.length > 0" class="test-results">
          <div v-for="r in testResults" :key="r.channel" :class="['test-result', r.ok ? 'ok' : 'fail']">
            {{ channelLabel(r.channel) }}：{{ r.ok ? t('common.success') : `${t('common.failure')}（${r.error ?? t('settings.unknownError')}）` }}
          </div>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never" v-loading="restoring" :element-loading-text="t('settings.restoringShort')">
        <template #header>{{ t('settings.backup') }}</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item :label="t('settings.backupScope')">
            <el-radio-group v-model="backupMode" :disabled="!canWrite()">
              <el-radio value="full">{{ t('settings.backupFull') }}</el-radio>
              <el-radio value="config">{{ t('settings.backupConfig') }}</el-radio>
            </el-radio-group>
            <div class="form-tip">
              <b>{{ t('settings.backupFull') }}</b>：{{ t('settings.backupTip') }}<span class="backup-danger">{{ t('settings.backupSensitive') }}</span><br />
              <b>{{ t('settings.backupConfig') }}</b>：{{ t('settings.backupConfigTip') }}
            </div>
          </el-form-item>
          <el-form-item>
            <el-button v-if="canWrite()" type="primary" :loading="restoring" @click="downloadBackup">{{ t('settings.downloadBackup') }}</el-button>
          </el-form-item>
          <el-form-item :label="t('settings.restoreLabel')">
            <el-button v-if="canWrite()" type="danger" plain :loading="restoring" @click="pickRestoreFile">
              {{ t('settings.uploadBackup') }}
            </el-button>
            <input ref="fileInput" type="file" accept=".tar.gz,.tgz,application/gzip" style="display: none" @change="onRestoreFile" />
            <div class="form-tip">
              {{ t('settings.restoreTip') }}
            </div>
            <div v-if="restoreNote" class="restore-note">{{ restoreNote }}</div>
          </el-form-item>
        </el-form>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never">
        <template #header>{{ t('settings.distribute') }}</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item :label="t('settings.tokenStatus')">
            <el-tag :type="settings?.hasDistributeToken ? 'success' : 'info'" size="small">
              {{ settings?.hasDistributeToken ? t('settings.tokenEnabled') : t('settings.tokenNotCreated') }}
            </el-tag>
            <el-button v-if="canWrite()" size="small" style="margin-left: 12px" @click="createToken">
              {{ settings?.hasDistributeToken ? t('settings.regenToken') : t('settings.createToken') }}
            </el-button>
            <el-button v-if="canWrite() && settings?.hasDistributeToken" size="small" type="danger" plain @click="revokeToken">
              {{ t('settings.revokeToken') }}
            </el-button>
            <div class="form-tip">
              {{ t('settings.tokenTip') }}
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </el-col>
  </el-row>
</template>

<style scoped>
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.muted {
  color: var(--el-text-color-secondary);
}
.small {
  font-size: 12px;
  margin-left: 8px;
}
.test-results {
  margin-top: 8px;
  font-size: 13px;
}
.test-result {
  line-height: 1.8;
}
.test-result.ok {
  color: #67c23a;
}
.test-result.fail {
  color: #f56c6c;
}
.backup-danger {
  color: var(--el-color-warning);
}
.restore-note {
  margin-top: 6px;
  font-size: 13px;
  color: #409eff;
  line-height: 1.6;
}
</style>
