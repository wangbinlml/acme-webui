<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const active = computed(() => {
  const seg = route.path.split('/')[1];
  return seg ? `/${seg}` : '/';
});

const menu = [
  { index: '/', title: '仪表盘', icon: 'Odometer' },
  { index: '/certificates', title: '证书管理', icon: 'Lock' },
  { index: '/dns', title: 'DNS API', icon: 'Connection' },
  { index: '/logs', title: '日志', icon: 'Document' },
  { index: '/settings', title: '设置', icon: 'Setting' },
];

const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : ''));
</script>

<template>
  <el-container class="layout">
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
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
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
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.main {
  background: #f5f7fa;
  padding: 20px;
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
