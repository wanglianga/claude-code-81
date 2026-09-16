import axios from 'axios';
import { ElMessage } from 'element-plus';

const api = axios.create({ baseURL: '/api', timeout: 15000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.message
      ? (Array.isArray(err.response.data.message) ? err.response.data.message.join('；') : err.response.data.message)
      : err.message;
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (!location.hash.includes('/login')) location.hash = '#/login';
    } else {
      ElMessage.error(typeof msg === 'string' ? msg : '请求失败');
    }
    return Promise.reject(err);
  },
);

export default api;

export const ROLE_NAMES: Record<string, string> = {
  admin: '系统管理员',
  operator: '园区运营',
  dispatcher: '调度员',
  hr: '企业HR',
  driver: '司机',
  employee: '员工',
};

export const EVENT_TYPES: Record<string, string> = {
  congestion: '道路拥堵', breakdown: '车辆故障', construction: '站点施工',
  missed_bus: '员工错过班车', overtime: '企业临时加班', detour: '司机绕行',
  late_arrival: '班车到厂晚点', weather: '极端天气', suspension: '停运',
  security_check: '临时安检/代刷', relocation: '企业搬迁', accident: '道路交通事故',
};

// 晚点证明统一晚点原因字典（与后端 CERT_REASONS 一致，员工端/HR端共用同一份文案）
export const CERT_REASONS: Record<string, string> = {
  accident: '道路交通事故',
  congestion: '道路拥堵',
  breakdown: '车辆故障',
  construction: '道路/站点施工',
  detour: '交通管制绕行',
  weather: '极端天气',
  other: '其他非员工原因',
};

export const STATUS: Record<string, { label: string; type: string }> = {
  booked: { label: '已预约', type: 'info' },
  on_manifest: { label: '已入名单', type: 'primary' },
  boarded: { label: '已上车', type: 'success' },
  late: { label: '迟到上车', type: 'warning' },
  no_show: { label: '未到', type: 'danger' },
  changed: { label: '临时改站', type: 'warning' },
  cancelled: { label: '已取消', type: 'info' },
  planned: { label: '待确认', type: 'info' },
  confirmed: { label: '已确认', type: 'primary' },
  boarding: { label: '签到中', type: 'primary' },
  departed: { label: '行驶中', type: 'warning' },
  arrived: { label: '已到厂', type: 'success' },
  suspended: { label: '已停运', type: 'danger' },
  normal: { label: '正常', type: 'success' },
  exempt: { label: '豁免', type: 'success' },
  pending: { label: '待处理', type: 'warning' },
  approved: { label: '申诉成立', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  proposed: { label: '待确认', type: 'warning' },
  company_confirmed: { label: '企业已确认', type: 'primary' },
  employee_confirmed: { label: '双确认通过', type: 'success' },
  confirmed_: { label: '已执行', type: 'success' },
  operator_review: { label: '升级运营处理', type: 'warning' },
  open: { label: '未处理', type: 'danger' },
  processing: { label: '处理中', type: 'warning' },
  resolved: { label: '已处理', type: 'success' },
  registered: { label: '已登记', type: 'info' },
  checked_in: { label: '已入园', type: 'success' },
  available: { label: '可用', type: 'success' },
  in_use: { label: '使用中', type: 'primary' },
  maintenance: { label: '保养中', type: 'warning' },
  auto_generated: { label: '平台已生成', type: 'info' },
  pending_hr: { label: '待HR确认', type: 'danger' },
  partially_confirmed: { label: '部分企业已处理', type: 'warning' },
  partial_exempt: { label: '事故豁免·保留个人迟到', type: 'warning' },
  reviewed: { label: '已复盘', type: 'success' },
};

export function st(s: string) {
  return STATUS[s] || { label: s, type: 'info' };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
