<template>
  <div>
    <h2 class="page-title">到厂考勤档案 · 企业考勤协同</h2>
    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <el-date-picker v-model="q.date" type="date" value-format="YYYY-MM-DD" placeholder="日期" clearable @change="load"/>
        <el-select v-model="q.companyId" placeholder="企业" clearable style="width:180px" @change="load">
          <el-option v-for="c in companies" :key="c.id" :label="c.name" :value="c.id"/>
        </el-select>
        <el-select v-model="q.status" placeholder="考勤状态" clearable style="width:140px" @change="load">
          <el-option label="正常" value="normal"/>
          <el-option label="迟到" value="late"/>
          <el-option label="豁免" value="exempt"/>
          <el-option label="事故豁免·保留个人迟到" value="partial_exempt"/>
          <el-option label="未到" value="no_show"/>
        </el-select>
        <el-button @click="reset">重置</el-button>
        <el-tag type="info">企业宽限规则不同：华星 10 分钟 / 瑞丰 5 分钟 / 恒信 15 分钟</el-tag>
      </div>
    </el-card>

    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="date" label="日期" width="105"/>
        <el-table-column label="员工" min-width="150">
          <template #default="{row}">
            {{ row.employee?.realName }}
            <span class="muted">{{ row.employee?.employeeNo }}</span>
            <el-tag size="small" effect="plain" style="margin-left:4px">{{ row.employee?.company?.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="计划→实际到厂" min-width="170">
          <template #default="{row}">
            {{ fmt(row.scheduledArrive) }} → <b>{{ fmt(row.actualArrive) || '未到厂' }}</b>
          </template>
        </el-table-column>
        <el-table-column label="迟到(分)" width="120">
          <template #default="{row}">
            <span :style="{color:row.lateMinutes>0?'#e6a23c':''}">{{ row.lateMinutes }}</span>
            <span v-if="row.commonLateMinutes || row.personalLateMinutes" class="muted" style="display:block;font-size:11px">
              事故{{ row.commonLateMinutes || 0 }}/个人{{ row.personalLateMinutes || 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="原因" width="100">
          <template #default="{row}">{{ reasonName(row.lateReason) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="补车费" width="90">
          <template #default="{row}">¥{{ row.makeupFee }}</template>
        </el-table-column>
        <el-table-column prop="feeReason" label="费用说明" min-width="160" show-overflow-tooltip/>
        <el-table-column label="操作" width="150" v-if="canEdit">
          <template #default="{row}">
            <el-button link type="success" size="small" @click="exempt(row)">豁免</el-button>
            <el-button link type="primary" size="small" @click="feeDlg(row)">改费</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlg" title="调整考勤" width="440px">
      <el-form label-width="90px">
        <el-form-item label="补车费(元)"><el-input-number v-model="form.makeupFee" :min="0"/></el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="将同步通知员工"/>
        </el-form-item>
        <el-form-item label="考勤豁免"><el-switch v-model="form.exempt"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st } from '../api';

const role = localStorage.getItem('role') || '';
const canEdit = ['hr', 'operator', 'admin'].includes(role);
const q = ref<any>({ date: '', companyId: null, status: '' });
const rows = ref<any[]>([]);
const companies = ref<any[]>([]);
const dlg = ref(false);
const cur = ref<any>(null);
const form = ref<any>({ makeupFee: 0, exempt: false, note: '' });

const reasons: Record<string, string> = {
  congestion: '道路拥堵', breakdown: '车辆故障', construction: '站点施工',
  missed: '错过班车', personal: '个人原因', detour: '司机绕行',
  late_arrival: '班车晚点', overtime: '临时加班',
};
const reasonName = (r?: string) => (r ? reasons[r] || r : '—');
function fmt(t?: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''; }

async function load() {
  const params: any = {};
  if (q.value.date) params.date = q.value.date;
  if (q.value.companyId) params.companyId = q.value.companyId;
  if (q.value.status) params.status = q.value.status;
  const [{ data }, { data: cs }] = await Promise.all([
    api.get('/attendance', { params }), api.get('/companies'),
  ]);
  rows.value = data;
  companies.value = cs;
}
function reset() { q.value = { date: '', companyId: null, status: '' }; load(); }
async function exempt(row: any) {
  await api.post(`/attendance/${row.id}/adjust`, { exempt: true, note: 'HR/运营人工核准豁免' });
  ElMessage.success('已豁免并通知员工');
  load();
}
function feeDlg(row: any) {
  cur.value = row;
  form.value = { makeupFee: row.makeupFee, exempt: row.exempt, note: '' };
  dlg.value = true;
}
async function save() {
  await api.post(`/attendance/${cur.value.id}/adjust`, form.value);
  ElMessage.success('已调整');
  dlg.value = false;
  load();
}
onMounted(load);
</script>
