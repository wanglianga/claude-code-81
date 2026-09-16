<template>
  <div>
    <h2 class="page-title">站点施工 · 临时改站</h2>

    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="proposed">待确认</el-radio-button>
          <el-radio-button label="completed">已完成</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">发起临时改站</el-button>
      </div>
    </el-card>

    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="date" label="日期" width="105"/>
        <el-table-column label="原站点 → 临停点" min-width="230">
          <template #default="{row}">
            <el-tag type="danger" size="small">{{ row.originalStationName }}</el-tag>
            → <el-tag type="success" size="small">{{ row.temporaryStationName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="施工原因" min-width="150" show-overflow-tooltip/>
        <el-table-column label="步行/安全上车点" min-width="200">
          <template #default="{row}">
            <div>约 {{ row.walkMeters }} 米</div>
            <div class="muted">{{ row.safePickupPoint }}</div>
          </template>
        </el-table-column>
        <el-table-column label="确认进度" width="150">
          <template #default="{row}">
            <el-tag size="small" type="success">已确认{{ row.acceptedCount }}</el-tag>
            <el-tag size="small" type="warning" style="margin-left:4px">待{{ row.pendingCount }}</el-tag>
            <el-tag v-if="row.declinedCount" size="small" type="danger" style="margin-left:4px">拒{{ row.declinedCount }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <el-tag size="small" :type="row.status==='completed'?'success':'warning'">
              {{ row.status==='completed'?'已完成':'通知待确认' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{row}">
            <el-button link type="primary" size="small" @click="openDetail(row)">点名表</el-button>
            <el-button v-if="row.status!=='completed'" link type="success" size="small" @click="finish(row)">完成</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 发起改站 -->
    <el-dialog v-model="createDlg" title="站点施工 · 推荐临时站点并通知" width="720px">
      <el-form label-width="100px">
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD"/>
        </el-form-item>
        <el-form-item label="线路">
          <el-select v-model="form.lineId" style="width:100%" @change="form.originalStationId=null;form.scheduleId=null">
            <el-option v-for="l in lines" :key="l.id" :label="l.name" :value="l.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="影响班次">
          <el-select v-model="form.scheduleId" clearable placeholder="空=当天该线全部班次" style="width:100%">
            <el-option v-for="s in lineSchedules" :key="s.id" :label="`${s.name} ${s.departureTime}`" :value="s.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="无法停靠站">
          <el-select v-model="form.originalStationId" style="width:100%" @change="loadRecommend">
            <el-option v-for="s in lineStations" :key="s.id"
              :label="`${s.name}（${s.status==='construction'?'施工中':s.status}）`" :value="s.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="推荐临停点">
          <el-table v-if="recs.length" :data="recs" size="small" border highlight-current-row
                    @current-change="(r:any)=>r&&(form.temporaryStationId=r.temporaryStationId)">
            <el-table-column label="选择" width="55">
              <template #default="{row}">
                <el-radio v-model="form.temporaryStationId" :value="row.temporaryStationId">&nbsp;</el-radio>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="临时站点" width="110"/>
            <el-table-column label="步行距离" width="90">
              <template #default="{row}">约 {{ row.walkMeters }} 米</template>
            </el-table-column>
            <el-table-column prop="safePickupPoint" label="安全上车点" min-width="180" show-overflow-tooltip/>
            <el-table-column prop="walkRoute" label="步行路线" min-width="220" show-overflow-tooltip/>
          </el-table>
          <el-empty v-else description="选择无法停靠站点后自动推荐" :image-size="50"/>
        </el-form-item>
        <el-form-item label="施工原因">
          <el-input v-model="form.reason" placeholder="如：市政道路施工，站点港湾封闭至当日12时"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg=false">取消</el-button>
        <el-button type="primary" @click="submitCreate">通知受影响员工与司机</el-button>
      </template>
    </el-dialog>

    <!-- 点名表 -->
    <el-dialog v-model="detailDlg" title="临时改站 · 员工确认与司机点名" width="780px">
      <div v-if="detail.id">
        <el-alert type="warning" :closable="false" style="margin-bottom:10px">
          <template #title>
            {{ detail.originalStation?.name }} → {{ detail.temporaryStation?.name }}；
            安全上车点：{{ detail.safePickupPoint }}；步行约 {{ detail.walkMeters }} 米
          </template>
        </el-alert>
        <el-table :data="detail.confirmations" size="small" border>
          <el-table-column label="员工" min-width="130">
            <template #default="{row}">{{ row.employee?.realName }} <span class="muted">{{ row.employee?.employeeNo }}</span></template>
          </el-table-column>
          <el-table-column label="员工确认" width="110">
            <template #default="{row}">
              <el-tag size="small" :type="row.status==='accepted'?'success':row.status==='declined'?'danger':'warning'">
                {{ row.status==='accepted'?'已确认前往':row.status==='declined'?'无法前往':'待确认' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="名单上车站点" width="110">
            <template #default="{row}">{{ row.reservation?.stationId === detail.temporaryStationId ? detail.temporaryStation.name : '原站/未更新' }}</template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="120" show-overflow-tooltip/>
          <el-table-column label="司机点名" min-width="180">
            <template #default="{row}">
              <el-tag v-if="row.rollCall" size="small" :type="row.rollCall.result==='on_board'?'success':'danger'">
                {{ rollName(row.rollCall.result) }}
              </el-tag>
              <span v-else class="muted">尚未点名</span>
              <div class="muted" v-if="row.rollCall?.reason">{{ row.rollCall.reason }}</div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const filter = ref('proposed');
const rows = ref<any[]>([]);
const lines = ref<any[]>([]);
const createDlg = ref(false);
const detailDlg = ref(false);
const detail = ref<any>({});
const form = ref<any>({ date: new Date().toISOString().slice(0, 10), lineId: null, scheduleId: null, originalStationId: null, temporaryStationId: null, reason: '' });
const recs = ref<any[]>([]);

const lineStations = computed(() => lines.value.find((l: any) => l.id === form.value.lineId)?.stationList || []);
const lineSchedules = ref<any[]>([]);

function rollName(r: string) {
  return ({ on_board: '临停点已上车', no_show: '未到', refused_change: '拒改站未乘', absent: '缺席', resolved: '已处理' } as any)[r] || r;
}

async function load() {
  const { data } = await api.get('/relocations', { params: filter.value ? { status: filter.value } : {} });
  // status filter done server-side loosely; filter client too
  rows.value = filter.value ? data.filter((r: any) => r.status === filter.value) : data;
  const { data: ls } = await api.get('/lines');
  lines.value = ls;
  const { data: ss } = await api.get('/schedules');
  lineSchedules.value = ss;
}
async function openCreate() {
  form.value = { date: new Date().toISOString().slice(0, 10), lineId: lines.value[0]?.id, scheduleId: null, originalStationId: null, temporaryStationId: null, reason: '道路施工，原站点无法停靠' };
  recs.value = [];
  createDlg.value = true;
}
async function loadRecommend() {
  recs.value = [];
  if (!form.value.lineId || !form.value.originalStationId) return;
  const { data } = await api.get('/relocations/recommend', {
    params: { lineId: form.value.lineId, stationId: form.value.originalStationId },
  });
  recs.value = data;
}
async function submitCreate() {
  if (!form.value.temporaryStationId) return ElMessage.warning('请选择推荐临时站点');
  await api.post('/relocations', form.value);
  ElMessage.success('已通知受影响员工与司机，等待员工确认');
  createDlg.value = false;
  load();
}
async function openDetail(row: any) {
  const { data } = await api.get(`/relocations/${row.id}`);
  detail.value = data;
  detailDlg.value = true;
}
async function finish(row: any) {
  await api.post(`/relocations/${row.id}/complete`);
  ElMessage.success('改站单已完成');
  load();
}
onMounted(load);
</script>
