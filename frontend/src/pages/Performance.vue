<template>
  <div>
    <h2 class="page-title">司机安全与绩效档案</h2>
    <el-row :gutter="14" style="margin-bottom:14px">
      <el-col :span="8" v-for="s in summary" :key="s.name">
        <el-card class="card-soft">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <b>{{ s.name }}</b>
              <div class="muted">安全培训有效期至 {{ s.expiry }}</div>
            </div>
            <el-progress type="dashboard" :width="70" :percentage="s.score"
                         :color="s.score>=80?'#67c23a':s.score>=60?'#e6a23c':'#f56c6c'"/>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="date" label="日期" width="105"/>
        <el-table-column label="司机" width="110">
          <template #default="{row}">{{ row.driver?.realName }}</template>
        </el-table-column>
        <el-table-column label="车次" width="90">
          <template #default="{row}">#{{ row.tripId }}</template>
        </el-table-column>
        <el-table-column label="安全分" width="100">
          <template #default="{row}">
            <el-tag size="small" :type="row.safetyScore>=80?'success':row.safetyScore>=60?'warning':'danger'">{{ row.safetyScore }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="奖励" width="90">
          <template #default="{row}"><span style="color:#67c23a">+¥{{ row.bonus }}</span></template>
        </el-table-column>
        <el-table-column label="扣罚" width="90">
          <template #default="{row}"><span style="color:#f56c6c">-¥{{ row.penalty }}</span></template>
        </el-table-column>
        <el-table-column prop="note" label="绩效说明" min-width="220"/>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import api from '../api';

const rows = ref<any[]>([]);
const drivers = ref<any[]>([]);

const summary = computed(() => {
  return drivers.value.map(d => {
    const mine = rows.value.filter(r => r.driverId === d.id);
    const score = mine.length ? Math.round(mine.reduce((s, r) => s + r.safetyScore, 0) / mine.length) : 100;
    return { name: d.realName, expiry: d.safetyTrainingExpiry, score };
  });
});

onMounted(async () => {
  const [{ data }, { data: ds }] = await Promise.all([api.get('/performances'), api.get('/drivers')]);
  rows.value = data;
  drivers.value = ds.filter((d: any) => d.username !== 'driver03').slice(0, 3);
});
</script>
