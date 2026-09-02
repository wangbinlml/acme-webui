<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { SettingsData } from '../types';
import { errMessage } from '../utils';

const settings = ref<SettingsData | null>(null);
const saving = ref(false);
const savingNotify = ref(false);
const testing = ref(false);
const running = ref(false);

const form = reactive({ accountEmail: '' });
const notifyForm = reactive({ channel: '' as '' | 'wecom' | 'feishu', webhook: '', feishuSecret: '' });

async function load(): Promise<void> {
  try {
    settings.value = await api.getSettings();
    form.accountEmail = settings.value.accountEmail;
    notifyForm.channel = settings.value.notify.channel;
    notifyForm.webhook = settings.value.notify.webhook;
    notifyForm.feishuSecret = settings.value.notify.feishuSecret;
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

/** 地址未改动时传回 MASK 哨兵，避免把脱敏显示值存进数据库 */
function notifyPayload(): { channel: string; webhook: string; feishuSecret: string } {
  const untouched = settings.value && notifyForm.webhook === settings.value.notify.webhook;
  return {
    channel: notifyForm.channel,
    webhook: untouched ? '••••••••' : notifyForm.webhook.trim(),
    feishuSecret: notifyForm.feishuSecret.trim(),
  };
}

async function saveNotify(): Promise<void> {
  savingNotify.value = true;
  try {
    await api.saveSettings({ accountEmail: form.accountEmail.trim(), notify: notifyPayload() });
    ElMessage.success('通知配置已保存');
    await load();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    savingNotify.value = false;
  }
}

async function testNotify(): Promise<void> {
  testing.value = true;
  try {
    await api.saveSettings({ accountEmail: form.accountEmail.trim(), notify: notifyPayload() });
    const res = await api.testNotify();
    ElMessage.success(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    testing.value = false;
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
            <el-button type="primary" :loading="saving" @click="save">保存</el-button>
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
          <el-button type="primary" :loading="running" @click="runCheck">立即执行续期检查</el-button>
          <span class="muted small">执行过程可在「日志」页查看</span>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-row style="margin-top: 16px">
    <el-col :span="24">
      <el-card shadow="never">
        <template #header>通知推送</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="通知渠道">
            <el-radio-group v-model="notifyForm.channel">
              <el-radio value="">不启用</el-radio>
              <el-radio value="wecom">企业微信机器人</el-radio>
              <el-radio value="feishu">飞书机器人</el-radio>
            </el-radio-group>
          </el-form-item>
          <template v-if="notifyForm.channel">
            <el-form-item label="Webhook">
              <el-input
                v-model="notifyForm.webhook"
                :placeholder="notifyForm.channel === 'wecom'
                  ? 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                  : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'"
              />
              <div class="form-tip">
                {{ notifyForm.channel === 'wecom'
                  ? '群设置 → 群机器人 → 添加机器人 → 复制 Webhook 地址'
                  : '飞书群 → 设置 → 群机器人 → 添加自定义机器人 → 复制 Webhook 地址' }}
              </div>
            </el-form-item>
            <el-form-item v-if="notifyForm.channel === 'feishu'" label="签名密钥">
              <el-input v-model="notifyForm.feishuSecret" placeholder="机器人安全设置选择「签名校验」时填写，选关键词校验可留空" />
              <div class="form-tip">若机器人使用「自定义关键词」校验，请把关键词设为 Acme Manager</div>
            </el-form-item>
          </template>
          <el-form-item>
            <el-button type="primary" :loading="savingNotify" @click="saveNotify">保存</el-button>
            <el-button :loading="testing" :disabled="!notifyForm.channel" @click="testNotify">保存并发送测试</el-button>
            <span class="muted small">续期成功 / 失败都会推送到群</span>
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
</style>
