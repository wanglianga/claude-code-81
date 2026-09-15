<template>
  <div>
    <h2 class="page-title">晚点考勤豁免证明 · 取证 / 批量确认 / 回写</h2>

    <el-card class="card-soft" style="margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <el-radio-group v-model="filter" @change="load">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="pending_hr">待确认</el-radio-button>
          <el-radio-button label="partially_confirmed">部分处理</el-radio-button>
          <el-radio-button label="confirmed">已确认</el-radio-button>
          <el-radio-button label="rejected">已驳回</el-radio-button>
        </el-radio-group>
        <div style="flex:1"></div>
        <el-tag type="info">同一证明的晚点原因，员工端与 HR 端完全一致</el-tag>
        <el-button v-if="canGenerate" type="primary" @click="openGen">平台取证生成证明</el-button>
      </div>
    </el-card>

    <el-card class="card-soft">
      <el-table :data="rows" size="small">
        <el-table-column prop="certNo" label="证明编号" width="180"/>
        <el-table-column prop="date" label="日期" width="100"/>
        <el-table-column label="线路 / 班次" min-width="170">
          <template #default="{row}">
            <div>{{ lineName(row) }}</div>
            <div class="muted">{{ schedName(row) }} · {{ reasonLabel(row.reasonType) }} · 晚点{{ row.delayMinutes }}分</div>
          </template>
        </el-table-column>
        <el-table-column label="影响企业 / 班次" min-width="200">
          <template #default="{row}">
            <el-tag v-for="c in (row.impactSummary?.companies||[])" :key="c.companyId"
                    size="small" effect="plain" style="margin:2px">
              {{ c.companyName }} · {{ c.scheduleName }} · {{ c.count }}人
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reasonText" label="晚点原因（两端同源）" min-width="240" show-overflow-tooltip/>
        <el-table-column label="处理进度" width="150">
          <template #default="{row}">
            <div>共 {{ row.affectedTotal }} 人</div>
            <div class="muted">待{{ row.pendingCount }} / 豁免{{ row.exemptCount }} / 驳回{{ row.rejectedCount }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{row}">
            <el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看/处理</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无晚点证明</template>
      </el-table>
    </el-card>

    <!-- ============ 取证生成 ============ -->
    <el-dialog v-model="genDlg" title="平台取证：生成晚点考勤豁免证明" width="640px">
      <el-alert type="info" :closable="false" style="margin-bottom:12px"
        title="平台将汇总 GPS 到厂/离场时间、站点扫码签到、到厂时间与各企业考勤规则自动取证；生成后推送涉事企业 HR 批量确认。"/>
      <el-form label-width="110px">
        <el-form-item label="晚点车次">
          <div style="display:flex;gap:8px;width:100%">
            <el-date-picker v-model="genDate" type="date" value-format="YYYY-MM-DD" style="width:160px"/>
            <el-button @click="loadArrivedTrips">载入已到厂车次</el-button>
            <el-select v-model="genForm.tripId" placeholder="选择车次" style="flex:1">
              <el-option v-for="t in arrivedTrips" :key="t.id"
                :label="`#${t.id} ${t.schedule?.name} ${t.date} 晚点${t.delayMinutes}分 · ${t.vehicle?.plate||''} · ${t.driver?.realName||''}`"
                :value="t.id"/>
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="晚点原因">
          <el-select v-model="genForm.reasonType" style="width:100%">
            <el-option v-for="(label,k) in CERT_REASONS" :key="k" :label="label" :value="k"/>
          </el-select>
        </el-form-item>
        <el-form-item label="事发地点">
          <el-input v-model="genForm.incidentLocation" placeholder="如：科技大桥上匝道（滨河路方向）"/>
        </el-form-item>
        <el-form-item label="事发时间">
          <el-date-picker v-model="genForm.incidentAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss"
                          placeholder="缺省取 GPS 途中时点" style="width:100%"/>
        </el-form-item>
        <el-form-item label="统一晚点原因">
          <el-input v-model="genForm.reasonText" type="textarea" :rows="2"
            placeholder="留空则按原因+地点+晚点分钟自动生成；该文案员工端与 HR 端共用"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genDlg=false">取消</el-button>
        <el-button type="primary" :loading="genLoading" @click="submitGen">取证并生成</el-button>
      </template>
    </el-dialog>

    <!-- ============ 证明详情 / 批量处理 ============ -->
    <el-dialog v-model="detailDlg" :title="`晚点证明 ${detail.certNo||''}`" width="920px" top="5vh">
      <div v-if="detail.id">
        <el-descriptions :column="3" border size="small" style="margin-bottom:10px">
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="st(detail.status).type">{{ st(detail.status).label }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="日期/班次">{{ detail.date }} · {{ detail.scheduleName }}（{{ detail.lineName }}）</el-descriptions-item>
          <el-descriptions-item label="晚点">{{ detail.delayMinutes }} 分钟</el-descriptions-item>
          <el-descriptions-item label="车辆/司机">{{ detail.vehiclePlate||'—' }} / {{ detail.driverName||'—' }}</el-descriptions-item>
          <el-descriptions-item label="事发地点/时间">
            {{ detail.incidentLocation||'—' }} · {{ detail.incidentAt ? new Date(detail.incidentAt).toLocaleString('zh-CN') : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="生成方式">{{ detail.systemGenerated ? '平台自动取证' : '人工发起' }}</el-descriptions-item>
        </el-descriptions>

        <el-alert type="warning" :closable="false" style="margin-bottom:10px">
          <template #title>
            <b>统一晚点原因（员工端 / HR 端同一份）：</b>{{ detail.reasonText }}
          </template>
        </el-alert>

        <el-tabs v-model="tab">
          <!-- 取证 -->
          <el-tab-pane label="多源取证" name="evidence">
            <div class="section-title">① GPS 车辆轨迹</div>
            <div class="json-box">{{ detail.evidence?.gps?.trackSummary }}</div>
            <div class="muted" style="margin:6px 0 12px">
              计划到厂 {{ fmtTime(detail.plannedArrive) }} ｜ GPS 离场 {{ fmtTime(detail.gpsDepartAt) }}
              ｜ GPS 到厂 {{ fmtTime(detail.gpsArriveAt) }}
            </div>
            <div class="section-title">② 站点扫码签到（{{ detail.evidence?.stationCheckins?.length||0 }} 人）</div>
            <el-table :data="detail.evidence?.stationCheckins||[]" size="small" border style="margin-bottom:12px">
              <el-table-column prop="employeeName" label="员工" width="100"/>
              <el-table-column prop="employeeNo" label="工号" width="100"/>
              <el-table-column prop="station" label="上车站点" width="120"/>
              <el-table-column label="签到时间" width="160">
                <template #default="{row}">{{ row.boardedAt ? new Date(row.boardedAt).toLocaleString('zh-CN') : '—' }}</template>
              </el-table-column>
              <el-table-column label="签到类型" width="100">
                <template #default="{row}">
                  <el-tag size="small" :type="row.status==='late'?'warning':'success'">
                    {{ row.status==='late'?'迟到上车':row.status==='changed'?'临时改站':'正常签到' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            <div class="section-title">③ 到厂时间 &amp; ④ 企业考勤规则</div>
            <el-table :data="detail.evidence?.rules||[]" size="small" border>
              <el-table-column prop="companyName" label="企业" width="160"/>
              <el-table-column label="上班时间" width="90">
                <template #default="{row}">{{ row.shiftStart }}</template>
              </el-table-column>
              <el-table-column label="宽限(分)" width="90">
                <template #default="{row}">{{ row.graceMinutes }}</template>
              </el-table-column>
              <el-table-column label="基础补车费" width="100">
                <template #default="{row}">¥{{ row.lateFeeBase }}</template>
              </el-table-column>
              <el-table-column label="受影响" width="80">
                <template #default="{row}">{{ row.affectedCount }} 人</template>
              </el-table-column>
              <el-table-column label="超宽限（原应计迟到）">
                <template #default="{row}">{{ row.overGraceCount }} 人</template>
              </el-table-column>
            </el-table>
            <div v-if="detail.evidence?.event" style="margin-top:10px">
              <el-tag size="small" type="warning">关联途中事件 #{{ detail.evidence.event.id }}（{{ detail.evidence.event.status }}）</el-tag>
              <span style="margin-left:8px">{{ detail.evidence.event.description }}</span>
            </div>
          </el-tab-pane>

          <!-- 影响企业与班次 + 批量处理 -->
          <el-tab-pane :label="`影响企业/班次（${detail.items?.length||0}人）`" name="impact">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
              <el-select v-model="scope.companyId" :disabled="role==='hr'" placeholder="企业" style="width:200px">
                <el-option v-for="c in companyOptions" :key="c.companyId" :label="`${c.companyName}（${c.count}人）`" :value="c.companyId"/>
              </el-select>
              <el-select v-model="scope.scheduleId" placeholder="班次" clearable style="width:180px">
                <el-option v-for="s in scopeScheduleOptions" :key="s" :label="detail.impactSummary?.companies?.find((x:any)=>x.scheduleId===s)?.scheduleName||('班次#'+s)" :value="s"/>
              </el-select>
              <el-tag type="danger" effect="plain">本批次待处理 {{ scopedPending.length }} 人</el-tag>
              <div style="flex:1"></div>
              <el-button v-if="canHandle" type="success" :disabled="!scopedPending.length" @click="openBatch('confirm')">
                批量确认豁免并回写考勤
              </el-button>
              <el-button v-if="canHandle" type="danger" plain :disabled="!scopedPending.length" @click="openBatch('reject')">
                批量驳回
              </el-button>
            </div>
            <el-table :data="detail.items||[]" size="small" border max-height="420">
              <el-table-column label="企业" width="150">
                <template #default="{row}">{{ row.companyName }}</template>
              </el-table-column>
              <el-table-column label="员工" min-width="140">
                <template #default="{row}">
                  {{ row.employee?.realName }} <span class="muted">{{ row.employee?.employeeNo }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="scheduleName" label="班次" width="110"/>
              <el-table-column prop="stationName" label="签到站点" width="100"/>
              <el-table-column label="晚点/宽限" width="90">
                <template #default="{row}">{{ row.lateMinutes }} / {{ row.graceMinutes }}分</template>
              </el-table-column>
              <el-table-column label="原补车费" width="80">
                <template #default="{row}">¥{{ row.originalFee }}</template>
              </el-table-column>
              <el-table-column label="回写状态" width="150">
                <template #default="{row}">
                  <el-tag size="small" :type="row.status==='exempt'?'success':row.status==='rejected'?'danger':'warning'">
                    {{ row.status==='exempt'?'已豁免回写':row.status==='rejected'?'已驳回':'待处理' }}
                  </el-tag>
                  <div class="muted" v-if="row.handlerName">{{ row.handlerName }} · {{ row.handledAt ? new Date(row.handledAt).toLocaleDateString() : '' }}</div>
                </template>
              </el-table-column>
              <el-table-column prop="handleNote" label="处理备注" min-width="160" show-overflow-tooltip/>
            </el-table>
          </el-tab-pane>

          <!-- 线路复盘 -->
          <el-tab-pane label="线路复盘" name="review">
            <el-descriptions :column="2" border size="small" style="margin-bottom:10px">
              <el-descriptions-item label="复盘状态">
                <el-tag size="small" :type="detail.review?.status==='reviewed'?'success':'warning'">
                  {{ detail.review?.status==='reviewed'?'已复盘':'待复盘' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="晚点/豁免人数">
                {{ detail.review?.delayMinutes }}分 / {{ detail.review?.exemptedCount }}人
              </el-descriptions-item>
              <el-descriptions-item label="根因（与证明同源）" :span="2">{{ detail.review?.rootCause }}</el-descriptions-item>
            </el-descriptions>
            <el-input v-model="reviewMeasures" type="textarea" :rows="4" :disabled="!canReview"
              placeholder="整改措施：重点路段监控、预留缓冲、提前发车/区间车、账单核销等"/>
            <div v-if="canReview" style="margin-top:8px;text-align:right">
              <el-button type="primary" @click="saveReview">保存复盘措施</el-button>
            </div>
            <el-alert v-else type="info" :closable="false" style="margin-top:8px"
              title="证明全部企业确认后自动生成整改措施，园区运营/调度可补充完善；司机绩效已同步复核（非司机责任撤销晚点扣分）。"/>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>

    <!-- 批量确认/驳回 -->
    <el-dialog v-model="batchDlg" :title="batchAction==='confirm'?'批量确认豁免并回写':'批量驳回'" width="520px" append-to-body>
      <el-alert v-if="batchAction==='confirm'" type="success" :closable="false" style="margin-bottom:10px"
        :title="`将对本企业/班次 ${batchCount} 名待处理员工：考勤状态改豁免、补车费清零并回写考勤系统；司机绩效同步复核、线路复盘联动更新。`"/>
      <el-alert v-else type="error" :closable="false" style="margin-bottom:10px"
        :title="`将驳回 ${batchCount} 名员工的豁免，员工将收到通知并可走申诉流程。`"/>
      <el-input v-model="batchNote" type="textarea" :rows="3"
        :placeholder="batchAction==='confirm' ? '备注（可选），如：与交警事故通报一致，同意统一豁免' : '驳回原因（将通知员工）'"/>
      <template #footer>
        <el-button @click="batchDlg=false">取消</el-button>
        <el-button :type="batchAction==='confirm'?'success':'danger'" :loading="batchLoading" @click="submitBatch">
          确认处理 {{ batchCount }} 人
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st, CERT_REASONS } from '../api';

const role = localStorage.getItem('role') || '';
const canGenerate = ['dispatcher', 'operator', 'admin'].includes(role);
const canHandle = ['hr', 'operator', 'admin'].includes(role);
const canReview = ['operator', 'admin', 'dispatcher'].includes(role);

const filter = ref('pending_hr');
const rows = ref<any[]>([]);

async function load() {
  const { data } = await api.get('/late-certificates', { params: filter.value ? { status: filter.value } : {} });
  rows.value = data;
}
function reasonLabel(t: string) { return CERT_REASONS[t] || t; }
function lineName(row: any) { return row.impactSummary?.lineName || `线路#${row.lineId}`; }
function schedName(row: any) { return row.impactSummary?.scheduleName || `班次#${row.scheduleId}`; }
function fmtTime(t?: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }

// ---------- 生成 ----------
const genDlg = ref(false);
const genLoading = ref(false);
const genDate = ref(new Date().toISOString().slice(0, 10));
const arrivedTrips = ref<any[]>([]);
const genForm = ref<any>({ tripId: null, reasonType: 'accident', incidentLocation: '', incidentAt: '', reasonText: '' });

function openGen() {
  genForm.value = { tripId: null, reasonType: 'accident', incidentLocation: '', incidentAt: '', reasonText: '' };
  genDlg.value = true;
  loadArrivedTrips();
}
async function loadArrivedTrips() {
  if (!genDate.value) return ElMessage.warning('请先选择日期');
  const { data } = await api.get('/trips', { params: { date: genDate.value } });
  arrivedTrips.value = data.filter((t: any) => t.status === 'arrived');
  if (!arrivedTrips.value.length) ElMessage.info('该日期没有已到厂车次');
}
async function submitGen() {
  if (!genForm.value.tripId) return ElMessage.warning('请选择晚点车次');
  genLoading.value = true;
  try {
    const { data } = await api.post('/late-certificates/generate', genForm.value);
    ElMessage.success(`证明 ${data.certNo} 已生成并推送涉事企业 HR`);
    genDlg.value = false;
    filter.value = '';
    load();
    openDetailById(data.id);
  } finally { genLoading.value = false; }
}

// ---------- 详情 ----------
const detailDlg = ref(false);
const detail = ref<any>({});
const tab = ref('evidence');
const scope = ref<any>({ companyId: null, scheduleId: null });
const reviewMeasures = ref('');

const companyOptions = computed(() => detail.value.impactSummary?.companies || []);
const scopeScheduleOptions = computed(() =>
  [...new Set((detail.value.items || []).map((i: any) => i.scheduleId))]);
const scopedItems = computed(() => (detail.value.items || []).filter((i: any) =>
  (!scope.value.companyId || i.companyId === scope.value.companyId)
  && (!scope.value.scheduleId || i.scheduleId === scope.value.scheduleId)));
const scopedPending = computed(() => scopedItems.value.filter((i: any) => i.status === 'pending'));

async function openDetail(row: any) { return openDetailById(row.id); }
async function openDetailById(id: number) {
  const { data } = await api.get(`/late-certificates/${id}`);
  detail.value = data;
  const myCompanyId = role === 'hr' ? Number(localStorage.getItem('companyId') || 0) : null;
  const firstCompany = myCompanyId && companyOptions.value.some((c: any) => c.companyId === myCompanyId)
    ? myCompanyId : (companyOptions.value[0]?.companyId ?? null);
  scope.value = { companyId: firstCompany, scheduleId: null };
  reviewMeasures.value = data.review?.measures || '';
  tab.value = 'evidence';
  detailDlg.value = true;
}

// ---------- 批量处理 ----------
const batchDlg = ref(false);
const batchAction = ref<'confirm' | 'reject'>('confirm');
const batchNote = ref('');
const batchLoading = ref(false);
const batchCount = ref(0);

function openBatch(a: 'confirm' | 'reject') {
  batchAction.value = a;
  batchCount.value = scopedPending.value.length;
  batchNote.value = '';
  batchDlg.value = true;
}
async function submitBatch() {
  if (batchAction.value === 'reject' && !batchNote.value.trim())
    return ElMessage.warning('驳回需填写原因');
  try {
    await ElMessageBox.confirm(
      `确认对 ${batchCount.value} 人执行${batchAction.value === 'confirm' ? '豁免回写' : '驳回'}？结果将直接回写考勤系统并通知本人。`,
      '批量处理确认', { type: 'warning' },
    );
  } catch { return; } // 用户取消
  batchLoading.value = true;
  try {
    const url = `/late-certificates/${detail.value.id}/${batchAction.value === 'confirm' ? 'batch-confirm' : 'batch-reject'}`;
    const { data } = await api.post(url, {
      companyId: scope.value.companyId || undefined,
      scheduleId: scope.value.scheduleId || undefined,
      note: batchNote.value,
    });
    ElMessage.success(`已处理 ${data.processed} 人，证明整体状态：${st(data.status).label}`);
    batchDlg.value = false;
    await openDetailById(detail.value.id);
    load();
  } finally { batchLoading.value = false; }
}

async function saveReview() {
  if (!reviewMeasures.value.trim()) return ElMessage.warning('请填写整改措施');
  await api.post(`/late-certificates/${detail.value.id}/review`, { measures: reviewMeasures.value });
  ElMessage.success('复盘已保存');
  await openDetailById(detail.value.id);
}

onMounted(load);
</script>
