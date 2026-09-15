<template>
  <div>
    <h2 class="page-title">线路调整 · 企业负责人 + 员工代表双确认共治</h2>
    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="muted">
          通勤优化不由园区单方决定：线路新增/调整/停运/搬迁，须经涉及企业 HR 与员工代表共同确认后方可发布；
          持续影响车辆、司机排班与企业费用。
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
            <div><el-tag size="small">{{ typeName(p.type) }}</el-tag>
              <el-tag size="small" type="success" effect="plain" style="margin-left:6px" v-if="p.estimatedSaving">
                预计月节省 ¥{{ p.estimatedSaving }}
              </el-tag>
              <el-tag size="small" type="info" effect="plain" style="margin-left:6px" v-if="p.effectiveDate">
                拟生效 {{ p.effectiveDate }}
              </el-tag>
            </div>
            <div style="margin:6px 0">{{ p.content }}</div>
            <div class="muted">影响评估：{{ p.impactSummary }}</div>
          </div>
          <el-descriptions :column="2" size="small" border style="margin-top:8px">
            <el-descriptions-item label="企业确认">
              <el-tag v-for="c in p.companyConfirmations" :key="c.companyId" size="small" type="success" style="margin:2px">
                {{ c.name }} · {{ c.by }}
              </el-tag>
              <span v-if="!p.companyConfirmations?.length" class="muted">待企业负责人确认</span>
            </el-descriptions-item>
            <el-descriptions-item label="员工代表确认">
              <el-tag v-for="c in p.employeeConfirmations" :key="c.by" size="small" type="success" style="margin:2px">
                {{ c.name }} · {{ c.by }}
              </el-tag>
              <span v-if="!p.employeeConfirmations?.length" class="muted">待员工代表确认</span>
            </el-descriptions-item>
          </el-descriptions>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <el-button v-if="role==='hr' && !alreadyCompany(p) && canAct(p)" size="small" type="primary"
                       @click="confirm(p,'company')">代表本企业确认</el-button>
            <el-button v-if="role==='employee' && canAct(p)" size="small" type="success"
                       @click="confirm(p,'employee')">作为员工代表确认</el-button>
            <el-button v-if="role==='operator' && (p.status==='employee_confirmed'||p.status==='company_confirmed'&&p.employeeConfirmations?.length)"
                       size="small" type="success" @click="apply(p)">发布执行</el-button>
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
          <el-select v-model="form.lineId" clearable style="width:100%">
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
        <el-button type="primary" @click="submit">发起（通知企业负责人）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st } from '../api';

const role = localStorage.getItem('role') || '';
const companyId = Number(localStorage.getItem('companyId') || 0);
const canRaise = ['operator', 'dispatcher', 'admin'].includes(role);
const rows = ref<any[]>([]);
const lines = ref<any[]>([]);
const dlg = ref(false);
const form = ref<any>({ type: 'adjust', lineId: null, title: '', content: '', impactSummary: '', estimatedSaving: 0, effectiveDate: '' });

const typeName = (t: string) => ({
  adjust: '线路调整', new_line: '新增线路', suspend: '停运', extend: '延长/接驳', relocation: '搬迁配套',
} as any)[t] || t;
const canAct = (p: any) => ['proposed', 'company_confirmed'].includes(p.status);
const alreadyCompany = (p: any) => (p.companyConfirmations || []).some((c: any) => c.companyId === companyId);

async function load() {
  const [{ data }, { data: ls }] = await Promise.all([api.get('/proposals'), api.get('/lines')]);
  rows.value = data; lines.value = ls;
}
async function submit() {
  if (!form.value.title || !form.value.content) return ElMessage.warning('标题和内容必填');
  await api.post('/proposals', form.value);
  ElMessage.success('提案已发起，等待企业与员工代表双确认');
  dlg.value = false;
  load();
}
async function confirm(p: any, side: 'company' | 'employee') {
  const { value: note } = await ElMessageBox.prompt('确认意见（可选）', '确认提案', { inputType: 'text' }).catch(() => ({ value: null }));
  if (note === undefined) return;
  await api.post(`/proposals/${p.id}/confirm/${side}`, { note });
  ElMessage.success(side === 'company' ? '企业已确认' : '员工代表已确认');
  load();
}
async function apply(p: any) {
  await ElMessageBox.confirm('双确认已通过，确认发布执行？线路状态将同步更新。', '发布', { type: 'success' });
  await api.post(`/proposals/${p.id}/apply`);
  ElMessage.success('已发布执行');
  load();
}
async function reject(p: any) {
  const { value: note } = await ElMessageBox.prompt('驳回原因', '驳回提案', { inputType: 'text' }).catch(() => ({ value: null }));
  if (note === undefined) return;
  await api.post(`/proposals/${p.id}/reject`, { note });
  ElMessage.success('已驳回');
  load();
}
onMounted(load);
</script>
