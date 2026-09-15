<template>
  <div>
    <h2 class="page-title">司机控制台</h2>
    <el-row :gutter="14">
      <el-col :span="9">
        <el-card class="card-soft" header="我的车次任务">
          <el-table :data="trips" size="small" highlight-current-row @current-change="(v:any)=>v&&open(v)">
            <el-table-column label="日期" prop="date" width="100"/>
            <el-table-column label="班次" min-width="120">
              <template #default="{row}">{{ row.schedule?.name }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="15" v-if="trip">
        <el-card class="card-soft">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>{{ trip.date }} {{ trip.schedule?.name }} · {{ trip.vehicle?.plate || '车辆未分配' }} · 签到码 {{ trip.qrToken }}</b>
              <el-tag :type="st(trip.status).type" effect="dark">{{ st(trip.status).label }}</el-tag>
            </div>
          </template>

          <div class="trip-flow" style="margin-bottom:12px">
            <span class="flow-step" :class="{active:['confirmed','boarding','departed','arrived'].includes(trip.status)}">①发车前确认</span>
            <span>→</span>
            <span class="flow-step" :class="{active:['boarding','departed','arrived'].includes(trip.status)}">②乘客签到</span>
            <span>→</span>
            <span class="flow-step" :class="{active:['departed','arrived'].includes(trip.status)}">③发车（未到登记）</span>
            <span>→</span>
            <span class="flow-step" :class="{active:trip.status==='arrived'}">④到厂归档</span>
            <span v-if="trip.status==='suspended'" class="flow-step danger">已停运</span>
          </div>

          <!-- ① 发车前确认 -->
          <div v-if="trip.status==='planned'" style="line-height:2">
            <el-checkbox v-model="vehicleCheck">已完成车辆检查（轮胎/灯光/制动/消防/消杀）</el-checkbox><br/>
            <el-checkbox v-model="routeOk">已确认行驶路线，未收到施工/停运通知</el-checkbox>
            <div class="muted">当前名单 {{ manifest.length }} 人 · 空座 {{ trip.emptySeats }} ·
              行李 {{ manifest.filter((r:any)=>r.withLuggage).length }} 人 ·
              临时加班 {{ manifest.filter((r:any)=>r.tempOvertime).length }} 人</div>
            <el-button type="primary" :disabled="!vehicleCheck||!routeOk" @click="confirm">确认车辆/路线，开放签到</el-button>
          </div>

          <!-- ② 签到 -->
          <div v-if="['confirmed','boarding','departed'].includes(trip.status)" style="margin-bottom:10px">
            <el-input v-model="scanCode" placeholder="扫码 token / 刷工牌（工号，如 HX1001）" clearable
                      style="width:340px" @keyup.enter="scan">
              <template #prepend>扫码/工牌</template>
            </el-input>
            <el-button type="primary" @click="scan">签到上车</el-button>
            <el-button @click="proxyDlg=true">代刷登记</el-button>
            <el-button type="warning" plain @click="depart"
                       v-if="trip.status==='confirmed'||trip.status==='boarding'">发车</el-button>
          </div>

          <el-table :data="manifest" size="small" max-height="360">
            <el-table-column prop="seatNo" label="座号" width="55"/>
            <el-table-column label="乘客" min-width="130">
              <template #default="{row}">{{ row.employee?.realName }}（{{ row.employee?.employeeNo }}）</template>
            </el-table-column>
            <el-table-column label="上车站点" min-width="110">
              <template #default="{row}">
                {{ row.station?.name }}
                <el-tag v-if="row.boardedStationId && row.boardedStationId!==row.stationId" type="warning" size="small">改站</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标签" width="120">
              <template #default="{row}">
                <el-tag v-if="row.withLuggage" size="small" type="info">行李</el-tag>
                <el-tag v-if="row.tempOvertime" size="small" type="warning">加班</el-tag>
                <el-tag v-if="row.proxyBoarded" size="small" type="danger">代刷</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{row}">
                <el-button v-if="['on_manifest'].includes(row.status)&&['confirmed','boarding'].includes(trip.status)"
                           link type="primary" size="small" @click="board(row)">上车</el-button>
                <el-button v-if="['on_manifest'].includes(row.status)&&['confirmed','boarding'].includes(trip.status)"
                           link type="warning" size="small" @click="changeStation(row)">改站</el-button>
                <el-button v-if="['on_manifest'].includes(row.status)&&trip.status==='boarding'"
                           link type="danger" size="small" @click="noShow(row)">未到</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
            <el-statistic title="已上车" :value="boarded"/>
            <el-statistic title="未到" :value="manifest.filter((r:any)=>r.status==='no_show').length"/>
            <el-statistic title="临时空座" :value="trip.emptySeats"/>
            <el-button v-if="trip.status==='departed'" type="success" size="large" @click="arrive">到厂确认（归档考勤/绩效）</el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="15" v-else>
        <el-empty description="请从左侧选择一个车次"/>
      </el-col>
    </el-row>

    <!-- 代刷登记 -->
    <el-dialog v-model="proxyDlg" title="代刷登记（留痕核查）" width="460px">
      <el-form label-width="80px">
        <el-form-item label="乘客">
          <el-select v-model="proxy.reservationId" placeholder="选择名单乘客" style="width:100%">
            <el-option v-for="r in manifest.filter((x:any)=>['on_manifest','boarded'].includes(x.status))"
                       :key="r.id" :label="`${r.seatNo}号 ${r.employee?.realName}`" :value="r.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="proxy.proxyNote" type="textarea" :rows="2" placeholder="如：本人工牌故障，由同座代刷，司机现场核验身份"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="proxyDlg=false">取消</el-button>
        <el-button type="warning" @click="submitProxy">登记并签到</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st } from '../api';

