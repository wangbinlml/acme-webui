import { createRouter, createWebHistory } from 'vue-router';
import { authChecked, currentUser, fetchMe } from '../auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { titleKey: 'login.loginTitle' } },
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { titleKey: 'menu.dashboard' } },
    {
      path: '/certificates',
      name: 'certificates',
      component: () => import('../views/CertificatesView.vue'),
      meta: { titleKey: 'menu.certificates' },
    },
    {
      path: '/certificates/create',
      name: 'cert-create',
      component: () => import('../views/CreateCertificateView.vue'),
      meta: { titleKey: 'route.certCreate', requiresAdmin: true },
    },
    {
      path: '/certificates/import',
      name: 'cert-import',
      component: () => import('../views/ImportCertificateView.vue'),
      meta: { titleKey: 'route.certImport', requiresAdmin: true },
    },
    {
      path: '/certificates/:id',
      name: 'cert-detail',
      component: () => import('../views/CertificateDetailView.vue'),
      meta: { titleKey: 'route.certDetail' },
    },
    { path: '/dns', name: 'dns', component: () => import('../views/DnsProvidersView.vue'), meta: { titleKey: 'menu.dns' } },
    {
      path: '/distribute',
      name: 'distribute',
      component: () => import('../views/DistributeOverviewView.vue'),
      meta: { titleKey: 'menu.distribute' },
    },
    { path: '/logs', name: 'logs', component: () => import('../views/LogsView.vue'), meta: { titleKey: 'menu.logs' } },
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/UsersView.vue'),
      meta: { titleKey: 'menu.users', requiresAdmin: true },
    },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { titleKey: 'menu.settings' } },
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
