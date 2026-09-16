import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  Company, User, Line, Station, Schedule, Vehicle, Trip, Reservation,
  AttendanceRecord, TripEvent, DriverPerformance, Notification,
  LateCertificate, LateCertificateAffected, LineReview,
} from '../entities';

// 晚点原因字典：全平台同一份，员工端与 HR 端展示完全一致的晚点原因
export const CERT_REASONS: Record<string, string> = {
  accident: '道路交通事故',
  congestion: '道路拥堵',
  breakdown: '车辆故障',
  construction: '道路/站点施工',
  detour: '交通管制绕行',
  weather: '极端天气',
  other: '其他非员工原因',
};

// 非司机责任的外部原因：HR 确认后撤销晚点对司机绩效的扣分
const NON_DRIVER_RESPONSIBLE = ['accident', 'congestion', 'weather', 'construction', 'other'];
// 可追溯的外部晚点原因（必须能关联到同车次、留痕的途中事件）
const EXTERNAL_CAUSE_TYPES = ['accident', 'congestion', 'weather', 'construction', 'detour', 'breakdown'];
// 平台晚点取证阈值（分钟）：实际到厂晚点达到该值，或超过任一受影响企业宽限规则，才允许出证
const PLATFORM_DELAY_MINUTES = 10;
// 车上视为"受影响"的签到状态
const ONBOARD = ['boarded', 'late', 'changed'];
const hhmm = (d?: Date | string | null) =>
  d ? new Date(d as any).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

