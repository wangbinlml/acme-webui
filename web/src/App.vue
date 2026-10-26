<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import en from 'element-plus/es/locale/lang/en';
import { api } from './api';
import { canWrite, currentUser } from './auth';
import { appVersion, loadVersion } from './version';
import { errMessage } from './utils';
import { theme, toggleTheme } from './theme';
import { setLocale, type Locale } from './locales';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

onMounted(loadVersion);

const isLoginPage = computed(() => route.path === '/login');

const active = computed(() => {
  const seg = route.path.split('/')[1];
  return seg ? `/${seg}` : '/';
});

const menu = computed(() => [
  { index: '/', title: t('menu.dashboard'), icon: 'Odometer' },
  { index: '/certificates', title: t('menu.certificates'), icon: 'Lock' },
  { index: '/distribute', title: t('menu.distribute'), icon: 'Share' },
  { index: '/dns', title: t('menu.dns'), icon: 'Connection' },
  ...(canWrite() ? [{ index: '/users', title: t('menu.users'), icon: 'User' }] : []),
  { index: '/settings', title: t('menu.settings'), icon: 'Setting' },
  { index: '/logs', title: t('menu.logs'), icon: 'Document' },
]);

const elLocale = computed(() => (locale.value === 'en-US' ? en : zhCn));

function switchLocale(next: Locale): void {
  setLocale(next);
}

const title = computed(() => (typeof route.meta.titleKey === 'string' ? t(route.meta.titleKey) : ''));

const roleLabel = computed(() =>
  currentUser.value?.role === 'admin' ? t('header.admin') : currentUser.value ? t('header.viewer') : '',
);

// ---- 修改密码 ----
const pwdDialog = ref(false);
const pwdSaving = ref(false);
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });

function openPwdDialog(): void {
  pwdForm.oldPassword = '';
  pwdForm.newPassword = '';
  pwdForm.confirm = '';
  pwdDialog.value = true;
}

async function savePassword(): Promise<void> {
  if (pwdForm.newPassword !== pwdForm.confirm) {
    ElMessage.error(t('header.passwordMismatch'));
    return;
  }
  pwdSaving.value = true;
  try {
    await api.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
    ElMessage.success(t('header.passwordChanged'));
    pwdDialog.value = false;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    pwdSaving.value = false;
  }
}

async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // 即使接口失败也照常回到登录页
  }
  currentUser.value = null;
  router.push('/login');
}
</script>

<template>
  <el-config-provider :locale="elLocale">
    <router-view v-if="isLoginPage" />

    <el-container v-else class="layout">
      <el-aside width="220px" class="aside">
        <div class="brand">
          <el-icon :size="24"><Lock /></el-icon>
          <span class="brand-name">Acme Manager</span>
        </div>
        <el-menu
          :default-active="active"
          router
          background-color="#1d2530"
          text-color="#9aa7b6"
          active-text-color="#ffffff"
        >
          <el-menu-item v-for="item in menu" :key="item.index" :index="item.index">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </el-menu>
        <div v-if="appVersion" class="aside-footer">Acme Manager v{{ appVersion }}</div>
      </el-aside>
      <el-container>
        <el-header class="header">
          <span class="header-title">{{ title }}</span>
          <div class="header-right">
            <el-tooltip :content="t('header.theme')" placement="bottom">
              <el-button text circle class="header-btn" @click="toggleTheme">
                <el-icon v-if="theme === 'dark'"><Sunny /></el-icon>
                <el-icon v-else><Moon /></el-icon>
              </el-button>
            </el-tooltip>
            <el-dropdown @command="switchLocale">
              <el-button text circle class="header-btn">
                <el-icon><Compass /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="zh-CN" :disabled="locale === 'zh-CN'">中文</el-dropdown-item>
                  <el-dropdown-item command="en-US" :disabled="locale === 'en-US'">English</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown v-if="currentUser" class="user-box">
              <span class="user-name">
                <el-icon><User /></el-icon>
                {{ currentUser.username }}
                <el-tag size="small" :type="currentUser.role === 'admin' ? 'primary' : 'info'">{{ roleLabel }}</el-tag>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openPwdDialog">{{ t('header.changePassword') }}</el-dropdown-item>
                  <el-dropdown-item divided @click="logout">{{ t('header.logout') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        <el-main class="main">
          <router-view />
        </el-main>
      </el-container>

      <el-dialog v-model="pwdDialog" :title="t('header.changePassword')" width="420px">
        <el-form label-width="90px" label-position="left">
          <el-form-item :label="t('header.oldPassword')">
            <el-input v-model="pwdForm.oldPassword" type="password" show-password />
          </el-form-item>
          <el-form-item :label="t('header.newPassword')">
            <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="6-128" />
          </el-form-item>
          <el-form-item :label="t('header.confirmPassword')">
            <el-input v-model="pwdForm.confirm" type="password" show-password @keyup.enter="savePassword" />
          </el-form-item>
        </el-form>
        <div class="pwd-tip">{{ t('header.passwordTip') }}</div>
        <template #footer>
          <el-button @click="pwdDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="pwdSaving" @click="savePassword">{{ t('common.save') }}</el-button>
        </template>
      </el-dialog>
    </el-container>
  </el-config-provider>
</template>

<style scoped>
.layout {
  height: 100vh;
}
.aside {
  background-color: #1d2530;
  display: flex;
  flex-direction: column;
}
.aside-footer {
  margin-top: auto;
  padding: 14px 20px;
  color: #586a7d;
  font-size: 12px;
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 20px;
  color: #fff;
  font-weight: 600;
  font-size: 17px;
}
.brand-name {
  letter-spacing: 0.5px;
}
.aside :deep(.el-menu) {
  border-right: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-btn {
  font-size: 16px;
  color: var(--el-text-color-regular);
}
.user-box {
  cursor: pointer;
}
.user-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.main {
  background: var(--el-bg-color-page);
  padding: 20px;
}
.pwd-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
}
</style>
