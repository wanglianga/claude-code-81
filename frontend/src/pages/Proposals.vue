<template>
  <div>
    <h2 class="page-title">线路调整 · 涉线企业 HR + 员工代表完整双确认</h2>
    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="muted">
          通勤优化不由园区单方决定：关联线路上的<strong>每家共线企业</strong>，均须由该企业 HR 与该企业配置的员工代表
          （企业档案 representative）分别确认；矩阵全部点亮后园区运营才可一次发布，缺任一方都无法落地。
        </span>
        <el-button v-if="canRaise" type="primary" @click="dlg=true">发起线路调整提案</el-button>
      </div>
    </el-card>

    <el-row :gutter="14">
      <el-col :span="12" v-for="p in rows" :key="p.id">
        <el-card class="card-soft" style="margin-bottom:14px">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>{{ p.title }}</b>
              <el-tag size="small" :type="st(p.status).type">{{ st(p.status).label }}</el-tag>
            </div>
          </template>
          <div style="font-size:13px;line-height:1.8">
            <div>
              <el-tag size="small">{{ typeName(p.type) }}</el-tag>
              <el-tag size="small" type="success" effect="plain" style="margin-left:6px" v-if="p.estimatedSaving">
                预计月节省 ¥{{ p.estimatedSaving }}
              </el-tag>
              <el-tag size="small" type="info" effect="plain" style="margin-left:6px" v-if="p.effectiveDate">
                拟生效 {{ p.effectiveDate }}
              </el-tag>
            </div>
            <div style="margin:6px 0">{{ p.content }}</div>
            <div class="muted">影响评估（车辆/司机/企业费用）：{{ p.impactSummary }}</div>
          </div>

          <!-- 完整确认矩阵：每家涉线企业一行 -->
          <el-table :data="matrixRows(p)" size="small" border style="margin-top:8px">
            <el-table-column label="涉线企业" min-width="130">
              <template #default="{row}">{{ row.company.name }}</template>
            </el-table-column>
            <el-table-column label="企业 HR 确认" min-width="150">
              <template #default="{row}">
                <el-tag v-if="row.hr" size="small" type="success">{{ row.hr.by }}</el-tag>
                <span v-else class="muted">待该企业 HR 确认</span>
              </template>
            </el-table-column>
            <el-table-column :label="`员工代表确认（${repNames(p)}）`" min-width="170">
              <template #default="{row}">
                <el-tag v-if="row.rep" size="small" type="success">{{ row.rep.by }}</el-tag>
                <span v-else class="muted">
                  待{{ row.company.representative || '（未配置代表）' }}确认
                </span>
              </template>
            </el-table-column>
          </el-table>

          <div class="muted" style="margin-top:6px">
            矩阵进度：{{ doneHr(p) }}/{{ involved(p).length }} 家企业 HR ·
            {{ doneRep(p) }}/{{ involved(p).length }} 家员工代表
          </div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <!-- 企业侧：仅本提案涉线企业 HR 且自家未确认可见（最终以后端 403 为准） -->
            <el-button v-if="role==='hr' && canMyCompanyConfirm(p)"
                       size="small" type="primary" @click="confirm(p,'company')">
              代表本企业（{{ myCompanyName }}）HR 确认
            </el-button>
            <!-- 员工侧：仅本企业配置的 representative 本人、且涉线、且自家未确认 -->
            <el-button v-if="role==='employee' && canIRepresent(p)"
                       size="small" type="success" @click="confirm(p,'employee')">
              我作为{{ myCompanyName }}员工代表（{{ realName }}）确认
            </el-button>
            <!-- 发布：矩阵完整（employee_confirmed）后仅 operator 可见 -->
            <el-button v-if="role==='operator' && p.status==='employee_confirmed'"
                       size="small" type="success" @click="apply(p)">发布执行（一次落地）</el-button>
            <el-tag v-if="role==='operator' && ['proposed','company_confirmed'].includes(p.status)"
                    size="small" type="warning" effect="plain">双确认不完整，禁止发布</el-tag>
            <el-button v-if="['operator','hr'].includes(role) && canAct(p)" size="small" type="danger" plain @click="reject(p)">驳回</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dlg" title="发起线路调整提案" width="520px">
      <el-form label-width="92px">
        <el-form-item label="调整类型">
          <el-select v-model="form.type" style="width:100%">
            <el-option label="线路调整" value="adjust"/>
            <el-option label="新增线路" value="new_line"/>
            <el-option label="停运" value="suspend"/>
            <el-option label="延长线路/跨区接驳" value="extend"/>
            <el-option label="企业搬迁配套" value="relocation"/>
          </el-select>
        </el-form-item>
        <el-form-item label="关联线路">
          <el-select v-model="form.lineId" clearable style="width:100%" placeholder="不选=园区级提案（默认全部企业）">
            <el-option v-for="l in lines" :key="l.id" :label="l.name" :value="l.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="标题"><el-input v-model="form.title"/></el-form-item>
        <el-form-item label="调整内容">
          <el-input v-model="form.content" type="textarea" :rows="2"/>
        </el-form-item>
        <el-form-item label="影响评估">
          <el-input v-model="form.impactSummary" type="textarea" :rows="2"
            placeholder="对车辆/司机/费用/员工步行距离/企业生产排班的影响"/>
        </el-form-item>
        <el-form-item label="预计月节省"><el-input-number v-model="form.estimatedSaving" :min="0"/></el-form-item>
        <el-form-item label="拟生效日期">
          <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="submit">发起（通知涉线企业）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st } from '../api';

