<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { NotifyTestResult, SettingsData } from '../types';
import { canWrite } from '../auth';
import { errMessage } from '../utils';

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
</style>
