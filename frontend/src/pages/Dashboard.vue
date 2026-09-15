<template>
  <div>
    <h2 class="page-title">通勤运行总览 · {{ today }}</h2>
    <el-row :gutter="14">
      <el-col :span="6" v-for="c in cards" :key="c.label">
        <el-card class="card-soft" style="margin-bottom:14px">
          <div class="stat-num" :style="{color:c.color}">{{ c.value }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :span="14">
        <el-card class="card-soft">
          <template #header><b>今日车次实时状态</b></template>
          <el-table :data="trips" size="small" empty-text="今日尚未生成车次（调度派车后展示）">
            <el-table-column label="班次" min-width="150">
              <template #default="{row}">{{ row.schedule?.name }}（{{ row.schedule?.shiftLabel }}）</template>
            </el-table-column>
            <el-table-column label="车辆/司机" min-width="150">
              <template #default="{row}">{{ row.vehicle?.plate || '未派车' }} / {{ row.driver?.realName || '未派司机' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="boardedCount" label="已签" width="70"/>
            <el-table-column prop="noShowCount" label="未到" width="70"/>
            <el-table-column prop="emptySeats" label="空座" width="70"/>
            <el-table-column label="晚点" width="80">
              <template #default="{row}">
                <span :style="{color:row.delayMinutes>0?'#e6a23c':''}">{{ row.delayMinutes }} 分</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card class="card-soft" style="margin-top:14px">
          <template #header><b>今日考勤分布（到厂档案）</b></template>
          <div ref="chartRef" style="height:280px"></div>
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card class="card-soft">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>未闭环途中事件</b>
              <el-button link type="primary" @click="$router.push('/events')">前往处理 →</el-button>
            </div>
          </template>
          <el-table :data="openEv" size="small" max-height="260">
            <el-table-column label="类型" width="100">
              <template #default="{row}">
                <el-tag size="small" :type="row.severity==='critical'?'danger':'warning'">{{ EVENT_TYPES[row.type]||row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip/>
            <el-table-column prop="affectedCount" label="影响" width="60"/>
          </el-table>
          <el-empty v-if="!openEv.length" description="暂无未处理事件，线路运行平稳" :image-size="60"/>
        </el-card>

        <el-card class="card-soft" style="margin-top:14px">
          <template #header><b>今日运行要点</b></template>
          <ul style="margin:0;padding-left:18px;line-height:2;color:#374151;font-size:13px">
            <li>共 {{ d.companies }} 家企业、{{ d.lines }} 条线路共线运行，车辆 {{ d.vehicles.available }}/{{ d.vehicles.total }} 可用</li>
            <li>今日预约 {{ d.reservationsToday }} 人，已签到 {{ d.boardedToday }} 人，未到 {{ d.noShowToday }} 人</li>
            <li>考勤：迟到 <b style="color:#e6a23c">{{ d.attendanceToday.late }}</b> 人，
              豁免 <b style="color:#67c23a">{{ d.attendanceToday.exempt }}</b> 人，
              未到 <b style="color:#f56c6c">{{ d.attendanceToday.noShow }}</b> 人，
              补车费合计 <b>¥{{ d.attendanceToday.feeTotal }}</b></li>
            <li>待处理申诉 {{ d.pendingAppeals }} 件、在园访客 {{ d.activeVisitors }} 人</li>
          </ul>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import * as echarts from 'echarts';
import api, { st, EVENT_TYPES, today } from '../api';

const d = ref<any>({ companies: 0, lines: 0, vehicles: { total: 0, available: 0 }, attendanceToday: {} });
const trips = ref<any[]>([]);
const openEv = ref<any[]>([]);
const chartRef = ref<HTMLElement>();

const cards = ref<any[]>([]);

onMounted(async () => {
  const [{ data: dash }, { data: tripList }, { data: evs }] = await Promise.all([
    api.get('/dashboard'),
    api.get(`/trips?date=${today()}`),
    api.get('/events?status=open'),
  ]);
  d.value = dash;
  trips.value = tripList;
  openEv.value = evs;
  cards.value = [
    { label: '今日预约人数', value: dash.reservationsToday, color: '#1f6feb' },
    { label: '已签到 / 未到', value: `${dash.boardedToday} / ${dash.noShowToday}`, color: '#67c23a' },
    { label: '未闭环事件', value: dash.openEvents, color: dash.openEvents ? '#f56c6c' : '#67c23a' },
    { label: '待审申诉', value: dash.pendingAppeals, color: dash.pendingAppeals ? '#e6a23c' : '#67c23a' },
  ];
  await nextTick();
  const chart = echarts.init(chartRef.value!);
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['45%', '70%'],
      data: [
        { name: '正常', value: Math.max(0, dash.attendanceToday.total - dash.attendanceToday.late - dash.attendanceToday.exempt - dash.attendanceToday.noShow), itemStyle: { color: '#67c23a' } },
        { name: '迟到', value: dash.attendanceToday.late, itemStyle: { color: '#e6a23c' } },
        { name: '豁免', value: dash.attendanceToday.exempt, itemStyle: { color: '#409eff' } },
        { name: '未到', value: dash.attendanceToday.noShow, itemStyle: { color: '#f56c6c' } },
      ],
      label: { formatter: '{b}: {c}' },
    }],
  });
  window.addEventListener('resize', () => chart.resize());
});
</script>