const role = localStorage.getItem('role') || '';
const realName = localStorage.getItem('realName') || '';
const myCompanyId = Number(localStorage.getItem('companyId') || 0);
const myCompanyName = localStorage.getItem('companyName') || '';
const canRaise = ['operator', 'dispatcher', 'admin'].includes(role);
const rows = ref<any[]>([]);
const lines = ref<any[]>([]);
const companiesAll = ref<any[]>([]);
const dlg = ref(false);
const form = ref<any>({ type: 'adjust', lineId: null, title: '', content: '', impactSummary: '', estimatedSaving: 0, effectiveDate: '' });

const typeName = (t: string) => ({
  adjust: '线路调整', new_line: '新增线路', suspend: '停运', extend: '延长/接驳', relocation: '搬迁配套',
} as any)[t] || t;
const canAct = (p: any) => ['proposed', 'company_confirmed'].includes(p.status);

// 提案涉线企业：关联线路共线企业；无线路=全部企业
function involved(p: any) {
  if (p.lineId) {
    const line = lines.value.find((l: any) => l.id === p.lineId);
    return line?.companies || [];
  }
  return companiesAll.value;
}
function ccOf(p: any, cid: number) {
  return (p.companyConfirmations || []).find((c: any) => c.companyId === cid && c.confirmed);
}
function repOf(p: any, cid: number) {
  return (p.employeeConfirmations || []).find((c: any) => c.companyId === cid && c.confirmed);
}
function matrixRows(p: any) {
  return involved(p).map((c: any) => ({ company: c, hr: ccOf(p, c.id), rep: repOf(p, c.id) }));
}
function repNames(p: any) {
  return involved(p).map((c: any) => c.representative || '未配置').join('、');
}
function doneHr(p: any) { return involved(p).filter((c: any) => ccOf(p, c.id)).length; }
function doneRep(p: any) { return involved(p).filter((c: any) => repOf(p, c.id)).length; }

// 当前用户 HR 资格：属于涉线企业且自家尚未确认
function canMyCompanyConfirm(p: any) {
  if (!myCompanyId || !involved(p).some((c: any) => c.id === myCompanyId)) return false;
  if (ccOf(p, myCompanyId)) return false;
  return canAct(p);
}
// 当前用户员工代表资格：本企业在涉线范围、本人是该企业 representative、自家代表未确认
function canIRepresent(p: any) {
  if (!myCompanyId || !involved(p).some((c: any) => c.id === myCompanyId)) return false;
  const mine = companiesAll.value.find((c: any) => c.id === myCompanyId);
  if (!mine?.representative || mine.representative.trim() !== realName.trim()) return false;
  if (repOf(p, myCompanyId)) return false;
  return canAct(p);
}

async function load() {
  const [{ data }, { data: ls }, { data: cs }] = await Promise.all([
    api.get('/proposals'), api.get('/lines'), api.get('/companies'),
  ]);
  rows.value = data; lines.value = ls; companiesAll.value = cs;
}
async function submit() {
  if (!form.value.title || !form.value.content) return ElMessage.warning('标题和内容必填');
  await api.post('/proposals', form.value);
  ElMessage.success('提案已发起，等待涉线企业 HR 与员工代表双确认');
  dlg.value = false;
  load();
}
async function confirm(p: any, side: 'company' | 'employee') {
  const { value: note } = await ElMessageBox.prompt('确认意见（可选）', '确认提案', { inputType: 'text' }).catch(() => ({ value: undefined }));
  if (note === undefined) return;
  await api.post(`/proposals/${p.id}/confirm/${side}`, { note: note || '' });
  ElMessage.success(side === 'company' ? '企业 HR 已确认' : '员工代表已确认');
  load();
}
async function apply(p: any) {
  await ElMessageBox.confirm('完整双确认已通过，确认发布执行？线路状态、车辆/司机/企业费用影响与通知将一次落地。', '发布', { type: 'success' });
  await api.post(`/proposals/${p.id}/apply`);
  ElMessage.success('已发布执行');
  load();
}
async function reject(p: any) {
  const { value: note } = await ElMessageBox.prompt('驳回原因', '驳回提案', { inputType: 'text' }).catch(() => ({ value: undefined }));
  if (note === undefined) return;
  await api.post(`/proposals/${p.id}/reject`, { note });
  ElMessage.success('已驳回');
  load();
}
onMounted(load);
</script>
