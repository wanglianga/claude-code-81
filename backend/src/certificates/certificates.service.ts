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

      // 证据一：途中事件（事故上报）
      let ev = dto.eventId
        ? await manager.getRepository(TripEvent).findOne({ where: { id: Number(dto.eventId) } })
        : null;
      if (!ev) {
        ev = await manager.getRepository(TripEvent).findOne({
          where: { tripId: trip.id }, order: { id: 'DESC' },
        });
      }
      if (ev && ev.tripId !== trip.id) throw new BadRequestException('事件与车次不匹配');

      // 证据二：GPS 到厂 / 发车时间
      const delay = Math.max(0, trip.delayMinutes || 0);
      const plannedArrive = (await manager.getRepository(AttendanceRecord).findOne({
        where: { tripId: trip.id }, order: { id: 'ASC' },
      }))?.scheduledArrive
        || new Date((trip.actualDepart || new Date()).getTime() + 45 * 60000);
      const incidentAt = dto.incidentAt ? new Date(dto.incidentAt)
        : (trip.actualDepart ? new Date(trip.actualDepart.getTime() + 10 * 60000) : null);
      const incidentLocation = dto.incidentLocation
        || (ev?.description ? ev.description.slice(0, 20) : '事发路段');

      // 统一晚点原因：一处生成，员工端 / HR 端共用
      const reasonText = dto.reasonText?.trim()
        || `${this.reasonName(reasonType)}${dto.incidentLocation ? `（${dto.incidentLocation}）` : ''}导致${line?.name || '班车'}晚到园区约 ${delay} 分钟`;

      // 证据三：站点签到
      const onboard = await manager.getRepository(Reservation).find({
        where: { tripId: trip.id, status: In(ONBOARD) }, order: { seatNo: 'ASC' },
      });
      if (!onboard.length) throw new BadRequestException('该车次没有签到乘客，无受影响员工');
      const stationIds = [...new Set(onboard.flatMap(r => [r.stationId, r.boardedStationId].filter(Boolean)))] as number[];
      const stations = stationIds.length
        ? await manager.getRepository(Station).find({ where: { id: In(stationIds) } }) : [];
      const employeeIds = [...new Set(onboard.map(r => r.employeeId))];
      const empUsers = await manager.getRepository(User).find({ where: { id: In(employeeIds) } });
      const recs = await manager.getRepository(AttendanceRecord).find({ where: { tripId: trip.id } });

      // 证据四：企业考勤规则（按企业快照宽限/班次/扣款）
      const companyIds = [...new Set(onboard.map(r => r.companyId))];
      const companies = await manager.getRepository(Company).find({ where: { id: In(companyIds) } });
      const rules = companies.map(c => {
        const rs = onboard.filter(r => r.companyId === c.id);
        const rr = recs.filter(x => x.companyId === c.id);
        return {
          companyId: c.id, companyName: c.name,
          graceMinutes: c.lateGraceMinutes, shiftStart: c.dayShiftStart, lateFeeBase: c.lateFeeBase,
          affectedCount: rs.length,
          overGraceCount: rr.filter(x => (x.lateMinutes || 0) > c.lateGraceMinutes).length,
        };
      });

      const checkins = onboard.map(r => {
        const u = empUsers.find(x => x.id === r.employeeId);
        const st = stations.find(s => s.id === (r.boardedStationId || r.stationId));
        return {
          employeeId: r.employeeId, employeeNo: u?.employeeNo, employeeName: u?.realName,
          companyId: r.companyId, station: st?.name, boardedAt: r.boardedAt, status: r.status,
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
        return {
          companyId: c.id, companyName: c.name,
          scheduleId: sched.id, scheduleName: sched.name, shiftLabel: sched.shiftLabel,
          count: rs.length,
          overGraceCount: rr.filter(x => (x.lateMinutes || 0) > c.lateGraceMinutes).length,
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

      // 影响名单：按企业 × 班次展开（批量处理的最小粒度）
      for (const r of onboard) {
        const u = empUsers.find(x => x.id === r.employeeId);
        const c = companies.find(x => x.id === r.companyId);
        const rec = recs.find(x => x.employeeId === r.employeeId && x.tripId === trip.id);
        const st = stations.find(s => s.id === (r.boardedStationId || r.stationId));
        await manager.getRepository(LateCertificateAffected).save(
          manager.getRepository(LateCertificateAffected).create({
            certificateId: cert.id, employeeId: r.employeeId, companyId: r.companyId,
            scheduleId: sched.id, attendanceId: rec?.id ?? null,
            stationName: st?.name || null, boardedAt: r.boardedAt,
            lateMinutes: rec?.lateMinutes || 0, graceMinutes: c?.lateGraceMinutes ?? 10,
            originalFee: rec?.makeupFee || 0, status: 'pending', writeback: false,
          }),
        );
        void u;
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

  // 到厂自动触发：晚点达到阈值且存在外部责任事件时平台自动生成
  async maybeAutoGenerate(tripId: number): Promise<LateCertificate | null> {
    try {
      const trip = await this.trips.findOne({ where: { id: tripId } });
      if (!trip || trip.status !== 'arrived' || (trip.delayMinutes || 0) < 10) return null;
      const existed = await this.certs.findOne({ where: { tripId } });
      if (existed) return null;
      const evs = await this.events.find({ where: { tripId }, order: { id: 'DESC' } });
      const ev = evs.find(e => ['accident', 'congestion', 'weather', 'construction', 'detour', 'breakdown'].includes(e.type));
      if (!ev) return null;
      const reasonType = ev.type === 'late_arrival' ? 'congestion' : ev.type;
      const systemUser = { userId: ev.createdById, role: ev.createdByRole || 'dispatcher' };
      return await this.generate({
        tripId, eventId: ev.id, reasonType,
        incidentLocation: ev.description.slice(0, 20),
      }, systemUser);
    } catch {
      return null; // 自动生成不阻断到厂主流程
    }
  }

  // ==================== 查询 ====================
  async listCertificates(user: any, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const list = await this.certs.find({ where, order: { id: 'DESC' }, take: 100 });
    const items = list.length
      ? await this.items.find({ where: { certificateId: In(list.map(c => c.id)) } }) : [];
    let result = list.map(c => {
      const its = items.filter(i => i.certificateId === c.id);
      return {
        ...c,
        affectedTotal: its.length,
        pendingCount: its.filter(i => i.status === 'pending').length,
        exemptCount: its.filter(i => i.status === 'exempt').length,
        rejectedCount: its.filter(i => i.status === 'rejected').length,
        companyIds: [...new Set(its.map(i => i.companyId))],
      };
    });
    // 企业 HR 只看涉及本企业的证明；司机只看本人车次；员工只看本人受影响的证明
    if (user.role === 'hr' && user.companyId) {
      result = result.filter(c => c.companyIds.includes(Number(user.companyId)));
    } else if (user.role === 'driver') {
      result = result.filter(c => c.driverId === user.userId);
    } else if (user.role === 'employee') {
      const myItems = await this.items.find({ where: { employeeId: user.userId } });
      const myCertIds = new Set(myItems.map(i => i.certificateId));
      result = result.filter(c => myCertIds.has(c.id));
    }
    return result;
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
      for (const it of targets) {
        if (it.attendanceId) {
          const rec = await attRepo.findOne({ where: { id: it.attendanceId } });
          if (rec) {
            // 回写考勤系统：豁免 + 清零补车费，晚点原因与证明同源（减少人工截图传递）
            rec.status = 'exempt';
            rec.exempt = true;
            rec.certificateId = cert.id;
            rec.lateReason = cert.reasonType;
            rec.exemptReason = `晚点证明 ${cert.certNo}：${cert.reasonText}`;
            rec.makeupFee = 0;
            rec.feeReason = `晚点证明 ${cert.certNo} 确认豁免，补车费取消`;
            await attRepo.save(rec);
          }
        }
        it.status = 'exempt';
        it.writeback = true;
        it.handledById = user.userId;
        it.handledAt = new Date();
        it.handleNote = note || `HR 批量确认（证明 ${cert.certNo}）`;
        await manager.getRepository(LateCertificateAffected).save(it);

        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: it.employeeId, title: '晚点考勤豁免已生效',
          content: `晚点证明 ${cert.certNo} 已由 HR 确认：${cert.reasonText}。您 ${cert.date} 的考勤已豁免、补车费已取消。`,
          category: 'success',
        }));
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

      // ---- 证明整体状态重算 ----
      const all = await manager.getRepository(LateCertificateAffected).find({ where: { certificateId: id } });
      const pending = all.filter(a => a.status === 'pending').length;
      const exemptN = all.filter(a => a.status === 'exempt').length;
      const rejectedN = all.filter(a => a.status === 'rejected').length;
      if (pending === 0 && exemptN === all.length) {
        cert.status = 'confirmed';
        cert.confirmedAt = new Date();
      } else if (pending === 0 && rejectedN === all.length) {
        cert.status = 'rejected';
        cert.confirmedAt = new Date();
      } else if (pending === 0) {
        cert.status = 'partially_confirmed';
        cert.confirmedAt = new Date();
      } else {
        cert.status = 'partially_confirmed';
      }
      await manager.getRepository(LateCertificate).save(cert);

      // ---- 司机绩效联动（本企业批次确认时只更新一次） ----
      if (action === 'confirm' && cert.driverId && cert.tripId) {
        const perf = await manager.getRepository(DriverPerformance).findOne({
          where: { driverId: cert.driverId, tripId: cert.tripId },
        });
        if (perf) {
          const external = NON_DRIVER_RESPONSIBLE.includes(cert.reasonType);
          if (perf.certificateId !== cert.id) {
            perf.certificateId = cert.id;
            const tag = external
              ? `晚点证明 ${cert.certNo}：${cert.reasonText}，非司机责任，撤销晚点扣分`
              : `晚点证明 ${cert.certNo}：${cert.reasonText}，晚点与车辆/司机相关，维持考核`;
            perf.note = `${perf.note || ''}｜${tag}`;
            if (external) { perf.safetyScore = 100; perf.penalty = 0; }
            await manager.getRepository(DriverPerformance).save(perf);
            await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
              userId: cert.driverId, title: '晚点证明已联动绩效复核',
              content: `车次 #${cert.tripId} 的晚点证明已由 HR 批量确认：${external ? '非司机责任，晚点扣分已撤销' : '维持原考核'}。`,
            }));
          }
        }
      }

      // ---- 线路复盘联动 ----
      if (cert.reviewId) {
        const review = await manager.getRepository(LineReview).findOne({ where: { id: cert.reviewId } });
        if (review) {
          review.exemptedCount = exemptN;
          if (cert.status === 'confirmed') {
            review.status = 'reviewed';
            review.reviewedAt = new Date();
            review.handledById = user.userId;
            const buffer = Math.max(10, Math.round(cert.delayMinutes / 2));
            const autoMeasures = `1) ${cert.incidentLocation || '事发路段'} 纳入高峰重点监控，提前获取交警事故/管制信息；`
              + `2) 相关线路预留 ${buffer} 分钟缓冲，必要时提前发车/安排区间车；`
              + `3) ${exemptN} 名受影响员工考勤统一豁免并回写，账单同步核销补车费。`;
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
        exemptTotal: exemptN, affectedTotal: all.length,
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
