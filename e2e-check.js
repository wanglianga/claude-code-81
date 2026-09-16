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

  // 9. 线路调整完整双确认（东线 l1 三家共线：每家 HR + 每家配置的员工代表）
  const tEmpZhao = await login('emp_zhao');  // 赵强 = 瑞丰 representative
  const tEmpZhou = await login('emp_zhou');  // 周婷 = 恒信 representative
  const tEmpXu = await login('emp_xu');      // 徐静 = 普通员工（非代表）
  const tHr3b = tHr3;
  const proposals = (await req('GET', '/proposals', null, tOp)).json;
  const seedProposal = proposals.find(p => p.status === 'proposed' && p.lineId === 1);

  // 非代表员工不能代表员工侧确认
  const nonRep = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, { note: '普通员工尝试' }, tEmpXu);
  check('非代表员工确认被拒(403)', nonRep.status === 403 && /员工代表/.test(JSON.stringify(nonRep.json)), nonRep.json);

  // 普通员工冒充企业侧确认
  const empAsHr = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, {}, tEmp);
  check('员工不能代表企业侧确认(403)', empAsHr.status === 403, empAsHr.status);

  // 三家 HR 确认，但零员工代表 → operator 发布必须 4xx 且无任何落地
  for (const [name, tk] of [['华星', tHr], ['瑞丰', tHr2], ['恒信', tHr3b]]) {
    const cc = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, { note: `${name}同意（E2E）` }, tk);
    check(`${name} HR 确认提案`, ok(cc), cc.json);
  }
  const linesBefore = (await req('GET', '/lines', null, tOp)).json;
  const lineBefore = linesBefore.find(l => l.id === 1);
  const disNotisBefore = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  const applyNoRep = await req('POST', `/proposals/${seedProposal.id}/apply`, null, tOp);
  check('三家 HR 但零员工代表时发布返回 4xx', applyNoRep.status >= 400 && applyNoRep.status < 500, applyNoRep.status);
  const afterBlocked = (await req('GET', '/proposals', null, tOp)).json.find(p => p.id === seedProposal.id);
  const lineAfterBlocked = (await req('GET', '/lines', null, tOp)).json.find(l => l.id === 1);
  check('拒绝发布后提案状态不变（company_confirmed）', afterBlocked.status === 'company_confirmed', afterBlocked.status);
  check('拒绝发布后线路状态不变', lineAfterBlocked.status === lineBefore.status, { before: lineBefore.status, after: lineAfterBlocked.status });
  const disNotisBlocked = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  check('拒绝发布不产生执行通知', disNotisBlocked === disNotisBefore, { before: disNotisBefore, after: disNotisBlocked });

  // 非涉线 HR 确认：西线 l2 仅华星+瑞丰共线，恒信 HR 无权确认其提案
  const l2 = linesBefore.find(l => l.code === 'L-WEST');
  const pWest = await req('POST', '/proposals', {
    lineId: l2.id, type: 'adjust', title: 'E2E 西线时刻微调', content: 'x', impactSummary: 'x',
  }, tOp);
  const outsider = await req('POST', `/proposals/${pWest.json.id}/confirm/company`, {}, tHr3b);
  check('非涉线企业 HR 确认被拒(403)', outsider.status === 403 && /共线企业范围/.test(JSON.stringify(outsider.json)), outsider.json);
  const outsiderRep = await req('POST', `/proposals/${pWest.json.id}/confirm/employee`, {}, tEmpZhou);
  check('非涉线企业员工代表确认被拒(403)', outsiderRep.status === 403, outsiderRep.json);

  // 三家员工代表（每家企业配置的 representative）逐一确认
  for (const [cname, tk] of [['华星·李磊', tEmp], ['瑞丰·赵强', tEmpZhao], ['恒信·周婷', tEmpZhou]]) {
    const ec = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, { note: `${cname}代表同意` }, tk);
    check(`${cname} 员工代表确认`, ok(ec), ec.json);
  }
  const afterAll = (await req('GET', '/proposals', null, tOp)).json.find(p => p.id === seedProposal.id);
  check('三家 HR + 三家员工代表齐 → 双确认通过', afterAll.status === 'employee_confirmed', afterAll.status);

  const ccDup = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, {}, tHr);
  check('同企业 HR 重复确认被拒', ccDup.status === 400, ccDup.json);
  const repDup = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, {}, tEmp);
  check('同企业代表重复确认被拒', repDup.status === 400, repDup.json);
  const empSideDenied = await req('POST', `/proposals/${seedProposal.id}/confirm/employee`, {}, tHr);
  check('HR 不能替员工代表确认(403)', empSideDenied.status === 403, empSideDenied.status);

  // operator 一次发布
  const apply = await req('POST', `/proposals/${seedProposal.id}/apply`, null, tOp);
  check('完整双确认后运营发布成功', ok(apply) && apply.json.status === 'confirmed', apply.json);
  const disNotisAfter = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  check('执行通知仅落地一次', disNotisAfter - disNotisBefore === 1, { delta: disNotisAfter - disNotisBefore });

  // 已闭环：重复确认与重复发布均被拒（影响不二次落地）
  const afterClosedCc = await req('POST', `/proposals/${seedProposal.id}/confirm/company`, {}, tHr2);
  check('发布后再确认被拒（已闭环）', afterClosedCc.status === 400, afterClosedCc.json);
  const applyTwice = await req('POST', `/proposals/${seedProposal.id}/apply`, null, tOp);
  check('重复发布被拒（只落地一次）', applyTwice.status === 400, applyTwice.json);
  const disNotisTwice = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  check('重复发布不产生第二条通知', disNotisTwice === disNotisAfter, { n: disNotisTwice });

  // 9b. 并发一致性：新提案，Promise.all 并发 3 家 HR + 3 家代表确认
  const pConc = await req('POST', '/proposals', {
    lineId: 1, type: 'adjust', title: 'E2E 并发确认测试', content: 'x', impactSummary: 'x',
  }, tOp);
  const pConcId = pConc.json.id;
  const hrCalls = [
    ['华星', tHr], ['瑞丰', tHr2], ['恒信', tHr3],
  ].map(([n, tk]) =>
    req('POST', `/proposals/${pConcId}/confirm/company`, { note: `${n}并发确认` }, tk)
  );
  const repCalls = [
    ['华星·李磊', tEmp], ['瑞丰·赵强', tEmpZhao], ['恒信·周婷', tEmpZhou],
  ].map(([n, tk]) =>
    req('POST', `/proposals/${pConcId}/confirm/employee`, { note: `${n}并发确认` }, tk)
  );
  const concResults = await Promise.all([...hrCalls, ...repCalls]);
  const concOk = concResults.filter(r => ok(r)).length;
  check('并发 6 路确认全部成功（行锁串行合并）', concOk === 6, concResults.map(r => r.status));
  const pConcFinal = (await req('GET', '/proposals', null, tOp)).json.find(p => p.id === pConcId);
  check('并发确认后保留 3 家 HR 确认', (pConcFinal.companyConfirmations || []).length === 3,
    pConcFinal.companyConfirmations?.map((c) => c.companyId));
  check('并发确认后保留 3 家员工代表确认', (pConcFinal.employeeConfirmations || []).length === 3,
    pConcFinal.employeeConfirmations?.map((c) => c.companyId));
  check('并发确认无重复企业条目（每家恰 1 条）',
    new Set(pConcFinal.companyConfirmations.map((c) => c.companyId)).size === 3
    && new Set(pConcFinal.employeeConfirmations.map((c) => c.companyId)).size === 3);
  check('并发确认收敛为可发布状态 employee_confirmed', pConcFinal.status === 'employee_confirmed', pConcFinal.status);

  // 9c. 两个 operator 并发发布同一提案：最多一成功一 4xx，状态/通知增量恰为 1
  const tOp2 = await login('operator2');
  const disNotisPreRace = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  const [race1, race2] = await Promise.all([
    req('POST', `/proposals/${pConcId}/apply`, null, tOp),
    req('POST', `/proposals/${pConcId}/apply`, null, tOp2),
  ]);
  const raceSuccess = [race1, race2].filter(r => ok(r)).length;
  const raceFail = [race1, race2].filter(r => r.status >= 400 && r.status < 500).length;
  check('两个 operator 并发发布：恰好一成一败(4xx)', raceSuccess === 1 && raceFail === 1,
    [race1.status, race2.status]);
  const pRaced = (await req('GET', '/proposals', null, tOp)).json.find(p => p.id === pConcId);
  check('并发发布后状态恰为 confirmed', pRaced.status === 'confirmed', pRaced.status);
  const disNotisPostRace = ((await req('GET', '/notifications', null, tDis)).json)
    .filter(n => n.title === '线路调整已执行').length;
  check('并发发布执行通知增量恰为 1（同事务一次写入）', disNotisPostRace - disNotisPreRace === 1,
    { before: disNotisPreRace, after: disNotisPostRace });
  // 并发失败的事务必须回滚干净：确认矩阵未被破坏
  check('失败事务未污染确认矩阵（仍 3+3）',
    pRaced.companyConfirmations.length === 3 && pRaced.employeeConfirmations.length === 3);

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

  // 13. 晚点考勤豁免证明：种子证明（昨日道路事故）越权校验 + HR 批量确认回写
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const certsHr = (await req('GET', '/late-certificates', null, tHr)).json;
  const seedCert = certsHr.find(c => c.certNo === `LATE-${yesterday.replace(/-/g, '')}-0001`);
  check('华星 HR 看到待确认的种子晚点证明', !!seedCert && seedCert.status === 'pending_hr' && seedCert.pendingCount === 3, seedCert);

  const certsHr2 = (await req('GET', '/late-certificates', null, tHr2)).json;
  check('非涉事企业（瑞丰）HR 列表不可见该证明', !certsHr2.some(c => c.id === seedCert.id), certsHr2.map(c => c.id));

  const seedDetail = (await req('GET', `/late-certificates/${seedCert.id}`, null, tHr)).json;
  check('证明含四类取证来源',
    JSON.stringify(seedDetail.evidence.sources).includes('GPS') &&
    seedDetail.evidence.stationCheckins.length === 3 &&
    seedDetail.evidence.rules[0].graceMinutes === 10, seedDetail.evidence);

  // 员工端看到的晚点原因与 HR 端同源
  const myCertsLi = (await req('GET', '/my/late-certificates', null, tEmp)).json;
  const mySeed = myCertsLi.find(c => c.id === seedCert.id);
  check('员工端可见本人晚点证明', !!mySeed && mySeed.item.status === 'pending', mySeed);
  check('员工端与 HR 端晚点原因完全一致（同一 reasonText）',
    !!mySeed && mySeed.reasonText === seedDetail.reasonText,
    { emp: mySeed?.reasonText, hr: seedDetail.reasonText });

  // 越权：瑞丰 HR 不能处理华星证明；员工不能批量处理；无关员工不能看详情
  const cross = await req('POST', `/late-certificates/${seedCert.id}/batch-confirm`, { companyId: 1 }, tHr2);
  check('跨企业 HR 批量处理被拒(403)', cross.status === 403, cross.status);
  const empBatch = await req('POST', `/late-certificates/${seedCert.id}/batch-confirm`, {}, tEmp2);
  check('员工批量处理被拒(403)', empBatch.status === 403, empBatch.status);
  const zhaoDetail = await req('GET', `/late-certificates/${seedCert.id}`, null, await login('emp_zhao'));
  check('无关员工查看证明详情被拒(403)', zhaoDetail.status === 403, zhaoDetail.status);

  // 华星 HR 批量确认 → 回写考勤/司机绩效/线路复盘
  const seedConfirm = await req('POST', `/late-certificates/${seedCert.id}/batch-confirm`, {
    companyId: 1, note: '与交警事故通报一致，统一豁免（E2E）',
  }, tHr);
  check('HR 批量确认 3 人并回写', ok(seedConfirm) && seedConfirm.json.processed === 3
    && seedConfirm.json.status === 'confirmed', seedConfirm.json);

  const yAtt = (await req('GET', `/attendance?date=${yesterday}`, null, tHr)).json;
  const seedAtt = yAtt.filter(a => a.certificateId === seedCert.id);
  check('3 条昨日考勤回写为豁免、补车费清零',
    seedAtt.length === 3 && seedAtt.every(a => a.status === 'exempt' && a.makeupFee === 0 && a.exempt === true),
    seedAtt.map(a => ({ s: a.status, fee: a.makeupFee })));
  check('回写的豁免原因引用同一证明编号与晚点原因',
    seedAtt.every(a => (a.exemptReason || '').includes(seedCert.certNo) && (a.exemptReason || '').includes('道路交通事故')),
    seedAtt[0]?.exemptReason);

  const perfs = (await req('GET', '/performances', null, tDrv)).json;
  const histPerf = perfs.find(p => p.tripId === seedCert.tripId);
  check('司机绩效联动：非司机责任撤销晚点扣分（100分/0罚）',
    !!histPerf && histPerf.safetyScore === 100 && histPerf.penalty === 0 && histPerf.certificateId === seedCert.id, histPerf);

  const reviews = (await req('GET', '/line-reviews', null, tOp)).json;
  const seedReview = reviews.find(r => r.certificateId === seedCert.id);
  check('线路复盘联动生成并已复盘（豁免3人、含整改措施）',
    !!seedReview && seedReview.status === 'reviewed' && seedReview.exemptedCount === 3
    && /缓冲|监控|区间车/.test(seedReview.measures || ''), seedReview);

  const mySeedAfter = (await req('GET', '/my/late-certificates', null, tEmp)).json.find(c => c.id === seedCert.id);
  check('员工端同步显示已豁免回写', mySeedAfter.item.status === 'exempt' && mySeedAfter.item.writeback === true, mySeedAfter?.item);
  const closedAgain = await req('POST', `/late-certificates/${seedCert.id}/batch-confirm`, {}, tHr);
  check('已闭环证明重复处理被拒', closedAgain.status === 400, closedAgain.status);

  // 14a. 准点/提前到厂车次：即使提交道路事故说明，也必须拒绝出证且零副作用
  const onTimeAttBefore = (await req('GET', `/attendance?date=${today}`, null, tOp)).json
    .filter(a => a.tripId === tripId);
  const certsBefore = (await req('GET', '/late-certificates', null, tDis)).json.length;
  const notisEmpBefore = (await req('GET', '/notifications', null, tEmp)).json.length;
  // 今日车次在步骤7已断言 delayMinutes===0；虽然该车次有一条拥堵留痕事件，仍不得出证
  const fakeGen = await req('POST', '/late-certificates/generate', {
    tripId, reasonType: 'accident',
    incidentLocation: '手工填写的事故地点',
    reasonText: '手工声明：道路交通事故导致严重晚点（实际准点）',
  }, tDis);
  check('准点车次仅凭手工事故说明生成证明被拒(400)',
    fakeGen.status === 400 && /未达到平台阈值|准点/.test(JSON.stringify(fakeGen.json)), fakeGen.json);
  // 引用其它车次（昨日西线）的事故事件为准点车次出证 → 证据链不匹配，拒绝
  const yTripsAll = (await req('GET', `/trips?date=${yesterday}`, null, tDis)).json;
  const westTrip0 = yTripsAll.find(t => t.schedule?.name === '西线早班');
  const westEv = (await req('GET', '/events', null, tDis)).json.find(e => e.tripId === westTrip0.id);
  const crossEvGen = await req('POST', '/late-certificates/generate', {
    tripId, reasonType: 'accident', eventId: westEv.id,
  }, tDis);
  check('准点车次引用他车事件出证被拒（证据链不匹配/未晚点）', crossEvGen.status === 400, crossEvGen.status);

  const certsAfter = (await req('GET', '/late-certificates', null, tDis)).json;
  check('拒绝后未生成任何新证明', certsAfter.length === certsBefore, certsAfter.length);
  const onTimeAttAfter = (await req('GET', `/attendance?date=${today}`, null, tOp)).json
    .filter(a => a.tripId === tripId);
  check('拒绝后考勤/费用/证明关联均不变（无 certificateId 回写）',
    onTimeAttBefore.length === onTimeAttAfter.length
    && onTimeAttAfter.every(a => a.certificateId == null)
    && JSON.stringify(onTimeAttBefore.map(a => [a.status, a.makeupFee]))
      === JSON.stringify(onTimeAttAfter.map(a => [a.status, a.makeupFee])),
    onTimeAttAfter.map(a => ({ s: a.status, fee: a.makeupFee, cert: a.certificateId })));
  const notisEmpAfter = (await req('GET', '/notifications', null, tEmp)).json.length;
  check('拒绝后不产生员工/HR 通知', notisEmpAfter === notisEmpBefore, { before: notisEmpBefore, after: notisEmpAfter });
  check('无证明则 HR 无法批量豁免（404）',
    (await req('POST', '/late-certificates/999999/batch-confirm', {}, tHr)).status === 404);

  // 14b. 真实事故晚点车次（昨日西线，GPS晚点25分；华星王敏发车后补签到=公共25+个人15=40分）正常出证
  const genAccident = await req('POST', '/late-certificates/generate', {
    tripId: westTrip0.id, reasonType: 'accident',
  }, tDis);
  check('真实事故晚点车次取证生成证明（3人/晚点25分/2家企业）',
    ok(genAccident) && genAccident.json.certNo && genAccident.json.delayMinutes === 25
    && genAccident.json.impactSummary.totalEmployees === 3
    && genAccident.json.impactSummary.companies.length === 2, genAccident.json);
  // 取证已区分公共/个人分钟：王敏 25+15，其余 25+0
  const westEvd = genAccident.json;
  void westEvd;
  const westDetail0 = (await req('GET', `/late-certificates/${genAccident.json.id}`, null, tHr)).json;
  const wWang = westDetail0.items.find(i => i.employee?.employeeNo === 'HX1003');
  check('取证区分公共晚点与个人迟到（王敏 25/15，共40）',
    wWang.commonLateMinutes === 25 && wWang.personalLateMinutes === 15 && wWang.lateMinutes === 40, wWang);
  check('正常签到员工无个人分钟（徐静 25/0）',
    westDetail0.items.find(i => i.employee?.employeeNo === 'HX1002')?.personalLateMinutes === 0, westDetail0.items);
  const westCertId = genAccident.json.id;
  const dupGen = await req('POST', '/late-certificates/generate', { tripId: westTrip0.id, reasonType: 'accident' }, tDis);
  check('同一车次重复生成证明被拒', dupGen.status === 400, dupGen.json);
  const empGen = await req('POST', '/late-certificates/generate', { tripId: westTrip0.id, reasonType: 'accident' }, tEmp);
  check('员工无权生成证明(403)', empGen.status === 403, empGen.status);

  const companies = (await req('GET', '/companies', null, tHr)).json;
  const cHx = companies.find(c => c.code === 'HX').id;
  const cRf = companies.find(c => c.code === 'RF').id;
  const cWl = companies.find(c => c.code === 'HXWL').id;
  void cWl;

  const cfHx2 = await req('POST', `/late-certificates/${westCertId}/batch-confirm`, { companyId: cHx }, tHr);
  check('西线·华星批次确认 2 人：1整条豁免 + 1部分豁免（保留个人迟到）',
    ok(cfHx2) && cfHx2.json.processed === 2 && cfHx2.json.fullExempt === 1
    && cfHx2.json.partialExempt === 1 && cfHx2.json.status === 'partially_confirmed', cfHx2.json);
  const cfCross2 = await req('POST', `/late-certificates/${westCertId}/batch-confirm`, { companyId: cHx }, tHr2);
  check('瑞丰 HR 越权处理华星批次被拒(403)', cfCross2.status === 403, cfCross2.status);
  const cfRf2 = await req('POST', `/late-certificates/${westCertId}/batch-confirm`, { companyId: cRf }, tHr2);
  check('西线·瑞丰批次确认 1 人后证明整体 confirmed（累计整条豁免2/分责1）',
    ok(cfRf2) && cfRf2.json.processed === 1 && cfRf2.json.fullExempt === 2
    && cfRf2.json.partialExempt === 1 && cfRf2.json.status === 'confirmed', cfRf2.json);

  const westAttAll = (await req('GET', `/attendance?date=${yesterday}`, null, tOp)).json
    .filter(a => a.certificateId === westCertId);
  const wangAtt = westAttAll.find(a => a.employee?.employeeNo === 'HX1003');
  const xuAtt = westAttAll.find(a => a.employee?.employeeNo === 'HX1002');
  check('王敏：事故25分已豁免，保留15分个人迟到、计迟到并按华星规则扣费',
    wangAtt.status === 'late' && wangAtt.exempt === false
    && wangAtt.commonLateMinutes === 25 && wangAtt.personalLateMinutes === 15
    && wangAtt.makeupFee === 20 && wangAtt.lateReason === 'personal'
    && /个人到站迟到/.test(wangAtt.exemptReason || ''), wangAtt);
  check('徐静/钱多多：无个人责任，整条豁免、补车费清零',
    xuAtt.status === 'exempt' && xuAtt.makeupFee === 0
    && westAttAll.filter(a => a.employee?.employeeNo === 'RF2002')[0]?.status === 'exempt'
    && westAttAll.filter(a => a.employee?.employeeNo === 'RF2002')[0]?.makeupFee === 0,
    westAttAll.map(a => ({ no: a.employee?.employeeNo, s: a.status, fee: a.makeupFee })));
  check('事故实际豁免人数不被个人迟到虚增：3条记录中仅2条整条豁免',
    westAttAll.filter(a => a.status === 'exempt').length === 2
    && westAttAll.filter(a => a.status === 'late').length === 1, westAttAll.map(a => a.status));

  // 王敏员工端：证明分责可见，且个人迟到记录仍可发起申诉
  const tEmpWang = await login('emp_wang');
  const wangMyCert = (await req('GET', '/my/late-certificates', null, tEmpWang)).json.find(c => c.id === westCertId);
  check('王敏员工端显示事故豁免·保留个人迟到（25/15）',
    wangMyCert.item.status === 'partial_exempt' && wangMyCert.item.commonLateMinutes === 25
    && wangMyCert.item.personalLateMinutes === 15 && wangMyCert.item.writeback === true, wangMyCert?.item);
  check('王敏与 HR 看到同一晚点原因（道路事故）', wangMyCert.reasonText === westDetail0.reasonText, wangMyCert?.reasonText);
  const wangAppeal = await req('POST', '/appeals', {
    attendanceId: wangAtt.id, reason: '不认可个人迟到15分钟，当时站点拥堵非个人原因（E2E）', evidence: '站点监控',
  }, tEmpWang);
  check('保留个人迟到的员工仍可发起申诉', ok(wangAppeal) && wangAppeal.json.id, wangAppeal.json);

  const westHrView = (await req('GET', `/late-certificates/${westCertId}`, null, tHr2)).json;
  const westEmpView = (await req('GET', '/my/late-certificates', null, tEmp2)).json.find(c => c.id === westCertId);
  check('西线证明员工端与 HR 端晚点原因一致（道路交通事故）',
    !!westEmpView && westEmpView.reasonText === westHrView.reasonText && /道路交通事故/.test(westEmpView.reasonText),
    { emp: westEmpView?.reasonText, hr: westHrView?.reasonText });
  const westPerf = (await req('GET', '/performances', null, tDrv2)).json.find(p => p.tripId === westTrip0.id);
  check('driver02 绩效：事故公共晚点撤销扣分，备注标明个人迟到不纳入事故影响',
    westPerf.safetyScore === 100 && westPerf.penalty === 0 && westPerf.certificateId === westCertId
    && /个人到站迟到/.test(westPerf.note || ''), westPerf);
  const westReview = (await req('GET', '/line-reviews', null, tOp)).json.find(r => r.certificateId === westCertId);
  check('西线事故复盘：事故整条豁免2人、分责1人，整改措施含两类',
    !!westReview && westReview.status === 'reviewed' && westReview.exemptedCount === 2
    && westReview.partialExemptCount === 1
    && /缓冲|监控|区间车/.test(westReview.measures || '')
    && /个人到站迟到/.test(westReview.measures || ''), westReview);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常', e); process.exit(2); });
