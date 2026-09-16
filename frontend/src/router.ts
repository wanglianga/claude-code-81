import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('./pages/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: () => import('./pages/Dashboard.vue'), title: '总览大屏' },
      { path: 'booking', component: () => import('./pages/Booking.vue'), title: '班车预约', roles: ['employee'] },
      { path: 'my-attendance', component: () => import('./pages/MyAttendance.vue'), title: '我的考勤与申诉', roles: ['employee'] },
      { path: 'driver', component: () => import('./pages/DriverConsole.vue'), title: '司机控制台', roles: ['driver'] },
      { path: 'dispatch', component: () => import('./pages/Dispatch.vue'), title: '调度派车', roles: ['dispatcher', 'operator', 'admin'] },
      { path: 'relocations', component: () => import('./pages/Relocations.vue'), title: '站点施工临时改站', roles: ['dispatcher', 'operator', 'admin'] },
      { path: 'supplements', component: () => import('./pages/Supplements.vue'), title: '加班补车与月结', roles: ['hr', 'dispatcher', 'operator', 'admin', 'driver'] },
      { path: 'events', component: () => import('./pages/Events.vue'), title: '途中事件五方协同' },
      { path: 'attendance', component: () => import('./pages/Attendance.vue'), title: '考勤档案', roles: ['hr', 'operator', 'admin', 'dispatcher'] },
      { path: 'appeals', component: () => import('./pages/Appeals.vue'), title: '迟到申诉', roles: ['hr', 'operator', 'admin'] },
      { path: 'certificates', component: () => import('./pages/Certificates.vue'), title: '晚点考勤豁免证明', roles: ['hr', 'operator', 'admin', 'dispatcher'] },
      { path: 'performance', component: () => import('./pages/Performance.vue'), title: '司机绩效', roles: ['operator', 'admin', 'dispatcher', 'hr', 'driver'] },
      { path: 'proposals', component: () => import('./pages/Proposals.vue'), title: '线路调整双确认' },
      { path: 'visitors', component: () => import('./pages/Visitors.vue'), title: '访客与门禁', roles: ['hr', 'operator', 'dispatcher', 'admin'] },
      { path: 'base-data', component: () => import('./pages/BaseData.vue'), title: '基础数据', roles: ['operator', 'admin', 'dispatcher'] },
    ],
  },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  const token = localStorage.getItem('token');
  if (!to.meta.public && !token) return '/login';
  if (to.meta.roles) {
    const role = localStorage.getItem('role');
    if (!(to.meta.roles as string[]).includes(role || '')) return '/dashboard';
  }
  return true;
});

export default router;
