<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from './api';
import { canWrite, currentUser } from './auth';
import { errMessage } from './utils';

const route = useRoute();
const router = useRouter();

const isLoginPage = computed(() => route.path === '/login');

const active = computed(() => {
  const seg = route.path.split('/')[1];
  return seg ? `/${seg}` : '/';
});

const menu = computed(() => {
  const items = [
    { index: '/', title: '仪表盘', icon: 'Odometer' },
    { index: '/certificates', title: '证书管理', icon: 'Lock' },
    { index: '/dns', title: 'DNS API', icon: 'Connection' },
    { index: '/logs', title: '日志', icon: 'Document' },
  ];
  if (canWrite()) items.push({ index: '/users', title: '用户管理', icon: 'User' });
  items.push({ index: '/settings', title: '设置', icon: 'Setting' });
  return items;
});

const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : ''));

const roleLabel = computed(() =>
  currentUser.value?.role === 'admin' ? '管理员' : currentUser.value ? '只读' : '',
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
    ElMessage.error('两次输入的新密码不一致');
    return;
  }
  pwdSaving.value = true;
  try {
    await api.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
    ElMessage.success('密码已修改');
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
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="header-title">{{ title }}</span>
        <el-dropdown v-if="currentUser" class="user-box">
          <span class="user-name">
            <el-icon><User /></el-icon>
            {{ currentUser.username }}
            <el-tag size="small" :type="currentUser.role === 'admin' ? 'primary' : 'info'">{{ roleLabel }}</el-tag>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="openPwdDialog">修改密码</el-dropdown-item>
              <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>

    <el-dialog v-model="pwdDialog" title="修改密码" width="420px">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="6-128 位" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password @keyup.enter="savePassword" />
        </el-form-item>
      </el-form>
      <div class="pwd-tip">修改成功后其他设备会被强制下线</div>
      <template #footer>
        <el-button @click="pwdDialog = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}
.aside {
  background-color: #1d2530;
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
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.user-box {
  cursor: pointer;
}
.user-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #303133;
}
.main {
  background: #f5f7fa;
  padding: 20px;
}
.pwd-tip {
  font-size: 12px;
  color: #909399;
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
