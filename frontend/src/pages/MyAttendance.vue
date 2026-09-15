<template>
  <div>
    <h2 class="page-title">我的考勤 · 晚点证明 · 申诉</h2>

    <el-tabs v-model="tab" class="card-soft" style="background:#fff;border-radius:10px;padding:6px 16px 16px">
      <!-- ============ 考勤档案 ============ -->
      <el-tab-pane label="到厂考勤档案" name="attendance">
        <el-table :data="records" size="small">
          <el-table-column prop="date" label="日期" width="110"/>
          <el-table-column label="计划/实际到厂" min-width="200">
            <template #default="{row}">
              {{ fmt(row.scheduledArrive) }} → <b>{{ fmt(row.actualArrive) || '—' }}</b>
            </template>
          </el-table-column>
          <el-table-column label="迟到" width="80">
            <template #default="{row}">{{ row.lateMinutes ? row.lateMinutes + '分' : '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
          </el-table-column>
          <el-table-column label="补车费" width="90">
            <template #default="{row}">¥{{ row.makeupFee }}</template>
          </el-table-column>
          <el-table-column label="豁免依据" min-width="200" show-overflow-tooltip>
            <template #default="{row}">
              <el-button v-if="row.certificateId" link type="success" size="small" @click="openCert(row.certificateId)">
                查看晚点证明
              </el-button>
              <span v-else class="muted">{{ row.exemptReason || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{row}">
              <el-button v-if="row.status==='late' || row.status==='no_show'" link type="primary" size="small"
                         @click="openAppeal(row)">申诉</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无考勤记录</template>
        </el-table>
      </el-tab-pane>

      <!-- ============ 我的晚点证明（与 HR 端同一晚点原因） ============ -->
      <el-tab-pane label="晚点考勤豁免证明" name="cert">
        <el-alert type="success" :closable="false" style="margin-bottom:12px"
          title="班车因道路事故等非个人原因晚点时，平台取证生成晚点证明；HR 批量确认后您的考勤自动豁免，无需再找司机/HR 截图传递。"/>
        <el-table :data="certs" size="small">
          <el-table-column prop="certNo" label="证明编号" width="185"/>
          <el-table-column prop="date" label="日期" width="105"/>
          <el-table-column label="晚点原因（与 HR 端一致）" min-width="260">
            <template #default="{row}">
              <el-tag size="small" type="warning" style="margin-right:6px">{{ row.reasonName }}</el-tag>
              <span>{{ row.reasonText }}</span>
            </template>
          </el-table-column>
          <el-table-column label="事发地点" width="150" show-overflow-tooltip>
            <template #default="{row}">{{ row.incidentLocation || '—' }}</template>
          </el-table-column>
          <el-table-column label="晚点" width="70">
            <template #default="{row}">{{ row.delayMinutes }}分</template>
          </el-table-column>
          <el-table-column label="我的处理结果" width="150">
            <template #default="{row}">
              <el-tag v-if="row.item.status==='exempt'" size="small" type="success">已豁免并回写考勤</el-tag>
              <el-tag v-else-if="row.item.status==='rejected'" size="small" type="danger">未获豁免</el-tag>
              <el-tag v-else size="small" type="warning">待 HR 确认</el-tag>
              <div class="muted" v-if="row.item.handleNote">{{ row.item.handleNote }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openCert(row.id)">证明详情</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无晚点证明（班车正常或本次晚点未触发证明）</template>
        </el-table>
      </el-tab-pane>

      <!-- ============ 我的申诉 ============ -->
      <el-tab-pane label="我的申诉" name="appeal">
        <el-timeline>
          <el-timeline-item v-for="a in appeals" :key="a.id"
            :timestamp="new Date(a.createdAt).toLocaleString('zh-CN')">
            <el-tag size="small" :type="st(a.status).type">{{ st(a.status).label }}</el-tag>
            <div style="margin:6px 0">{{ a.reason }}</div>
            <div v-if="a.reply" class="muted">处理回复：{{ a.reply }}</div>
            <el-tag v-if="a.grantExemption" size="small" type="success" style="margin-top:4px">已豁免考勤</el-tag>
            <el-tag v-if="a.refundFee" size="small" type="success" style="margin-left:4px">已退补车费</el-tag>
          </el-timeline-item>
          <el-empty v-if="!appeals.length" description="还没有申诉" :image-size="60"/>
        </el-timeline>
      </el-tab-pane>
    </el-tabs>

    <!-- 申诉弹窗 -->
    <el-dialog v-model="dlg" title="发起迟到/未到申诉" width="500px">
      <el-form label-width="86px">
        <el-form-item label="申诉对象">
          <el-input :model-value="target ? `${target.date} · ${st(target.status).label} · ¥${target.makeupFee}` : ''" disabled/>
        </el-form-item>
        <el-form-item label="申诉理由">
          <el-input v-model="form.reason" type="textarea" :rows="3"
            placeholder="如：班车因滨河路交通事故晚点30分钟，非个人原因"/>
        </el-form-item>
        <el-form-item label="佐证材料">
          <el-input v-model="form.evidence" placeholder="截图/证人/广播通告等（文字描述）"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="submit">提交申诉</el-button>
      </template>
    </el-dialog>

    <!-- 晚点证明详情弹窗 -->
    <el-dialog v-model="certDlg" :title="`晚点证明 ${cert.certNo||''}`" width="760px">
      <div v-if="cert.id">
        <el-descriptions :column="2" border size="small" style="margin-bottom:10px">
          <el-descriptions-item label="证明编号">{{ cert.certNo }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ cert.date }}</el-descriptions-item>
          <el-descriptions-item label="线路/班次">{{ cert.impactSummary?.lineName }} · {{ cert.impactSummary?.scheduleName }}</el-descriptions-item>
          <el-descriptions-item label="晚点时长">{{ cert.delayMinutes }} 分钟</el-descriptions-item>
          <el-descriptions-item label="影响企业与班次" :span="2">
            <el-tag v-for="c in (cert.impactSummary?.companies||[])" :key="c.companyId" size="small" effect="plain" style="margin:2px">
              {{ c.companyName }} · {{ c.scheduleName }} · {{ c.count }}人
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-alert type="warning" :closable="false" style="margin-bottom:10px">
          <template #title><b>晚点原因：</b>{{ cert.reasonText }}</template>
        </el-alert>

        <div class="section-title">平台取证依据（GPS / 站点签到 / 到厂时间 / 企业规则）</div>
        <div class="json-box" style="margin-bottom:10px">{{ cert.gpsSummary?.trackSummary }}</div>
        <el-table :data="cert.evidenceRows" size="small" border>
          <el-table-column label="证据来源" width="130">
            <template #default="{row}"><el-tag size="small" :type="row.t">{{ row.k }}</el-tag></template>
          </el-table-column>
          <el-table-column label="取证内容" min-width="300">
            <template #default="{row}">{{ row.v }}</template>
          </el-table-column>
        </el-table>

        <el-alert style="margin-top:10px" :closable="false"
          :type="cert.item?.status==='exempt'?'success':cert.item?.status==='rejected'?'error':'warning'"
          :title="`我的考勤：${cert.item?.status==='exempt'?'已按本证明豁免并回写，补车费已取消':cert.item?.status==='rejected'?'本证明未覆盖/未获豁免，可发起申诉':'等待企业 HR 批量确认'}`"/>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st } from '../api';

const tab = ref('attendance');
const records = ref<any[]>([]);
const appeals = ref<any[]>([]);
const certs = ref<any[]>([]);
const dlg = ref(false);
const target = ref<any>(null);
const form = ref({ reason: '', evidence: '' });

const certDlg = ref(false);
const cert = ref<any>({});

function fmt(t?: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''; }

async function load() {
  const [{ data: r }, { data: a }, { data: c }] = await Promise.all([
    api.get('/my/attendance'), api.get('/my/appeals'), api.get('/my/late-certificates'),
  ]);
  records.value = r; appeals.value = a; certs.value = c;
}
function openAppeal(row: any) { target.value = row; form.value = { reason: '', evidence: '' }; dlg.value = true; }
async function submit() {
  if (!form.value.reason) return ElMessage.warning('请填写申诉理由');
  await api.post('/appeals', { attendanceId: target.value.id, ...form.value });
  ElMessage.success('申诉已提交，将由企业 HR / 园区运营处理');
  dlg.value = false; load();
}
async function openCert(id: number) {
  const { data } = await api.get(`/late-certificates/${id}`);
  const myItem = (data.items || []).find((i: any) => i.employeeId === Number(localStorage.getItem('uid') || 0));
  const myCompany = (data.evidence?.rules || []).find((x: any) => x.companyId === myItem?.companyId);
  data.item = myItem || (data.items || [])[0];
  data.evidenceRows = [
    { k: 'GPS 车辆定位', t: 'primary', v: data.evidence?.gps?.trackSummary },
    { k: '站点扫码签到', t: 'success', v: `共 ${data.evidence?.stationCheckins?.length || 0} 人完成扫码签到，本人在 ${data.item?.stationName || '—'} 签到` },
    { k: '到厂时间', t: 'warning', v: `计划到厂 ${fmt(data.plannedArrive)}，GPS 实际到厂 ${fmt(data.gpsArriveAt)}，晚点 ${data.delayMinutes} 分钟` },
    { k: '企业考勤规则', t: 'info', v: myCompany ? `宽限 ${myCompany.graceMinutes} 分钟、上班 ${myCompany.shiftStart}、基础补车费 ¥${myCompany.lateFeeBase}，本企业超宽限 ${myCompany.overGraceCount} 人` : '按企业规则自动判定' },
  ];
  cert.value = data;
  certDlg.value = true;
}
onMounted(load);
</script>
