<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { NotifyTestResult, SettingsData } from '../types';
import { canWrite, currentUser } from '../auth';
import { errMessage } from '../utils';

const router = useRouter();
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
    ElMessage.success('已保存');
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
    if (await saveNotifyTab(part)) ElMessage.success('通知配置已保存');
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
    if (res.ok) ElMessage.success('测试消息已发送，请查收');
    else ElMessage.error(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    testing.value = '';
  }
}

function channelLabel(c: string): string {
  return c === 'robot' ? '机器人' : c === 'webhook' ? 'Webhook' : '邮件';
}

async function createToken(): Promise<void> {
  if (settings.value?.hasDistributeToken) {
    try {
      await ElMessageBox.confirm(
        '重新生成后旧 Token 立即失效，所有已安装机器的自动同步会失败，需用新命令重装。确定？',
        '重新生成 Token',
        { type: 'warning' },
      );
    } catch {
      return;
    }
  }
  try {
    await api.createDistributeToken();
    ElMessage.success('Token 已生成，到证书详情页点「分发到其他服务器」即可生成安装命令');
    await load();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function revokeToken(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '吊销后所有机器的自动同步立即失败（已下载到机器上的证书文件不受影响）。确定？',
      '吊销 Token',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await api.revokeDistributeToken();
    ElMessage.success('已吊销');
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
  throw new Error('服务未在预期时间内重启完成（本地开发模式需手动重启后端 pnpm dev）');
}

async function onRestoreFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;
  try {
    await ElMessageBox.confirm(
      `将使用 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）覆盖当前全部数据。\n` +
        '恢复前会自动把当前数据留底到 data/pre-restore-safety.tar.gz；完成后服务自动重启，需要重新登录。',
      '恢复备份',
      { type: 'warning', confirmButtonText: '覆盖并恢复' },
    );
  } catch {
    return; // 用户取消
  }
  restoring.value = true;
  restoreNote.value = '正在上传并校验备份（校验失败不会有任何改动）…';
  try {
    const res = await api.restoreBackup(file);
    restoreNote.value = `${res.message}正在等待服务重启…`;
    await waitRestart();
    currentUser.value = null;
    ElMessage.success('恢复完成，请重新登录');
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
        <template #header>账户</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="账户邮箱">
            <el-input v-model="form.accountEmail" placeholder="用于 Let's Encrypt / ZeroSSL 账户注册" />
            <div class="form-tip">
              ZeroSSL 强制要求邮箱；Let's Encrypt 推荐填写以便接收到期通知。该邮箱会在签发前用于注册 ACME 账户。
            </div>
          </el-form-item>
          <el-form-item>
            <el-button v-if="canWrite()" type="primary" :loading="saving" @click="save">保存</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card shadow="never">
        <template #header>自动续期</template>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="续期计划">
            <span class="mono">{{ settings?.renewCron ?? '-' }}</span>
            <span class="muted">（每天 03:00，服务器时区）</span>
          </el-descriptions-item>
          <el-descriptions-item label="acme.sh">
            <el-tag :type="settings?.acmeAvailable ? 'success' : 'danger'" size="small">
              {{ settings?.acmeAvailable ? '已安装' : '未安装' }}
            </el-tag>
            <div class="form-tip">{{ settings?.acmeBin }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="版本">v{{ settings?.version ?? '-' }}</el-descriptions-item>
        </el-descriptions>
        <div style="margin-top: 16px">
          <el-button v-if="canWrite()" type="primary" :loading="running" @click="runCheck">立即执行续期检查</el-button>
          <span class="muted small">执行过程可在「日志」页查看</span>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never">
        <template #header>通知推送</template>
        <el-alert
          type="info"
          :closable="false"
          style="margin-bottom: 16px"
          title="签发 / 续期的成功与失败都会推送；三个渠道可同时启用，任一渠道失败不影响其他渠道"
        />
        <el-tabs>
          <el-tab-pane label="机器人推送">
            <el-form label-width="110px" label-position="left">
              <el-form-item label="通知渠道">
                <el-radio-group v-model="robotForm.channel" :disabled="!canWrite()">
                  <el-radio value="">不启用</el-radio>
                  <el-radio value="wecom">企业微信机器人</el-radio>
                  <el-radio value="feishu">飞书机器人</el-radio>
                </el-radio-group>
              </el-form-item>
              <template v-if="robotForm.channel">
                <el-form-item label="Webhook">
                  <el-input
                    v-model="robotForm.webhook"
                    :disabled="!canWrite()"
                    :placeholder="robotForm.channel === 'wecom'
                      ? 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                      : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'"
                  />
                  <div class="form-tip">
                    {{ robotForm.channel === 'wecom'
                      ? '群设置 → 群机器人 → 添加机器人 → 复制 Webhook 地址'
                      : '飞书群 → 设置 → 群机器人 → 添加自定义机器人 → 复制 Webhook 地址' }}
                  </div>
                </el-form-item>
                <el-form-item v-if="robotForm.channel === 'feishu'" label="签名密钥">
                  <el-input v-model="robotForm.feishuSecret" :disabled="!canWrite()" placeholder="机器人安全设置选择「签名校验」时填写，选关键词校验可留空" />
                  <div class="form-tip">若机器人使用「自定义关键词」校验，请把关键词设为 Acme Manager</div>
                </el-form-item>
              </template>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('robot')">保存</el-button>
                <el-button :loading="testing === 'robot'" :disabled="!robotForm.channel" @click="testNotify('robot')">保存并发送测试</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="Webhook">
            <el-form label-width="110px" label-position="left">
              <el-form-item label="推送地址">
                <el-input v-model="webhookForm.url" :disabled="!canWrite()" placeholder="https://your-hook.example.com/acme" />
                <div class="form-tip">
                  签发 / 续期结束时向该地址 POST JSON（event / title / message / ok / domain / domains / ca / expiresAt / error 等），
                  HTTP 2xx 视为成功；留空表示不启用。适合对接 ntfy / Bark / 自建脚本等任意系统。
                </div>
              </el-form-item>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('webhook')">保存</el-button>
                <el-button :loading="testing === 'webhook'" :disabled="!webhookForm.url" @click="testNotify('webhook')">保存并发送测试</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="邮件（SMTP）">
            <el-form label-width="110px" label-position="left">
              <el-form-item label="SMTP 服务器">
                <el-input v-model="smtpForm.host" :disabled="!canWrite()" placeholder="如 smtp.qq.com / smtp.163.com / smtp.gmail.com" />
                <el-input-number v-model="smtpForm.port" :min="1" :max="65535" :disabled="!canWrite()" style="margin-left: 8px" />
                <div class="form-tip">465 为 SSL；587 / 25 将自动尝试 STARTTLS。服务器与收件人都留空表示不启用</div>
              </el-form-item>
              <el-form-item label="账号 / 密码">
                <el-input v-model="smtpForm.user" :disabled="!canWrite()" placeholder="SMTP 用户名（通常为邮箱地址）" style="width: 55%" />
                <el-input
                  v-model="smtpForm.password"
                  type="password"
                  show-password
                  :disabled="!canWrite()"
                  placeholder="SMTP 密码 / 授权码"
                  style="width: 45%"
                />
                <div class="form-tip">QQ / 163 / Gmail 等需使用「授权码 / 应用专用密码」，而非登录密码</div>
              </el-form-item>
              <el-form-item label="发件人">
                <el-input v-model="smtpForm.from" :disabled="!canWrite()" placeholder="留空默认使用登录账号" />
              </el-form-item>
              <el-form-item label="收件人">
                <el-input v-model="smtpForm.to" :disabled="!canWrite()" placeholder="a@example.com, b@example.com（多个用逗号分隔）" />
              </el-form-item>
              <el-form-item v-if="canWrite()">
                <el-button type="primary" :loading="savingNotify" @click="saveNotify('smtp')">保存</el-button>
                <el-button :loading="testing === 'smtp'" :disabled="!smtpForm.host || !smtpForm.to" @click="testNotify('smtp')">保存并发送测试</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <div v-if="testResults.length > 0" class="test-results">
          <div v-for="r in testResults" :key="r.channel" :class="['test-result', r.ok ? 'ok' : 'fail']">
            {{ channelLabel(r.channel) }}：{{ r.ok ? '发送成功' : `失败（${r.error ?? '未知错误'}）` }}
          </div>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never" v-loading="restoring" element-loading-text="恢复中…">
        <template #header>备份与恢复</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="备份范围">
            <el-radio-group v-model="backupMode" :disabled="!canWrite()">
              <el-radio value="full">完整备份</el-radio>
              <el-radio value="config">仅配置</el-radio>
            </el-radio-group>
            <div class="form-tip">
              <b>完整备份</b>：数据库 + 全部证书与私钥 + acme.sh 账户，用于迁移 / 灾备恢复。<span class="backup-danger">包含敏感信息，请妥善保管</span>。<br />
              <b>仅配置</b>：证书记录、DNS Provider（凭据已置空）、部署目标等配置，不含用户 / 会话 / 日志 / 证书文件，适合分享排障。
            </div>
          </el-form-item>
          <el-form-item>
            <el-button v-if="canWrite()" type="primary" :loading="restoring" @click="downloadBackup">下载备份（tar.gz）</el-button>
          </el-form-item>
          <el-form-item label="恢复">
            <el-button v-if="canWrite()" type="danger" plain :loading="restoring" @click="pickRestoreFile">
              上传备份恢复…
            </el-button>
            <input ref="fileInput" type="file" accept=".tar.gz,.tgz,application/gzip" style="display: none" @change="onRestoreFile" />
            <div class="form-tip">
              上传本页导出的 tar.gz 覆盖当前全部数据。先校验备份有效性（失败不会有任何改动），生效前自动把当前数据留底到
              data/pre-restore-safety.tar.gz；完成后服务自动重启（Docker 部署，本地开发需手动重启后端）并要求重新登录。
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
        <template #header>多主机分发</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="分发 Token">
            <el-tag :type="settings?.hasDistributeToken ? 'success' : 'info'" size="small">
              {{ settings?.hasDistributeToken ? '已启用' : '未创建' }}
            </el-tag>
            <el-button v-if="canWrite()" size="small" style="margin-left: 12px" @click="createToken">
              {{ settings?.hasDistributeToken ? '重新生成' : '创建 Token' }}
            </el-button>
            <el-button v-if="canWrite() && settings?.hasDistributeToken" size="small" type="danger" plain @click="revokeToken">
              吊销
            </el-button>
            <div class="form-tip">
              证书跑在多台服务器上时用：创建 Token 后，在证书详情页点「分发到其他服务器」生成一条命令，到每台目标服务器上以
              root 执行即可（自动下载证书、每天检查更新、有变化才 reload）。Token 只能读取证书文件，无法查看或修改任何配置；
              重新生成后旧 Token 立即失效，已安装的机器需用新命令重装。
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
  color: #909399;
  line-height: 1.6;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.muted {
  color: #909399;
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
  color: #e6a23c;
}
.restore-note {
  margin-top: 6px;
  font-size: 13px;
  color: #409eff;
  line-height: 1.6;
}
</style>
