<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { currentUser, fetchMe } from '../auth';
import { appVersion } from '../version';
import { errMessage } from '../utils';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

/** setup = 首次部署初始化管理员；login = 常规登录 */
const mode = ref<'loading' | 'setup' | 'login'>('loading');
const submitting = ref(false);
const form = reactive({ username: '', password: '', confirm: '' });

onMounted(async () => {
  try {
    const res = await api.authStatus();
    mode.value = res.needsSetup ? 'setup' : 'login';
  } catch (e) {
    ElMessage.error(errMessage(e));
    mode.value = 'login';
  }
});

async function submit(): Promise<void> {
  if (mode.value === 'setup' && form.password !== form.confirm) {
    ElMessage.error(t('login.passwordMismatch'));
    return;
  }
  submitting.value = true;
  try {
    if (mode.value === 'setup') {
      await api.setup({ username: form.username.trim(), password: form.password });
      ElMessage.success(t('login.adminCreated'));
    } else {
      await api.login({ username: form.username.trim(), password: form.password });
    }
    await fetchMe();
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.push(currentUser.value ? redirect : '/login');
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <el-card shadow="always" class="login-card">
      <div class="brand">
        <el-icon :size="28"><Lock /></el-icon>
        <span>Acme Manager</span>
      </div>

      <template v-if="mode === 'loading'">
        <el-skeleton :rows="3" animated />
      </template>

      <template v-else>
        <div class="mode-title">{{ mode === 'setup' ? t('login.setupTitle') : t('login.loginTitle') }}</div>
        <el-alert
          v-if="mode === 'setup'"
          type="info"
          :closable="false"
          class="setup-tip"
          :title="t('login.setupAlert')"
        />
        <el-form label-position="top" @submit.prevent>
          <el-form-item :label="t('login.username')">
            <el-input v-model="form.username" :placeholder="t('login.usernamePlaceholder')" @keyup.enter="submit" />
          </el-form-item>
          <el-form-item :label="t('login.password')">
            <el-input v-model="form.password" type="password" show-password @keyup.enter="submit" />
          </el-form-item>
          <el-form-item v-if="mode === 'setup'" :label="t('login.confirmPassword')">
            <el-input v-model="form.confirm" type="password" show-password @keyup.enter="submit" />
          </el-form-item>
          <el-button type="primary" class="submit" :loading="submitting" @click="submit">
            {{ mode === 'setup' ? t('login.setupBtn') : t('login.loginBtn') }}
          </el-button>
        </el-form>
      </template>
    </el-card>

    <div v-if="appVersion" class="page-footer">Acme Manager v{{ appVersion }}</div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1d2530;
}
.page-footer {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  user-select: none;
}
.login-card {
  width: 380px;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 20px;
}
.mode-title {
  font-size: 14px;
  color: var(--el-text-color-regular);
  margin-bottom: 12px;
}
.setup-tip {
  margin-bottom: 16px;
}
.submit {
  width: 100%;
}
</style>
