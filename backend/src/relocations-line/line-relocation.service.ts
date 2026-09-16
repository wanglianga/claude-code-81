import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  Company, User, Line, Station, Schedule, Reservation, Vehicle, Trip,
  DriverPerformance, Notification, LineProposal,
  LineRelocation, LineRelocationOption, LineRelocationFeedback, LineRelocationChoice,
} from '../entities';

const ACTIVE_RES = ['booked', 'on_manifest', 'boarded', 'late', 'changed'];

@Injectable()
export class LineRelocationService {
  constructor(
    @InjectRepository(LineRelocation) private rls: Repository<LineRelocation>,
    @InjectRepository(LineRelocationOption) private options: Repository<LineRelocationOption>,
    @InjectRepository(LineRelocationFeedback) private feedbacks: Repository<LineRelocationFeedback>,
    @InjectRepository(LineRelocationChoice) private choices: Repository<LineRelocationChoice>,
    @InjectRepository(Line) private lines: Repository<Line>,
    @InjectRepository(Station) private stations: Repository<Station>,
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
    @InjectRepository(Reservation) private reservations: Repository<Reservation>,
    @InjectRepository(Vehicle) private vehicles: Repository<Vehicle>,
    @InjectRepository(Trip) private trips: Repository<Trip>,
    @InjectRepository(Company) private companies: Repository<Company>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Notification) private notifications: Repository<Notification>,
    private ds: DataSource,
  ) {}

  private async notifyRoles(manager: any, roles: string[], title: string, content: string, companyId?: number) {
    const where: any = roles.map(r => ({ role: r, active: true }));
    let list = await manager.getRepository(User).find({ where });
    if (companyId) list = list.filter((u: User) => u.companyId === companyId);
    for (const u of list) {
      await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
        userId: u.id, title, content, category: 'warning',
      }));
    }
  }
  private async notify(manager: any, userId: number, title: string, content: string, category = 'info') {
    await manager.getRepository(Notification).save(manager.getRepository(Notification).create({ userId, title, content, category }));
  }

  // 1) 发起搬迁重排：冻结原线新预约 + 影响盘点
  async create(dto: any, user: any) {
    if (!dto.companyId || !dto.oldLineId) throw new BadRequestException('企业与原线路必填');
    const company = await this.companies.findOne({ where: { id: Number(dto.companyId) } });
    if (!company) throw new NotFoundException('企业不存在');
    const oldLine = await this.lines.findOne({ where: { id: Number(dto.oldLineId) } });
    if (!oldLine) throw new NotFoundException('原线路不存在');
    const effectDate = dto.effectDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    let rlId: number;
    await this.ds.transaction(async (manager) => {
      const seq = (await manager.getRepository(LineRelocation).count()) + 1;
      const rlNo = `RL-${effectDate.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

      // 影响盘点
      const stations = await manager.getRepository(Station).find({ where: { lineId: oldLine.id }, order: { seq: 'ASC' } });
      const schedules = await manager.getRepository(Schedule).find({ where: { lineId: oldLine.id } });
      const activeRes = await manager.getRepository(Reservation).find({
        where: { scheduleId: In(schedules.map(s => s.id)), status: In(['booked', 'on_manifest']) },
      });
      const employees = await manager.getRepository(User).find({
        where: [{ role: 'employee', companyId: company.id, active: true }],
      });
      // 车辆座位/在乘与司机工时（该线各班次车次）
      const recentTrips = await manager.getRepository(Trip).find({
        where: { scheduleId: In(schedules.map(s => s.id)) },
      });
      const driverIds = [...new Set(recentTrips.map(t => t.driverId).filter(Boolean))] as number[];
      const perfs = driverIds.length
        ? await manager.getRepository(DriverPerformance).find({ where: { driverId: In(driverIds) } }) : [];
      const vehicles = await manager.getRepository(Vehicle).find();
      const feeSplit = activeRes.reduce((acc: any, r) => {
        acc[r.companyId] = (acc[r.companyId] || 0) + 1;
        return acc;
      }, {});

      const impact = {
        companyName: company.name,
        oldLineName: oldLine.name,
        schedules: schedules.map(s => ({ id: s.id, name: s.name, direction: s.direction, departureTime: s.departureTime, shiftLabel: s.shiftLabel })),
        stations: stations.map(s => ({ id: s.id, name: s.name, seq: s.seq, capacity: s.capacity, status: s.status })),
        activeReservationCount: activeRes.length,
        employeeCount: employees.length,
        reservations: activeRes.map(r => ({ id: r.id, employeeId: r.employeeId, companyId: r.companyId, scheduleId: r.scheduleId, stationId: r.stationId, date: r.date, status: r.status })),
        vehicles: vehicles.map(v => ({ id: v.id, plate: v.plate, seats: v.seats, status: v.status })),
        driverWorkMinutes: driverIds.map(d => ({
          driverId: d,
          minutes: perfs.filter(p => p.driverId === d).length,
        })),
        feeShare: feeSplit,
      };

      const rl = await manager.getRepository(LineRelocation).save(
        manager.getRepository(LineRelocation).create({
          rlNo, companyId: company.id, oldLineId: oldLine.id,
          title: dto.title || `${company.name} 搬迁至${dto.newSiteName || '新厂区'} · ${oldLine.name} 线路重排`,
          newSiteName: dto.newSiteName || null, newSiteAddress: dto.newSiteAddress || null,
          status: 'draft', bookingFrozen: true, effectDate,
          transitionEnd: dto.transitionEnd || effectDate,
          impact, createdById: user.userId,
        }),
      );

      // 冻结原线路新预约：把原线置为 suspended（预约接口据此拒绝）；旧车次过渡仍可乘
      oldLine.status = 'suspended';
      await manager.getRepository(Line).save(oldLine);

      await this.notifyRoles(manager, ['dispatcher', 'operator'], '企业搬迁线路重排已发起（原线预约冻结）',
        `${rl.rlNo}：${company.name} 搬迁，原线「${oldLine.name}」新预约已冻结，请盘点并生成候选线路。`);
      await this.notifyRoles(manager, ['hr'], '搬迁线路重排：等待候选方案',
        `${rl.rlNo} 已冻结原线预约，候选线路生成后将请 HR 与员工代表评估。`, company.id);

      rlId = rl.id;
    });
    return this.detail(rlId);
  }

  // 2) 生成候选线路（按新厂区/居住分布/走向/道路条件；演示确定性生成）
  async generateOptions(id: number) {
    await this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      if (!['draft', 'consulting', 'adjusted'].includes(rl.status))
        throw new BadRequestException('当前状态不可生成候选');
      const oldStations = rl.impact?.stations || [];
      const newSite = rl.newSiteName || '新厂区';

      const baseStations = (shift: number, prefix: string, cross: boolean) =>
        oldStations.map((s: any, i: number) => ({
          name: cross && i === oldStations.length - 1 ? `${newSite}接驳枢纽` : `${prefix}${s.name.replace(/（.*?）/, '')}`,
          walkMeters: 180 + ((s.seq + shift) % 4) * 90,
          arriveTime: `08:${String(15 + i * 4 + shift).padStart(2, '0')}`,
          transferNote: cross && i === 0 ? '需在接驳枢纽换乘跨区班车' : '直达新厂区',
        }));

      const defs = [
        {
          name: '方案A·沿原走向北延至新厂区（直达，推荐）',
          crossDistrict: false, addedFeePerMonth: 0, estimatedArriveMinutes: 5,
          stations: baseStations(0, '', false),
        },
        {
          name: '方案B·东环绕行（道路条件好、步行短）',
          crossDistrict: false, addedFeePerMonth: 1200, estimatedArriveMinutes: 12,
          stations: baseStations(1, '东环·', false),
        },
        {
          name: '方案C·跨区接驳（经西区枢纽换乘）',
          crossDistrict: true, addedFeePerMonth: 3600, estimatedArriveMinutes: 20,
          stations: baseStations(2, '枢纽·', true),
        },
      ];
      for (const d of defs) {
        const exists = await manager.getRepository(LineRelocationOption).findOne({ where: { relocationId: id, name: d.name } });
        if (!exists) {
          await manager.getRepository(LineRelocationOption).save(
            manager.getRepository(LineRelocationOption).create({
              relocationId: id, ...d,
              scheduleLinks: (rl.impact?.schedules || []).map((s: any) => ({
                scheduleName: s.name, oldDeparture: s.departureTime, newDeparture: s.departureTime, linkNote: d.crossDistrict ? '跨区接驳加开 07:10 摆渡' : '时刻平移',
              })),
            }),
          );
        }
      }
      rl.status = 'consulting';
      await manager.getRepository(LineRelocation).save(rl);
      await this.notifyRoles(manager, ['hr'], '搬迁候选线路已生成，请组织员工代表评估',
        `${rl.rlNo}：共 3 个候选（直达/东环/跨区接驳），请员工代表按站点、班次、步行距离、到厂时间反馈。`, rl.companyId);
      const reps = await this.companyReps(manager, rl.companyId);
      for (const rep of reps) {
        await this.notify(manager, rep.id, '请对搬迁候选线路投票/反馈',
          `${rl.rlNo} 候选线路已发布，请按站点、班次、步行距离、预计到厂时间在系统内反馈意见。`, 'warning');
      }
    });
    return this.detail(id);
  }

  private async companyReps(manager: any, companyId: number): Promise<User[]> {
    const company = await manager.getRepository(Company).findOne({ where: { id: companyId } });
    if (!company?.representative) return [];
    return manager.getRepository(User).find({ where: { companyId, realName: company.representative, role: 'employee', active: true } });
  }

  // 3) 员工代表反馈
  async feedback(id: number, dto: any, user: any) {
    return this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      const company = await manager.getRepository(Company).findOne({ where: { id: rl.companyId } });
      const isRep = company?.representative === user.realName;
      if (user.role === 'employee' && !isRep)
        throw new ForbiddenException('仅企业配置的员工代表可对线路方案反馈');
      if (user.role === 'hr' && user.companyId !== rl.companyId)
        throw new ForbiddenException('仅本企业 HR 可反馈');
      if (!['consulting', 'adjusted'].includes(rl.status))
        throw new BadRequestException('当前不在意见征集阶段');
      const fb = await manager.getRepository(LineRelocationFeedback).save(
        manager.getRepository(LineRelocationFeedback).create({
          relocationId: id, optionId: dto.optionId || null, employeeId: user.userId,
          verdict: dto.verdict || 'change_request',
          stationName: dto.stationName || null, scheduleName: dto.scheduleName || null,
          walkMeters: Number(dto.walkMeters || 0), arriveTime: dto.arriveTime || null,
          comment: dto.comment || null,
        }),
      );
      await this.notifyRoles(manager, ['operator', 'dispatcher'], '搬迁线路收到员工代表反馈',
        `${rl.rlNo}：${user.realName} 反馈「${fb.verdict}」${dto.comment ? '：' + dto.comment : ''}`);
      return fb;
    });
  }

  // HR 汇总企业侧生产排班要求
  async hrSummary(id: number, note: string, user: any) {
    return this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      if (user.role !== 'hr' || user.companyId !== rl.companyId)
        throw new ForbiddenException('仅本企业 HR 可汇总排班要求');
      rl.hrScheduleNote = note;
      await manager.getRepository(LineRelocation).save(rl);
      await this.notifyRoles(manager, ['operator'], '搬迁线路：企业侧排班要求已汇总',
        `${rl.rlNo}：${note}`);
      return rl;
    });
  }

  // 4) 园区调整为正式方案：先费用承担/班次，再锁定座位/车辆
  async adjust(id: number, dto: any, user: any) {
    await this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      if (!['operator', 'admin', 'dispatcher'].includes(user.role))
        throw new ForbiddenException('仅园区运营可调整正式方案');
      const option = await manager.getRepository(LineRelocationOption).findOne({ where: { id: Number(dto.optionId) } });
      if (!option || option.relocationId !== id) throw new BadRequestException('请选择候选方案');

      // 先确认费用承担与班次安排（有争议则禁止进入运力锁定）
      if (!dto.costPlan?.companyShareRatio)
        throw new BadRequestException('必须先确认企业/园区费用承担比例');
      rl.costPlan = {
        companyShareRatio: dto.costPlan.companyShareRatio,
        parkSubsidyRatio: dto.costPlan.parkSubsidyRatio,
        crossDistrictMonthlyFee: option.addedFeePerMonth,
        scheduleArrangement: dto.costPlan.scheduleArrangement || '班次时刻平移，保留早晚高峰接驳',
        disputeNote: dto.costPlan.disputeNote || null,
      };
      if (dto.costPlan.disputeNote)
        throw new BadRequestException(`企业间费用分摊存在争议（${dto.costPlan.disputeNote}），请先确认费用承担再锁定运力`);
      rl.costLocked = true;

      // 再锁定座位/车辆/司机工时（运力不足/工时超限则拒绝）
      const pax = rl.impact?.activeReservationCount || 0;
      const vehicles = await manager.getRepository(Vehicle).find({ where: { status: In(['available', 'in_use']) } });
      const fit = vehicles.filter(v => v.seats >= pax).sort((a, b) => a.seats - b.seats);
      if (!fit.length)
        throw new BadRequestException(`新线路运力不足：需要 ≥${pax} 座，当前无可用车辆，请先增配车辆或拆分班次`);
      const vehicle = fit[0];
      // 司机工时：简单规则，跨区接驳需额外 50 分钟，校验不超过 300
      const extra = option.crossDistrict ? 50 : 25;
      rl.capacityPlan = {
        vehicleId: vehicle.id, vehiclePlate: vehicle.plate, seats: vehicle.seats,
        requiredSeats: pax, extraWorkMinutes: extra, driverLimit: 300, feasible: true,
      };
      rl.capacityLocked = true;
      rl.chosenOptionId = option.id;
      rl.effectDate = dto.effectDate || rl.effectDate;
      rl.transitionEnd = dto.transitionEnd || rl.transitionEnd;
      rl.status = 'adjusted';
      await manager.getRepository(LineRelocation).save(rl);
      await manager.getRepository(LineRelocationOption).update({ id: option.id }, { chosen: true });

      await this.notifyRoles(manager, ['hr'], '搬迁线路正式方案已形成，请企业与员工代表确认生效',
        `${rl.rlNo}：已选定「${option.name}」，费用与运力已锁定，等待企业负责人与员工代表确认。`, rl.companyId);
    });
    return this.detail(id);
  }

  // 5a) 企业负责人（HR/运营代企业）确认
  async confirmCompany(id: number, user: any) {
    return this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      if (!['hr', 'operator', 'admin'].includes(user.role)) throw new ForbiddenException('无权确认');
      if (user.role === 'hr' && user.companyId !== rl.companyId) throw new ForbiddenException('非本企业');
      if (rl.status !== 'adjusted') throw new BadRequestException('正式方案尚未形成或已确认');
      rl.status = 'company_confirmed';
      rl.companyConfirmById = user.userId;
      rl.companyConfirmedAt = new Date();
      await manager.getRepository(LineRelocation).save(rl);
      const reps = await this.companyReps(manager, rl.companyId);
      for (const rep of reps) {
        await this.notify(manager, rep.id, '企业侧已确认搬迁方案，请员工代表最终确认',
          `${rl.rlNo}：企业负责人已确认，请员工代表确认后生效。`, 'warning');
      }
      return rl;
    });
  }

  // 5b) 员工代表确认 → 双确认通过
  async confirmEmployee(id: number, user: any) {
    return this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      const company = await manager.getRepository(Company).findOne({ where: { id: rl.companyId } });
      if (user.role !== 'employee' || company?.representative !== user.realName)
        throw new ForbiddenException('仅企业配置的员工代表可确认');
      if (rl.status !== 'company_confirmed')
        throw new BadRequestException('需企业负责人先确认');
      rl.status = 'confirmed';
      await manager.getRepository(LineRelocation).save(rl);
      await this.notifyRoles(manager, ['operator', 'dispatcher'], '搬迁线路双确认通过，可生效',
        `${rl.rlNo}：企业负责人与员工代表均已确认，请在生效日执行切换。`);
      await this.notifyRoles(manager, ['hr'], '搬迁线路双确认通过', `${rl.rlNo} 已具备生效条件。`, rl.companyId);
      return rl;
    });
  }

  // 6) 过渡期已预约员工选择：改站/改班次/退订/继续旧站
  async choose(id: number, dto: any, user: any) {
    return this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id } });
      if (!rl) throw new NotFoundException('重排单不存在');
      const res = await manager.getRepository(Reservation).findOne({ where: { id: Number(dto.reservationId) } });
      if (!res || res.employeeId !== user.userId) throw new ForbiddenException('非本人预约');

      let choice = await manager.getRepository(LineRelocationChoice).findOne({ where: { relocationId: id, reservationId: res.id } });
      if (!choice) {
        choice = manager.getRepository(LineRelocationChoice).create({
          relocationId: id, reservationId: res.id, employeeId: user.userId,
        });
      }
      choice.choice = dto.choice;
      choice.targetStationId = dto.targetStationId || null;
      choice.targetScheduleId = dto.targetScheduleId || null;
      choice.decidedAt = new Date();
      await manager.getRepository(LineRelocationChoice).save(choice);

      if (dto.choice === 'refund') {
        res.status = 'cancelled';
        res.changeNote = `搬迁过渡：员工选择退订（${rl.rlNo}）`;
        await manager.getRepository(Reservation).save(res);
      } else if (dto.choice === 'change_station' && dto.targetStationId) {
        res.originalStationId = res.originalStationId ?? res.stationId;
        await manager.createQueryBuilder().update(Reservation)
          .set({ stationId: Number(dto.targetStationId), changeNote: `搬迁过渡改站（${rl.rlNo}）` })
          .where('id = :id', { id: res.id }).execute();
      } else if (dto.choice === 'change_schedule' && dto.targetScheduleId) {
        await manager.createQueryBuilder().update(Reservation)
          .set({ scheduleId: Number(dto.targetScheduleId), changeNote: `搬迁过渡改班次（${rl.rlNo}）` })
          .where('id = :id', { id: res.id }).execute();
      }
      return choice;
    });
  }

  async myChoices(userId: number) {
    const choices = await this.choices.find({ where: { employeeId: userId }, order: { id: 'DESC' } });
    if (!choices.length) return [];
    const rls = await this.rls.find({ where: { id: In(choices.map(c => c.relocationId)) } });
    return choices.map(c => ({ ...c, relocation: rls.find(r => r.id === c.relocationId) })).filter(x => x.relocation);
  }

  // 7) 生效：落地新线路与站点、标记旧站点停用日期；未确认员工继续旧站并提醒
  async effectuate(id: number, user: any) {
    if (!['operator', 'admin'].includes(user.role)) throw new ForbiddenException('仅园区运营可执行生效');
    await this.ds.transaction(async (manager) => {
      const rl = await manager.getRepository(LineRelocation).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rl) throw new NotFoundException('重排单不存在');
      if (rl.status !== 'confirmed') throw new BadRequestException('需企业负责人与员工代表双确认后才能生效');
      const option = await manager.getRepository(LineRelocationOption).findOne({ where: { id: rl.chosenOptionId } });
      const company = await manager.getRepository(Company).findOne({ where: { id: rl.companyId } });

      // 创建新线路（独立结算）
      const newLine = await manager.getRepository(Line).save(manager.getRepository(Line).create({
        code: `L-NEW-${rl.id}`, name: `${company.name}·${rl.newSiteName || '新厂区'}专线`,
        district: option.crossDistrict ? '跨区' : '东区', baseFare: 0,
        status: 'active',
      }));
      const optStations: any[] = option.stations || [];
      for (let i = 0; i < optStations.length; i++) {
        await manager.getRepository(Station).save(manager.getRepository(Station).create({
          lineId: newLine.id, name: optStations[i].name, seq: i + 1,
          district: option.crossDistrict ? '跨区' : '东区', capacity: 30, status: 'normal',
        }));
      }
      // 复制班次
      for (const s of (rl.impact?.schedules || [])) {
        await manager.getRepository(Schedule).save(manager.getRepository(Schedule).create({
          lineId: newLine.id, name: s.name.replace(/东线|西线/, '新厂区专线'), direction: s.direction,
          departureTime: s.departureTime, shiftLabel: s.shiftLabel, valid: true,
        }));
      }

      // 旧站点标记停用日期；旧线路在过渡期后停用
      const oldStations = await manager.getRepository(Station).find({ where: { lineId: rl.oldLineId } });
      for (const st of oldStations) {
        st.closedFrom = rl.transitionEnd;
        st.closeReason = `${company.name} 搬迁，随旧线路停用（${rl.rlNo}）`;
        await manager.getRepository(Station).save(st);
      }
      const oldLine = await manager.getRepository(Line).findOne({ where: { id: rl.oldLineId } });
      oldLine.status = 'suspended';
      await manager.getRepository(Line).save(oldLine);

      // 未做选择的在乘员工：继续按旧站点乘过渡车并提醒，避免漏接
      const activeRes = await manager.getRepository(Reservation).find({
        where: { id: In((rl.impact?.reservations || []).map((r: any) => r.id)) },
      });
      const decidedIds = (await manager.getRepository(LineRelocationChoice).find({ where: { relocationId: id } }))
        .filter(c => c.choice !== 'keep_old').map(c => c.reservationId);
      let keepCount = 0;
      for (const r of activeRes) {
        if (!decidedIds.includes(r.id)) {
          await manager.getRepository(LineRelocationChoice).save(manager.getRepository(LineRelocationChoice).create({
            relocationId: id, reservationId: r.id, employeeId: r.employeeId, choice: 'keep_old', decidedAt: new Date(),
          }));
          await this.notify(manager, r.employeeId, '搬迁过渡：您仍按旧站点乘车',
            `${rl.rlNo}：新线路将于 ${rl.effectDate} 生效，过渡期至 ${rl.transitionEnd} 您继续在原站点乘车，司机将按旧站点名，请留意不要漏接；可在 App 内改站/改班次/退订。`, 'critical');
          keepCount++;
        }
      }

      rl.status = 'effective';
      rl.newLineId = newLine.id;
      rl.effectiveById = user.userId;
      rl.effectiveAt = new Date();
      await manager.getRepository(LineRelocation).save(rl);

      await this.notifyRoles(manager, ['hr', 'operator', 'dispatcher'], '搬迁新线路已生效',
        `${rl.rlNo}：新线路「${newLine.name}」自 ${rl.effectDate} 独立结算；旧线过渡至 ${rl.transitionEnd}，${keepCount} 名未选择员工继续旧站乘车并已提醒。门禁/考勤规则按新厂区匹配。`, rl.companyId);
    });
    return this.detail(id);
  }

  async list(user: any) {
    const list = await this.rls.find({ order: { id: 'DESC' }, take: 100 });
    if (user.role === 'hr' && user.companyId) return list.filter(r => r.companyId === Number(user.companyId));
    if (user.role === 'employee') {
      const mine = await this.choices.find({ where: { employeeId: user.userId } });
      const ids = new Set(mine.map(c => c.relocationId));
      // 员工代表可见本企业单
      const company = await this.companies.findOne({ where: { id: (user.companyId || 0) } });
      if (company?.representative === user.realName)
        return list.filter(r => r.companyId === Number(user.companyId));
      return list.filter(r => ids.has(r.id));
    }
    return list;
  }

  async detail(id: number) {
    const rl = await this.rls.findOne({ where: { id } });
    if (!rl) throw new NotFoundException('重排单不存在');
    const options = await this.options.find({ where: { relocationId: id }, order: { id: 'ASC' } });
    const feedbacks = await this.feedbacks.find({ where: { relocationId: id }, order: { id: 'DESC' } });
    const fbUsers = feedbacks.length
      ? await this.users.find({ where: { id: In(feedbacks.map(f => f.employeeId)) } }) : [];
    const choices = await this.choices.find({ where: { relocationId: id } });
    const chResIds = choices.map(c => c.reservationId);
    const chRes = chResIds.length ? await this.reservations.find({ where: { id: In(chResIds) } }) : [];
    const company = await this.companies.findOne({ where: { id: rl.companyId } });
    const newLine = rl.newLineId ? await this.lines.findOne({ where: { id: rl.newLineId } }) : null;
    return {
      ...rl,
      companyName: company?.name,
      newLine,
      options,
      feedbacks: feedbacks.map(f => ({ ...f, employee: fbUsers.find(u => u.id === f.employeeId) })),
      choices: choices.map(c => ({ ...c, reservation: chRes.find(r => r.id === c.reservationId) })),
    };
  }

  async cancel(id: number, user: any) {
    const rl = await this.rls.findOne({ where: { id } });
    if (!rl) throw new NotFoundException('重排单不存在');
    if (!['operator', 'admin'].includes(user.role)) throw new ForbiddenException('仅运营可撤销');
    if (rl.status === 'effective') throw new BadRequestException('已生效不可撤销');
    rl.status = 'cancelled';
    await this.rls.save(rl);
    // 解除预约冻结
    const oldLine = await this.lines.findOne({ where: { id: rl.oldLineId } });
    if (oldLine && oldLine.status === 'suspended') { oldLine.status = 'active'; await this.lines.save(oldLine); }
    return rl;
  }
}
