<template>
  <div>
    <h2 class="page-title">调度派车与乘车名单</h2>
    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" @change="load"/>
        <el-tag type="info">车辆座位 / 线路 / 司机资质 / 站点容量 / 企业考勤规则共同约束名单</el-tag>
        <el-button type="danger" plain @click="load">刷新</el-button>
      </div>
    </el-card>

    <el-row :gutter="14">
      <el-col :span="10">
        <el-card class="card-soft" header="待生成名单的班次">
          <el-table :data="pending" size="small">
            <el-table-column label="班次/线路" min-width="180">
              <template #default="{row}">
                <b>{{ row.name }}</b>
                <div class="muted">{{ row.line?.name }} · {{ row.departureTime }} · {{ row.shiftLabel }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="bookedCount" label="预约" width="60"/>
            <el-table-column label="操作" width="100">
              <template #default="{row}">
                <el-button type="primary" size="small" :disabled="!row.bookedCount" @click="openGen(row)">生成名单</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card class="card-soft" style="margin-top:14px" header="车辆 / 司机">
          <el-table :data="vehicles" size="small" max-height="220">
            <el-table-column prop="plate" label="车牌" width="120"/>
            <el-table-column prop="seats" label="座位" width="60"/>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
          </el-table>
          <el-divider style="margin:8px"/>
          <el-table :data="drivers" size="small" max-height="200">
            <el-table-column prop="realName" label="司机" width="90"/>
            <el-table-column prop="licenseNo" label="驾照" width="110"/>
            <el-table-column label="安全培训有效期" min-width="120">
              <template #default="{row}">
                <span :style="{color: row.safetyTrainingExpiry<=date?'#f56c6c':''}">{{ row.safetyTrainingExpiry }}</span>
                <el-tag v-if="row.safetyTrainingExpiry<=date" type="danger" size="small">过期</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card class="card-soft" header="车次与乘车名单">
          <el-table :data="trips" size="small" max-height="760" :row-key="(r:any)=>r.id"
                    :expand-row-keys="expanded" @expand-change="onExpand">
            <el-table-column type="expand">
              <template #default="{row}">
                <div style="padding:6px 20px">
                  <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center">
                    <el-button size="small" @click="openAssign(row)">调换车辆/司机</el-button>
                    <el-button size="small" type="danger" plain
                               v-if="!['arrived','cancelled','suspended'].includes(row.status)" @click="openSuspend(row)">停运（天气/安检）</el-button>
                    <el-tag v-if="row.manifest?.overflow?.length" type="danger" size="small">
                      超载未入名单 {{ row.manifest.overflow.length }} 人，需分流加班车
                    </el-tag>
                  </div>
                  <el-table :data="row.reservations" size="small" border>
                    <el-table-column prop="seatNo" label="座" width="50"/>
                    <el-table-column label="乘客" min-width="120">
                      <template #default="{row:r}">{{ r.employee?.realName }}（{{ r.employee?.employeeNo }}）</template>
                    </el-table-column>
                    <el-table-column label="企业" width="130">
                      <template #default="{row:r}">{{ r.employee?.company?.name }}</template>
                    </el-table-column>
                    <el-table-column label="站点" min-width="100">
                      <template #default="{row:r}">{{ r.station?.name }}</template>
                    </el-table-column>
                    <el-table-column label="标记" width="130">
                      <template #default="{row:r}">
                        <el-tag v-if="r.withLuggage" size="small" type="info">行李</el-tag>
                        <el-tag v-if="r.tempOvertime" size="small" type="warning">加班</el-tag>
                        <el-tag v-if="r.proxyBoarded" size="small" type="danger">代刷</el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="状态" width="90">
                      <template #default="{row:r}"><el-tag size="small" :type="st(r.status).type">{{ st(r.status).label }}</el-tag></template>
                    </el-table-column>
                  </el-table>
                  <div v-if="row.feeSplit?.length" style="margin-top:8px">
                    <b>多企业费用分摊：</b>
                    <el-tag v-for="f in row.feeSplit" :key="f.companyId" type="success" effect="plain" style="margin-right:6px">
                      {{ f.companyName }}：{{ f.passengers }}人 / ¥{{ f.fee }}
                    </el-tag>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="日期" prop="date" width="100"/>
            <el-table-column label="班次" min-width="120">
              <template #default="{row}">{{ row.schedule?.name }}</template>
            </el-table-column>
            <el-table-column label="车辆" width="110">
              <template #default="{row}">{{ row.vehicle?.plate || '—' }}</template>
            </el-table-column>
            <el-table-column label="司机" width="90">
              <template #default="{row}">{{ row.driver?.realName || '未派' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="乘/未到/空" width="100">
              <template #default="{row}">{{ row.boardedCount }}/{{ row.noShowCount }}/{{ row.emptySeats }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 生成名单 -->
    <el-dialog v-model="genDlg" title="生成乘车名单" width="480px">
      <el-form label-width="90px">
        <el-form-item label="班次">
          <el-input :model-value="cur ? `${cur.name}（预约 ${cur.bookedCount} 人）` : ''" disabled/>
        </el-form-item>
        <el-form-item label="指定车辆">
          <el-select v-model="genForm.vehicleId" placeholder="不选则自动匹配座位" clearable style="width:100%">
            <el-option v-for="v in vehicles.filter((x:any)=>['available','in_use'].includes(x.status))"
                       :key="v.id" :label="`${v.plate}（${v.seats}座，${st(v.status).label}）`" :value="v.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="指派司机">
          <el-select v-model="genForm.driverId" placeholder="选择司机（可后补）" clearable style="width:100%">
            <el-option v-for="dr in drivers" :key="dr.id"
                       :label="`${dr.realName} ${dr.safetyTrainingExpiry<=date?'(培训过期)':''}`" :value="dr.id"
                       :disabled="dr.safetyTrainingExpiry<=date"/>
          </el-select>
        </el-form-item>
        <div class="muted">系统按站点顺序排座，校验车辆座位与站点容量；超员列入 overflow 待分流；多企业按人数分摊车费。</div>
      </el-form>
      <template #footer>
        <el-button @click="genDlg=false">取消</el-button>
        <el-button type="primary" @click="generate">生成</el-button>
      </template>
    </el-dialog>

    <!-- 调换车辆/司机 -->
    <el-dialog v-model="assignDlg" title="调换车辆 / 司机" width="460px">
      <el-form label-width="90px">
        <el-form-item label="车次">
          <el-input :model-value="assignTrip ? `${assignTrip.date} ${assignTrip.schedule?.name}` : ''" disabled/>
        </el-form-item>
        <el-form-item label="车辆">
          <el-select v-model="assignForm.vehicleId" placeholder="保持原车辆" clearable style="width:100%">
            <el-option v-for="v in vehicles.filter((x:any)=>!['maintenance','breakdown'].includes(x.status))"
                       :key="v.id" :label="`${v.plate}（${v.seats}座）`" :value="v.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="司机">
          <el-select v-model="assignForm.driverId" placeholder="保持原司机" clearable style="width:100%">
            <el-option v-for="dr in drivers" :key="dr.id"
                       :label="`${dr.realName} ${dr.safetyTrainingExpiry<=date?'(培训过期)':''}`"
                       :value="dr.id" :disabled="dr.safetyTrainingExpiry<=date"/>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignDlg=false">取消</el-button>
        <el-button type="primary" @click="doAssign">保存</el-button>
      </template>
    </el-dialog>

    <!-- 停运 -->
    <el-dialog v-model="susDlg" title="停运登记" width="460px">
      <el-form label-width="90px">
        <el-form-item label="停运类型">
          <el-select v-model="susForm.type" style="width:100%">
            <el-option label="极端天气停运" value="weather"/>
            <el-option label="临时安检" value="security_check"/>
            <el-option label="车辆故障" value="breakdown"/>
            <el-option label="其他停运" value="suspension"/>
          </el-select>
        </el-form-item>
        <el-form-item label="原因说明">
          <el-input v-model="susForm.reason" type="textarea" :rows="3"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="susDlg=false">取消</el-button>
        <el-button type="danger" @click="suspend">确认停运并通知全员</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st, today } from '../api';