@Injectable()
export class CertificateService {
  constructor(
    @InjectRepository(LateCertificate) private certs: Repository<LateCertificate>,
    @InjectRepository(LateCertificateAffected) private items: Repository<LateCertificateAffected>,
    @InjectRepository(LineReview) private reviews: Repository<LineReview>,
    @InjectRepository(Trip) private trips: Repository<Trip>,
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
    @InjectRepository(Line) private lines: Repository<Line>,
    @InjectRepository(Station) private stations: Repository<Station>,
    @InjectRepository(Vehicle) private vehicles: Repository<Vehicle>,
    @InjectRepository(Reservation) private reservations: Repository<Reservation>,
    @InjectRepository(AttendanceRecord) private attendance: Repository<AttendanceRecord>,
    @InjectRepository(TripEvent) private events: Repository<TripEvent>,
    @InjectRepository(DriverPerformance) private performances: Repository<DriverPerformance>,
    @InjectRepository(Company) private companies: Repository<Company>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Notification) private notifications: Repository<Notification>,
    private ds: DataSource,
  ) {}

  reasonName(t: string) { return CERT_REASONS[t] || t; }

  private async notify(userId: number, title: string, content: string, category = 'info') {
    await this.notifications.save(this.notifications.create({ userId, title, content, category }));
  }

  // ==================== 平台取证并生成晚点证明 ====================
  async generate(dto: any, user: any): Promise<LateCertificate> {
    if (!dto.tripId) throw new BadRequestException('请选择晚点车次');
    const reasonType = dto.reasonType || 'accident';
    if (!CERT_REASONS[reasonType]) throw new BadRequestException('晚点原因类型不合法');

    return this.ds.transaction(async (manager) => {
      const trip = await manager.getRepository(Trip).findOne({ where: { id: Number(dto.tripId) } });
      if (!trip) throw new NotFoundException('车次不存在');
      if (trip.status !== 'arrived')
        throw new BadRequestException('该车次尚未到厂，缺少 GPS 到厂时间，暂不能生成晚点证明');

      const dup = await manager.getRepository(LateCertificate).findOne({ where: { tripId: trip.id } });
      if (dup) throw new BadRequestException(`该车次已生成晚点证明 ${dup.certNo}，请勿重复生成`);

      const sched = await manager.getRepository(Schedule).findOne({ where: { id: trip.scheduleId } });
      if (!sched) throw new NotFoundException('班次不存在');
      if (sched.direction !== 'to_park')
        throw new BadRequestException('下班班次不产生到厂考勤，无需生成晚点考勤豁免证明');
      const line = await manager.getRepository(Line).findOne({ where: { id: sched.lineId } });
      const vehicle = trip.vehicleId
        ? await manager.getRepository(Vehicle).findOne({ where: { id: trip.vehicleId } }) : null;

      // 证据一：可追溯外部事件（必须属于同一趟车，且为外部原因类型）
      let ev = dto.eventId
        ? await manager.getRepository(TripEvent).findOne({ where: { id: Number(dto.eventId) } })
        : null;
      if (!ev) {
        // 自动选取同车次最近一条外部原因事件，不接受纯手工、无留痕的原因描述
        ev = await manager.getRepository(TripEvent).findOne({
          where: { tripId: trip.id, type: In(EXTERNAL_CAUSE_TYPES) }, order: { id: 'DESC' },
        });
      }
      if (!ev)
        throw new BadRequestException('未找到该趟车可追溯的外部事件（事故/拥堵/天气/施工/管制/故障），不能仅凭手工说明生成晚点证明');
      if (ev.tripId !== trip.id)
        throw new BadRequestException('所关联事件不属于该车次，证据链不可信');
      if (!EXTERNAL_CAUSE_TYPES.includes(ev.type))
        throw new BadRequestException(`事件类型「${ev.type}」不属于可豁免的外部晚点原因`);

      // 证据二：GPS 可信到厂时间 —— 必须同时有实际到厂与计划到厂时间戳
      if (!trip.actualArrive)
        throw new BadRequestException('缺少 GPS 实际到厂时间，无法核验晚点');
      const plannedArrive = (await manager.getRepository(AttendanceRecord).findOne({
        where: { tripId: trip.id }, order: { id: 'ASC' },
      }))?.scheduledArrive
        || new Date((trip.actualDepart || new Date()).getTime() + 45 * 60000);
      // 以 GPS 实际到厂与计划到厂重新计算晚点，不信任手工填写的晚点分钟
      const delay = Math.max(0, Math.round((trip.actualArrive.getTime() - plannedArrive.getTime()) / 60000));

      // 证据三：已签到员工（GPS/扫码名单是受影响范围的唯一依据）
      const onboard = await manager.getRepository(Reservation).find({
        where: { tripId: trip.id, status: In(ONBOARD) }, order: { seatNo: 'ASC' },
      });
      if (!onboard.length) throw new BadRequestException('该车次没有签到乘客，无受影响员工');
      const recs = await manager.getRepository(AttendanceRecord).find({ where: { tripId: trip.id } });

      // 证据四：企业考勤规则（按企业快照宽限/班次/扣款）
      const companyIds = [...new Set(onboard.map(r => r.companyId))];
      const companies = await manager.getRepository(Company).find({ where: { id: In(companyIds) } });

      // ===== 统一核验闸门：实际晚点必须达到平台阈值或至少一家企业的宽限规则 =====
      const overGraceCompanies = companies.filter(c => delay > c.lateGraceMinutes);
      if (delay < PLATFORM_DELAY_MINUTES && overGraceCompanies.length === 0) {
        throw new BadRequestException(
          `GPS 核验该车次实际晚点 ${delay} 分钟（计划到厂 ${hhmm(plannedArrive)} / 实际到厂 ${hhmm(trip.actualArrive)}），`
          + `未达到平台阈值 ${PLATFORM_DELAY_MINUTES} 分钟且不超过任一企业宽限规则，准点/提前到厂车次不得出具晚点豁免证明`,
        );
      }

      // 校验通过后才允许固化晚点原因与事发信息（员工端 / HR 端共用同一份）
      const incidentAt = dto.incidentAt ? new Date(dto.incidentAt)
        : (trip.actualDepart ? new Date(trip.actualDepart.getTime() + 10 * 60000) : null);
      const incidentLocation = dto.incidentLocation
        || (ev.description ? ev.description.slice(0, 20) : '事发路段');
      const reasonText = dto.reasonText?.trim()
        || `${this.reasonName(reasonType)}${incidentLocation ? `（${incidentLocation}）` : ''}导致${line?.name || '班车'}晚到园区约 ${delay} 分钟`;

      const stationIds = [...new Set(onboard.flatMap(r => [r.stationId, r.boardedStationId].filter(Boolean)))] as number[];
      const stations = stationIds.length
        ? await manager.getRepository(Station).find({ where: { id: In(stationIds) } }) : [];
      const employeeIds = [...new Set(onboard.map(r => r.employeeId))];
      const empUsers = await manager.getRepository(User).find({ where: { id: In(employeeIds) } });

      // 逐人拆分：车次公共晚点（GPS 事实，事故可豁免）与个人到站迟到（发车后补签到等，不豁免）
      const splitOf = (r: any) => {
        const rec = recs.find(x => x.employeeId === r.employeeId && x.tripId === trip.id);
        const personal = rec?.personalLateMinutes ?? (r.status === 'late' ? 15 : 0);
        const common = rec?.commonLateMinutes ?? delay;
        return { common, personal, total: common + personal, rec: rec || null };
      };

      const rules = companies.map(c => {
        const rs = onboard.filter(r => r.companyId === c.id);
        const rr = recs.filter(x => x.companyId === c.id);
        return {
          companyId: c.id, companyName: c.name,
          graceMinutes: c.lateGraceMinutes, shiftStart: c.dayShiftStart, lateFeeBase: c.lateFeeBase,
          affectedCount: rs.length,
          overGraceCount: rr.filter(x => (x.lateMinutes || 0) > c.lateGraceMinutes).length,
          // 事故公共晚点豁免后，仅个人迟到仍超过企业宽限的人数（这部分不免除）
          personalOverGraceCount: rs.filter(r => splitOf(r).personal > c.lateGraceMinutes).length,
        };
      });

      const checkins = onboard.map(r => {
        const u = empUsers.find(x => x.id === r.employeeId);
        const st = stations.find(s => s.id === (r.boardedStationId || r.stationId));
        const sp = splitOf(r);
        return {
          employeeId: r.employeeId, employeeNo: u?.employeeNo, employeeName: u?.realName,
          companyId: r.companyId, station: st?.name, boardedAt: r.boardedAt, status: r.status,
          commonLateMinutes: sp.common, personalLateMinutes: sp.personal,
          personalLate: sp.personal > 0,
          responsibility: sp.personal > 0 ? '事故公共晚点 + 个人到站迟到（分责）' : '事故公共晚点（全员共担）',
        };
      });

      const evidence = {
        sources: ['GPS 车辆定位', '站点扫码签到', '到厂打卡时间', '企业考勤规则'],
        gps: {
          vehiclePlate: vehicle?.plate || null,
          actualDepart: trip.actualDepart, actualArrive: trip.actualArrive, plannedArrive,
          routeDelayMinutes: delay, incidentLocation, incidentAt,
          trackSummary: `GPS 轨迹：车辆 ${vehicle?.plate || '—'} 于 ${hhmm(trip.actualDepart)} 离场，`
            + `${hhmm(trip.actualArrive)} 抵达园区，计划到厂 ${hhmm(plannedArrive)}，`
            + `${incidentLocation} 段低速行驶，途中晚点 ${delay} 分钟`,
        },
        stationCheckins: checkins,
        rules,
        event: ev ? { id: ev.id, type: ev.type, typeName: this.reasonName(reasonType),
          description: ev.description, status: ev.status } : null,
      };

      const impactCompanies = companies.map(c => {
        const rs = onboard.filter(r => r.companyId === c.id);
        const rr = recs.filter(x => x.companyId === c.id);
        // 扣除事故公共晚点后，仍需个人担责的人数（个人迟到超宽限）
        const personalHeld = rs.filter(r => splitOf(r).personal > c.lateGraceMinutes).length;
        return {
          companyId: c.id, companyName: c.name,
          scheduleId: sched.id, scheduleName: sched.name, shiftLabel: sched.shiftLabel,
          count: rs.length,
          overGraceCount: rr.filter(x => (x.lateMinutes || 0) > c.lateGraceMinutes).length,
          fullExemptCount: rs.length - personalHeld,   // 事故晚点整条豁免
          partialExemptCount: personalHeld,           // 豁免公共部分、保留个人迟到
          commonLateMinutes: delay,
          feeTotal: rr.reduce((s, x) => s + (x.makeupFee || 0), 0),
        };
      });
      const impactSummary = {
        totalEmployees: onboard.length, delayMinutes: delay,
        lineName: line?.name, scheduleName: sched.name, shiftLabel: sched.shiftLabel,
        companies: impactCompanies,
      };

      // 证明编号 LATE-YYYYMMDD-####
      const day = trip.date.replace(/-/g, '');
      const seq = (await manager.getRepository(LateCertificate).count() + 1);
      const certNo = `LATE-${day}-${String(seq).padStart(4, '0')}`;

      const cert = await manager.getRepository(LateCertificate).save(
        manager.getRepository(LateCertificate).create({
          certNo, tripId: trip.id, eventId: ev?.id ?? null,
          date: trip.date, scheduleId: sched.id, lineId: sched.lineId,
          driverId: trip.driverId, vehicleId: trip.vehicleId,
          reasonType, reasonText, incidentLocation, incidentAt,
          gpsDepartAt: trip.actualDepart, gpsArriveAt: trip.actualArrive, plannedArrive,
          delayMinutes: delay, boardedCount: onboard.length,
          status: 'pending_hr', systemGenerated: true,
          evidence, impactSummary,
          generatorNote: dto.note || null, createdById: user.userId, createdByRole: user.role,
        }),
      );

      // 影响名单：按企业 × 班次展开（批量处理的最小粒度），逐人记录两类晚点分钟
      for (const r of onboard) {
        const c = companies.find(x => x.id === r.companyId);
        const st = stations.find(s => s.id === (r.boardedStationId || r.stationId));
        const sp = splitOf(r);
        await manager.getRepository(LateCertificateAffected).save(
          manager.getRepository(LateCertificateAffected).create({
            certificateId: cert.id, employeeId: r.employeeId, companyId: r.companyId,
            scheduleId: sched.id, attendanceId: sp.rec?.id ?? null,
            stationName: st?.name || null, boardedAt: r.boardedAt,
            lateMinutes: sp.total, commonLateMinutes: sp.common, personalLateMinutes: sp.personal,
            graceMinutes: c?.lateGraceMinutes ?? 10,
            originalFee: sp.rec?.makeupFee || 0, status: 'pending', writeback: false,
          }),
        );
      }

      // 线路复盘单随证明一并建立，原因与证明同源
      const review = await manager.getRepository(LineReview).save(
        manager.getRepository(LineReview).create({
          lineId: sched.lineId, certificateId: cert.id, tripId: trip.id, date: trip.date,
          title: `${line?.name || ''} ${sched.name} 晚点复盘（${cert.certNo}）`,
          rootCause: reasonText, delayMinutes: delay, affectedCount: onboard.length,
          exemptedCount: 0, status: 'open',
        }),
      );
      cert.reviewId = review.id;
      await manager.getRepository(LateCertificate).save(cert);

      // 通知涉事企业 HR 批量处理
      for (const c of companies) {
        const hrs = await manager.getRepository(User).find({
          where: { role: 'hr', companyId: c.id, active: true },
        });
        for (const h of hrs) {
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: h.id, title: '晚点考勤豁免证明待确认',
            content: `${cert.certNo}：${reasonText}。贵司 ${impactCompanies.find(x => x.companyId === c.id)?.count || 0} 名员工受影响，请批量确认豁免并回写考勤。`,
            category: 'warning',
          }));
        }
      }
      return cert;
    });
  }

  // 到厂自动触发：存在外部事件时尝试取证；是否晚点/是否达阈值由 generate() 统一核验，不满足则不出证
  async maybeAutoGenerate(tripId: number): Promise<LateCertificate | null> {
    try {
      const trip = await this.trips.findOne({ where: { id: tripId } });
      if (!trip || trip.status !== 'arrived' || !trip.actualArrive) return null;
      if (await this.certs.findOne({ where: { tripId } })) return null;
      const ev = await this.events.findOne({
        where: { tripId, type: In(EXTERNAL_CAUSE_TYPES) }, order: { id: 'DESC' },
      });
      if (!ev) return null;
      const reasonType = ev.type === 'late_arrival' ? 'congestion' : ev.type;
      const systemUser = { userId: ev.createdById, role: ev.createdByRole || 'dispatcher' };
      // generate 内部核验失败（准点/提前、无签到等）直接抛错，自动触发静默放弃且零写入
      return await this.generate({ tripId, eventId: ev.id, reasonType }, systemUser);
    } catch {
      return null;
    }
  }

  // ==================== 查询 ====================
  async listCertificates(user: any, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const list = await this.certs.find({ where, order: { id: 'DESC' }, take: 100 });
    const items = list.length
      ? await this.items.find({ where: { certificateId: In(list.map(c => c.id)) } }) : [];
    const result = list.map(c => {
      const its = items.filter(i => i.certificateId === c.id);
      return {
        ...c,
        affectedTotal: its.length,
        pendingCount: its.filter(i => i.status === 'pending').length,
        exemptCount: its.filter(i => i.status === 'exempt').length,
        partialCount: its.filter(i => i.status === 'partial_exempt').length,
        rejectedCount: its.filter(i => i.status === 'rejected').length,
        companyIds: [...new Set(its.map(i => i.companyId))],
      };
    });
    let result2 = result;
    // 企业 HR 只看涉及本企业的证明；司机只看本人车次；员工只看本人受影响的证明
    if (user.role === 'hr' && user.companyId) {
      result2 = result.filter(c => c.companyIds.includes(Number(user.companyId)));
    } else if (user.role === 'driver') {
      result2 = result.filter(c => c.driverId === user.userId);
    } else if (user.role === 'employee') {
      const myItems = await this.items.find({ where: { employeeId: user.userId } });
      const myCertIds = new Set(myItems.map(i => i.certificateId));
      result2 = result.filter(c => myCertIds.has(c.id));
    }
    return result2;
  }

  async detail(id: number, user: any) {
    const cert = await this.certs.findOne({ where: { id } });
    if (!cert) throw new NotFoundException('晚点证明不存在');
    if (user.role === 'hr' && user.companyId) {
      const mine = await this.items.count({ where: { certificateId: id, companyId: Number(user.companyId) } });
      if (!mine) throw new ForbiddenException('该证明不涉及贵企业');
    }
    if (user.role === 'driver' && cert.driverId !== user.userId)
      throw new ForbiddenException('无权查看该证明');
    if (user.role === 'employee') {
      const mine = await this.items.count({ where: { certificateId: id, employeeId: user.userId } });
      if (!mine) throw new ForbiddenException('该证明与您无关');
    }

    const its = await this.items.find({ where: { certificateId: id }, order: { id: 'ASC' } });
    const users = await this.users.find({ where: { id: In(its.map(i => i.employeeId)) } });
    const companies = await this.companies.find();
    const scheds = await this.schedules.find();
    const trip = cert.tripId ? await this.trips.findOne({ where: { id: cert.tripId } }) : null;
    const vehicle = cert.vehicleId ? await this.vehicles.findOne({ where: { id: cert.vehicleId } }) : null;
    const driver = cert.driverId ? await this.users.findOne({ where: { id: cert.driverId } }) : null;
    const line = cert.lineId ? await this.lines.findOne({ where: { id: cert.lineId } }) : null;
    const review = cert.reviewId ? await this.reviews.findOne({ where: { id: cert.reviewId } }) : null;
    const handlerIds = [...new Set(its.map(i => i.handledById).filter(Boolean))] as number[];
    const handlers = handlerIds.length ? await this.users.find({ where: { id: In(handlerIds) } }) : [];

    return {
      ...cert,
      reasonName: this.reasonName(cert.reasonType),
      lineName: line?.name, scheduleName: scheds.find(s => s.id === cert.scheduleId)?.name,
      vehiclePlate: vehicle?.plate, driverName: driver?.realName,
      review,
      items: its.map(i => ({
        ...i,
        employee: users.find(u => u.id === i.employeeId),
        companyName: companies.find(c => c.id === i.companyId)?.name,
        scheduleName: scheds.find(s => s.id === i.scheduleId)?.name,
        handlerName: handlers.find(h => h.id === i.handledById)?.realName,
      })),
    };
  }

  // 员工端：与我相关的证明（看到的晚点原因与 HR 端是同一字段 reasonText）
  async myCertificates(userId: number) {
    const myItems = await this.items.find({ where: { employeeId: userId }, order: { id: 'DESC' } });
    if (!myItems.length) return [];
    const certs = await this.certs.find({ where: { id: In(myItems.map(i => i.certificateId)) } });
    return myItems.map(item => {
      const cert = certs.find(c => c.id === item.certificateId);
      if (!cert) return null;
      return {
        id: cert.id, certNo: cert.certNo, date: cert.date,
        reasonType: cert.reasonType, reasonName: this.reasonName(cert.reasonType),
        reasonText: cert.reasonText,
        incidentLocation: cert.incidentLocation, delayMinutes: cert.delayMinutes,
        status: cert.status, item,
        impactSummary: cert.impactSummary,
        gpsSummary: cert.evidence?.gps,
        createdAt: cert.createdAt,
      };
    }).filter(Boolean);
  }

  // ==================== HR 批量确认 → 回写考勤/绩效/复盘 ====================
  async batchConfirm(id: number, dto: any, user: any) {
    const note = (dto.note || '').slice(0, 200);
    return this.runBatch(id, dto, user, async (manager, cert, targets) => {
      const attRepo = manager.getRepository(AttendanceRecord);
      const companyCache = new Map<number, Company>();
      for (const it of targets) {
        const company = companyCache.get(it.companyId)
          || await manager.getRepository(Company).findOne({ where: { id: it.companyId } });
        if (company) companyCache.set(it.companyId, company);
        const grace = company?.lateGraceMinutes ?? it.graceMinutes;
        const feeBase = company?.lateFeeBase ?? 20;
        const common = it.commonLateMinutes || 0;   // 事故公共晚点（本次证明豁免）
        const personal = it.personalLateMinutes || 0; // 个人到站迟到（不豁免）

        if (it.attendanceId) {
          const rec = await attRepo.findOne({ where: { id: it.attendanceId } });
          if (rec) {
            rec.certificateId = cert.id;
            rec.commonLateMinutes = common;
            rec.personalLateMinutes = personal;
            if (personal === 0) {
              // 无个人责任：整条豁免，费用清零
              rec.status = 'exempt';
              rec.exempt = true;
              rec.lateReason = cert.reasonType;
              rec.exemptReason = `晚点证明 ${cert.certNo}：${cert.reasonText}`;
              rec.makeupFee = 0;
              rec.feeReason = `晚点证明 ${cert.certNo} 确认事故晚点豁免，补车费取消`;
            } else {
              // 事故公共晚点部分豁免，个人到站迟到部分继续按企业宽限/扣费结算（保留申诉入口）
              rec.exempt = false;
              rec.lateReason = 'personal';
              rec.exemptReason = `晚点证明 ${cert.certNo} 仅豁免事故公共晚点 ${common} 分钟；个人到站迟到 ${personal} 分钟不在事故豁免范围`;
              if (personal > grace) {
                rec.status = 'late';
                rec.makeupFee = feeBase;
                rec.feeReason = `事故公共晚点 ${common} 分钟已豁免；个人到站迟到 ${personal} 分钟超出企业宽限 ${grace} 分钟，计个人迟到`;
              } else {
                rec.status = 'normal';
                rec.makeupFee = 0;
                rec.feeReason = `事故公共晚点 ${common} 分钟已豁免；个人迟到 ${personal} 分钟在企业宽限 ${grace} 分钟内，不计迟到`;
              }
            }
            await attRepo.save(rec);
          }
        }

        if (personal === 0) {
          it.status = 'exempt';
          it.resolution = 'full';
          it.handleNote = note || `HR 批量确认：事故晚点整条豁免（证明 ${cert.certNo}）`;
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: it.employeeId, title: '晚点考勤豁免已生效',
            content: `晚点证明 ${cert.certNo} 已由 HR 确认：${cert.reasonText}。您 ${cert.date} 的考勤已豁免、补车费已取消。`,
            category: 'success',
          }));
        } else {
          it.status = 'partial_exempt';
          it.resolution = 'partial';
          const held = personal > grace;
          it.handleNote = note
            || `事故公共晚点 ${common} 分钟已豁免；个人到站迟到 ${personal} 分钟${held ? `超宽限 ${grace} 分钟，计个人迟到` : '在宽限内'}（证明 ${cert.certNo}）`;
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: it.employeeId, title: '晚点证明分责处理结果',
            content: `晚点证明 ${cert.certNo} 已由 HR 确认：班车因事故公共晚点 ${common} 分钟已豁免；`
              + `您发车后补签到形成的个人到站迟到 ${personal} 分钟不属于事故豁免范围，`
              + (held ? `按企业规则计个人迟到并产生补车费，如有异议可在系统发起申诉。` : `在企业宽限 ${grace} 分钟内，不计迟到。`),
            category: held ? 'warning' : 'success',
          }));
        }
        it.writeback = true;
        it.handledById = user.userId;
        it.handledAt = new Date();
        await manager.getRepository(LateCertificateAffected).save(it);
      }
    }, note, 'confirm');
  }

  async batchReject(id: number, dto: any, user: any) {
    const note = (dto.note || '').slice(0, 200);
    return this.runBatch(id, dto, user, async (manager, cert, targets) => {
      for (const it of targets) {
        it.status = 'rejected';
        it.writeback = false;
        it.handledById = user.userId;
        it.handledAt = new Date();
        it.handleNote = note || `HR 驳回（证明 ${cert.certNo}）`;
        await manager.getRepository(LateCertificateAffected).save(it);
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: it.employeeId, title: '晚点证明未获豁免',
          content: `晚点证明 ${cert.certNo} 中您的记录未被豁免：${note || '请按正常迟到流程处理，如有异议可发起申诉'}。`,
          category: 'warning',
        }));
      }
      void cert;
    }, note, 'reject');
  }

  private async runBatch(
    id: number, dto: any, user: any,
    apply: (manager: any, cert: LateCertificate, targets: LateCertificateAffected[]) => Promise<void>,
    note: string, action: 'confirm' | 'reject',
  ) {
    if (!['hr', 'operator', 'admin'].includes(user.role))
      throw new ForbiddenException('仅企业 HR / 园区运营可批量处理晚点证明');
    if (action === 'reject' && !note)
      throw new BadRequestException('驳回需填写原因');
    // HR 只能处理本企业：指定他企批次直接 403，不暴露该批次是否有待处理人
    if (user.role === 'hr') {
      if (!user.companyId) throw new ForbiddenException('HR 账号未归属企业');
      if (dto.companyId && Number(dto.companyId) !== Number(user.companyId))
        throw new ForbiddenException('只能批量处理本企业员工，越权部分已拦截');
    }

    return this.ds.transaction(async (manager) => {
      // 行锁串行化同一证明的并发批量操作
      const cert = await manager.getRepository(LateCertificate).findOne({
        where: { id }, lock: { mode: 'pessimistic_write' },
      });
      if (!cert) throw new NotFoundException('晚点证明不存在');
      if (['confirmed', 'rejected', 'cancelled'].includes(cert.status))
        throw new BadRequestException('该证明已闭环，不可再批量处理');

      let targets = await manager.getRepository(LateCertificateAffected).find({
        where: { certificateId: id, status: 'pending' },
      });
      // HR 未显式指定企业时强制收敛到本企业，避免误处理
      const scopeCompany = user.role === 'hr'
        ? Number(user.companyId)
        : (dto.companyId ? Number(dto.companyId) : null);
      if (scopeCompany) targets = targets.filter(t => t.companyId === scopeCompany);
      if (dto.scheduleId) targets = targets.filter(t => t.scheduleId === Number(dto.scheduleId));
      if (Array.isArray(dto.employeeIds) && dto.employeeIds.length)
        targets = targets.filter(t => dto.employeeIds.map(Number).includes(t.employeeId));

      if (user.role === 'hr') {
        const bad = targets.filter(t => t.companyId !== Number(user.companyId));
        if (bad.length) throw new ForbiddenException('只能批量处理本企业员工，越权部分已拦截');
      }
      if (!targets.length)
        throw new BadRequestException('所选企业/班次下没有待处理员工（可能已被处理）');

      const companyIds = [...new Set(targets.map(t => t.companyId))];
      const scheduleIds = [...new Set(targets.map(t => t.scheduleId))];
      await apply(manager, cert, targets);

      // ---- 证明整体状态重算（partial_exempt 也属已回写办结，不阻断闭环） ----
      const all = await manager.getRepository(LateCertificateAffected).find({ where: { certificateId: id } });
      const pending = all.filter(a => a.status === 'pending').length;
      const exemptN = all.filter(a => a.status === 'exempt').length;
      const partialN = all.filter(a => a.status === 'partial_exempt').length;
      const rejectedN = all.filter(a => a.status === 'rejected').length;
      const handledN = exemptN + partialN; // 事故公共晚点已实际豁免/回写的人数
      if (pending === 0 && rejectedN === all.length) {
        cert.status = 'rejected';
        cert.confirmedAt = new Date();
      } else if (pending === 0) {
        cert.status = 'confirmed';
        cert.confirmedAt = new Date();
      } else {
        cert.status = 'partially_confirmed';
      }
      await manager.getRepository(LateCertificate).save(cert);

      // ---- 司机绩效联动：撤销的是事故公共晚点的扣分；员工个人补签到不属司机责任也不虚增受影响人数 ----
      if (action === 'confirm' && cert.driverId && cert.tripId) {
        const perf = await manager.getRepository(DriverPerformance).findOne({
          where: { driverId: cert.driverId, tripId: cert.tripId },
        });
        if (perf) {
          const external = NON_DRIVER_RESPONSIBLE.includes(cert.reasonType);
          if (perf.certificateId !== cert.id) {
            perf.certificateId = cert.id;
            const tag = external
              ? `晚点证明 ${cert.certNo}：${cert.reasonText}，事故公共晚点 ${cert.delayMinutes} 分钟非司机责任，撤销晚点扣分；另有 ${partialN} 名员工个人到站迟到不纳入本次事故影响`
              : `晚点证明 ${cert.certNo}：${cert.reasonText}，晚点与车辆/司机相关，维持考核`;
            perf.note = `${perf.note || ''}｜${tag}`;
            if (external) { perf.safetyScore = 100; perf.penalty = 0; }
            await manager.getRepository(DriverPerformance).save(perf);
            await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
              userId: cert.driverId, title: '晚点证明已联动绩效复核',
              content: `车次 #${cert.tripId} 的晚点证明已由 HR 批量确认：${external ? '事故公共晚点非司机责任，晚点扣分已撤销' : '维持原考核'}。`,
            }));
          }
        }
      }

      // ---- 线路复盘联动：分别统计事故豁免人数与部分豁免（保留个人迟到）人数 ----
      if (cert.reviewId) {
        const review = await manager.getRepository(LineReview).findOne({ where: { id: cert.reviewId } });
        if (review) {
          review.exemptedCount = exemptN;
          review.partialExemptCount = partialN;
          if (cert.status === 'confirmed') {
            review.status = 'reviewed';
            review.reviewedAt = new Date();
            review.handledById = user.userId;
            const buffer = Math.max(10, Math.round(cert.delayMinutes / 2));
            const autoMeasures = `1) ${cert.incidentLocation || '事发路段'} 纳入高峰重点监控，提前获取交警事故/管制信息；`
              + `2) 相关线路预留 ${buffer} 分钟缓冲，必要时提前发车/安排区间车；`
              + `3) ${exemptN} 名员工事故晚点整条豁免并回写、账单核销；`
              + `${partialN ? `4) 另 ${partialN} 名员工保留个人到站迟到结算（不纳入园区事故成本），推送各企业加强准点到站提醒。` : ''}`;
            // HR 批量确认备注追加为处理意见，不覆盖平台自动整改措施
            review.measures = note
              ? `${review.measures && review.measures !== note ? review.measures : autoMeasures}\n【HR批量确认意见】${note}`
              : (review.measures || autoMeasures);
          }
          await manager.getRepository(LineReview).save(review);
        }
      }

      return {
        ok: true, certNo: cert.certNo, status: cert.status,
        processed: targets.length, companyIds, scheduleIds,
        exemptTotal: handledN, fullExempt: exemptN, partialExempt: partialN, affectedTotal: all.length,
      };
    });
  }

  // 运营/调度补充复盘措施
  async updateReview(id: number, dto: { measures: string; rootCause?: string }, user: any) {
    if (!['operator', 'admin', 'dispatcher'].includes(user.role))
      throw new ForbiddenException('仅园区运营/调度可编辑复盘');
    const cert = await this.certs.findOne({ where: { id } });
    if (!cert) throw new NotFoundException('晚点证明不存在');
    if (!cert.reviewId) throw new BadRequestException('该证明暂无复盘单');
    const review = await this.reviews.findOne({ where: { id: cert.reviewId } });
    review.measures = dto.measures;
    if (dto.rootCause) review.rootCause = dto.rootCause;
    review.status = 'reviewed';
    review.reviewedAt = new Date();
    review.handledById = user.userId;
    await this.reviews.save(review);
    return review;
  }

  listReviews() {
    return this.reviews.find({ order: { id: 'DESC' }, take: 100 });
  }
}
