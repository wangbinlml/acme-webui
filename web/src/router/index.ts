import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
      meta: { title: '创建证书' },
    },
    {
      path: '/certificates/:id',
      name: 'cert-detail',
      component: () => import('../views/CertificateDetailView.vue'),
      meta: { title: '证书详情' },
    },
    { path: '/dns', name: 'dns', component: () => import('../views/DnsProvidersView.vue'), meta: { title: 'DNS API' } },
    { path: '/logs', name: 'logs', component: () => import('../views/LogsView.vue'), meta: { title: '日志' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
