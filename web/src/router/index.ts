import { createRouter, createWebHistory } from 'vue-router';
import { authChecked, currentUser, fetchMe } from '../auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { title: '登录' } },
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '仪表盘' } },
    {
      path: '/certificates',
      name: 'certificates',
      component: () => import('../views/CertificatesView.vue'),
      meta: { title: '证书管理' },
    },
    {
      path: '/certificates/create',
      name: 'cert-create',
      component: () => import('../views/CreateCertificateView.vue'),
      meta: { title: '创建证书', requiresAdmin: true },
    },
    {
      path: '/certificates/import',
      name: 'cert-import',
      component: () => import('../views/ImportCertificateView.vue'),
      meta: { title: '导入证书', requiresAdmin: true },
    },
    {
      path: '/certificates/:id',
      name: 'cert-detail',
      component: () => import('../views/CertificateDetailView.vue'),
      meta: { title: '证书详情' },
    },
    { path: '/dns', name: 'dns', component: () => import('../views/DnsProvidersView.vue'), meta: { title: 'DNS API' } },
    {
      path: '/distribute',
      name: 'distribute',
      component: () => import('../views/DistributeOverviewView.vue'),
      meta: { title: '分发总览' },
    },
    { path: '/logs', name: 'logs', component: () => import('../views/LogsView.vue'), meta: { title: '日志' } },
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/UsersView.vue'),
      meta: { title: '用户管理', requiresAdmin: true },
    },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (to.path === '/login') return true;
  if (!authChecked.value) await fetchMe();
  if (!currentUser.value) {
    return to.fullPath === '/' ? { path: '/login' } : { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && currentUser.value.role !== 'admin') return { path: '/' };
  return true;
});

export default router;
