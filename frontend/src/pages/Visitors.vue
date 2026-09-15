<template>
  <div>
    <h2 class="page-title">临时访客乘车 · 园区门禁联动</h2>
    <el-row :gutter="14">
      <el-col :span="13">
        <el-card class="card-soft" style="margin-bottom:14px">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>访客通行证（{{ date }}）</b>
              <el-button type="primary" size="small" @click="dlg=true">登记访客</el-button>
            </div>
          </template>
          <el-table :data="visitors" size="small">
            <el-table-column prop="visitorName" label="访客" width="110"/>
            <el-table-column prop="hostName" label="接待人" width="90"/>
            <el-table-column prop="visitDate" label="日期" width="105"/>
            <el-table-column label="访客码" min-width="150">
              <template #default="{row}"><span style="font-family:monospace">{{ row.qrCode }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{row}">
                <el-button v-if="row.status==='registered'" link type="primary" size="small" @click="board(row)">访客乘车核验</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="11">
        <el-card class="card-soft" style="margin-bottom:14px" header="门禁扫码（工牌 / 访客码）">
          <el-form label-width="72px">
            <el-form-item label="闸机口">
              <el-select v-model="gate.gateName" style="width:100%">
                <el-option label="园区东门（班车到厂）" value="园区东门"/>
                <el-option label="园区西门" value="园区西门"/>
                <el-option label="访客登记通道" value="访客通道"/>
              </el-select>
            </el-form-item>
            <el-form-item label="方向">
              <el-radio-group v-model="gate.direction">
                <el-radio-button label="in">入园</el-radio-button>
                <el-radio-button label="out">离园</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="凭证">
              <el-input v-model="gate.code" placeholder="员工工号（HX1001）或访客码（V-XXXX）"/>
            </el-form-item>
            <el-button type="primary" @click="scan">刷卡/扫码放行</el-button>
          </el-form>
        </el-card>

        <el-card class="card-soft" header="最近门禁记录">
          <el-table :data="logs" size="small" max-height="300">
            <el-table-column prop="createdAt" label="时间" width="160">
              <template #default="{row}">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="gateName" label="闸机" width="100"/>
            <el-table-column prop="personName" label="人员" width="100"/>
            <el-table-column label="类型" width="70">
              <template #default="{row}">
                <el-tag size="small" :type="row.personType==='visitor'?'warning':'primary'">
                  {{ row.personType === 'visitor' ? '访客' : '员工' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="80">
              <template #default="{row}">
                <el-tag size="small" :type="row.result==='allow'?'success':'danger'">
                  {{ row.result === 'allow' ? '放行' : '拒绝' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="note" label="备注" min-width="120" show-overflow-tooltip/>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dlg" title="登记临时访客" width="460px">
      <el-form label-width="90px">
        <el-form-item label="访客姓名"><el-input v-model="form.visitorName"/></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone"/></el-form-item>
        <el-form-item label="接待企业">
          <el-select v-model="form.hostCompanyId" style="width:100%">
            <el-option v-for="c in companies" :key="c.id" :label="c.name" :value="c.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="接待人"><el-input v-model="form.hostName" placeholder="企业内对接人姓名"/></el-form-item>
        <el-form-item label="到访日期">
          <el-date-picker v-model="form.visitDate" type="date" value-format="YYYY-MM-DD"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" @click="save">生成访客乘车码</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api, { st, today } from '../api';

const date = today();
const visitors = ref<any[]>([]);
const logs = ref<any[]>([]);
const companies = ref<any[]>([]);
const dlg = ref(false);
const form = ref<any>({ visitorName: '', phone: '', hostCompanyId: null, hostName: '', visitDate: date });
const gate = ref<any>({ gateName: '园区东门', direction: 'in', code: '' });

async function load() {
  const [{ data: v }, { data: l }, { data: c }] = await Promise.all([
    api.get('/visitors', { params: { date } }),
    api.get('/gate-logs'),
    api.get('/companies'),
  ]);
  visitors.value = v; logs.value = l; companies.value = c;
  if (!form.value.hostCompanyId && c[0]) form.value.hostCompanyId = c[0].id;
}
async function save() {
  if (!form.value.visitorName || !form.value.hostName) return ElMessage.warning('访客姓名和接待人必填');
  await api.post('/visitors', form.value);
  ElMessage.success('访客码已生成');
  dlg.value = false;
  form.value = { visitorName: '', phone: '', hostCompanyId: companies.value[0]?.id, hostName: '', visitDate: date };
  load();
}
async function board(row: any) {
  await api.post(`/visitors/board/${row.qrCode}`);
  ElMessage.success('访客已核验乘车');
  load();
}
async function scan() {
  if (!gate.value.code) return ElMessage.warning('请输入凭证');
  const { data } = await api.post('/gate/scan', gate.value);
  ElMessage({ type: data.result === 'allow' ? 'success' : 'error', message: data.result === 'allow' ? `${data.personName} 已${data.direction === 'in' ? '入园' : '离园'}` : `拒绝：${data.note}` });
  gate.value.code = '';
  load();
}
onMounted(load);
</script>
