<template>
  <div>
    <h2 class="page-title">企业加班补车 · 派单 · 工时与月度结算</h2>

    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <el-radio-group v-model="statusFilter" @change="load">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="pending">待审核</el-radio-button>
          <el-radio-button label="approved">已派车</el-radio-button>
          <el-radio-button label="completed">已完成待月结</el-radio-button>
          <el-radio-button label="settled">已月结</el-radio-button>
          <el-radio-button label="rejected">已驳回</el-radio-button>
        </el-radio-group>
        <div>
          <el-button v-if="isHr" type="primary" @click="openApply">HR 发起加班补车</el-button>
          <el-button v-if="isOperator" type="warning" @click="billingDlg=true;loadBilling()">月度结算</el-button>
        </div>
      </div>
    </el-card>

    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="busNo" label="补车单号" width="170"/>
        <el-table-column label="企业/目的地" min-width="170">
          <template #default="{row}">
            <div>{{ companyName(row.companyId) }}</div>
            <div class="muted">{{ row.date }} → {{ row.destination }}</div>
          </template>
        </el-table-column>
        <el-table-column label="发车/人数" width="130">
          <template #default="{row}">
            {{ new Date(row.departAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) }}
            <el-tag size="small" effect="plain">{{ row.passengerCount }}人</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="车辆/司机" min-width="140">
          <template #default="{row}">{{ row.vehicleId ? vehicle(row.vehicleId)?.plate : '—' }} / {{ driverName(row.driverId) }}</template>
        </el-table-column>
        <el-table-column label="工时/费用" width="150">
          <template #default="{row}">
            <div>{{ row.driverWorkMinutes }}分 · ¥{{ row.totalFee }}</div>
            <div class="muted">企业¥{{ row.feeSplit?.companyShare }} 园区¥{{ row.feeSplit?.parkSubsidy }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{row}"><el-tag size="small" :type="busStatus(row.status).type">{{ busStatus(row.status).label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status==='pending' && isDispatcher" link type="success" size="small" @click="openDispatch(row)">派单</el-button>
            <el-button v-if="row.status==='approved' && canOperate(row)" link type="primary" size="small" @click="depart(row)">发车</el-button>
            <el-button v-if="row.status==='departed' && canOperate(row)" link type="success" size="small" @click="complete(row)">完成送达</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- HR 申请 -->
    <el-dialog v-model="applyDlg" title="HR 发起深夜加班补车申请" width="640px">
      <el-form label-width="100px">
        <el-form-item label="加班日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD"/>
        </el-form-item>
        <el-form-item label="计划发车">
          <el-date-picker v-model="form.departAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="如 23:30"/>
        </el-form-item>
        <el-form-item label="目的地">
          <el-input v-model="form.destination" placeholder="如：滨河家园片区（东线沿途）"/>
        </el-form-item>
        <el-form-item label="乘车人数">
          <el-input-number v-model="form.passengerCount" :min="1" :max="45" @change="runCheck"/>
        </el-form-item>
        <el-form-item label="乘车员工">
          <el-select v-model="form.employeeIds" multiple filterable placeholder="可选：指定加班员工（计入乘车记录）" style="width:100%">
            <el-option v-for="e in myEmployees" :key="e.id" :label="`${e.realName} ${e.employeeNo||''}`" :value="e.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="加班说明">
          <el-input v-model="form.reason" type="textarea" :rows="2" placeholder="如：产线赶单，临时加班至23时"/>
        </el-form-item>
        <el-alert v-if="checkResult" :type="checkResult.ok?'success':'error'" :closable="false" style="margin-bottom:8px">
          <template #title>
            <div v-if="checkResult.errors.length" v-for="(m,i) in checkResult.errors" :key="i">⛔ {{ m }}</div>
            <div v-if="!checkResult.errors.length">
              ✅ 资源预检通过，预估费用：车辆¥{{ checkResult.estimatedFee.vehicleFee }} +
              工时¥{{ checkResult.estimatedFee.driverOvertimeFee }} + 人次¥{{ checkResult.estimatedFee.perPassengerFee }}
              = <b>¥{{ checkResult.estimatedFee.totalFee }}</b>（企业承担 ¥{{ checkResult.estimatedFee.companyShare }}，园区补贴 ¥{{ checkResult.estimatedFee.parkSubsidy }}）
            </div>
            <div v-for="(w,i) in checkResult.warnings" :key="'w'+i" style="color:#e6a23c">⚠️ {{ w }}</div>
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="applyDlg=false">取消</el-button>
        <el-button type="primary" @click="submitApply">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- 派单 -->
    <el-dialog v-model="dispatchDlg" title="调度审核派单（车辆/司机工时/休息校验）" width="600px">
      <div v-if="cur">
        <el-alert type="info" :closable="false" style="margin-bottom:10px"
          :title="`${cur.busNo}：${companyName(cur.companyId)} ${cur.passengerCount} 人，${cur.date} 深夜补车至 ${cur.destination}`"/>
        <el-form label-width="90px">
          <el-form-item label="车辆">
            <el-select v-model="dispatchForm.vehicleId" style="width:100%">
              <el-option v-for="v in vehicles" :key="v.id" :label="`${v.plate}（${v.seats}座/${v.status}）`" :value="v.id"
                         :disabled="['maintenance','breakdown'].includes(v.status) || v.seats < cur.passengerCount"/>
            </el-select>
          </el-form-item>
          <el-form-item label="司机">
            <el-select v-model="dispatchForm.driverId" style="width:100%" @change="runDispatchCheck">
              <el-option v-for="d in drivers" :key="d.id"
                         :label="`${d.realName}（培训至${d.safetyTrainingExpiry}）`" :value="d.id"/>
            </el-select>
          </el-form-item>
        </el-form>
        <el-alert v-if="dispatchCheck" :type="dispatchCheck.ok?'success':'error'" :closable="false">
          <template #title>
            <div>当日已驾驶 {{ dispatchCheck.driverWorkedMinutes ?? 0 }} 分钟（上限 300，满 240 提醒）</div>
            <div v-for="(m,i) in dispatchCheck.errors" :key="i">⛔ {{ m }}</div>
            <div v-for="(w,i) in dispatchCheck.warnings" :key="i" style="color:#e6a23c">⚠️ {{ w }}</div>
            <div v-if="dispatchCheck.ok">预估费用 ¥{{ dispatchCheck.estimatedFee.totalFee }}（企业 ¥{{ dispatchCheck.estimatedFee.companyShare }}）</div>
          </template>
        </el-alert>
      </div>
      <template #footer>
        <el-button type="danger" plain @click="reject">驳回</el-button>
        <el-button @click="dispatchDlg=false">取消</el-button>
        <el-button type="success" :disabled="!dispatchCheck?.ok" @click="submitDispatch">确认派单</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailDlg" :title="`补车单 ${cur?.busNo||''}`" width="640px">
      <div v-if="cur">
        <el-descriptions :column="2" border size="small" style="margin-bottom:10px">
          <el-descriptions-item label="状态"><el-tag size="small" :type="busStatus(cur.status).type">{{ busStatus(cur.status).label }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="乘车人数">{{ cur.passengerCount }}</el-descriptions-item>
          <el-descriptions-item label="车辆">{{ cur.vehicle?.plate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="司机">{{ cur.driver?.realName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="实际工时">{{ cur.driverWorkMinutes }} 分钟</el-descriptions-item>
          <el-descriptions-item label="强制休息至">{{ cur.restDueAt ? new Date(cur.restDueAt).toLocaleString('zh-CN') : '—' }}</el-descriptions-item>
          <el-descriptions-item label="费用拆分" :span="2">
            车辆 ¥{{ cur.feeSplit?.vehicleFee }} ｜ 司机工时 ¥{{ cur.feeSplit?.driverOvertimeFee }}
            （{{ cur.driverWorkMinutes }}分钟）｜ 人次 ¥{{ cur.feeSplit?.perPassengerFee }}
            ｜ <b>企业承担 ¥{{ cur.feeSplit?.companyShare }}</b> ｜ 园区补贴 ¥{{ cur.feeSplit?.parkSubsidy }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="cur.passengers||[]" size="small" border>
          <el-table-column label="员工" min-width="150">
            <template #default="{row}">{{ row.employee?.realName }} {{ row.employee?.employeeNo||'' }}</template>
          </el-table-column>
          <el-table-column label="乘车状态" width="110">
            <template #default="{row}">
              <el-tag size="small" :type="row.status==='boarded'?'success':'info'">{{ row.status==='boarded'?'已乘车':'待乘车' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-alert v-if="cur.status==='completed'" type="warning" :closable="false" style="margin-top:10px"
          title="已完成，等待园区月度结算出账；完成后司机休息时间已按实际工时重新计算。"/>
      </div>
    </el-dialog>

    <!-- 月结 -->
    <el-dialog v-model="billingDlg" title="园区加班补车月度结算" width="720px">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <el-date-picker v-model="period" type="month" value-format="YYYY-MM" @change="loadBilling"/>
      </div>
      <el-descriptions v-if="billing" :column="3" border size="small" style="margin-bottom:10px">
        <el-descriptions-item label="待结算补车">{{ billing.pendingCount }} 趟</el-descriptions-item>
        <el-descriptions-item label="总金额">¥{{ billing.totalAmount }}</el-descriptions-item>
        <el-descriptions-item label="园区补贴">¥{{ billing.parkSubsidy }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="billing?.companyBreakdown||[]" size="small" border>
        <el-table-column prop="companyName" label="企业" min-width="130"/>
        <el-table-column prop="supplementCount" label="趟次" width="60"/>
        <el-table-column prop="passengerCount" label="人次" width="60"/>
        <el-table-column prop="driverWorkMinutes" label="司机工时(分)" width="100"/>
        <el-table-column label="车辆/工时/人次" width="170">
          <template #default="{row}">¥{{ row.vehicleFee }}/¥{{ row.driverOvertimeFee }}/¥{{ row.perPassengerFee }}</template>
        </el-table-column>
        <el-table-column label="企业承担" width="90">
          <template #default="{row}"><b>¥{{ row.companyShare }}</b></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="billingDlg=false">关闭</el-button>
        <el-button type="primary" :disabled="!billing?.pendingCount" @click="confirmBilling">确认出账（月结）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const role = localStorage.getItem('role') || '';
const isHr = role === 'hr';
const isDispatcher = ['dispatcher', 'operator', 'admin'].includes(role);
const isOperator = ['operator', 'admin', 'dispatcher'].includes(role);

const rows = ref<any[]>([]);
const companies = ref<any[]>([]);
const vehicles = ref<any[]>([]);
const drivers = ref<any[]>([]);
const myEmployees = ref<any[]>([]);
const statusFilter = ref(isHr ? '' : 'pending');

const applyDlg = ref(false);
const dispatchDlg = ref(false);
const detailDlg = ref(false);
const billingDlg = ref(false);
const cur = ref<any>(null);
const period = ref(new Date().toISOString().slice(0, 7));
const billing = ref<any>(null);

const form = ref<any>({ date: '', departAt: '', destination: '', passengerCount: 1, employeeIds: [], reason: '' });
const checkResult = ref<any>(null);
const dispatchForm = ref<any>({ vehicleId: null, driverId: null });
const dispatchCheck = ref<any>(null);

function companyName(id: number) { return companies.value.find(c => c.id === id)?.name || `企业#${id}`; }
function vehicle(id: number) { return vehicles.value.find(v => v.id === id); }
function driverName(id?: number) { return drivers.value.find(d => d.id === id)?.realName || '—'; }
function busStatus(s: string) {
  return ({
    pending: { label: '待审核', type: 'warning' }, approved: { label: '已派车', type: 'primary' },
    departed: { label: '行驶中', type: 'warning' }, completed: { label: '已完成待月结', type: 'success' },
    settled: { label: '已月结', type: 'info' }, rejected: { label: '已驳回', type: 'danger' },
  } as any)[s] || { label: s, type: 'info' };
}
function canOperate(row: any) {
  if (['dispatcher', 'operator', 'admin'].includes(role)) return true;
  return role === 'driver' && row.driverId === Number(localStorage.getItem('uid'));
}

async function load() {
  const [{ data: bs }, { data: cs }, { data: vs }, { data: ds2 }] = await Promise.all([
    api.get('/supplements', { params: statusFilter.value ? { status: statusFilter.value } : {} }),
    api.get('/companies'), api.get('/vehicles'), api.get('/drivers'),
  ]);
  rows.value = bs; companies.value = cs; vehicles.value = vs; drivers.value = ds2;
}
async function openApply() {
  const cid = Number(localStorage.getItem('companyId'));
  const { data } = await api.get('/employees', { params: { companyId: cid } });
  myEmployees.value = data;
  form.value = {
    date: new Date().toISOString().slice(0, 10),
    departAt: `${new Date().toISOString().slice(0, 10)}T23:30:00`,
    destination: '', passengerCount: 1, employeeIds: [], reason: '企业临时加班',
  };
  checkResult.value = null;
  applyDlg.value = true;
}
async function runCheck() {
  const { data } = await api.post('/supplements/check', {
    date: form.value.date, passengerCount: form.value.passengerCount,
  });
  checkResult.value = data;
}
async function submitApply() {
  await api.post('/supplements', form.value);
  ElMessage.success('补车申请已提交，等待调度审核派车');
  applyDlg.value = false; load();
}
async function openDispatch(row: any) {
  cur.value = row;
  dispatchForm.value = { vehicleId: null, driverId: null };
  dispatchCheck.value = null;
  dispatchDlg.value = true;
}
async function runDispatchCheck() {
  if (!dispatchForm.value.driverId) return;
  const { data } = await api.post('/supplements/check', {
    date: cur.value.date, passengerCount: cur.value.passengerCount,
    vehicleId: dispatchForm.value.vehicleId, driverId: dispatchForm.value.driverId,
  });
  dispatchCheck.value = data;
}
async function submitDispatch() {
  const { data } = await api.post(`/supplements/${cur.value.id}/dispatch`, dispatchForm.value);
  ElMessage.success(`派单成功，费用 ¥${data.totalFee}`);
  dispatchDlg.value = false; load();
}
async function reject() {
  const { value } = await ElMessageBox.prompt('驳回原因', '驳回补车申请', { type: 'warning' }).catch(() => ({ value: null }));
  if (!value) return;
  await api.post(`/supplements/${cur.value.id}/dispatch`, { reject: true, reviewNote: value });
  ElMessage.success('已驳回'); dispatchDlg.value = false; load();
}
async function openDetail(row: any) {
  const { data } = await api.get(`/supplements/${row.id}`);
  cur.value = data; detailDlg.value = true;
}
async function depart(row: any) {
  await api.post(`/supplements/${row.id}/depart`);
  ElMessage.success('补车已发车'); load();
}
async function complete(row: any) {
  try {
    await ElMessageBox.confirm('确认已安全送达？将按实际工时重算费用并重置司机休息时间。', '完成补车', { type: 'success' });
  } catch { return; }
  const res = await api.post(`/supplements/${row.id}/complete`);
  ElMessage.success(`完成，工时 ${res.data.driverWorkMinutes} 分钟，休息至 ${new Date(res.data.restDueAt).toLocaleTimeString('zh-CN')}`);
  load();
}
async function loadBilling() {
  if (!period.value) return;
  const { data } = await api.get('/billings/preview', { params: { period: period.value } });
  billing.value = data;
}
async function confirmBilling() {
  await api.post(`/billings/${period.value}/confirm`);
  ElMessage.success('月度账单已出账并通知企业 HR');
  billingDlg.value = false; load();
}
onMounted(load);
</script>
