import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  Company, User, Vehicle, Trip, Schedule, Line, Station, Notification,
  SupplementBus, SupplementPassenger, MonthlyBilling,
} from '../entities';

// 司机工时/休息安全阈值（演示平台规则）
const DRIVING_LIMIT_MIN = 300;   // 单日累计驾驶上限 5 小时（夜班补车场景更敏感）
const REST_AFTER_MIN = 20;       // 每次任务后强制休息 20 分钟
const OVERTIME_WARN_MIN = 240;   // 累计 4 小时触发调度提醒
const VEHICLE_FEE = 120;         // 深夜补车车辆/里程基础费
const DRIVER_RATE_PER_H = 80;    // 司机夜间工时单价（元/小时）
const PER_PAX_FEE = 10;          // 每人次夜间保障费
const PARK_SUBSIDY_RATE = 0.2;   // 园区承担 20%（深夜通勤保障），其余企业承担

@Injectable()
export class SupplementService {
  constructor(
    @InjectRepository(SupplementBus) private buses: Repository<SupplementBus>,
    @InjectRepository(SupplementPassenger) private passengers: Repository<SupplementPassenger>,
    @InjectRepository(MonthlyBilling) private billings: Repository<MonthlyBilling>,
    @InjectRepository(Company) private companies: Repository<Company>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Vehicle) private vehicles: Repository<Vehicle>,
    @InjectRepository(Trip) private trips: Repository<Trip>,
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
    @InjectRepository(Line) private lines: Repository<Line>,
    @InjectRepository(Station) private stations: Repository<Station>,
    @InjectRepository(Notification) private notifications: Repository<Notification>,
    private ds: DataSource,
  ) {}

  private async notify(userId: number, title: string, content: string, category = 'info') {
    await this.notifications.save(this.notifications.create({ userId, title, content, category }));
  }

  // 计算司机某日已累计驾驶分钟（常规车次 + 已完成补车）
  private async driverWorkMinutes(driverId: number, date: string, manager?: any, excludeBusId?: number) {
    const m = manager || this;
    const tripRepo = manager ? manager.getRepository(Trip) : this.trips;
    const busRepo = manager ? manager.getRepository(SupplementBus) : this.buses;
    const trips = await tripRepo.find({ where: { driverId, date, status: 'arrived' } });
    let mins = 0;
    for (const t of trips) {
      if (t.actualDepart && t.actualArrive) {
        mins += Math.round((new Date(t.actualArrive).getTime() - new Date(t.actualDepart).getTime()) / 60000);
      }
    }
    const buses = await busRepo.find({
      where: { driverId, date, status: In(['departed', 'completed', 'settled']) },
    });
    for (const b of buses) {
      if (excludeBusId && b.id === excludeBusId) continue;
      mins += b.driverWorkMinutes || 0;
    }
    return mins;
  }

  // 派单前的车辆/司机工时/休息校验（不写库，供申请预览与派单共用）
  async check(dto: any) {
    const result: any = { ok: true, errors: [], warnings: [], estimatedFee: null };
    const pax = Number(dto.passengerCount || 0);
    if (pax <= 0) result.errors.push('乘车人数必须大于 0');

    if (dto.vehicleId) {
      const v = await this.vehicles.findOne({ where: { id: Number(dto.vehicleId) } });
      if (!v) result.errors.push('车辆不存在');
      else {
        if (['maintenance', 'breakdown'].includes(v.status)) result.errors.push(`车辆 ${v.plate} 不可用（${v.status}）`);
        if (v.seats < pax) result.errors.push(`车辆仅 ${v.seats} 座，少于 ${pax} 人`);
      }
    } else {
      // 深夜补车多在白天提交，车辆此时常为 in_use（当日运营结束后归还），不视为不可用；
      // 仅保养/故障车辆不可派。按座位就近匹配
      const avail = await this.vehicles.find({
        where: { status: In(['available', 'in_use']) }, order: { seats: 'ASC' },
      });
      const fit = avail.find(v => v.seats >= pax);
      if (!fit) result.errors.push('没有座位足够的可用车辆');
      else result.suggestedVehicleId = fit.id;
    }

    if (dto.driverId && dto.date) {
      const d = await this.users.findOne({ where: { id: Number(dto.driverId), role: 'driver' } });
      if (!d) result.errors.push('司机不存在');
      else {
        if (d.safetyTrainingExpiry && d.safetyTrainingExpiry < dto.date)
          result.errors.push(`司机 ${d.realName} 安全培训已过期`);
        const worked = await this.driverWorkMinutes(d.id, dto.date);
        result.driverWorkedMinutes = worked;
        if (worked + 45 >= DRIVING_LIMIT_MIN)
          result.errors.push(`司机当日已驾驶 ${worked} 分钟，加本次预计 45 分钟将超过 ${DRIVING_LIMIT_MIN} 分钟上限，禁止派单`);
        else if (worked >= OVERTIME_WARN_MIN)
          result.warnings.push(`司机当日已驾驶 ${worked} 分钟，接近上限，请关注疲劳驾驶`);
        // 最近一次补车的强制休息窗口
        const last = await this.buses.findOne({
          where: { driverId: d.id }, order: { id: 'DESC' },
        });
        if (last?.restDueAt && new Date(last.restDueAt) > new Date() && ['completed', 'settled'].includes(last.status)) {
          const remain = Math.ceil((new Date(last.restDueAt).getTime() - Date.now()) / 60000);
          result.errors.push(`司机仍在强制休息期，还需休息 ${remain} 分钟`);
        }
      }
    }
    result.estimatedFee = this.calcFee(pax, 45);
    result.ok = result.errors.length === 0;
    return result;
  }

  private calcFee(pax: number, workMinutes: number) {
    const vehicleFee = VEHICLE_FEE;
    const driverOvertimeFee = Math.round(workMinutes / 60 * DRIVER_RATE_PER_H);
    const perPassengerFee = pax * PER_PAX_FEE;
    const totalFee = vehicleFee + driverOvertimeFee + perPassengerFee;
    const parkSubsidy = Math.round(totalFee * PARK_SUBSIDY_RATE);
    const companyShare = totalFee - parkSubsidy;
    return {
      vehicleFee, driverOvertimeFee, perPassengerFee, perPerson: PER_PAX_FEE,
      totalFee, parkSubsidy, companyShare, workMinutes,
    };
  }

  // HR 发起补车申请
  async apply(dto: any, user: any) {
    if (!dto.date || !dto.departAt || !dto.destination || !dto.passengerCount)
      throw new BadRequestException('日期、发车时间、目的地、乘车人数必填');
    if (user.role === 'hr') dto.companyId = user.companyId;
    if (!dto.companyId) throw new BadRequestException('缺少企业');
    const company = await this.companies.findOne({ where: { id: Number(dto.companyId) } });
    if (!company) throw new NotFoundException('企业不存在');
    const employeeIds: number[] = (dto.employeeIds || []).map(Number);
    if (employeeIds.length && employeeIds.length !== Number(dto.passengerCount))
      throw new BadRequestException('乘车人名单数量与人数不一致');

    // 申请阶段即做车辆/工时预检（不强制指定车辆时给出建议）
    const pre = await this.check(dto);
    if (!pre.ok) throw new BadRequestException(pre.errors.join('；'));

    const day = dto.date.replace(/-/g, '');
    const seq = (await this.buses.count()) + 1;
    const busNo = `BC-${day}-${String(seq).padStart(4, '0')}`;
    const bus = await this.buses.save(this.buses.create({
      busNo, date: dto.date, companyId: company.id, createdById: user.userId,
      scheduleId: dto.scheduleId ?? null, lineId: dto.lineId ?? null, stationId: dto.stationId ?? null,
      departAt: new Date(dto.departAt), destination: dto.destination,
      passengerCount: Number(dto.passengerCount), reason: dto.reason || '企业临时加班',
      status: 'pending', feeSplit: pre.estimatedFee, totalFee: pre.estimatedFee.totalFee,
    }));
    for (const eid of employeeIds) {
      await this.passengers.save(this.passengers.create({
        supplementBusId: bus.id, employeeId: eid, companyId: company.id, status: 'booked',
      }));
    }
    await this.notifyRoles(['dispatcher', 'operator'], '新的深夜加班补车申请',
      `${company.name} 申请 ${dto.date} 加班补车至 ${dto.destination}，${dto.passengerCount} 人，预计费用 ¥${pre.estimatedFee.totalFee}，请审核派车。`, 'warning');
    return this.detail(bus.id);
  }

  list(status?: string, companyId?: number, date?: string, driverId?: number) {
    const where: any = {};
    if (status) where.status = status;
    if (companyId) where.companyId = Number(companyId);
    if (date) where.date = date;
    if (driverId) where.driverId = driverId;
    return this.buses.find({ where, order: { id: 'DESC' }, take: 100 });
  }

  async detail(id: number) {
    const bus = await this.buses.findOne({ where: { id } });
    if (!bus) throw new NotFoundException('补车单不存在');
    const pax = await this.passengers.find({ where: { supplementBusId: id } });
    const userIds = [bus.createdById, bus.driverId, bus.reviewedById].filter(Boolean) as number[];
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const empIds = pax.map(p => p.employeeId);
    const emps = empIds.length ? await this.users.find({ where: { id: In(empIds) } }) : [];
    const company = await this.companies.findOne({ where: { id: bus.companyId } });
    const vehicle = bus.vehicleId ? await this.vehicles.findOne({ where: { id: bus.vehicleId } }) : null;
    return {
      ...bus,
      companyName: company?.name,
      vehicle,
      driver: bus.driverId ? users.find(u => u.id === bus.driverId) : null,
      applicant: users.find(u => u.id === bus.createdById)?.realName,
      passengers: pax.map(p => ({ ...p, employee: emps.find(e => e.id === p.employeeId) })),
    };
  }

  // 调度审核派单：车辆 + 司机（工时/休息硬校验）+ 费用按工时重算
  async dispatch(id: number, dto: { vehicleId?: number; driverId?: number; reject?: boolean; reviewNote?: string }, user: any) {
    return this.ds.transaction(async (manager) => {
      const bus = await manager.getRepository(SupplementBus).findOne({ where: { id } });
      if (!bus) throw new NotFoundException('补车单不存在');
      if (bus.status !== 'pending') throw new BadRequestException('该补车单已处理，不可重复派单');

      if (dto.reject) {
        bus.status = 'rejected';
        bus.reviewedById = user.userId;
        bus.reviewNote = dto.reviewNote || '调度驳回';
        await manager.getRepository(SupplementBus).save(bus);
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: bus.createdById, title: '补车申请未通过',
          content: `${bus.busNo} 被驳回：${dto.reviewNote || '资源不足'}`, category: 'warning',
        }));
        return bus;
      }

      // 先做司机安全/工时校验（优先级高于车辆占用）
      if (!dto.driverId) throw new BadRequestException('请指派司机');
      const driver = await manager.getRepository(User).findOne({ where: { id: Number(dto.driverId), role: 'driver' } });
      if (!driver) throw new BadRequestException('司机不存在');
      if (driver.safetyTrainingExpiry && driver.safetyTrainingExpiry < bus.date)
        throw new BadRequestException('司机安全培训已过期');

      // 工时硬校验：常规车次 + 既有补车累计
      const worked = await this.driverWorkMinutes(driver.id, bus.date, manager, bus.id);
      const estimated = 45;
      if (worked + estimated > DRIVING_LIMIT_MIN)
        throw new BadRequestException(`司机当日已驾驶 ${worked} 分钟，加本次预计 ${estimated} 分钟超过 ${DRIVING_LIMIT_MIN} 分钟上限，禁止派单，请换班司机`);
      const lastBus = await manager.getRepository(SupplementBus).findOne({
        where: { driverId: driver.id }, order: { id: 'DESC' },
      });
      if (lastBus?.restDueAt && new Date(lastBus.restDueAt) > new Date() && ['completed', 'settled'].includes(lastBus.status)) {
        const remain = Math.ceil((new Date(lastBus.restDueAt).getTime() - Date.now()) / 60000);
        throw new BadRequestException(`司机仍在强制休息期，还需 ${remain} 分钟，不能派单`);
      }

      // 再校验车辆
      const vehicleId = dto.vehicleId ? Number(dto.vehicleId) : (await this.check({ ...bus, vehicleId: undefined })).suggestedVehicleId;
      const vehicle = await manager.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
      if (!vehicle) throw new BadRequestException('请指定可用车辆');
      if (['maintenance', 'breakdown'].includes(vehicle.status))
        throw new BadRequestException(`车辆 ${vehicle.plate} 保养/故障中，不可派补车`);
      if (vehicle.seats < bus.passengerCount)
        throw new BadRequestException(`车辆仅 ${vehicle.seats} 座，少于 ${bus.passengerCount} 人`);

      // 同一车辆不可同时派给其它未完成补车
      const conflict = await manager.getRepository(SupplementBus).findOne({
        where: { vehicleId: vehicle.id, status: In(['approved', 'departed']) },
      });
      if (conflict && conflict.id !== bus.id)
        throw new BadRequestException(`车辆 ${vehicle.plate} 已派给补车 ${conflict.busNo}，请换车`);

      bus.vehicleId = vehicle.id;
      bus.driverId = driver.id;
      bus.reviewedById = user.userId;
      bus.reviewNote = dto.reviewNote || null;
      bus.status = 'approved';
      // 按预估工时落费用拆分（完成后按实际工时重算）
      bus.feeSplit = this.calcFee(bus.passengerCount, estimated);
      bus.totalFee = bus.feeSplit.totalFee;
      bus.driverWorkMinutes = estimated;
      await manager.getRepository(SupplementBus).save(bus);
      // 补车为夜间临时任务，不改动车辆在白天班线的占用状态

      await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
        userId: driver.id, title: '深夜加班补车任务',
        content: `${bus.busNo}：${bus.date} 送 ${bus.passengerCount} 名加班员工至 ${bus.destination}，车辆 ${vehicle.plate}。当日已驾驶 ${worked} 分钟，请注意工时与休息。`,
        category: 'warning',
      }));
      await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
        userId: bus.createdById, title: '补车申请已派车',
        content: `${bus.busNo} 已派车 ${vehicle.plate} / 司机 ${driver.realName}，费用拆分：车辆¥${bus.feeSplit.vehicleFee} + 工时¥${bus.feeSplit.driverOvertimeFee} + 人次¥${bus.feeSplit.perPassengerFee}，企业承担 ¥${bus.feeSplit.companyShare}。`,
      }));
      const paxList = await manager.getRepository(SupplementPassenger).find({ where: { supplementBusId: bus.id } });
      for (const p of paxList) {
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: p.employeeId, title: '加班补车已安排',
          content: `${bus.date} 深夜加班补车 ${vehicle.plate} 将送您至 ${bus.destination}，请凭工牌乘车。`,
        }));
      }
      return bus;
    });
  }

  // 发车
  async depart(id: number, user: any) {
    const bus = await this.buses.findOne({ where: { id } });
    if (!bus) throw new NotFoundException('补车单不存在');
    if (user.role === 'driver' && bus.driverId !== user.userId) throw new ForbiddenException('这不是您的补车任务');
    if (bus.status !== 'approved') throw new BadRequestException('仅已派车补车单可以发车');
    bus.status = 'departed';
    bus.actualDepartAt = new Date();
    await this.buses.save(bus);
    return bus;
  }

  // 完成：实际工时 → 费用重算、员工乘车记录、司机休息时间重算/超时提醒
  async complete(id: number, user: any) {
    await this.ds.transaction(async (manager) => {
      const bus = await manager.getRepository(SupplementBus).findOne({ where: { id } });
      if (!bus) throw new NotFoundException('补车单不存在');
      if (user.role === 'driver' && bus.driverId !== user.userId) throw new ForbiddenException('这不是您的补车任务');
      if (bus.status !== 'departed') throw new BadRequestException('仅行驶中的补车可以完成');

      const now = new Date();
      bus.actualArriveAt = now;
      const workMinutes = bus.actualDepartAt
        ? Math.max(15, Math.round((now.getTime() - new Date(bus.actualDepartAt).getTime()) / 60000))
        : bus.driverWorkMinutes;
      bus.driverWorkMinutes = workMinutes;
      // 费用按实际工时重算（企业、人数、司机工时拆分）
      bus.feeSplit = this.calcFee(bus.passengerCount, workMinutes);
      bus.totalFee = bus.feeSplit.totalFee;
      bus.status = 'completed';

      // 司机休息时间重新计算：完成后强制休息至 restDueAt
      bus.restReset = true;
      bus.restDueAt = new Date(now.getTime() + REST_AFTER_MIN * 60000);
      await manager.getRepository(SupplementBus).save(bus);

      const pax = await manager.getRepository(SupplementPassenger).find({ where: { supplementBusId: id } });
      for (const p of pax) {
        p.status = 'boarded';
        p.boardedAt = now;
        await manager.getRepository(SupplementPassenger).save(p);
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: p.employeeId, title: '加班补车已送达',
          content: `${bus.busNo} 已安全送达 ${bus.destination}，本次乘车记录将进入企业月度结算。`,
        }));
      }
      // 补车为夜间临时任务，不改动车辆在白天班线的占用状态

      // 超时驾驶校验：累计工时达阈值 → 调度提醒
      const workedTotal = await this.driverWorkMinutes(bus.driverId, bus.date, manager, undefined);
      const overLimit = workedTotal > DRIVING_LIMIT_MIN;
      const warn = workedTotal >= OVERTIME_WARN_MIN;
      if (warn || overLimit) {
        const targets = await manager.getRepository(User).find({
          where: [{ role: 'dispatcher', active: true }, { role: 'operator', active: true }],
        });
        for (const u of targets) {
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: u.id,
            title: overLimit ? '司机连续驾驶超时告警' : '司机工时接近上限提醒',
            content: `司机补车 ${bus.busNo} 完成，当日累计驾驶 ${workedTotal} 分钟`
              + (overLimit ? `，已超过 ${DRIVING_LIMIT_MIN} 分钟上限，系统已强制休息至 ${bus.restDueAt.toLocaleString('zh-CN')}，暂停派单。`
                + '请立即安排换班。' : `，接近上限 ${DRIVING_LIMIT_MIN} 分钟；本次后须休息至 ${bus.restDueAt.toLocaleString('zh-CN')}。`),
            category: overLimit ? 'critical' : 'warning',
          }));
        }
      }
      await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
        userId: bus.createdById, title: '补车已完成，费用待月结',
        content: `${bus.busNo} 已完成：实际工时 ${workMinutes} 分钟，企业承担 ¥${bus.feeSplit.companyShare}，将随月度结算出账。`,
      }));
    });
    return this.detail(id);
  }

  async driverBuses(driverId: number) {
    return this.buses.find({ where: { driverId }, order: { id: 'DESC' }, take: 30 });
  }

  // ==================== 月度结算 ====================
  private periodOf(date: string) { return date.slice(0, 7); }

  async billingPreview(period: string) {
    const buses = await this.buses.find({ where: { status: 'completed' } });
    const list = buses.filter(b => this.periodOf(b.date) === period && !b.billingId);
    const companyIds = [...new Set(list.map(b => b.companyId))];
    const companies = companyIds.length ? await this.companies.find({ where: { id: In(companyIds) } }) : [];
    const breakdown = companies.map(c => {
      const bs = list.filter(b => b.companyId === c.id);
      const paxTotal = bs.reduce((s, b) => s + b.passengerCount, 0);
      const workMin = bs.reduce((s, b) => s + b.driverWorkMinutes, 0);
      const vehicleFee = bs.reduce((s, b) => s + (b.feeSplit?.vehicleFee || 0), 0);
      const driverFee = bs.reduce((s, b) => s + (b.feeSplit?.driverOvertimeFee || 0), 0);
      const paxFee = bs.reduce((s, b) => s + (b.feeSplit?.perPassengerFee || 0), 0);
      const companyShare = bs.reduce((s, b) => s + (b.feeSplit?.companyShare || 0), 0);
      const parkSubsidy = bs.reduce((s, b) => s + (b.feeSplit?.parkSubsidy || 0), 0);
      return {
        companyId: c.id, companyName: c.name, supplementCount: bs.length, busNos: bs.map(b => b.busNo),
        passengerCount: paxTotal, driverWorkMinutes: workMin,
        vehicleFee, driverOvertimeFee: driverFee, perPassengerFee: paxFee,
        companyShare, parkSubsidy, total: vehicleFee + driverFee + paxFee,
      };
    });
    return {
      period, pendingCount: list.length,
      totalAmount: breakdown.reduce((s, x) => s + x.total, 0),
      companyAmount: breakdown.reduce((s, x) => s + x.companyShare, 0),
      parkSubsidy: breakdown.reduce((s, x) => s + x.parkSubsidy, 0),
      companyBreakdown: breakdown,
    };
  }

  async confirmBilling(period: string, user: any) {
    return this.ds.transaction(async (manager) => {
      const existed = await manager.getRepository(MonthlyBilling).findOne({ where: { period } });
      if (existed && existed.status === 'confirmed')
        throw new BadRequestException(`${period} 月度结算已确认，请勿重复出账`);
      const preview = await this.billingPreview(period);
      if (!preview.pendingCount) throw new BadRequestException(`${period} 没有待结算的已完成补车`);

      const billing = existed || manager.getRepository(MonthlyBilling).create({ period });
      billing.status = 'confirmed';
      billing.companyBreakdown = preview.companyBreakdown;
      billing.totalAmount = preview.totalAmount;
      billing.supplementCount = preview.pendingCount;
      billing.confirmedById = user.userId;
      billing.confirmedAt = new Date();
      const saved = await manager.getRepository(MonthlyBilling).save(billing);

      const buses = await manager.getRepository(SupplementBus).find({ where: { status: 'completed' } });
      for (const b of buses.filter(x => this.periodOf(x.date) === period && !x.billingId)) {
        b.billingId = saved.id;
        b.status = 'settled';
        await manager.getRepository(SupplementBus).save(b);
      }
      // 通知相关企业 HR
      for (const c of preview.companyBreakdown) {
        const hrs = await manager.getRepository(User).find({ where: { role: 'hr', companyId: c.companyId, active: true } });
        for (const h of hrs) {
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: h.id, title: `${period} 加班补车月度账单已出`,
            content: `本月补车 ${c.supplementCount} 趟、${c.passengerCount} 人次、司机工时 ${c.driverWorkMinutes} 分钟；`
              + `车辆费 ¥${c.vehicleFee}、工时费 ¥${c.driverOvertimeFee}、人次费 ¥${c.perPassengerFee}，`
              + `企业承担 ¥${c.companyShare}（园区补贴 ¥${c.parkSubsidy}）。`,
          }));
        }
      }
      return saved;
    });
  }

  listBillings() {
    return this.billings.find({ order: { period: 'DESC' }, take: 50 });
  }

  private async notifyRoles(roles: string[], title: string, content: string, category = 'info') {
    const list = await this.users.find({ where: roles.map(r => ({ role: r, active: true })) });
    for (const u of list) await this.notify(u.id, title, content, category);
  }
}
