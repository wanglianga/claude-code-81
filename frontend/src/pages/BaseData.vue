<template>
  <div>
    <h2 class="page-title">基础数据（企业 / 线路站点 / 班次 / 车辆 / 节假日）</h2>
    <el-card class="card-soft">
      <el-tabs v-model="tab">
        <!-- 企业考勤规则 -->
        <el-tab-pane label="企业与考勤规则" name="companies">
          <el-button type="primary" size="small" @click="coDlg=true" style="margin-bottom:10px">新增企业</el-button>
          <el-table :data="companies" size="small">
            <el-table-column prop="name" label="企业" min-width="170"/>
            <el-table-column prop="code" label="编码" width="80"/>
            <el-table-column label="白班/夜班" width="130">
              <template #default="{row}">{{ row.dayShiftStart }} / {{ row.nightShiftStart }}</template>
            </el-table-column>
            <el-table-column prop="lateGraceMinutes" label="迟到宽限(分)" width="120"/>
            <el-table-column prop="lateFeeBase" label="补车费基准(元)" width="130"/>
            <el-table-column prop="representative" label="员工代表" width="100"/>
          </el-table>
        </el-tab-pane>

        <!-- 线路站点 -->
        <el-tab-pane label="线路 / 站点（多企业共线）" name="lines">
          <el-button type="primary" size="small" @click="lineDlg=true" style="margin-bottom:10px">新增线路</el-button>
          <el-collapse>
            <el-collapse-item v-for="l in lines" :key="l.id"
              :title="`${l.name}（${l.code}）· ${l.district} · 共线：${l.companies?.map((c:any)=>c.name).join('、')||'—'}`"
              :name="l.id">
              <el-table :data="l.stationList" size="small" border>
                <el-table-column prop="seq" label="序号" width="60"/>
                <el-table-column prop="name" label="站点" min-width="120"/>
                <el-table-column prop="capacity" label="容量" width="70"/>
                <el-table-column label="状态" width="100">
                  <template #default="{row}">
                    <el-tag size="small" :type="row.status==='normal'?'success':row.status==='construction'?'warning':'danger'">
                      {{ row.status==='normal'?'正常':row.status==='construction'?'施工中':'已关闭' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="200">
                  <template #default="{row}">
                    <el-button link size="small" type="warning" @click="setStation(row,'construction')">标记施工</el-button>
                    <el-button link size="small" type="danger" @click="setStation(row,'closed')">关闭</el-button>
                    <el-button link size="small" type="success" @click="setStation(row,'normal')">恢复</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-button size="small" plain style="margin-top:8px" @click="addStation(l)">+ 加站点</el-button>
            </el-collapse-item>
          </el-collapse>
        </el-tab-pane>

        <!-- 班次 -->
        <el-tab-pane label="班次（含夜班/接驳）" name="schedules">
          <el-button type="primary" size="small" @click="schDlg=true" style="margin-bottom:10px">新增班次</el-button>
          <el-table :data="schedules" size="small">
            <el-table-column label="线路" min-width="180">
              <template #default="{row}">{{ row.line?.name }}</template>
            </el-table-column>
            <el-table-column prop="name" label="班次名" width="130"/>
            <el-table-column label="方向" width="90">
              <template #default="{row}">{{ row.direction==='to_park'?'上班到厂':'下班离园' }}</template>
            </el-table-column>
            <el-table-column prop="departureTime" label="发车时间" width="100"/>
            <el-table-column prop="shiftLabel" label="班别" width="90"/>
          </el-table>
        </el-tab-pane>

        <!-- 车辆 -->
        <el-tab-pane label="车辆" name="vehicles">
          <el-button type="primary" size="small" @click="vDlg=true" style="margin-bottom:10px">新增车辆</el-button>
          <el-table :data="vehicles" size="small">
            <el-table-column prop="plate" label="车牌" width="130"/>
            <el-table-column prop="seats" label="座位" width="70"/>
            <el-table-column label="状态" width="100">
              <template #default="{row}"><el-tag size="small" :type="st(row.status).type">{{ st(row.status).label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="230">
              <template #default="{row}">
                <el-button link size="small" @click="setVehicle(row,'available')">可用</el-button>
                <el-button link size="small" type="warning" @click="setVehicle(row,'maintenance')">保养</el-button>
                <el-button link size="small" type="danger" @click="setVehicle(row,'breakdown')">故障</el-button>
              </template>
            </el-table-column>
            <el-table-column prop="note" label="备注" min-width="120"/>
          </el-table>
        </el-tab-pane>

        <!-- 节假日调休 / 停运 -->
        <el-tab-pane label="节假日调休 / 停运" name="holidays">
          <el-button type="primary" size="small" @click="hDlg=true" style="margin-bottom:10px">新增日历</el-button>
          <el-table :data="holidays" size="small">
            <el-table-column prop="date" label="日期" width="130"/>
            <el-table-column label="类型" width="120">
              <template #default="{row}">
                <el-tag size="small" :type="row.type==='suspended'?'danger':row.type==='holiday'?'info':'warning'">
                  {{ row.type==='suspended'?'停运日':row.type==='holiday'?'节假日':'调休上班' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="160"/>
            <el-table-column prop="note" label="说明" min-width="220"/>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 新增企业 -->
    <el-dialog v-model="coDlg" title="新增企业" width="440px">
      <el-form :model="coForm" label-width="110px">
        <el-form-item label="企业名称"><el-input v-model="coForm.name"/></el-form-item>
        <el-form-item label="编码"><el-input v-model="coForm.code"/></el-form-item>
        <el-form-item label="白班上班"><el-time-picker v-model="coForm.dayShiftStart" value-format="HH:mm" format="HH:mm"/></el-form-item>
        <el-form-item label="夜班上班"><el-time-picker v-model="coForm.nightShiftStart" value-format="HH:mm" format="HH:mm"/></el-form-item>
        <el-form-item label="迟到宽限(分)"><el-input-number v-model="coForm.lateGraceMinutes" :min="0"/></el-form-item>
        <el-form-item label="补车费基准"><el-input-number v-model="coForm.lateFeeBase" :min="0"/></el-form-item>
        <el-form-item label="员工代表"><el-input v-model="coForm.representative"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="coDlg=false">取消</el-button>
        <el-button type="primary" @click="saveCompany">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增线路 -->
    <el-dialog v-model="lineDlg" title="新增线路（可多选共线企业、批量站点）" width="520px">
      <el-form :model="lineForm" label-width="90px">
        <el-form-item label="名称"><el-input v-model="lineForm.name" placeholder="南线（新枢纽—园区）"/></el-form-item>
        <el-form-item label="编码"><el-input v-model="lineForm.code" placeholder="L-SOUTH"/></el-form-item>
        <el-form-item label="片区"><el-input v-model="lineForm.district"/></el-form-item>
        <el-form-item label="共线企业">
          <el-select v-model="lineForm.companyIds" multiple style="width:100%">
            <el-option v-for="c in companies" :key="c.id" :label="c.name" :value="c.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="站点(逗号)">
          <el-input v-model="lineForm.stationText" type="textarea" :rows="2" placeholder="新枢纽,南站前,云溪路,园区南门"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="lineDlg=false">取消</el-button>
        <el-button type="primary" @click="saveLine">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增班次 -->
    <el-dialog v-model="schDlg" title="新增班次" width="440px">
      <el-form :model="schForm" label-width="90px">
        <el-form-item label="线路">
          <el-select v-model="schForm.lineId" style="width:100%">
            <el-option v-for="l in lines" :key="l.id" :label="l.name" :value="l.id"/>
          </el-select>
        </el-form-item>
        <el-form-item label="班次名"><el-input v-model="schForm.name"/></el-form-item>
        <el-form-item label="方向">
          <el-radio-group v-model="schForm.direction">
            <el-radio label="to_park">上班到厂</el-radio>
            <el-radio label="from_park">下班离园</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发车时间"><el-time-picker v-model="schForm.departureTime" value-format="HH:mm" format="HH:mm"/></el-form-item>
        <el-form-item label="班别">
          <el-select v-model="schForm.shiftLabel">
            <el-option label="早班" value="早班"/><el-option label="白班" value="白班"/>
            <el-option label="夜班" value="夜班"/><el-option label="跨区接驳" value="接驳"/>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="schDlg=false">取消</el-button>
        <el-button type="primary" @click="saveSchedule">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增车辆 -->
    <el-dialog v-model="vDlg" title="新增车辆" width="400px">
      <el-form :model="vForm" label-width="80px">
        <el-form-item label="车牌"><el-input v-model="vForm.plate"/></el-form-item>
        <el-form-item label="座位数"><el-input-number v-model="vForm.seats" :min="1" :max="100"/></el-form-item>
        <el-form-item label="备注"><el-input v-model="vForm.note"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="vDlg=false">取消</el-button>
        <el-button type="primary" @click="saveVehicle">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增日历 -->
    <el-dialog v-model="hDlg" title="节假日 / 调休 / 停运" width="420px">
      <el-form :model="hForm" label-width="80px">
        <el-form-item label="日期"><el-date-picker v-model="hForm.date" type="date" value-format="YYYY-MM-DD"/></el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="hForm.type">
            <el-radio label="holiday">节假日</el-radio>
            <el-radio label="adjusted_workday">调休上班</el-radio>
            <el-radio label="suspended">停运（极端天气等）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="hForm.name"/></el-form-item>
        <el-form-item label="说明"><el-input v-model="hForm.note"/></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="hDlg=false">取消</el-button>
        <el-button type="primary" @click="saveHoliday">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { st } from '../api';

const tab = ref('companies');
const companies = ref<any[]>([]);
const lines = ref<any[]>([]);
const schedules = ref<any[]>([]);
const vehicles = ref<any[]>([]);
const holidays = ref<any[]>([]);

const coDlg = ref(false);
const coForm = ref<any>({ name: '', code: '', dayShiftStart: '08:30', nightShiftStart: '20:00', lateGraceMinutes: 10, lateFeeBase: 20, representative: '' });
const lineDlg = ref(false);
const lineForm = ref<any>({ name: '', code: '', district: '南区', companyIds: [], stationText: '' });
const schDlg = ref(false);
const schForm = ref<any>({ lineId: null, name: '', direction: 'to_park', departureTime: '07:00', shiftLabel: '白班' });
const vDlg = ref(false);
const vForm = ref<any>({ plate: '', seats: 45, note: '' });
const hDlg = ref(false);
const hForm = ref<any>({ date: '', type: 'holiday', name: '', note: '' });

async function load() {
  const [{ data: c }, { data: l }, { data: s }, { data: v }, { data: h }] = await Promise.all([
    api.get('/companies'), api.get('/lines'), api.get('/schedules'),
    api.get('/vehicles'), api.get('/holidays'),
  ]);
  companies.value = c; lines.value = l; schedules.value = s; vehicles.value = v; holidays.value = h;
}
async function saveCompany() {
  await api.post('/companies', coForm.value);
  ElMessage.success('已新增'); coDlg.value = false; load();
}
async function saveLine() {
  const stations = lineForm.value.stationText.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean).map((n: string, i: number) => ({ name: n, seq: i + 1 }));
  await api.post('/lines', { ...lineForm.value, stations });
  ElMessage.success('已新增线路与站点'); lineDlg.value = false; load();
}
async function saveSchedule() {
  await api.post('/schedules', schForm.value);
  ElMessage.success('已新增班次'); schDlg.value = false; load();
}
async function saveVehicle() {
  await api.post('/vehicles', vForm.value);
  ElMessage.success('已新增车辆'); vDlg.value = false; load();
}
async function saveHoliday() {
  await api.post('/holidays', hForm.value);
  ElMessage.success('已登记'); hDlg.value = false; load();
}
async function setStation(row: any, status: string) {
  let note = '';
  if (status !== 'normal') {
    ({ value: note } = await ElMessageBox.prompt('原因说明（将通知调度与运营）', '站点状态', { inputType: 'text' }).catch(() => ({ value: null })));
    if (note === null) return;
  }
  await api.post(`/stations/${row.id}`, { status, note });
  ElMessage.success('已更新'); load();
}
async function addStation(l: any) {
  const { value } = await ElMessageBox.prompt('新站点名称（自动追加到线路末端）', '加站点', { inputType: 'text' }).catch(() => ({ value: null }));
  if (!value) return;
  await api.post(`/lines/${l.id}/stations`, { name: value, seq: (l.stationList?.length || 0) + 1 });
  ElMessage.success('已加站点'); load();
}
async function setVehicle(row: any, status: string) {
  await api.post(`/vehicles/${row.id}`, { status });
  ElMessage.success('已更新'); load();
}
onMounted(load);
</script>
