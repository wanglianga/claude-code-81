<template>
  <div>
    <h2 class="page-title">班车预约</h2>
    <!-- 企业搬迁过渡选择 -->
    <el-card v-if="rlChoices.length" class="card-soft" style="margin-bottom:14px;border:1px solid #409eff">
      <template #header><b style="color:#1f6feb">🏭 您所在企业正在搬迁线路，请选择过渡期乘车方式</b></template>
      <el-table :data="rlChoices" size="small">
        <el-table-column label="重排单" min-width="200">
          <template #default="{row}">{{ row.relocation.rlNo }} · {{ row.relocation.title }}<div class="muted">新线生效 {{ row.relocation.effectDate }}，过渡至 {{ row.relocation.transitionEnd }}</div></template>
        </el-table-column>
        <el-table-column label="当前选择" width="160">
          <template #default="{row}">
            <el-tag size="small" :type="row.choice==='refund'?'danger':row.choice==='keep_old'?'warning':'success'">{{ rlChoiceName(row.choice) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260">
          <template #default="{row}">
            <el-button size="small" @click="rlChoose(row,'keep_old')">继续旧站点</el-button>
            <el-button size="small" type="primary" @click="rlChoose(row,'refund')">退订</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 临时改站确认 -->
    <el-card v-if="relos.length" class="card-soft" style="margin-bottom:14px;border:1px solid #f56c6c">
      <template #header><b style="color:#f56c6c">⚠️ 您有 {{ relos.length }} 条站点施工临时改站待确认</b></template>
      <el-table :data="relos" size="small">
        <el-table-column label="日期" prop="date" width="105"/>
        <el-table-column label="原站点 → 临停点" min-width="200">
          <template #default="{row}">
            <el-tag type="danger" size="small">{{ row.relocation.originalStationName }}</el-tag>
            → <el-tag type="success" size="small">{{ row.relocation.temporaryStationName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="安全上车点 / 步行" min-width="220">
          <template #default="{row}">
            <div>{{ row.relocation.safePickupPoint }}</div>
            <div class="muted">步行约 {{ row.relocation.walkMeters }} 米：{{ row.relocation.walkRoute }}</div>
          </template>
        </el-table-column>
        <el-table-column label="确认" width="200">
          <template #default="{row}">
            <template v-if="row.status==='pending'">
              <el-button type="success" size="small" @click="confirmRelo(row,true)">已知晓，前往临停点</el-button>
              <el-button type="danger" size="small" plain @click="declineRelo(row)">无法前往</el-button>
            </template>
            <el-tag v-else size="small" :type="row.status==='accepted'?'success':'danger'">
              {{ row.status==='accepted'?'已确认前往':'已反馈无法前往' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;gap:12px;align-items:center">
        <span>乘车日期：</span>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :disabled-date="disabledFuture" @change="load"/>
        <el-tag type="warning" v-if="holidayNote">{{ holidayNote }}</el-tag>
        <el-button type="primary" @click="load">刷新</el-button>
        <span class="muted">按企业、班次、站点提交；携带行李/临时加班将同步调度与司机</span>
      </div>
    </el-card>

    <el-row :gutter="14">
      <el-col :span="16">
        <el-card v-for="s in list" :key="s.id" class="card-soft" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <el-tag :type="s.direction==='to_park'?'primary':'success'" size="small">
                {{ s.direction==='to_park' ? '上班·到厂' : '下班·离园' }}
              </el-tag>
              <b style="margin-left:8px">{{ s.line?.name }} · {{ s.name }}</b>
              <el-tag size="small" effect="plain" style="margin-left:8px">{{ s.shiftLabel }}</el-tag>
            </div>
            <div>
              <el-tag type="info">发车 {{ s.departureTime }}</el-tag>
              <el-tag :type="s.bookedCount>=45?'danger':'success'" effect="plain" style="margin-left:6px">
                已约 {{ s.bookedCount }} 人
              </el-tag>
            </div>
          </div>
          <div style="margin-top:8px">
            <el-button size="small" type="primary" plain
                       v-for="stn in availableStations(s)" :key="stn.id"
                       :disabled="stn.status==='closed'"
                       @click="openBook(s, stn)" style="margin-right:6px;margin-bottom:4px">
              {{ stn.name }}
              <el-tag v-if="stn.status==='construction'" type="warning" size="small">施工</el-tag>
              <el-tag v-if="stn.status==='closed'" type="danger" size="small">关闭</el-tag>
              <el-tag size="small" type="info" effect="plain">容量{{ stn.capacity }}</el-tag>
            </el-button>
          </div>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card class="card-soft" header="我的近期预约">
          <el-timeline>
            <el-timeline-item v-for="r in mine" :key="r.id"
              :type="st(r.status).type==='danger'?'danger':(st(r.status).type==='success'?'success':'primary')"
              :timestamp="`${r.date} 座位${r.seatNo||'-'}`">
              <b>{{ r.schedule?.name || ('班次#'+r.scheduleId) }}</b>
              <div class="muted">{{ r.station?.name }} ·
                <el-tag size="small" :type="st(r.status).type">{{ st(r.status).label }}</el-tag>
                <el-tag v-if="r.tempOvertime" size="small" type="warning">加班</el-tag>
                <el-tag v-if="r.withLuggage" size="small" type="info">行李</el-tag>
              </div>
              <el-button v-if="['booked'].includes(r.status) && r.date>=todayStr" link type="danger" size="small" @click="cancel(r)">取消</el-button>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dlg" title="提交预约" width="480px">
      <el-form label-width="92px">
        <el-form-item label="班次"><el-input :model-value="`${cur?.line?.name} · ${cur?.name}（${cur?.departureTime}）`" disabled/></el-form-item>
        <el-form-item label="上车站点"><el-input :model-value="curStation?.name" disabled/></el-form-item>
        <el-form-item label="携带行李"><el-switch v-model="form.withLuggage"/></el-form-item>
        <el-form-item label="临时加班"><el-switch v-model="form.tempOvertime"/></el-form-item>
        <el-form-item v-if="form.tempOvertime" label="加班说明">
          <el-input v-model="form.overtimeNote" type="textarea" :rows="2" placeholder="如：产线急单，需乘夜班接驳"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="submit">确认预约</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st, today } from '../api';

const date = ref(today());
const todayStr = today();
const list = ref<any[]>([]);
const mine = ref<any[]>([]);
const dlg = ref(false);
const cur = ref<any>(null);
const curStation = ref<any>(null);
const form = ref({ withLuggage: false, tempOvertime: false, overtimeNote: '' });
const holidayNote = ref('');
const relos = ref<any[]>([]);
const rlChoices = ref<any[]>([]);

function rlChoiceName(c: string) {
  return ({ keep_old: '过渡期继续旧站点', change_station: '改站', change_schedule: '改班次', refund: '退订' } as any)[c] || c;
}
async function loadRlChoices() {
  const { data } = await api.get('/my/line-relocation-choices');
  rlChoices.value = data;
}
async function rlChoose(row: any, choice: string) {
  await api.post(`/line-relocations/${row.relocationId}/choose`, { reservationId: row.reservationId, choice });
  ElMessage.success(choice === 'refund' ? '已退订' : '已记录，过渡期按旧站点乘车并提醒');
  loadRlChoices(); load();
}

async function loadRelos() {
  const { data } = await api.get('/my/relocations');
  relos.value = data;
}
async function confirmRelo(row: any, accept: boolean, note?: string) {
  await api.post(`/relocations/${row.relocationId}/confirm`, { accept, note });
  ElMessage.success(accept ? '已确认，乘车名单与司机导航已更新' : '已反馈');
  loadRelos(); load();
}
async function declineRelo(row: any) {
  const { value } = await ElMessageBox.prompt('无法前往临停点的原因（将进入司机点名与分流）', '反馈', { type: 'warning' }).catch(() => ({ value: null }));
  if (value === undefined) return;
  confirmRelo(row, false, value || '无法前往');
}

function availableStations(s: any) { return s.stations || []; }
function disabledFuture(d: Date) { return d.getTime() < Date.now() - 86400000; }

async function load() {
  const [{ data }, { data: my }, { data: holidays }] = await Promise.all([
    api.get('/booking-view', { params: { date: date.value } }),
    api.get('/my/reservations'),
    api.get('/holidays'),
  ]);
  list.value = data;
  mine.value = my;
  loadRelos();
  loadRlChoices();
  const h = holidays.find((x: any) => x.date === date.value);
  holidayNote.value = h ? `${h.name}（${h.type === 'suspended' ? '停运' : h.type === 'holiday' ? '节假日' : '调休上班'}）` : '';
}
function openBook(s: any, station: any) {
  cur.value = s; curStation.value = station;
  form.value = { withLuggage: false, tempOvertime: false, overtimeNote: '' };
  dlg.value = true;
}
async function submit() {
  await api.post('/reservations', {
    date: date.value, scheduleId: cur.value.id, stationId: curStation.value.id, ...form.value,
  });
  ElMessage.success('预约成功，等待调度生成乘车名单');
  dlg.value = false;
  load();
}
async function cancel(r: any) {
  await ElMessageBox.confirm('确认取消该预约？', '提示', { type: 'warning' });
  await api.post(`/reservations/${r.id}/cancel`);
  ElMessage.success('已取消');
  load();
}
onMounted(load);
</script>
