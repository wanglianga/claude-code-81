<template>
  <div>
    <h2 class="page-title">我的考勤与迟到申诉</h2>
    <el-row :gutter="14">
      <el-col :span="14">
        <el-card class="card-soft" header="到厂考勤档案">
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
            <el-table-column label="操作" width="110">
              <template #default="{row}">
                <el-button v-if="row.status==='late' || row.status==='no_show'" link type="primary" size="small"
                           @click="openAppeal(row)">申诉</el-button>
              </template>
            </el-table-column>
            <template #empty>暂无考勤记录</template>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card class="card-soft" header="我的申诉">
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
        </el-card>
      </el-col>
    </el-row>

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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st } from '../api';

const records = ref<any[]>([]);
const appeals = ref<any[]>([]);
const dlg = ref(false);
const target = ref<any>(null);
const form = ref({ reason: '', evidence: '' });

function fmt(t?: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''; }

async function load() {
  const [{ data: r }, { data: a }] = await Promise.all([
    api.get('/my/attendance'), api.get('/my/appeals'),
  ]);
  records.value = r; appeals.value = a;
}
function openAppeal(row: any) { target.value = row; form.value = { reason: '', evidence: '' }; dlg.value = true; }
async function submit() {
  if (!form.value.reason) return ElMessage.warning('请填写申诉理由');
  await api.post('/appeals', { attendanceId: target.value.id, ...form.value });
  ElMessage.success('申诉已提交，将由企业 HR / 园区运营处理');
  dlg.value = false; load();
}
onMounted(load);
</script>
