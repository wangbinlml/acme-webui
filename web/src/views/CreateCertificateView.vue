<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { DnsProviderView, SettingsData } from '../types';
import { errMessage } from '../utils';

const router = useRouter();
const { t } = useI18n();
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
    ElMessage.error(t('certCreate.wildcardNeedDns'));
    return;
  }
  if (form.challengeType === 'dns01' && !form.dnsProviderId) {
    ElMessage.error(t('certCreate.needProvider'));
    return;
  }
  if (form.ca === 'zerossl' && settings.value && !settings.value.accountEmail) {
    ElMessage.error(t('certCreate.needEmail'));
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
    ElMessage.success(t('certCreate.created'));
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
        <template #header>{{ t('certCreate.title') }}</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item :label="t('certCreate.primaryDomain')" required>
            <el-input v-model="form.primaryDomain" :placeholder="t('certCreate.primaryDomainPlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('certCreate.san')">
            <el-input
              v-model="form.sanText"
              type="textarea"
              :rows="3"
              :placeholder="t('certCreate.sanPlaceholder')"
            />
            <div class="form-tip">{{ t('certCreate.sanTip') }}</div>
          </el-form-item>
          <el-form-item :label="t('certCreate.ca')">
            <el-radio-group v-model="form.ca">
              <el-radio value="letsencrypt">{{ t('ca.letsencrypt') }}</el-radio>
              <el-radio value="zerossl">{{ t('ca.zerossl') }}</el-radio>
            </el-radio-group>
            <div v-if="form.ca === 'zerossl' && settings && !settings.accountEmail" class="form-tip warning">
              {{ t('certCreate.caZeroTip') }}
            </div>
          </el-form-item>
          <el-form-item :label="t('certCreate.keyType')">
            <el-radio-group v-model="form.keyType">
              <el-radio value="ec-256">EC-256</el-radio>
              <el-radio value="ec-384">EC-384</el-radio>
              <el-radio value="rsa-2048">RSA-2048</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('certCreate.challenge')">
            <el-radio-group v-model="form.challengeType">
              <el-radio value="dns01">{{ t('certCreate.dns01') }}</el-radio>
              <el-radio value="http01">{{ t('certCreate.http01') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.challengeType === 'dns01'" :label="t('certCreate.dnsProvider')" required>
            <el-select v-model="form.dnsProviderId" :placeholder="t('certCreate.dnsProviderPlaceholder')" style="width: 100%">
              <el-option
                v-for="p in providers"
                :key="p.id"
                :label="`${p.name}（${p.typeName}）`"
                :value="p.id"
              />
            </el-select>
            <div v-if="providers.length === 0" class="form-tip warning">
              {{ t('certCreate.noProviderTip') }}
              <router-link to="/dns">{{ t('certCreate.goAdd') }}</router-link>
            </div>
          </el-form-item>
          <el-form-item :label="t('certCreate.autoRenew')">
            <el-switch v-model="form.autoRenew" />
            <span class="form-tip inline">{{ t('certCreate.renewBefore') }}</span>
            <el-input-number v-model="form.renewBeforeDays" :min="1" :max="89" :disabled="!form.autoRenew" />
            <span class="form-tip inline">{{ t('certCreate.renewAfter') }}</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submit">{{ t('certCreate.submit') }}</el-button>
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
.form-tip.warning {
  color: var(--el-color-warning);
}
.form-tip.inline {
  margin: 0 8px;
}
</style>
