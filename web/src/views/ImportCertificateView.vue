<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { errMessage } from '../utils';

const router = useRouter();
const { t } = useI18n();
const submitting = ref(false);
const fullchain = ref('');
const privkey = ref('');
const autoRenew = ref(false);
const renewBeforeDays = ref(30);

async function onFullchainFile(file: File): Promise<void> {
  fullchain.value = await file.text();
}

async function onPrivkeyFile(file: File): Promise<void> {
  privkey.value = await file.text();
}

async function submit(): Promise<void> {
  if (!fullchain.value.trim() || !privkey.value.trim()) {
    ElMessage.error(t('certImport.needBoth'));
    return;
  }
  if (!fullchain.value.includes('BEGIN CERTIFICATE')) {
    ElMessage.error(t('certImport.badFullchain'));
    return;
  }
  if (!privkey.value.includes('PRIVATE KEY')) {
    ElMessage.error(t('certImport.badPrivkey'));
    return;
  }

  submitting.value = true;
  try {
    const res = await api.importCert({
      fullchain: fullchain.value.trim(),
      privkey: privkey.value.trim(),
      autoRenew: autoRenew.value,
      renewBeforeDays: renewBeforeDays.value,
    });
    ElMessage.success(t('certImport.imported', { domain: res.certificate.primaryDomain }));
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
        <template #header>{{ t('certImport.title') }}</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item :label="t('certImport.fullchain')" required>
            <div class="upload-row">
              <el-input
                v-model="fullchain"
                type="textarea"
                :rows="6"
                :placeholder="t('certImport.fullchainPlaceholder')"
              />
              <el-upload
                :show-file-list="false"
                :before-upload="(f: File) => { onFullchainFile(f); return false; }"
                accept=".pem,.crt,.txt"
              >
                <el-button size="small">{{ t('certImport.chooseFile') }}</el-button>
              </el-upload>
            </div>
          </el-form-item>
          <el-form-item :label="t('certImport.privkey')" required>
            <div class="upload-row">
              <el-input
                v-model="privkey"
                type="textarea"
                :rows="6"
                :placeholder="t('certImport.privkeyPlaceholder')"
              />
              <el-upload
                :show-file-list="false"
                :before-upload="(f: File) => { onPrivkeyFile(f); return false; }"
                accept=".pem,.key,.txt"
              >
                <el-button size="small">{{ t('certImport.chooseFile') }}</el-button>
              </el-upload>
            </div>
          </el-form-item>
          <el-form-item :label="t('certImport.autoRenew')">
            <el-switch v-model="autoRenew" />
            <span class="form-tip inline">{{ t('certImport.autoRenewTip') }}</span>
          </el-form-item>
          <el-form-item v-if="autoRenew" :label="t('certImport.renewBefore')">
            <el-input-number v-model="renewBeforeDays" :min="1" :max="89" />
            <span class="form-tip inline">{{ t('certImport.renewAfter') }}</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submit">{{ t('certImport.submit') }}</el-button>
            <el-button @click="router.push('/certificates')">{{ t('certImport.cancel') }}</el-button>
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" style="margin-top: 8px">
          <ul class="help-list">
            <li>{{ t('certImport.help1') }}</li>
            <li>{{ t('certImport.help2') }}</li>
            <li>{{ t('certImport.help3') }}</li>
            <li>{{ t('certImport.help4') }}</li>
          </ul>
        </el-alert>
      </el-card>
    </el-col>
  </el-row>
</template>

<style scoped>
.upload-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.upload-row .el-textarea {
  flex: 1;
}
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.form-tip.inline {
  margin: 0 8px;
}
.help-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}
</style>
