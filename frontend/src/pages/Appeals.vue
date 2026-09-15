<template>
  <div>
    <h2 class="page-title">员工迟到申诉处理</h2>
    <el-card class="card-soft">
      <el-radio-group v-model="filter" @change="load" style="margin-bottom:12px">
        <el-radio-button label="">全部</el-radio-button>
        <el-radio-button label="pending">待处理</el-radio-button>
        <el-radio-button label="approved">已成立</el-radio-button>
        <el-radio-button label="rejected">已驳回</el-radio-button>
      </el-radio-group>
      <el-table :data="rows" size="small">
        <el-table-column prop="id" label="#" width="55"/>
        <el-table-column label="申诉人 / 工号" min-width="150">
          <template #default="{row}">{{ emp(row.employeeId)?.realName }}
            <span class="muted">{{ emp(row.employeeId)?.employeeNo }}</span></template>
        </el-table-column>
        <el-table-column prop="reason" label="申诉理由" min-width="240" show-overflow-tooltip/>
        <el-table-column prop="evidence" label="佐证" min-width="150" show-overflow-tooltip/>
        <el-table-column label="状态" width="110">
          <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="联动" width="150">
          <template #default="{row}">
            <el-tag v-if="row.grantExemption" size="small" type="success">豁免考勤</el-tag>
            <el-tag v-if="row.refundFee" size="small" type="success" style="margin-left:4px">退费</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reply" label="回复" min-width="160" show-overflow-tooltip/>
        <el-table-column label="操作" width="220">
          <template #default="{row}">
            <template v-if="['pending','hr_review','operator_review'].includes(row.status)">
              <el-button link type="success" size="small" @click="open(row,'approve')">成立</el-button>
              <el-button link type="danger" size="small" @click="open(row,'reject')">驳回</el-button>
              <el-button link type="warning" size="small" @click="open(row,'escalate')">升级运营</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlg" :title="action==='approve'?'申诉成立':action==='reject'?'驳回申诉':'升级园区运营'" width="480px">
      <el-form label-width="90px">
        <el-form-item v-if="action==='approve'" label="处理措施">
          <el-checkbox v-model="form.grantExemption">豁免该次考勤迟到</el-checkbox><br/>
          <el-checkbox v-model="form.refundFee">退还补车费用</el-checkbox>
        </el-form-item>
        <el-form-item label="回复说明">
          <el-input v-model="form.reply" type="textarea" :rows="3" placeholder="处理依据，将通知员工"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button :type="action==='approve'?'success':action==='reject'?'danger':'warning'" @click="save">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st } from '../api';

const filter = ref('pending');
const rows = ref<any[]>([]);
const employees = ref<any[]>([]);
const dlg = ref(false);
const cur = ref<any>(null);
const action = ref<'approve'|'reject'|'escalate'>('approve');
const form = ref<any>({ reply: '', grantExemption: true, refundFee: true });

const emp = (id: number) => employees.value.find(e => e.id === id);

async function load() {
  const { data } = await api.get('/appeals', { params: filter.value ? { status: filter.value } : {} });
  rows.value = data;
  // 从考勤/预约接口不便取员工名，这里用 dashboard 不需要；改为简单拉一次 trips 太绕，直接显示 ID 也行
  employees.value = await loadEmployees();
}
async function loadEmployees() {
  const { data } = await api.get('/employees');
  return data;
}
function open(row: any, a: any) {
  cur.value = row; action.value = a;
  form.value = { reply: '', grantExemption: true, refundFee: a === 'approve' };
  dlg.value = true;
}
async function save() {
  if (!form.value.reply) return ElMessage.warning('请填写回复说明');
  await api.post(`/appeals/${cur.value.id}/review`, { action: action.value, ...form.value });
  ElMessage.success('已处理并通知员工');
  dlg.value = false;
  load();
}
onMounted(load);
</script>
