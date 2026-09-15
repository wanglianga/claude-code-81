// 端到端冒烟：登录→预约→名单→派车→司机确认/签到/改站/代刷/发车→上报事件→到厂归档→考勤/申诉→双确认→访客门禁
const http = require('http');

const BASE = process.env.BASE || 'http://host.docker.internal:3081/api';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : {}; } catch { json = { raw: buf }; }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const ok = (r) => r.status === 200 || r.status === 201;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const login = async (u) => (await req('POST', '/auth/login', { username: u, password: 'Pass1234' })).json.token;

(async () => {
  // 0. 健康检查
  const health = await req('GET', '/health');
  check('健康检查 /api/health', ok(health) && health.json.status === 'ok', health.json);

  // 1. 六角色登录
  const tEmp = await login('emp_li');
  const tEmp2 = await login('emp_xu');
  const tNight = await login('emp_night');
  const tDrv = await login('driver01');
  const tDis = await login('dispatcher');
  const tHr = await login('hr_huaxing');
  const tHr2 = await login('hr_ruifeng');
  const tHr3 = await login('hr_hengxin');
  const tOp = await login('operator');
  check('六角色均可登录获取 JWT', !!(tEmp && tDrv && tDis && tHr && tOp && tNight));

  const bad = await req('POST', '/auth/login', { username: 'emp_li', password: 'wrong' });
  check('错误密码返回 401', bad.status === 401);

  const forbidden = await req('POST', '/trips/generate', { date: '2099-01-01', scheduleId: 1 }, tEmp);
  check('员工访问调度接口被拒(403)', forbidden.status === 403, forbidden.status);

  // 2. 预约规则
  const today = new Date().toISOString().slice(0, 10);
  const bv0 = await req('GET', `/booking-view?date=${today}`, null, tEmp);
  const morning = bv0.json.find(s => s.name === '东线早班');
  check('今日早班存在且有种子预约', morning && morning.bookedCount >= 8, { booked: morning?.bookedCount });

  const dup = await req('POST', '/reservations', {
    date: today, scheduleId: morning.id, stationId: morning.stations[0].id,
  }, tEmp);
  check('重复预约被拦截(400)', dup.status === 400, dup.json);

  const donghu = morning.stations.find(s => s.name === '东湖路口');
  const cap = await req('POST', '/reservations', {
    date: today, scheduleId: morning.id, stationId: donghu.id,
  }, tEmp2);
  check('预约规则校验生效（重复/容量 400）', cap.status === 400, cap.json);

  const holidays = (await req('GET', '/holidays', null, tEmp)).json;
  const suspended = holidays.find(h => h.type === 'suspended');
  const susBook = await req('POST', '/reservations', {
    date: suspended.date, scheduleId: morning.id, stationId: morning.stations[0].id,
  }, tEmp2);
  check('停运日禁止预约(400)', susBook.status === 400, susBook.json);

  // 3. 调度生成名单
  const vehicles = (await req('GET', '/vehicles', null, tDis)).json;
  const car20 = vehicles.find(v => v.seats === 20);
  const drvInfo = (await req('GET', '/drivers', null, tDis)).json;
  const d1 = drvInfo.find(d => d.username === 'driver01');
  const gen = await req('POST', '/trips/generate', {
    date: today, scheduleId: morning.id, vehicleId: car20.id, driverId: d1.id,
  }, tDis);
  check('名单生成成功（8人）', ok(gen) && gen.json.accepted === 8, gen.json);
  const tripId = gen.json.tripId;
  check('多企业费用分摊生成（3家）', Array.isArray(gen.json.feeSplit) && gen.json.feeSplit.length === 3, gen.json.feeSplit);
  check('20座车无超载', gen.json.overflow === 0, gen.json);

  const gen2 = await req('POST', '/trips/generate', { date: today, scheduleId: morning.id }, tDis);
  check('重复生成名单被拦截', gen2.status === 400, gen2.json);

  const bvNow = (await req('GET', `/booking-view?date=${today}`, null, tDis)).json;
  const west = bvNow.find(s => s.name === '西线早班');
  const d3 = drvInfo.find(d => d.username === 'driver03');
  const genExpired = await req('POST', '/trips/generate', {
    date: today, scheduleId: west.id, driverId: d3.id,
  }, tDis);
  check('安全培训过期司机被拦截', genExpired.status === 400 && /培训/.test(JSON.stringify(genExpired.json)), genExpired.json);

  // 4. 司机流程
  const tDrv2 = await login('driver02');
  const other = await req('GET', `/driver/trips/${tripId}/manifest`, null, tDrv2);
  check('非本车司机无权查看名单(403)', other.status === 403, other.status);

  const man0 = await req('GET', `/driver/trips/${tripId}/manifest`, null, tDrv);
  check('本车司机读取名单（8人）', ok(man0) && man0.json.reservations.length === 8, man0.json?.reservations?.length);

  const li = man0.json.reservations.find(r => r.employee.employeeNo === 'HX1001');
  const boardEarly = await req('POST', `/driver/trips/${tripId}/board`, { reservationId: li.id }, tDrv);
  check('未确认车辆路线前禁止签到', boardEarly.status === 400, boardEarly.json);

  const confirm = await req('POST', `/driver/trips/${tripId}/confirm`, { vehicleCheck: 'ok', routeOk: true }, tDrv);
  check('发车前确认车辆/路线', ok(confirm) && confirm.json.status === 'confirmed', confirm.json);
  const confirmBad = await req('POST', `/driver/trips/${tripId}/confirm`, { vehicleCheck: '', routeOk: false }, tDrv);
  check('未勾选路线确认被拒', confirmBad.status === 400, confirmBad.json);

  const b1 = await req('POST', `/driver/trips/${tripId}/board`, { employeeNo: 'HX1001' }, tDrv);
  check('刷工牌 HX1001 签到', ok(b1) && b1.json.status === 'boarded', b1.json);
  const xu = man0.json.reservations.find(r => r.employee.employeeNo === 'HX1002');
  const b2 = await req('POST', `/driver/trips/${tripId}/board`, { reservationId: xu.id }, tDrv);
  check('徐静签到成功', ok(b2));
  const dupBoard = await req('POST', `/driver/trips/${tripId}/board`, { employeeNo: 'HX1001' }, tDrv);
  check('重复刷卡被拦截', dupBoard.status === 400, dupBoard.json);
  const unknown = await req('POST', `/driver/trips/${tripId}/board`, { employeeNo: 'NOT-EXIST' }, tDrv);
  check('非名单工牌签到被拒', unknown.status === 404, unknown.json);

  const man1 = (await req('GET', `/driver/trips/${tripId}/manifest`, null, tDrv)).json.reservations;
  const wang = man1.find(r => r.employee.employeeNo === 'HX1003');
  const otherStation = man1.find(r => r.stationId !== wang.stationId);
  const chg = await req('POST', `/driver/trips/${tripId}/board`, {
    reservationId: wang.id, stationId: otherStation.stationId,
  }, tDrv);
  check('临时改站登记（changed）', ok(chg) && chg.json.status === 'changed' && !!chg.json.changeNote, chg.json);

  const zhao = man1.find(r => r.employee.employeeNo === 'RF2001');
  const proxy = await req('POST', `/driver/trips/${tripId}/board`, {
    reservationId: zhao.id, proxy: true, proxyNote: '工牌故障同座代刷，司机已核身份',
  }, tDrv);
  check('代刷登记留痕（proxyBoarded + 安全事件）', ok(proxy) && proxy.json.proxyBoarded === true, proxy.json);

  for (const no of ['RF2002', 'WL3001', 'WL3002']) {
    const rr = await req('POST', `/driver/trips/${tripId}/board`, { employeeNo: no }, tDrv);
    check(`签到 ${no}`, ok(rr), rr.json);
  }

  // 5. 五方协同事件
  const ev = await req('POST', '/events', {
    tripId, type: 'congestion', severity: 'warning', description: '滨河路交通事故拥堵（E2E 测试）',
  }, tEmp);
  check('员工上报途中事件', ok(ev) && ev.json.id, ev.json);
  const evId = ev.json.id;
  const resolveDenied = await req('POST', `/events/${evId}/resolve`, {
    resolution: 'xx', compensationType: 'exempt_attendance',
  }, tEmp);
  check('员工无权处置事件(403)', resolveDenied.status === 403, resolveDenied.status);

  // 6. 发车（孙丽 RF2003 未签到 → 未到）
  const depart = await req('POST', `/driver/trips/${tripId}/depart`, null, tDrv);
  check('发车成功，1人未到自动标记', ok(depart) && depart.json.noShowCount === 1, depart.json);

  const man2 = (await req('GET', `/driver/trips/${tripId}/manifest`, null, tDrv)).json.reservations;
  const sun = man2.find(r => r.employee.employeeNo === 'RF2003');
  const lateBoard = await req('POST', `/driver/trips/${tripId}/board`, { reservationId: sun.id }, tDrv);
  check('发车后补签到记为迟到(late)', ok(lateBoard) && lateBoard.json.status === 'late', lateBoard.json);

  const resolve = await req('POST', `/events/${evId}/resolve`, {
    resolution: '交通拥堵属实，本车全员考勤豁免（E2E）', compensationType: 'exempt_attendance',
  }, tDis);
  check('调度处置事件为考勤豁免', ok(resolve) && resolve.json.status === 'resolved', resolve.json);

  // 7. 到厂归档
  const arrive = await req('POST', `/driver/trips/${tripId}/arrive`, null, tDrv);
  check('到厂归档（考勤+绩效生成，演示时刻晚点0分）', ok(arrive) && arrive.json.delayMinutes === 0, arrive.json);
  const att = (await req('GET', `/attendance?date=${today}`, null, tHr)).json;
  check('8 条今日考勤档案生成', att.length === 8, att.length);
  const liAtt = att.find(a => a.employee?.employeeNo === 'HX1001');
  check('拥堵豁免生效：HX1001 状态 exempt', liAtt && liAtt.status === 'exempt' && liAtt.exempt === true, liAtt);
  const sunAtt = att.find(a => a.employee?.employeeNo === 'RF2003');
  check('孙丽个人迟到但因拥堵事件豁免', sunAtt && sunAtt.status === 'exempt', sunAtt);

  const perf = (await req('GET', '/performances', null, tDrv)).json;
  const todayPerf = perf.find(p => p.tripId === tripId);
  check('司机绩效档案生成', !!todayPerf && todayPerf.safetyScore <= 100, todayPerf);

  const notis = (await req('GET', '/notifications', null, tEmp)).json;
  check('员工收到协同通知（≥3条）', Array.isArray(notis) && notis.length >= 3, notis.length);

  // 8. 申诉
  const appeal = await req('POST', '/appeals', {
    attendanceId: liAtt.id, reason: 'E2E 测试申诉：事件已豁免，仅验证流程', evidence: '系统记录',
  }, tEmp);
  check('员工发起申诉', ok(appeal) && appeal.json.id, appeal.json);
  const appealId = appeal.json.id;
  const review = await req('POST', `/appeals/${appealId}/review`, {
    action: 'approve', reply: '情况属实，维持豁免并退费（E2E）', grantExemption: true, refundFee: true,
  }, tHr);
  check('HR 申诉成立联动豁免/退费', ok(review) && review.json.status === 'approved', review.json);
  const reviewDenied = await req('POST', `/appeals/${appealId}/review`, { action: 'reject', reply: 'x' }, tEmp2);
  check('员工处理申诉被拒(403)', reviewDenied.status === 403, reviewDenied.status);

  // 9. 线路调整双确认（东线 3 家共线，需三家 HR + 员工代表）
  const proposals = (await req('GET', '/proposals', null, tOp)).json;
  const seedProposal = proposals.find(p => p.status === 'proposed');
  // 员工代表先确认（验证双方可并行）
  const ecEarly = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, { note: '员工代表先表态（E2E）' }, tEmp);
  check('员工代表可先行确认（状态仍需企业集齐）', ok(ecEarly) && ecEarly.json.status === 'proposed', ecEarly.json);
  for (const [name, tk] of [['华星', tHr], ['瑞丰', tHr2], ['恒信', tHr3]]) {
    const cc = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, { note: `${name}同意（E2E）` }, tk);
    check(`${name} HR 确认提案`, ok(cc), cc.json);
  }
  const afterAll = (await req('GET', '/proposals', null, tOp)).json.find(p => p.id === seedProposal.id);
  check('三家企业+员工代表齐 → 双确认通过', afterAll.status === 'employee_confirmed', afterAll.status);
  const ccDup = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, {}, tHr);
  check('同企业重复确认被拒', ccDup.status === 400, ccDup.json);
  const empSideDenied = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, {}, tHr);
  check('HR 不能替员工代表确认(403)', empSideDenied.status === 403, empSideDenied.status);
  const apply = await req('POST', `/proposals/${seedProposal.id}/apply`, null, tOp);
  check('运营发布执行（双确认后才可落地）', ok(apply) && apply.json.status === 'confirmed', apply.json);

  // 单方决定防护：新建提案，仅员工确认不能发布
  const p2 = await req('POST', '/proposals', {
    lineId: null, type: 'new_line', title: 'E2E 单方防护测试线', content: 'x', impactSummary: 'x',
  }, tOp);
  await req('POST', `/proposals/${p2.json.id}/confirm/employee`, {}, tEmp);
  const applyBlocked = await req('POST', `/proposals/${p2.json.id}/apply`, null, tOp);
  check('缺企业确认时运营不能单方发布(400)', applyBlocked.status === 400, applyBlocked.json);

  // 10. 访客 + 门禁
  const newVisitor = await req('POST', '/visitors', {
    visitorName: 'E2E访客', phone: '13000000000', hostName: '徐静',
    visitDate: today, stationId: donghu.id, scheduleId: morning.id,
  }, tHr);
  check('HR 登记访客生成二维码', ok(newVisitor) && /^V-/.test(newVisitor.json.qrCode), newVisitor.json);
  const vCode = newVisitor.json.qrCode;
  const vBoard = await req('POST', `/visitors/board/${vCode}`, null, tHr);
  check('访客乘车核验', ok(vBoard) && vBoard.json.status === 'boarded', vBoard.json);
  const gateV = await req('POST', '/gate/scan', { gateName: '园区东门', code: vCode, direction: 'in' }, tHr);
  check('访客码刷闸机放行', ok(gateV) && gateV.json.result === 'allow', gateV.json);
  const gateE = await req('POST', '/gate/scan', { gateName: '园区东门', code: 'HX1001', direction: 'in' }, tHr);
  check('员工工牌刷闸机放行', ok(gateE) && gateE.json.result === 'allow' && gateE.json.personName === '李磊', gateE.json);
  const gateBad = await req('POST', '/gate/scan', { gateName: '园区东门', code: 'FAKE', direction: 'in' }, tHr);
  check('未知凭证刷闸机拒绝并留痕', ok(gateBad) && gateBad.json.result === 'deny', gateBad.json);

  // 11. 夜班 + 总览
  const nightRes = (await req('GET', '/my/reservations', null, tNight)).json;
  check('夜班员工临时加班预约存在', nightRes.some(r => r.tempOvertime), nightRes);
  const dash = (await req('GET', '/dashboard', null, tOp)).json;
  check('总览统计：企业3 / 线路2 / 今日签到≥8',
    dash.companies === 3 && dash.lines === 2 && dash.boardedToday >= 8, dash);

  // 12. 站点施工 → 通知调度
  const stnId = morning.stations[0].id;
  const patch = await req('POST', `/stations/${stnId}`, { status: 'construction', note: 'E2E 施工测试' }, tDis);
  check('站点施工状态更新并通知', ok(patch) && patch.json.status === 'construction', patch.json);
  const disNotis = (await req('GET', '/notifications', null, tDis)).json;
  check('调度收到站点施工通知', disNotis.some(n => n.title.includes('站点状态变更')), disNotis.map(n => n.title));
  await req('POST', `/stations/${stnId}`, { status: 'normal' }, tDis);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常', e); process.exit(2); });
