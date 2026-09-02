<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { DnsProviderView, SettingsData } from '../types';
import { errMessage } from '../utils';

const router = useRouter();
const submitting = ref(false);
const providers = ref<DnsProviderView[]>([]);
const settings = ref<SettingsData | null>(null);

const form = reactive({
  primaryDomain: '',
  sanText: '',
  ca: 'letsencrypt',
  keyType: 'ec-256',
  challengeType: 'dns01',
  dnsProviderId: undefined as number | undefined,
  autoRenew: true,
  renewBeforeDays: 30,
});

onMounted(async () => {
  try {
    providers.value = (await api.listProviders()).providers;
    settings.value = await api.getSettings();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
});

async function submit(): Promise<void> {
  const sanDomains = form.sanText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const hasWildcard = [form.primaryDomain, ...sanDomains].some((d) => d.trim().startsWith('*.'));
  if (hasWildcard && form.challengeType !== 'dns01') {
    ElMessage.error('通配符证书必须使用 DNS-01 验证');
    return;
  }
  if (form.challengeType === 'dns01' && !form.dnsProviderId) {
    ElMessage.error('DNS-01 验证需要选择一个 DNS Provider');
    return;
  }
  if (form.ca === 'zerossl' && settings.value && !settings.value.accountEmail) {
    ElMessage.error('使用 ZeroSSL 前请先在「设置」中配置账户邮箱');
    return;
  }

  submitting.value = true;
  try {
    const res = await api.createCert({
      primaryDomain: form.primaryDomain.trim().toLowerCase(),
      sanDomains: sanDomains.map((d) => d.toLowerCase()),
      ca: form.ca,
      keyType: form.keyType,
      challengeType: form.challengeType,
      dnsProviderId: form.dnsProviderId,
      autoRenew: form.autoRenew,
      renewBeforeDays: form.renewBeforeDays,
    });
    ElMessage.success('已创建，开始签发');
    router.push(`/certificates/${res.certificate.id}`);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-row justify="center">
    <el-col :span="14">
      <el-card shadow="never">
        <template #header>创建 SSL 证书</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="主域名" required>
            <el-input v-model="form.primaryDomain" placeholder="example.com 或 *.example.com" />
          </el-form-item>
          <el-form-item label="SAN">
            <el-input
              v-model="form.sanText"
              type="textarea"
              :rows="3"
              placeholder="每行一个域名，例如：&#10;www.example.com&#10;api.example.com"
            />
            <div class="form-tip">多域名证书请在这里追加，通配符（*.example.com）必须使用 DNS-01 验证</div>
          </el-form-item>
          <el-form-item label="CA">
            <el-radio-group v-model="form.ca">
              <el-radio value="letsencrypt">Let's Encrypt</el-radio>
              <el-radio value="zerossl">ZeroSSL</el-radio>
            </el-radio-group>
            <div v-if="form.ca === 'zerossl' && settings && !settings.accountEmail" class="form-tip warning">
              ZeroSSL 需要账户邮箱，请先到「设置」页填写
            </div>
          </el-form-item>
          <el-form-item label="密钥算法">
            <el-radio-group v-model="form.keyType">
              <el-radio value="ec-256">EC-256</el-radio>
              <el-radio value="ec-384">EC-384</el-radio>
              <el-radio value="rsa-2048">RSA-2048</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="验证方式">
            <el-radio-group v-model="form.challengeType">
              <el-radio value="dns01">DNS-01（推荐，支持通配符）</el-radio>
              <el-radio value="http01">HTTP-01（standalone，需要开放 80 端口）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.challengeType === 'dns01'" label="DNS Provider" required>
            <el-select v-model="form.dnsProviderId" placeholder="选择 DNS Provider" style="width: 100%">
              <el-option
                v-for="p in providers"
                :key="p.id"
                :label="`${p.name}（${p.typeName}）`"
                :value="p.id"
              />
            </el-select>
            <div v-if="providers.length === 0" class="form-tip warning">
              还没有可用的 DNS Provider，
              <router-link to="/dns">去添加</router-link>
            </div>
          </el-form-item>
          <el-form-item label="自动续期">
            <el-switch v-model="form.autoRenew" />
            <span class="form-tip inline">到期前</span>
            <el-input-number v-model="form.renewBeforeDays" :min="1" :max="89" :disabled="!form.autoRenew" />
            <span class="form-tip inline">天自动续期</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submit">创建证书</el-button>
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
.form-tip.warning {
  color: #e6a23c;
}
.form-tip.inline {
  margin: 0 8px;
}
</style>