const date = ref(today());
const pending = ref<any[]>([]);
const trips = ref<any[]>([]);
const vehicles = ref<any[]>([]);
const drivers = ref<any[]>([]);
const expanded = ref<number[]>([]);
const genDlg = ref(false);
const susDlg = ref(false);
const cur = ref<any>(null);
const genForm = ref<any>({ vehicleId: null, driverId: null });
const susForm = ref<any>({ type: 'weather', reason: '' });
const susTrip = ref<any>(null);
const assignDlg = ref(false);
const assignTrip = ref<any>(null);
const assignForm = ref<any>({ vehicleId: null, driverId: null });

async function load() {
  const [{ data: bv }, { data: ts }, { data: vs }, { data: ds }] = await Promise.all([
    api.get('/booking-view', { params: { date: date.value } }),
    api.get('/trips', { params: { date: date.value } }),
    api.get('/vehicles'), api.get('/drivers'),
  ]);
  pending.value = bv.filter((s: any) => !s.trip && s.bookedCount > 0);
  trips.value = ts;
  vehicles.value = vs;
  drivers.value = ds;
}
function onExpand(row: any, expandedRows: any[]) { expanded.value = expandedRows.map((r: any) => r.id); }
function openGen(row: any) {
  cur.value = row;
  genForm.value = { vehicleId: null, driverId: null };
  genDlg.value = true;
}
async function generate() {
  const { data } = await api.post('/trips/generate', {
    date: date.value, scheduleId: cur.value.id, ...genForm.value,
  });
  ElMessage.success(`名单已生成：${data.accepted} 人入名单${data.overflow ? `，超载 ${data.overflow} 人` : ''}`);
  genDlg.value = false;
  load();
}
function openAssign(row: any) {
  assignTrip.value = row;
  assignForm.value = { vehicleId: null, driverId: null };
  assignDlg.value = true;
}
async function doAssign() {
  const dto: any = {};
  if (assignForm.value.vehicleId) dto.vehicleId = assignForm.value.vehicleId;
  if (assignForm.value.driverId) dto.driverId = assignForm.value.driverId;
  if (!dto.vehicleId && !dto.driverId) return ElMessage.warning('请选择要调换的车辆或司机');
  await api.post(`/trips/${assignTrip.value.id}/assign`, dto);
  ElMessage.success('已调整');
  assignDlg.value = false;
  load();
}
function openSuspend(row: any) {
  susTrip.value = row;
  susForm.value = { type: 'weather', reason: '' };
  susDlg.value = true;
}
async function suspend() {
  if (!susForm.value.reason) return ElMessage.warning('请填写停运原因');
  await api.post(`/trips/${susTrip.value.id}/suspend`, susForm.value);
  ElMessage.success('已停运，员工/司机/HR/运营均已收到通知，考勤自动豁免');
  susDlg.value = false;
  load();
}
onMounted(load);
</script>
