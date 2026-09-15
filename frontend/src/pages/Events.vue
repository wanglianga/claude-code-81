<template>
  <div>
    <h2 class="page-title">途中事件 · 五方协同（员工 / 司机 / 调度 / HR / 园区运营）</h2>
    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="open">未处理</el-radio-button>
          <el-radio-button label="resolved">已处理</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="dlg=true">上报途中事件</el-button>
        <span class="muted">拥堵/故障/施工/错过班车/临时加班/绕行/晚点/极端天气/临时安检/企业搬迁——一次上报，五方同车可见</span>
      </div>
    </el-card>

    <el-row :gutter="14">
      <el-col :span="15">
        <el-card v-for="e in events" :key="e.id" class="card-soft" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <el-tag :type="e.severity==='critical'?'danger':'warning'" size="small">{{ EVENT_TYPES[e.type]||e.type }}</el-tag>
              <b style="margin-left:8px">#{{ e.id }} {{ e.description }}</b>
            </div>
            <el-tag :type="st(e.status).type" size="small">{{ st(e.status).label }}</el-tag>
          </div>
          <div class="muted" style="margin:6px 0">
            车次 #{{ e.tripId || '-' }} · 影响 {{ e.affectedCount }} 人 ·
            上报 {{ e.creator }}（{{ roleName(e.createdByRole) }}） ·
            {{ new Date(e.createdAt).toLocaleString('zh-CN') }}
          </div>
          <div v-if="e.resolution" style="background:#f0f9eb;padding:6px 10px;border-radius:6px;font-size:13px">
            处理结果（{{ e.handler }}）：{{ e.resolution }}
            <el-tag size="small" type="success" style="margin-left:6px">{{ compName(e.compensationType) }}</el-tag>
          </div>
          <div style="margin-top:8px" v-if="canHandle && e.status!=='resolved'">
            <el-button size="small" type="success" @click="openResolve(e)">处理并联动考勤/补车费</el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="9">
        <el-card class="card-soft" header="协同机制说明">
          <el-steps direction="vertical" :active="5" process-finish-status="success">
            <el-step title="① 任一方上报" description="员工/司机一键上报，调度与园区运营实时收到"/>
            <el-step title="② 同车人同步" description="车次上所有员工、司机、所属企业 HR 自动通知"/>
            <el-step title="③ 调度处置" description="绕行/补车/接驳/停运，登记处理结论"/>
            <el-step title="④ 考勤联动" description="豁免考勤 / 补车费由园区承担 / 退费，自动改写档案"/>
            <el-step title="⑤ 归档优化" description="进入线路优化与企业考勤协同的数据基础"/>
          </el-steps>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dlg" title="上报途中事件" width="500px">
      <el-form label-width="90px">
        <el-form-item label="关联车次">
          <el-select v-model="form.tripId" clearable filterable placeholder="选择今日/历史车次（可空）" style="width:100%">
            <el-option v-for="t in tripOpts" :key="t.id"
                       :label="`#${t.id} ${t.date} ${t.schedule?.name} ${t.vehicle?.plate||''}`" :value="t.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="事件类型">
          <el-select v-model="form.type" style="width:100%">
            <el-option v-for="(label,key) in EVENT_TYPES" :key="key" :label="label" :value="key"/>
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度">
          <el-radio-group v-model="form.severity">
            <el-radio label="info">一般</el-radio>
            <el-radio label="warning">较重</el-radio>
            <el-radio label="critical">严重</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="情况描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="时间、位置、现状、是否需要补车/救护车等"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="submit">上报并通知五方</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resolveDlg" title="处理事件" width="500px">
      <el-form label-width="100px">
        <el-form-item label="处置结论">
          <el-input v-model="resolveForm.resolution" type="textarea" :rows="3"
            placeholder="如：已安排接驳车08:10到达，全员改乘；本车晚点不计考勤"/>
        </el-form-item>
        <el-form-item label="联动措施">
          <el-radio-group v-model="resolveForm.compensationType">
            <el-radio label="none">仅记录</el-radio>
            <el-radio label="exempt_attendance">考勤豁免</el-radio>
            <el-radio label="makeup_bus">补车费园区承担</el-radio>
            <el-radio label="refund">退还补车费</el-radio>
            <el-radio label="reschedule">改乘下一班</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDlg=false">取消</el-button>
        <el-button type="success" @click="submitResolve">确认处理并通知员工/HR</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st, EVENT_TYPES, ROLE_NAMES, today } from '../api';

const role = localStorage.getItem('role') || '';
const canHandle = ['dispatcher', 'operator', 'admin'].includes(role);
const filter = ref('');
const events = ref<any[]>([]);
const tripOpts = ref<any[]>([]);
const dlg = ref(false);
const resolveDlg = ref(false);
const form = ref<any>({ type: 'congestion', severity: 'warning', description: '', tripId: null });
const cur = ref<any>(null);
const resolveForm = ref<any>({ resolution: '', compensationType: 'exempt_attendance' });

const roleName = (r: string) => ROLE_NAMES[r] || r;
const compName = (t: string) => ({
  none: '仅记录', exempt_attendance: '考勤豁免', makeup_bus: '补车费园区承担',
  refund: '退还补车费', reschedule: '改乘下一班',
} as any)[t] || t;

async function load() {
  const [{ data }, { data: trips }] = await Promise.all([
    api.get('/events', { params: filter.value ? { status: filter.value } : {} }),
    api.get('/trips'),
  ]);
  events.value = data;
  tripOpts.value = trips;
}
async function submit() {
  if (!form.value.description) return ElMessage.warning('请填写情况描述');
  await api.post('/events', form.value);
  ElMessage.success('事件已上报，员工/司机/调度/HR/运营同步收到通知');
  dlg.value = false;
  form.value = { type: 'congestion', severity: 'warning', description: '', tripId: null };
  load();
}
function openResolve(e: any) {
  cur.value = e;
  resolveForm.value = { resolution: '', compensationType: 'exempt_attendance' };
  resolveDlg.value = true;
}
async function submitResolve() {
  if (!resolveForm.value.resolution) return ElMessage.warning('请填写处置结论');
  await api.post(`/events/${cur.value.id}/resolve`, resolveForm.value);
  ElMessage.success('已处理，相关考勤/费用档案已联动更新');
  resolveDlg.value = false;
  load();
}
onMounted(load);
</script>