const trips = ref<any[]>([]);
const trip = ref<any>(null);
const manifest = ref<any[]>([]);
const vehicleCheck = ref(false);
const routeOk = ref(false);
const scanCode = ref('');
const proxyDlg = ref(false);
const proxy = ref({ reservationId: null as any, proxyNote: '' });
const stations = ref<any[]>([]);

const boarded = computed(() => manifest.value.filter(r => ['boarded', 'late', 'changed'].includes(r.status)).length);

async function loadTrips() {
  const { data } = await api.get('/driver/trips');
  trips.value = data;
}
async function open(t: any) {
  trip.value = t;
  const { data } = await api.get(`/driver/trips/${t.id}/manifest`);
  trip.value = data.trip;
  manifest.value = data.reservations;
  const { data: scheds } = await api.get('/schedules');
  const sLine = scheds.find((s: any) => s.id === trip.value.scheduleId)?.lineId;
  const { data: lines } = await api.get('/lines');
  const line = lines.find((l: any) => l.id === sLine);
  stations.value = line?.stationList || [];
}
async function confirm() {
  await api.post(`/driver/trips/${trip.value.id}/confirm`, { vehicleCheck: 'ok', routeOk: true });
  ElMessage.success('车辆与路线已确认，可开始乘客签到');
  await open({ id: trip.value.id });
  loadTrips();
}
async function board(row: any, extra: any = {}) {
  await api.post(`/driver/trips/${trip.value.id}/board`, { reservationId: row.id, ...extra });
  ElMessage.success(`${row.employee?.realName} 签到成功`);
  await open({ id: trip.value.id });
}
async function scan() {
  const code = scanCode.value.trim();
  if (!code) return;
  // 名单内 qrToken 暂以工牌为主，兼容直接输入工号
  try {
    await api.post(`/driver/trips/${trip.value.id}/board`, { employeeNo: code });
    ElMessage.success('签到成功');
  } finally {
    scanCode.value = '';
    await open({ id: trip.value.id });
  }
}
async function changeStation(row: any) {
  const { value } = await ElMessageBox.prompt('选择实际上车站点', '临时改站登记', {
    inputType: 'text',
    inputValue: row.station?.name,
  }).catch(() => ({ value: null }));
  if (!value) return;
  const stn = stations.value.find((s: any) => s.name.includes(value) || value.includes(s.name));
  if (!stn) return ElMessage.warning('未找到该站点（需在本线路上）');
  await board(row, { stationId: stn.id });
}
async function noShow(row: any) {
  await ElMessageBox.confirm(`确认 ${row.employee?.realName} 未到？发车后将计未到并产生补车费。`, '未到登记', { type: 'warning' });
  await api.post(`/driver/trips/${trip.value.id}/no-show/${row.id}`);
  ElMessage.success('已登记未到');
  await open({ id: trip.value.id });
}
async function depart() {
  const remain = manifest.value.filter((r: any) => r.status === 'on_manifest').length;
  await ElMessageBox.confirm(remain ? `还有 ${remain} 人未签到，发车后将统一标记为未到，确认发车？` : '确认发车？',
    '发车', { type: 'warning' });
  await api.post(`/driver/trips/${trip.value.id}/depart`);
  ElMessage.success('已发车');
  await open({ id: trip.value.id });
  loadTrips();
}
async function arrive() {
  await ElMessageBox.confirm('确认到厂？系统将按企业考勤规则生成考勤档案、迟到原因与司机绩效。', '到厂确认', { type: 'success' });
  const { data } = await api.post(`/driver/trips/${trip.value.id}/arrive`);
  ElMessage.success(`到厂归档完成，晚点 ${data.delayMinutes} 分钟`);
  await open({ id: trip.value.id });
  loadTrips();
}
async function submitProxy() {
  if (!proxy.value.reservationId) return ElMessage.warning('请选择乘客');
  const row = manifest.value.find(r => r.id === proxy.value.reservationId);
  await board(row, { proxy: true, proxyNote: proxy.value.proxyNote });
  proxyDlg.value = false;
}
onMounted(loadTrips);
</script>
