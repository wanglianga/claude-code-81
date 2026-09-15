<template>
  <div class="login-bg">
    <div class="login-card">
      <div class="login-logo">🚌 工业园区通勤班车协同平台</div>
      <div class="login-sub">预约 · 名单 · 扫码签到 · 晚点五方协同 · 考勤申诉 · 线路共治</div>
      <el-form @submit.prevent="login">
        <el-form-item>
          <el-input v-model="form.username" size="large" placeholder="用户名" :prefix-icon="User"/>
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" size="large" type="password" placeholder="密码（统一 Pass1234）"
                    :prefix-icon="Lock" show-password @keyup.enter="login"/>
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="login">登 录</el-button>
      </el-form>

      <el-divider style="margin:18px 0 12px">演示账号（点击填充，密码 Pass1234）</el-divider>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <span v-for="a in accounts" :key="a.u" class="quick-account" @click="quick(a.u)">
          {{ a.label }}<br/><b>{{ a.u }}</b>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import api from '../api';

const router = useRouter();
const form = reactive({ username: 'emp_li', password: 'Pass1234' });
const loading = ref(false);

const accounts = [
  { u: 'emp_li', label: '员工·华星' },
  { u: 'emp_night', label: '夜班员工' },
  { u: 'driver01', label: '司机·马建国' },
  { u: 'dispatcher', label: '调度员' },
  { u: 'hr_huaxing', label: '华星HR' },
  { u: 'operator', label: '园区运营' },
  { u: 'admin', label: '管理员' },
];
function quick(u: string) { form.username = u; form.password = 'Pass1234'; }

async function login() {
  loading.value = true;
  try {
    const { data } = await api.post('/auth/login', form);
    localStorage.setItem('token', data.token);
    localStorage.setItem('role', data.user.role);
    localStorage.setItem('realName', data.user.realName);
    localStorage.setItem('companyName', data.user.companyName || '');
    localStorage.setItem('companyId', data.user.companyId || '');
    localStorage.setItem('username', data.user.username);
    ElMessage.success(`欢迎，${data.user.realName}`);
    router.push('/dashboard');
  } finally { loading.value = false; }
}
</script>
