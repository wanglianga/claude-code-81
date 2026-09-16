<template>
  <div>
    <h2 class="page-title">企业搬迁 · 线路重排（候选 / 反馈 / 双确认 / 生效）</h2>

    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="draft">冻结/盘点</el-radio-button>
          <el-radio-button label="consulting">意见征集</el-radio-button>
          <el-radio-button label="adjusted">待双确认</el-radio-button>
          <el-radio-button label="effective">已生效</el-radio-button>
        </el-radio-group>
        <el-button v-if="isOperator" type="primary" @click="openCreate">发起搬迁重排</el-button>
      </div>
    </el-card>

    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="rlNo" label="单号" width="175"/>
        <el-table-column label="企业/原线路" min-width="170">
          <template #default="{row}">
            <div>{{ companyName(row.companyId) }}</div>
            <div class="muted">→ {{ row.newSiteName || '新厂区' }} ｜ 生效 {{ row.effectDate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="盘点" width="180">
          <template #default="{row}">
            <div class="muted">
              班次{{ row.impact?.schedules?.length||0 }} · 站{{ row.impact?.stations?.length||0 }}
              · 在乘{{ row.impact?.activeReservationCount||0 }}
            </div>
            <el-tag size="small" :type="row.bookingFrozen?'danger':'info'">{{ row.bookingFrozen?'新预约已冻结':'正常' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="费用/运力" width="140">
          <template #default="{row}">
            <el-tag size="small" :type="row.costLocked?'success':'info'">{{ row.costLocked?'费用已确认':'费用待定' }}</el-tag>
            <el-tag size="small" :type="row.capacityLocked?'success':'info'" style="margin-left:4px">{{ row.capacityLocked?'运力锁定':'运力待定' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{row}"><el-tag size="small" :type="rlStatus(row.status).type">{{ rlStatus(row.status).label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" size="small" @click="openDetail(row)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 发起 -->
    <el-dialog v-model="createDlg" title="发起企业搬迁线路重排（冻结原线新预约）" width="560px">
      <el-form label-width="100px">
        <el-form-item label="企业">
          <el-select v-model="form.companyId" style="width:100%">
            <el-option v-for="c in companies" :key="c.id" :label="c.name" :value="c.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="原线路">
          <el-select v-model="form.oldLineId" style="width:100%">
            <el-option v-for="l in lines" :key="l.id" :label="l.name" :value="l.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="新厂区名称"><el-input v-model="form.newSiteName" placeholder="如：滨湖智造园"/></el-form-item>
        <el-form-item label="新厂区地址"><el-input v-model="form.newSiteAddress"/></el-form-item>
        <el-form-item label="生效日期"><el-date-picker v-model="form.effectDate" type="date" value-format="YYYY-MM-DD"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg=false">取消</el-button>
        <el-button type="primary" @click="submitCreate">冻结并盘点</el-button>
      </template>
    </el-dialog>

    <!-- 详情/处理 -->
    <el-dialog v-model="detailDlg" :title="`线路重排 ${detail.rlNo||''}`" width="960px" top="4vh">
      <div v-if="detail.id">
        <el-descriptions :column="3" border size="small" style="margin-bottom:10px">
          <el-descriptions-item label="状态"><el-tag size="small" :type="rlStatus(detail.status).type">{{ rlStatus(detail.status).label }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="新厂区">{{ detail.newSiteName }}</el-descriptions-item>
          <el-descriptions-item label="生效/过渡截止">{{ detail.effectDate }} / {{ detail.transitionEnd }}</el-descriptions-item>
        </el-descriptions>

        <el-tabs v-model="tab">
          <!-- 影响盘点 -->
          <el-tab-pane label="影响盘点" name="impact">
            <el-row :gutter="10" style="margin-bottom:8px">
              <el-col :span="6"><el-statistic title="受影响班次" :value="detail.impact?.schedules?.length||0"/></el-col>
              <el-col :span="6"><el-statistic title="站点" :value="detail.impact?.stations?.length||0"/></el-col>
              <el-col :span="6"><el-statistic title="在乘员工" :value="detail.impact?.activeReservationCount||0"/></el-col>
              <el-col :span="6"><el-statistic title="企业员工" :value="detail.impact?.employeeCount||0"/></el-col>
            </el-row>
            <div class="section-title">受影响班次</div>
            <el-tag v-for="s in detail.impact?.schedules||[]" :key="s.id" size="small" style="margin:2px">{{ s.name }} {{ s.departureTime }}</el-tag>
            <div class="section-title" style="margin-top:8px">车辆座位 / 司机工时</div>
            <el-table :data="detail.impact?.vehicles||[]" size="small" border max-height="160">
              <el-table-column prop="plate" label="车辆" width="120"/>
              <el-table-column prop="seats" label="座位" width="80"/>
              <el-table-column prop="status" label="状态"/>
            </el-table>
            <div style="margin-top:10px" v-if="isOperator">
              <el-button type="primary" :disabled="detail.status==='effective'" @click="genOptions">生成候选线路</el-button>
            </div>
          </el-tab-pane>

          <!-- 候选与反馈 -->
          <el-tab-pane label="候选线路 / 意见" name="options">
            <el-timeline>
              <el-timeline-item v-for="o in detail.options" :key="o.id" :type="o.chosen?'success':'primary'">
                <b>{{ o.name }}</b>
                <el-tag v-if="o.chosen" size="small" type="success">已选定</el-tag>
                <el-tag size="small" :type="o.crossDistrict?'warning':'info'">{{ o.crossDistrict?'跨区接驳 +¥'+o.addedFeePerMonth+'/月':'直达' }}</el-tag>
                <el-tag size="small">到厂{{ o.estimatedArriveMinutes>=0?'+':'' }}{{ o.estimatedArriveMinutes }}分</el-tag>
                <el-table :data="o.stations" size="small" border style="margin-top:6px">
                  <el-table-column prop="name" label="站点" width="150"/>
                  <el-table-column label="步行距离" width="100">
                    <template #default="{row}">约 {{ row.walkMeters }} 米</template>
                  </el-table-column>
                  <el-table-column prop="arriveTime" label="预计到厂" width="90"/>
                  <el-table-column prop="transferNote" label="班次衔接/跨区"/>
                </el-table>
              </el-timeline-item>
            </el-timeline>

            <div class="section-title">员工代表反馈</div>
            <el-table :data="detail.feedbacks||[]" size="small" border>
              <el-table-column label="代表" width="100">
                <template #default="{row}">{{ row.employee?.realName }}</template>
              </el-table-column>
              <el-table-column label="意见" width="100">
                <template #default="{row}">
                  <el-tag size="small" :type="row.verdict==='approved'?'success':row.verdict==='rejected'?'danger':'warning'">
                    {{ row.verdict==='approved'?'赞成':row.verdict==='rejected'?'反对':'建议调整' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="stationName" label="站点" width="100"/>
              <el-table-column label="步行/到厂" width="120">
                <template #default="{row}">{{ row.walkMeters }}米 / {{ row.arriveTime||'—' }}</template>
              </el-table-column>
              <el-table-column prop="comment" label="意见内容" min-width="180" show-overflow-tooltip/>
            </el-table>

            <div v-if="isRep && ['consulting','adjusted'].includes(detail.status)" style="margin-top:10px">
              <el-select v-model="fb.optionId" placeholder="针对候选" style="width:260px;margin-right:8px">
                <el-option v-for="o in detail.options" :key="o.id" :label="o.name" :value="o.id"/>
              </el-select>
              <el-select v-model="fb.verdict" style="width:120px;margin-right:8px">
                <el-option label="赞成" value="approved"/>
                <el-option label="建议调整" value="change_request"/>
                <el-option label="反对" value="rejected"/>
              </el-select>
              <el-input v-model="fb.comment" placeholder="按站点/班次/步行距离/到厂时间说明" style="width:300px;margin-right:8px"/>
              <el-button type="primary" @click="submitFb">提交代表意见</el-button>
            </div>
            <div v-if="isHr" style="margin-top:10px">
              <el-input v-model="hrNote" type="textarea" :rows="2" placeholder="HR 汇总企业侧生产排班要求"/>
              <el-button style="margin-top:6px" @click="submitHr">提交企业排班要求</el-button>
            </div>
          </el-tab-pane>

          <!-- 形成正式方案：费用先、运力后 -->
          <el-tab-pane label="费用/运力锁定" name="lock" v-if="isOperator">
            <el-alert type="warning" :closable="false" style="margin-bottom:10px"
              title="必须先确认企业/园区费用承担与班次安排，再锁定座位与车辆；存在费用争议或运力不足时不能形成正式方案。"/>
            <el-form label-width="130px">
              <el-form-item label="选定候选">
                <el-select v-model="adj.optionId" style="width:100%">
                  <el-option v-for="o in detail.options" :key="o.id" :label="o.name" :value="o.id"/>
                </el-select>
              </el-form-item>
              <el-form-item label="企业承担比例%">
                <el-input-number v-model="adj.companyShareRatio" :min="0" :max="100"/>
                <span class="muted" style="margin-left:8px">园区补贴 {{ 100-(adj.companyShareRatio||0) }}%</span>
              </el-form-item>
              <el-form-item label="班次安排"><el-input v-model="adj.scheduleArrangement"/></el-form-item>
              <el-form-item label="费用争议说明">
                <el-input v-model="adj.disputeNote" placeholder="有争议时填写，将阻止锁定"/>
              </el-form-item>
              <el-form-item label="生效/过渡截止">
                <el-date-picker v-model="adj.effectDate" type="date" value-format="YYYY-MM-DD"/>
                <el-date-picker v-model="adj.transitionEnd" type="date" value-format="YYYY-MM-DD" style="margin-left:8px"/>
              </el-form-item>
            </el-form>
            <el-button type="primary" @click="submitAdj">确认费用并锁定运力</el-button>
          </el-tab-pane>

          <!-- 双确认与生效 -->
          <el-tab-pane label="确认 / 生效" name="confirm">
            <el-descriptions :column="2" border size="small" style="margin-bottom:10px">
              <el-descriptions-item label="企业负责人">
                {{ detail.companyConfirmedAt ? '已确认 ' + new Date(detail.companyConfirmedAt).toLocaleString('zh-CN') : '待确认' }}
              </el-descriptions-item>
              <el-descriptions-item label="员工代表">{{ ['company_confirmed','confirmed','effective'].includes(detail.status)?'待代表/已确认':'等待企业先确认' }}</el-descriptions-item>
            </el-descriptions>
            <el-button v-if="isHr && detail.status==='adjusted'" type="primary" @click="confirmCo">企业负责人确认</el-button>
            <el-button v-if="isRep && detail.status==='company_confirmed'" type="success" @click="confirmEmp">员工代表确认</el-button>
            <el-button v-if="isOperator && detail.status==='confirmed'" type="danger" @click="effectuate">执行生效（落地新线/停用旧站）</el-button>
            <el-button v-if="isOperator && detail.status!=='effective'" link type="warning" @click="cancelRlo">撤销重排（解冻）</el-button>

            <div class="section-title" style="margin-top:12px">过渡期在乘员工选择（改站/改班次/退订/继续旧站）</div>
            <el-table :data="detail.choices||[]" size="small" border>
              <el-table-column label="预约#" width="80">
                <template #default="{row}">{{ row.reservationId }}</template>
              </el-table-column>
              <el-table-column label="选择" width="120">
                <template #default="{row}">{{ choiceName(row.choice) }}</template>
              </el-table-column>
              <el-table-column prop="decidedAt" label="决定时间" min-width="160">
                <template #default="{row}">{{ row.decidedAt ? new Date(row.decidedAt).toLocaleString('zh-CN') : '—' }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const role = localStorage.getItem('role') || '';
const realName = localStorage.getItem('realName') || '';
const isOperator = ['operator', 'admin', 'dispatcher'].includes(role);
const isHr = role === 'hr';
const isEmployee = role === 'employee';

const rows = ref<any[]>([]);
const companies = ref<any[]>([]);
const lines = ref<any[]>([]);
const filter = ref('');
const createDlg = ref(false);
const detailDlg = ref(false);
const detail = ref<any>({});
const tab = ref('impact');
const form = ref<any>({ companyId: null, oldLineId: null, newSiteName: '', newSiteAddress: '', effectDate: '' });
const fb = ref<any>({ optionId: null, verdict: 'change_request', comment: '', stationName: '', walkMeters: 0, arriveTime: '' });
const hrNote = ref('');
const adj = ref<any>({ optionId: null, companyShareRatio: 80, scheduleArrangement: '班次时刻平移，保留早晚高峰接驳', disputeNote: '', effectDate: '', transitionEnd: '' });

const isRep = computed(() => {
  const c = companies.value.find(x => x.name === detail.value.companyName || x.id === detail.value.companyId);
  return isEmployee && c?.representative === realName;
});

function rlStatus(s: string) {
  return ({
    draft: { label: '冻结/盘点', type: 'info' }, consulting: { label: '意见征集', type: 'warning' },
    adjusted: { label: '待双确认', type: 'warning' }, company_confirmed: { label: '企业已确认', type: 'primary' },
    confirmed: { label: '双确认通过', type: 'success' }, effective: { label: '已生效', type: 'success' },
    cancelled: { label: '已撤销', type: 'danger' },
  } as any)[s] || { label: s, type: 'info' };
}
function companyName(id: number) { return companies.value.find(c => c.id === id)?.name || `企业#${id}`; }
function choiceName(c: string) {
  return ({ keep_old: '继续旧站点（过渡）', change_station: '改站', change_schedule: '改班次', refund: '退订' } as any)[c] || c;
}

async function load() {
  const [{ data: rl }, { data: cs }, { data: ls }] = await Promise.all([
    api.get('/line-relocations', { params: filter.value ? {} : {} }),
    api.get('/companies'), api.get('/lines'),
  ]);
  rows.value = filter.value ? rl.filter((r: any) => r.status === filter.value) : rl;
  companies.value = cs; lines.value = ls;
}
function openCreate() {
  form.value = { companyId: companies.value[0]?.id, oldLineId: lines.value[0]?.id, newSiteName: '', newSiteAddress: '', effectDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) };
  createDlg.value = true;
}
async function submitCreate() {
  const { data } = await api.post('/line-relocations', form.value);
  ElMessage.success(`已冻结原线新预约并完成盘点：${data.rlNo}`);
  createDlg.value = false; load(); openDetailById(data.id);
}
async function openDetail(row: any) { return openDetailById(row.id); }
async function openDetailById(id: number) {
  const { data } = await api.get(`/line-relocations/${id}`);
  detail.value = data;
  adj.value.optionId = data.chosenOptionId || data.options?.[0]?.id;
  adj.value.effectDate = data.effectDate; adj.value.transitionEnd = data.transitionEnd;
  hrNote.value = data.hrScheduleNote || '';
  tab.value = data.options?.length ? 'options' : 'impact';
  detailDlg.value = true;
}
async function genOptions() {
  await api.post(`/line-relocations/${detail.value.id}/options`);
  ElMessage.success('候选线路已生成并通知 HR/员工代表');
  openDetailById(detail.value.id); load();
}
async function submitFb() {
  await api.post(`/line-relocations/${detail.value.id}/feedback`, fb.value);
  ElMessage.success('代表意见已提交');
  openDetailById(detail.value.id);
}
async function submitHr() {
  await api.post(`/line-relocations/${detail.value.id}/hr-summary`, { note: hrNote.value });
  ElMessage.success('企业排班要求已汇总');
  openDetailById(detail.value.id);
}
async function submitAdj() {
  await api.post(`/line-relocations/${detail.value.id}/adjust`, {
    optionId: adj.value.optionId,
    costPlan: {
      companyShareRatio: adj.value.companyShareRatio,
      parkSubsidyRatio: 100 - adj.value.companyShareRatio,
      scheduleArrangement: adj.value.scheduleArrangement, disputeNote: adj.value.disputeNote,
    },
    effectDate: adj.value.effectDate, transitionEnd: adj.value.transitionEnd,
  });
  ElMessage.success('费用已确认、座位车辆已锁定，等待双确认');
  openDetailById(detail.value.id); load();
}
async function confirmCo() {
  await api.post(`/line-relocations/${detail.value.id}/confirm-company`);
  ElMessage.success('企业负责人已确认');
  openDetailById(detail.value.id); load();
}
async function confirmEmp() {
  await api.post(`/line-relocations/${detail.value.id}/confirm-employee`);
  ElMessage.success('员工代表已确认，双确认通过');
  openDetailById(detail.value.id); load();
}
async function effectuate() {
  const { data } = await api.post(`/line-relocations/${detail.value.id}/effectuate`);
  ElMessage.success(`新线路「${data.newLine?.name}」已生效，旧站点已标记停用`);
  openDetailById(detail.value.id); load();
}
async function cancelRlo() {
  await api.post(`/line-relocations/${detail.value.id}/cancel`);
  ElMessage.success('已撤销并解冻原线路');
  detailDlg.value = false; load();
}
onMounted(load);
</script>
