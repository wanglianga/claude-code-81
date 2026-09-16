import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as E from './entities';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'commute',
  password: process.env.DB_PASSWORD || 'commute123',
  database: process.env.DB_NAME || 'commute',
  entities: Object.values(E),
  synchronize: true,
  logging: false,
});

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function main() {
  await ds.initialize();
  const userRepo = ds.getRepository(E.User);
  if (await userRepo.findOne({ where: { username: 'admin' } })) {
    console.log('Seed skipped: data already exists');
    await ds.destroy();
    return;
  }

  const hash = (p: string) => bcrypt.hash(p, 10);
  const pw = await hash('Pass1234');

  // ---------- 企业 ----------
  const c1 = await ds.getRepository(E.Company).save(ds.getRepository(E.Company).create({
    name: '华星电子科技', code: 'HX', lateGraceMinutes: 10, dayShiftStart: '08:30',
    nightShiftStart: '20:00', lateFeeBase: 20, representative: '李磊',
  }));
  const c2 = await ds.getRepository(E.Company).save(ds.getRepository(E.Company).create({
    name: '瑞丰精密制造', code: 'RF', lateGraceMinutes: 5, dayShiftStart: '08:00',
    nightShiftStart: '20:00', lateFeeBase: 30, representative: '赵强',
  }));
  const c3 = await ds.getRepository(E.Company).save(ds.getRepository(E.Company).create({
    name: '恒信物流仓储', code: 'HXWL', lateGraceMinutes: 15, dayShiftStart: '09:00',
    nightShiftStart: '21:00', lateFeeBase: 15, representative: '周婷',
  }));

  // ---------- 用户 ----------
  const mk = async (u: any): Promise<any> => userRepo.save(userRepo.create({ passwordHash: pw, active: true, ...u }));
  const admin = await mk({ username: 'admin', realName: '系统管理员', role: 'admin' });
  const operator = await mk({ username: 'operator', realName: '陈运营', role: 'operator' });
  const operator2 = await mk({ username: 'operator2', realName: '林运营(备岗)', role: 'operator' });
  const dispatcher = await mk({ username: 'dispatcher', realName: '周调度', role: 'dispatcher' });
  const hr1 = await mk({ username: 'hr_huaxing', realName: '孙丽华(华星HR)', role: 'hr', companyId: c1.id });
  const hr2 = await mk({ username: 'hr_ruifeng', realName: '吴芳(瑞丰HR)', role: 'hr', companyId: c2.id });
  const hr3 = await mk({ username: 'hr_hengxin', realName: '郑洁(恒信HR)', role: 'hr', companyId: c3.id });

  const d1 = await mk({ username: 'driver01', realName: '马建国', role: 'driver', phone: '13800000001', licenseNo: 'A1-20031', safetyTrainingExpiry: '2027-06-30' });
  const d2 = await mk({ username: 'driver02', realName: '刘安全', role: 'driver', phone: '13800000002', licenseNo: 'A1-20055', safetyTrainingExpiry: '2026-12-31' });
  // 当日已跑长途（约260分钟）的司机，用于加班补车工时上限校验
  const d4 = await mk({ username: 'driver04', realName: '陈长途', role: 'driver', phone: '13800000004', licenseNo: 'A1-20188', safetyTrainingExpiry: '2027-03-31' });
  // 安全培训过期司机（用于排班拦截演示）
  await mk({ username: 'driver03', realName: '张过期', role: 'driver', phone: '13800000003', licenseNo: 'A1-20099', safetyTrainingExpiry: '2025-01-01' });

  // 员工：白班/夜班，分属三企业
  const empDefs = [
    { username: 'emp_li', realName: '李磊', employeeNo: 'HX1001', companyId: c1.id, stationIdx: 1 },
    { username: 'emp_xu', realName: '徐静', employeeNo: 'HX1002', companyId: c1.id, stationIdx: 2 },
    { username: 'emp_wang', realName: '王敏', employeeNo: 'HX1003', companyId: c1.id, stationIdx: 3 },
    { username: 'emp_zhao', realName: '赵强', employeeNo: 'RF2001', companyId: c2.id, stationIdx: 2 },
    { username: 'emp_qian', realName: '钱多多', employeeNo: 'RF2002', companyId: c2.id, stationIdx: 4 },
    { username: 'emp_sun', realName: '孙丽', employeeNo: 'RF2003', companyId: c2.id, stationIdx: 5 },
    { username: 'emp_zhou', realName: '周婷', employeeNo: 'WL3001', companyId: c3.id, stationIdx: 1 },
    { username: 'emp_wu', realName: '吴刚', employeeNo: 'WL3002', companyId: c3.id, stationIdx: 3 },
  ];
  const emps: any[] = [];
  for (const d of empDefs) emps.push(await mk({ ...d, role: 'employee', homeStationId: null }));
  // 夜班员工
  const nightEmp = await mk({ username: 'emp_night', realName: '夜班·高源', employeeNo: 'RF2099', companyId: c2.id, role: 'employee' });

  // ---------- 线路 / 站点 ----------
  const l1 = await ds.getRepository(E.Line).save(ds.getRepository(E.Line).create({
    name: '东线（滨河—园区）', code: 'L-EAST', district: '东区', baseFare: 60, status: 'active',
  }));
  const l2 = await ds.getRepository(E.Line).save(ds.getRepository(E.Line).create({
    name: '西线（高新—园区）', code: 'L-WEST', district: '西区', baseFare: 45, status: 'active',
  }));
  await ds.createQueryBuilder().relation(E.Line, 'companies').of(l1).add([c1.id, c2.id, c3.id]); // 多企业共线
  await ds.createQueryBuilder().relation(E.Line, 'companies').of(l2).add([c1.id, c2.id]);

  const stRepo = ds.getRepository(E.Station);
  const eastStations = [];
  const eastNames = ['滨河家园', '东湖路口', '市民中心', '科技大桥', '园区东门'];
  for (let i = 0; i < eastNames.length; i++) {
    eastStations.push(await stRepo.save(stRepo.create({
      lineId: l1.id, name: eastNames[i], seq: i + 1, district: '东区',
      capacity: i === 1 ? 3 : 30, // 东湖路口容量小，便于容量演示
    })));
  }
  const westNames = ['高新花园', '软件园', '孵化基地', '园区西门'];
  const westStations = [];
  for (let i = 0; i < westNames.length; i++) {
    westStations.push(await stRepo.save(stRepo.create({
      lineId: l2.id, name: westNames[i], seq: i + 1, district: '西区', capacity: 30,
    })));
  }

  // ---------- 班次 ----------
  const schRepo = ds.getRepository(E.Schedule);
  const sMorning = await schRepo.save(schRepo.create({ name: '东线早班', direction: 'to_park', departureTime: '07:10', shiftLabel: '白班', lineId: l1.id }));
  const sEvening = await schRepo.save(schRepo.create({ name: '东线晚班', direction: 'from_park', departureTime: '17:40', shiftLabel: '白班', lineId: l1.id }));
  const sNight = await schRepo.save(schRepo.create({ name: '东线夜班(接驳)', direction: 'to_park', departureTime: '19:00', shiftLabel: '夜班', lineId: l1.id }));
  const sWestMorning = await schRepo.save(schRepo.create({ name: '西线早班', direction: 'to_park', departureTime: '07:25', shiftLabel: '白班', lineId: l2.id }));

  // ---------- 车辆 ----------
  const vRepo = ds.getRepository(E.Vehicle);
  const v1 = await vRepo.save(vRepo.create({ plate: '苏E·A1001', seats: 20, status: 'available' }));
  const v2 = await vRepo.save(vRepo.create({ plate: '苏E·B2002', seats: 45, status: 'available' }));
  const v3 = await vRepo.save(vRepo.create({ plate: '苏E·C3003', seats: 45, status: 'maintenance', note: '例行保养中' }));

  // ---------- 今日预约（早班：名单待生成；晚班/夜班部分预约） ----------
  const rRepo = ds.getRepository(E.Reservation);
  // 早班：员工分布到各站点（stationIdx 1..5 对应 eastStations[idx-1]）
  for (const d of empDefs) {
    await rRepo.save(rRepo.create({
      date: today, employeeId: emps.find(e => e.employeeNo === d.employeeNo).id,
      companyId: d.companyId, scheduleId: sMorning.id,
      stationId: eastStations[d.stationIdx - 1].id,
      withLuggage: d.employeeNo === 'RF2002',
      tempOvertime: false, status: 'booked',
    }));
  }
  // 晚班下班预约
  for (const e of emps.slice(0, 3)) {
    await rRepo.save(rRepo.create({
      date: today, employeeId: e.id, companyId: e.companyId,
      scheduleId: sEvening.id, stationId: eastStations[4].id, status: 'booked',
    }));
  }
  // 夜班预约（临时加班）
  await rRepo.save(rRepo.create({
    date: today, employeeId: nightEmp.id, companyId: nightEmp.companyId,
    scheduleId: sNight.id, stationId: eastStations[1].id,
    tempOvertime: true, overtimeNote: '产线急单，临时加班至夜班', withLuggage: true, status: 'booked',
  }));
  // 西线早班
  await rRepo.save(rRepo.create({
    date: today, employeeId: emps[2].id, companyId: emps[2].companyId,
    scheduleId: sWestMorning.id, stationId: westStations[1].id, status: 'booked',
  }));

  // ---------- 昨日已完成车次（档案+迟到+申诉） ----------
  const tripRepo = ds.getRepository(E.Trip);
  const histTrip: any = await tripRepo.save(tripRepo.create({
    date: yesterday, scheduleId: sMorning.id, vehicleId: v2.id, driverId: d1.id,
    status: 'arrived', plannedDepart: '07:10',
    actualDepart: new Date(`${yesterday}T07:15:00Z`),
    actualArrive: new Date(`${yesterday}T08:25:00Z`),
    delayMinutes: 30, boardedCount: 3, noShowCount: 0, emptySeats: 42,
    qrToken: crypto.randomBytes(8).toString('hex'),
    feeSplit: [{ companyId: c1.id, companyName: c1.name, passengers: 3, fee: 60 }],
  }));
  const histEmps = [emps[0], emps[1], emps[2]];
  const aRepo = ds.getRepository(E.AttendanceRecord);
  const plannedArrive = new Date(`${yesterday}T07:55:00Z`);
  const histRecs: any[] = [];
  for (let i = 0; i < histEmps.length; i++) {
    const e = histEmps[i];
    const rec = await aRepo.save(aRepo.create({
      date: yesterday, employeeId: e.id, companyId: e.companyId, tripId: histTrip.id,
      scheduledArrive: plannedArrive, actualArrive: new Date(`${yesterday}T08:25:00Z`),
      lateMinutes: 30, commonLateMinutes: 30, personalLateMinutes: 0,
      status: 'late', lateReason: i === 0 ? 'congestion' : 'late_arrival',
      exempt: false, makeupFee: 20,
      feeReason: '班车因道路事故晚点30分钟',
    }));
    histRecs.push(rec);
    if (i === 0) {
      // 李磊已提交申诉（昨日拥堵，HR 待审）
      await ds.getRepository(E.Appeal).save(ds.getRepository(E.Appeal).create({
        employeeId: e.id, attendanceId: rec.id,
        reason: '昨日滨河路大面积拥堵，新闻有通报，班车晚点非个人原因，申请豁免迟到并退还补车费。',
        evidence: '交通广播拥堵截图 + 班组签到记录',
        status: 'pending',
      }));
    }
  }
  await ds.getRepository(E.DriverPerformance).save(ds.getRepository(E.DriverPerformance).create({
    driverId: d1.id, tripId: histTrip.id, date: yesterday,
    safetyScore: 70, bonus: 0, penalty: 0, note: '晚点30分钟（道路拥堵）',
  }));

  // ---------- 今日 driver04 长途接驳（已到厂，驾驶约260分钟，用于加班补车工时上限校验） ----------
  await tripRepo.save(tripRepo.create({
    date: today, scheduleId: sNight.id, vehicleId: v2.id, driverId: d4.id,
    status: 'arrived', plannedDepart: '19:00',
    actualDepart: new Date(`${today}T18:00:00Z`),
    actualArrive: new Date(`${today}T22:20:00Z`),
    delayMinutes: 0, boardedCount: 1, noShowCount: 0, emptySeats: 44,
    qrToken: crypto.randomBytes(8).toString('hex'),
  }));
  await ds.getRepository(E.DriverPerformance).save(ds.getRepository(E.DriverPerformance).create({
    driverId: d4.id, date: today, safetyScore: 100, bonus: 0, penalty: 0, note: '长途接驳260分钟，接近工时上限',
  }));

  // ---------- 昨日未处理事件（调度/运营待办） ----------
  const histEvent = await ds.getRepository(E.TripEvent).save(ds.getRepository(E.TripEvent).create({
    tripId: histTrip.id, type: 'congestion', severity: 'warning',
    description: '滨河路早高峰交通事故，拥堵约30分钟', createdById: d1.id,
    createdByRole: 'driver', status: 'open', affectedCount: 3,
    compensationType: 'none',
  }));

  // ---------- 昨日事故晚点：平台已取证生成晚点考勤豁免证明（待 HR 批量确认） ----------
  const certRepo = ds.getRepository(E.LateCertificate);
  const itemRepo = ds.getRepository(E.LateCertificateAffected);
  const reviewRepo = ds.getRepository(E.LineReview);
  const certNo = `LATE-${yesterday.replace(/-/g, '')}-0001`;
  const reasonText = '道路交通事故（科技大桥上匝道·滨河路方向）导致东线（滨河—园区）晚到园区约 30 分钟';
  const incidentAt = new Date(`${yesterday}T07:22:00Z`);
  const seedCert = await certRepo.save(certRepo.create({
    certNo, tripId: histTrip.id, eventId: histEvent.id,
    date: yesterday, scheduleId: sMorning.id, lineId: l1.id,
    driverId: d1.id, vehicleId: v2.id,
    reasonType: 'accident', reasonText,
    incidentLocation: '科技大桥上匝道（滨河路方向）', incidentAt,
    gpsDepartAt: histTrip.actualDepart, gpsArriveAt: histTrip.actualArrive,
    plannedArrive, delayMinutes: 30, boardedCount: 3,
    status: 'pending_hr', systemGenerated: true,
    evidence: {
      sources: ['GPS 车辆定位', '站点扫码签到', '到厂打卡时间', '企业考勤规则'],
      gps: {
        vehiclePlate: v2.plate, actualDepart: histTrip.actualDepart, actualArrive: histTrip.actualArrive,
        plannedArrive, routeDelayMinutes: 30,
        incidentLocation: '科技大桥上匝道（滨河路方向）', incidentAt,
        trackSummary: `GPS 轨迹：车辆 ${v2.plate} 于 07:15 离场，08:25 抵达园区，计划到厂 07:55，科技大桥上匝道段低速滞留约28分钟，途中晚点 30 分钟`,
      },
      stationCheckins: histEmps.map((e, i) => ({
        employeeId: e.id, employeeNo: e.employeeNo, employeeName: e.realName, companyId: e.companyId,
        station: ['滨河家园', '东湖路口', '市民中心'][i], boardedAt: new Date(`${yesterday}T0${7}:${12 + i}:00Z`),
        status: 'boarded',
      })),
      rules: [{
        companyId: c1.id, companyName: c1.name, graceMinutes: 10, shiftStart: '08:30',
        lateFeeBase: 20, affectedCount: 3, overGraceCount: 3,
      }],
      event: { id: histEvent.id, type: 'congestion', typeName: '道路交通事故', description: histEvent.description, status: 'open' },
    },
    impactSummary: {
      totalEmployees: 3, delayMinutes: 30, lineName: l1.name, scheduleName: sMorning.name, shiftLabel: '白班',
      companies: [{
        companyId: c1.id, companyName: c1.name, scheduleId: sMorning.id,
        scheduleName: sMorning.name, shiftLabel: '白班', count: 3, overGraceCount: 3, feeTotal: 70,
      }],
    },
    generatorNote: '到厂自动取证：晚点 30 分钟 ≥ 阈值且关联道路事故事件',
    createdById: d1.id, createdByRole: 'driver',
  }));
  for (let i = 0; i < histEmps.length; i++) {
    await itemRepo.save(itemRepo.create({
      certificateId: seedCert.id, employeeId: histEmps[i].id, companyId: c1.id,
      scheduleId: sMorning.id, attendanceId: histRecs[i].id,
      stationName: ['滨河家园', '东湖路口', '市民中心'][i],
      boardedAt: new Date(`${yesterday}T07:${12 + i}:00Z`),
      lateMinutes: histRecs[i].lateMinutes, commonLateMinutes: 30, personalLateMinutes: 0,
      graceMinutes: 10,
      originalFee: histRecs[i].makeupFee, status: 'pending', writeback: false,
    }));
  }
  const seedReview = await reviewRepo.save(reviewRepo.create({
    lineId: l1.id, certificateId: seedCert.id, tripId: histTrip.id, date: yesterday,
    title: `${l1.name} ${sMorning.name} 晚点复盘（${certNo}）`,
    rootCause: reasonText, delayMinutes: 30, affectedCount: 3, exemptedCount: 0, status: 'open',
  }));
  seedCert.reviewId = seedReview.id;
  await certRepo.save(seedCert);
  // 通知华星 HR 批量处理
  await ds.getRepository(E.Notification).save(ds.getRepository(E.Notification).create({
    userId: hr1.id, title: '晚点考勤豁免证明待确认',
    content: `${certNo}：${reasonText}。贵司 3 名员工受影响，请批量确认豁免并回写考勤。`,
    category: 'warning',
  }));

  // ---------- 节假日/调休/天气停运示例 ----------
  const hRepo = ds.getRepository(E.Holiday);
  await hRepo.save(hRepo.create({ date: today, type: 'adjusted_workday', name: '调休上班（周日）', note: '国庆调休' }));
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await hRepo.save(hRepo.create({ date: future, type: 'suspended', name: '台风预警停运', note: '气象橙色预警，园区班车全天停运，考勤统一豁免' }));

  // ---------- 访客 ----------
  await ds.getRepository(E.VisitorPass).save(ds.getRepository(E.VisitorPass).create({
    visitorName: '访客·陈晓明', phone: '13900001111', hostCompanyId: c1.id, hostName: '徐静',
    visitDate: today, stationId: eastStations[2].id, scheduleId: sMorning.id,
    qrCode: 'V-DEMO20260915', status: 'registered', createdById: hr1.id,
  }));

  // ---------- 线路提案（待双确认） ----------
  await ds.getRepository(E.LineProposal).save(ds.getRepository(E.LineProposal).create({
    lineId: l1.id, type: 'adjust', title: '东线增设「滨河公园南」站点并提前5分钟发车',
    content: '近30天东线早班平均晚点12分钟，建议增设滨河公园南停靠点，首班发车由07:10提前至07:05。',
    impactSummary: '覆盖新增住宅小区约120名员工；预计月均晚点下降60%；企业分摊车费预计下降8%。',
    estimatedSaving: 1200, status: 'proposed', raisedById: operator.id,
    effectiveDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    companyConfirmations: [], employeeConfirmations: [],
  }));

  // ---------- 昨日西线真实事故晚点车次（GPS 晚点25分；含1名发车后补签到员工=公共25+个人15=40分；尚未出证） ----------
  const westAccEmps = [emps[1], emps[2], emps[4]]; // 徐静、王敏（华星）；钱多多（瑞丰）
  const westPersonalIdx = 1; // 王敏：发车后才赶到补签到，个人到站迟到 15 分钟
  const westTrip: any = await tripRepo.save(tripRepo.create({
    date: yesterday, scheduleId: sWestMorning.id, vehicleId: v2.id, driverId: d2.id,
    status: 'arrived', plannedDepart: '07:25',
    actualDepart: new Date(`${yesterday}T07:30:00Z`),
    actualArrive: new Date(`${yesterday}T08:35:00Z`),
    delayMinutes: 25, boardedCount: 3, noShowCount: 0, emptySeats: 42,
    qrToken: crypto.randomBytes(8).toString('hex'),
    feeSplit: [
      { companyId: c1.id, companyName: c1.name, passengers: 2, fee: 30 },
      { companyId: c2.id, companyName: c2.name, passengers: 1, fee: 15 },
    ],
  }));
  const westPlannedArrive = new Date(`${yesterday}T08:10:00Z`);
  const westStationIds = [westStations[0].id, westStations[1].id, westStations[2].id];
  for (let i = 0; i < westAccEmps.length; i++) {
    const e = westAccEmps[i];
    const isPersonal = i === westPersonalIdx;
    const personal = isPersonal ? 15 : 0;
    await rRepo.save(rRepo.create({
      date: yesterday, employeeId: e.id, companyId: e.companyId,
      scheduleId: sWestMorning.id, stationId: westStationIds[i], tripId: westTrip.id,
      // 王敏发车（07:30）后 07:35 才补签到 → late；其余正常签到 boarded
      status: isPersonal ? 'late' : 'boarded', seatNo: i + 1,
      boardedAt: isPersonal
        ? new Date(`${yesterday}T07:35:00Z`)
        : new Date(`${yesterday}T07:${26 + i * 2}:00Z`),
      changeNote: isPersonal ? '发车后补签到，按个人到站迟到处理' : undefined,
    }));
    const totalLate = 25 + personal;
    await aRepo.save(aRepo.create({
      date: yesterday, employeeId: e.id, companyId: e.companyId, tripId: westTrip.id,
      scheduledArrive: westPlannedArrive, actualArrive: westTrip.actualArrive,
      lateMinutes: totalLate, commonLateMinutes: 25, personalLateMinutes: personal,
      status: 'late', lateReason: isPersonal ? 'personal' : 'congestion', exempt: false,
      makeupFee: e.companyId === c2.id ? 30 : 20,
      feeReason: isPersonal
        ? `西线事故公共晚点25分钟 + 个人发车后补签到15分钟，共40分钟`
        : '西线班车因道路事故晚点25分钟，超企业宽限',
    }));
  }
  // 可追溯外部事件：同车次道路事故留痕（司机上报）
  await ds.getRepository(E.TripEvent).save(ds.getRepository(E.TripEvent).create({
    tripId: westTrip.id, type: 'accident', severity: 'critical',
    description: '高新大道转软件园匝道发生两车追尾事故，临时管制，西线早班晚点约25分钟',
    createdById: d2.id, createdByRole: 'driver', status: 'open', affectedCount: 3,
    compensationType: 'none',
  }));
  await ds.getRepository(E.DriverPerformance).save(ds.getRepository(E.DriverPerformance).create({
    driverId: d2.id, tripId: westTrip.id, date: yesterday,
    safetyScore: 75, bonus: 0, penalty: 0, note: '晚点25分钟（道路事故，待证明核验）',
  }));

  // ---------- 明日站点施工临时改站（员工待确认） ----------
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tomR = await rRepo.save(rRepo.create({
    date: tomorrow, employeeId: emps[2].id, companyId: c1.id,
    scheduleId: sMorning.id, stationId: eastStations[2].id, status: 'booked',
  }));
  const reloRepo = ds.getRepository(E.StationRelocation);
  const cfRepo = ds.getRepository(E.RelocationConfirmation);
  const demoRelo = await reloRepo.save(reloRepo.create({
    date: tomorrow, scheduleId: sMorning.id,
    originalStationId: eastStations[2].id, temporaryStationId: eastStations[3].id, lineId: l1.id,
    safePickupPoint: '科技大桥北引桥公交港湾（有照明、非机动车隔离）',
    walkMeters: 320,
    walkRoute: '由市民中心沿人行道步行约320米至科技大桥北引桥，途经1处信号灯控人行横道',
    reason: '市政道路施工，市民中心站公交港湾封闭',
    affectedCount: 1, status: 'proposed', createdById: dispatcher.id, createdByRole: 'dispatcher',
  }));
  tomR.relocationId = demoRelo.id; tomR.originalStationId = eastStations[2].id;
  await rRepo.save(tomR);
  await cfRepo.save(cfRepo.create({
    relocationId: demoRelo.id, reservationId: tomR.id, employeeId: emps[2].id, status: 'pending',
  }));
  await ds.getRepository(E.Notification).save(ds.getRepository(E.Notification).create({
    userId: emps[2].id, title: '临时改站通知（请确认）',
    content: `${tomorrow} 市民中心站因施工无法停靠，临时上车点改为科技大桥（步行约320米），请在 App 内确认。`,
    category: 'critical',
  }));

  // ---------- 加班补车：本月待派 1 单 + 上月已月结 1 单 ----------
  const supRepo = ds.getRepository(E.SupplementBus);
  const supPaxRepo = ds.getRepository(E.SupplementPassenger);
  const billRepo = ds.getRepository(E.MonthlyBilling);
  const feeOf = (pax: number, mins: number) => {
    const vehicleFee = 120;
    const driverOvertimeFee = Math.round(mins / 60 * 80);
    const perPassengerFee = pax * 10;
    const totalFee = vehicleFee + driverOvertimeFee + perPassengerFee;
    const parkSubsidy = Math.round(totalFee * 0.2);
    return { vehicleFee, driverOvertimeFee, perPassengerFee, totalFee, parkSubsidy, companyShare: totalFee - parkSubsidy, workMinutes: mins, perPerson: 10 };
  };
  await supRepo.save(supRepo.create({
    busNo: `BC-${today.replace(/-/g, '')}-0001`, date: today, companyId: c1.id, createdById: hr1.id,
    departAt: new Date(`${today}T23:00:00`), destination: '滨河家园片区（东线沿途）',
    passengerCount: 3, reason: '华星产线赶单，临时加班至23时', status: 'pending',
    feeSplit: feeOf(3, 45), totalFee: feeOf(3, 45).totalFee, driverWorkMinutes: 45,
  }));

  const d = new Date(Date.now() - 40 * 86400000);
  const lastMonthDate = d.toISOString().slice(0, 10);
  const lastPeriod = lastMonthDate.slice(0, 7);
  const lastFee = feeOf(2, 50);
  const lastBilling = await billRepo.save(billRepo.create({
    period: lastPeriod, status: 'confirmed', totalAmount: lastFee.totalFee, supplementCount: 1,
    companyBreakdown: [{
      companyId: c2.id, companyName: c2.name, supplementCount: 1, passengerCount: 2, driverWorkMinutes: 50,
      vehicleFee: lastFee.vehicleFee, driverOvertimeFee: lastFee.driverOvertimeFee,
      perPassengerFee: lastFee.perPassengerFee, companyShare: lastFee.companyShare, parkSubsidy: lastFee.parkSubsidy,
      total: lastFee.totalFee, busNos: [],
    }],
    confirmedById: operator.id, confirmedAt: new Date(),
  }));
  const lastBus = await supRepo.save(supRepo.create({
    busNo: `BC-${lastMonthDate.replace(/-/g, '')}-0002`, date: lastMonthDate, companyId: c2.id,
    createdById: hr2.id, departAt: new Date(`${lastMonthDate}T22:40:00`),
    actualDepartAt: new Date(`${lastMonthDate}T22:40:00`), actualArriveAt: new Date(`${lastMonthDate}T23:30:00`),
    destination: '瑞丰夜班宿舍区', passengerCount: 2, reason: '瑞丰月度盘点加班',
    vehicleId: v1.id, driverId: d2.id, status: 'settled', reviewedById: dispatcher.id,
    feeSplit: lastFee, totalFee: lastFee.totalFee, driverWorkMinutes: 50,
    restReset: true, restDueAt: new Date(`${lastMonthDate}T23:50:00`), billingId: lastBilling.id,
  }));
  for (const eid of [emps[3].id, emps[4].id]) {
    await supPaxRepo.save(supPaxRepo.create({
      supplementBusId: lastBus.id, employeeId: eid, companyId: c2.id,
      status: 'boarded', boardedAt: new Date(`${lastMonthDate}T22:40:00`),
    }));
  }

  // ---------- 企业搬迁线路重排（恒信搬迁至滨湖智造园，西线冻结/意见征集） ----------
  const rlRepo = ds.getRepository(E.LineRelocation);
  const rlOptRepo = ds.getRepository(E.LineRelocationOption);
  const rlFbRepo = ds.getRepository(E.LineRelocationFeedback);
  const westScheds = await ds.getRepository(E.Schedule).find({ where: { lineId: l2.id } });
  const westActiveRes = await rRepo.find({
    where: { scheduleId: In(westScheds.map(s => s.id)), status: In(['booked', 'on_manifest']) },
  });
  const effectDay = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const demoRl = await rlRepo.save(rlRepo.create({
    rlNo: `RL-${effectDay.replace(/-/g, '')}-0001`,
    companyId: c3.id, oldLineId: l2.id,
    title: '恒信物流搬迁至滨湖智造园 · 西线重排',
    newSiteName: '滨湖智造园', newSiteAddress: '滨湖新区智造大道 88 号',
    status: 'consulting', bookingFrozen: false,
    effectDate: effectDay, transitionEnd: effectDay,
    impact: {
      companyName: c3.name, oldLineName: l2.name,
      schedules: westScheds.map(s => ({ id: s.id, name: s.name, direction: s.direction, departureTime: s.departureTime, shiftLabel: s.shiftLabel })),
      stations: westStations.map(s => ({ id: s.id, name: s.name, seq: s.seq, capacity: s.capacity, status: s.status })),
      activeReservationCount: westActiveRes.length, employeeCount: 2,
      reservations: westActiveRes.map(r => ({ id: r.id, employeeId: r.employeeId, companyId: r.companyId, scheduleId: r.scheduleId, stationId: r.stationId, date: r.date, status: r.status })),
    },
    hrScheduleNote: '新厂区两班倒，夜班需保留 22:00 接驳',
    createdById: operator.id,
  }));
  const demoOpts = [
    { name: '方案A·沿原走向北延至智造园（直达，推荐）', crossDistrict: false, addedFeePerMonth: 0, estimatedArriveMinutes: 5 },
    { name: '方案C·跨区接驳（经东区枢纽换乘）', crossDistrict: true, addedFeePerMonth: 3600, estimatedArriveMinutes: 22 },
  ];
  for (let i = 0; i < demoOpts.length; i++) {
    const o = demoOpts[i];
    await rlOptRepo.save(rlOptRepo.create({
      relocationId: demoRl.id, ...o, chosen: false,
      stations: westStations.map((s, k) => ({
        name: o.crossDistrict && k === westStations.length - 1 ? '智造园接驳枢纽' : s.name,
        walkMeters: 180 + ((s.seq + i) % 4) * 90,
        arriveTime: `08:${String(10 + k * 4 + i * 2).padStart(2, '0')}`,
        transferNote: o.crossDistrict && k === 0 ? '需在枢纽换乘跨区班车' : '直达智造园',
      })),
      scheduleLinks: westScheds.map(s => ({ scheduleName: s.name, oldDeparture: s.departureTime, newDeparture: s.departureTime, linkNote: o.crossDistrict ? '跨区加开摆渡' : '时刻平移' })),
    }));
  }
  await rlFbRepo.save(rlFbRepo.create({
    relocationId: demoRl.id, optionId: null, employeeId: emps[6].id, verdict: 'change_request',
    stationName: '孵化基地', walkMeters: 450, arriveTime: '08:18',
    comment: '孵化基地步行到临停点偏元，建议保留早 07:05 班次',
  }));
  // 西线保持正常运营（该演示单用于展示盘点/候选/意见，真实冻结由发起流程触发）

  console.log('Seed finished. Accounts (password: Pass1234):');
  console.log('  admin / operator / dispatcher');
  console.log('  hr_huaxing / hr_ruifeng / hr_hengxin');
  console.log('  driver01 / driver02 / driver03(expired)');
  console.log('  emp_li / emp_xu / emp_wang / emp_zhao / emp_qian / emp_sun / emp_zhou / emp_wu / emp_night');
  await ds.destroy();
}

main().catch(async (e) => { console.error(e); process.exit(1); });
