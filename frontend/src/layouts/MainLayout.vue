<template>
  <el-container style="height: 100vh">
    <el-aside width="226px" style="background: linear-gradient(180deg,#0b3d91,#123b7a)">
      <div class="brand-side">
        🚌 园区通勤协同平台
        <small>预约 · 签到 · 晚点 · 申诉 · 线路共治</small>
      </div>
      <el-menu :default-active="$route.path" router background-color="transparent" text-color="#cfe0ff"
               active-text-color="#fff" @select="go">
        <el-menu-item index="/dashboard"><el-icon><DataLine/></el-icon><span>总览大屏</span></el-menu-item>
        <el-menu-item v-if="role==='employee'" index="/booking"><el-icon><Calendar/></el-icon><span>班车预约</span></el-menu-item>
        <el-menu-item v-if="role==='employee'" index="/my-attendance"><el-icon><DocumentChecked/></el-icon><span>我的考勤/申诉</span></el-menu-item>
        <el-menu-item v-if="role==='driver'" index="/driver"><el-icon><Van/></el-icon><span>司机控制台</span></el-menu-item>
        <el-menu-item v-if="['dispatcher','operator','admin'].includes(role)" index="/dispatch">
          <el-icon><Coordinate/></el-icon><span>调度派车</span></el-menu-item>
        <el-menu-item v-if="['dispatcher','operator','admin'].includes(role)" index="/relocations">
          <el-icon><MapLocation/></el-icon><span>施工临时改站</span></el-menu-item>
        <el-menu-item v-if="['hr','dispatcher','operator','admin','driver'].includes(role)" index="/supplements">
          <el-icon><Sunny/></el-icon><span>加班补车/月结</span></el-menu-item>
        <el-menu-item index="/events"><el-icon><Warning/></el-icon><span>途中事件协同</span>
          <el-badge v-if="openEvents>0" :value="openEvents" class="badge-dot"/></el-menu-item>
        <el-menu-item v-if="['hr','operator','admin','dispatcher'].includes(role)" index="/attendance">
          <el-icon><Tickets/></el-icon><span>考勤档案</span></el-menu-item>
        <el-menu-item v-if="['hr','operator','admin'].includes(role)" index="/appeals">
          <el-icon><ChatDotSquare/></el-icon><span>迟到申诉</span>
          <el-badge v-if="pendingAppeals>0" :value="pendingAppeals" class="badge-dot"/></el-menu-item>
        <el-menu-item v-if="['hr','operator','admin','dispatcher'].includes(role)" index="/certificates">
          <el-icon><Document/></el-icon><span>晚点豁免证明</span>
          <el-badge v-if="pendingCerts>0" :value="pendingCerts" class="badge-dot"/></el-menu-item>
        <el-menu-item v-if="['operator','admin','dispatcher','hr','driver'].includes(role)" index="/performance">
          <el-icon><TrophyBase/></el-icon><span>司机绩效</span></el-menu-item>
        <el-menu-item index="/proposals"><el-icon><Share/></el-icon><span>线路调整双确认</span></el-menu-item>
        <el-menu-item v-if="['operator','admin','dispatcher','hr','employee'].includes(role)" index="/line-relocations"><el-icon><OfficeBuilding/></el-icon><span>搬迁线路重排</span></el-menu-item>
        <el-menu-item v-if="['hr','operator','dispatcher','admin'].includes(role)" index="/visitors">
          <el-icon><Avatar/></el-icon><span>访客与门禁</span></el-menu-item>
        <el-menu-item v-if="['operator','admin','dispatcher'].includes(role)" index="/base-data">
          <el-icon><Setting/></el-icon><span>基础数据</span></el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="background:#fff;display:flex;align-items:center;justify-content:space-between;
                        box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <div style="font-weight:700">{{ $route.meta?.title || '园区通勤协同平台' }}</div>
        <div style="display:flex;align-items:center;gap:14px">
          <el-popover placement="bottom-end" :width="360" trigger="click">
            <template #reference>
              <el-badge :value="unread" :hidden="!unread" :max="99">
                <el-button circle><el-icon><Bell/></el-icon></el-button>
              </el-badge>
            </template>
            <div style="max-height:360px;overflow:auto">
              <div v-for="n in notifications" :key="n.id" style="padding:8px 4px;border-bottom:1px solid #f0f0f0">
                <div style="display:flex;justify-content:space-between">
                  <b :style="{color:n.read?'#999':'#111'}">{{ n.title }}</b>
                  <el-tag v-if="!n.read" size="small" type="danger" effect="plain">新</el-tag>
                </div>
                <div class="muted" style="margin:3px 0">{{ n.content }}</div>
                <el-button v-if="!n.read" link type="primary" size="small" @click="read(n)">标为已读</el-button>
              </div>
              <el-empty v-if="!notifications.length" description="暂无通知" :image-size="60"/>
            </div>
          </el-popover>
          <el-tag type="primary" effect="dark">{{ roleName }}</el-tag>
          <span style="font-weight:600">{{ realName }}</span>
          <span v-if="companyName" class="muted">({{ companyName }})</span>
          <el-button link type="danger" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api, { ROLE_NAMES } from '../api';

const router = useRouter();
const route = useRoute();
const role = localStorage.getItem('role') || '';
const realName = localStorage.getItem('realName') || '';
const companyName = localStorage.getItem('companyName') || '';
const roleName = ROLE_NAMES[role] || role;

const notifications = ref<any[]>([]);
const unread = computed(() => notifications.value.filter(n => !n.read).length);
const openEvents = ref(0);
const pendingAppeals = ref(0);
const pendingCerts = ref(0);

async function load() {
  try {
    const { data } = await api.get('/notifications');
    notifications.value = data;
    const dash = await api.get('/dashboard');
    openEvents.value = dash.data.openEvents;
    pendingAppeals.value = dash.data.pendingAppeals;
    if (['hr', 'dispatcher', 'operator', 'admin'].includes(role)) {
      const certs = (await api.get('/late-certificates')).data;
      pendingCerts.value = certs.filter((c: any) => (c.pendingCount || 0) > 0).length;
    }
  } catch { /* ignore */ }
}
function go(path: string) { router.push(path); }
async function read(n: any) { await api.post(`/notifications/${n.id}/read`); n.read = true; }
function logout() {
  localStorage.clear();
  router.push('/login');
}
onMounted(load);
setInterval(load, 20000);
</script>
<style scoped>
.badge-dot { margin-left: 6px; }
:deep(.el-badge__content) { transform: translateY(-2px) translateX(4px); }
</style>
