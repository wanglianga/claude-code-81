import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  Company, User, Line, Station, Schedule, Vehicle, Trip, Reservation,
  AttendanceRecord, TripEvent, Appeal, DriverPerformance, LineProposal,
  VisitorPass, GateLog, Holiday, Notification,
} from '../entities';
import { CertificateService } from '../certificates/certificates.service';

const todayStr = () => new Date().toISOString().slice(0, 10);
const ROUTE_MINUTES = 45; // 计划车程（分钟），用于计算到厂晚点

function combine(date: string, time: string, addMinutes = 0): Date {
  const d = new Date(`${date}T${time.length === 5 ? time + ':00' : time}+00:00`);
  d.setMinutes(d.getMinutes() + addMinutes);
  return d;
}

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Company) private companies: Repository<Company>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Line) private lines: Repository<Line>,
    @InjectRepository(Station) private stations: Repository<Station>,
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
    @InjectRepository(Vehicle) private vehicles: Repository<Vehicle>,
    @InjectRepository(Trip) private trips: Repository<Trip>,
    @InjectRepository(Reservation) private reservations: Repository<Reservation>,
    @InjectRepository(AttendanceRecord) private attendance: Repository<AttendanceRecord>,
    @InjectRepository(TripEvent) private events: Repository<TripEvent>,
    @InjectRepository(Appeal) private appeals: Repository<Appeal>,
    @InjectRepository(DriverPerformance) private performances: Repository<DriverPerformance>,
    @InjectRepository(LineProposal) private proposals: Repository<LineProposal>,
    @InjectRepository(VisitorPass) private visitorPasses: Repository<VisitorPass>,
    @InjectRepository(GateLog) private gateLogs: Repository<GateLog>,
    @InjectRepository(Holiday) private holidays: Repository<Holiday>,
    @InjectRepository(Notification) private notifications: Repository<Notification>,
    private certificates: CertificateService,
    private ds: DataSource,
  ) {}

  // ==================== 通知 ====================
  private async notify(userId: number, title: string, content: string, category = 'info') {
    await this.notifications.save(this.notifications.create({ userId, title, content, category }));
  }
  private async notifyRoles(roles: string[], title: string, content: string, category = 'info') {
    const list = await this.users.find({ where: roles.map(r => ({ role: r, active: true })) });
    for (const u of list) await this.notify(u.id, title, content, category);
  }
  myNotifications(userId: number) {
    return this.notifications.find({ where: { userId }, order: { id: 'DESC' }, take: 50 });
  }
  async readNotification(userId: number, id: number) {
    const n = await this.notifications.findOne({ where: { id, userId } });
    if (n) { n.read = true; await this.notifications.save(n); }
    return { ok: true };
  }

  // ==================== 基础数据 ====================
  listCompanies() { return this.companies.find({ order: { id: 'ASC' } }); }

  async createCompany(dto: Partial<Company>) {
    if (!dto.name || !dto.code) throw new BadRequestException('名称与编码必填');
    if (await this.companies.findOne({ where: { code: dto.code } }))
      throw new BadRequestException('企业编码已存在');
    return this.companies.save(this.companies.create({
      name: dto.name, code: dto.code,
      lateGraceMinutes: dto.lateGraceMinutes ?? 10,
      dayShiftStart: dto.dayShiftStart ?? '08:30',
      nightShiftStart: dto.nightShiftStart ?? '20:00',
      lateFeeBase: dto.lateFeeBase ?? 20,
      representative: dto.representative,
    }));
  }

  async listLines() {
    const lines = await this.lines.find({
      order: { id: 'ASC' }, relations: { companies: true },
    });
    for (const l of lines) {
      (l as any).stationList = await this.stations.find({
        where: { lineId: l.id }, order: { seq: 'ASC' },
      });
    }
    return lines;
  }

  async createLine(dto: any) {
    if (!dto.name || !dto.code) throw new BadRequestException('线路名称与编码必填');
    if (await this.lines.findOne({ where: { code: dto.code } }))
      throw new BadRequestException('线路编码已存在');
    const line = await this.lines.save(this.lines.create({
      name: dto.name, code: dto.code,
      district: dto.district ?? '东区', baseFare: dto.baseFare ?? 45,
    }));
    const companyIds: number[] = dto.companyIds || [];
    if (companyIds.length)
      await this.ds.createQueryBuilder().relation(Line, 'companies').of(line.id).add(companyIds);
    for (const [i, s] of (dto.stations || []).entries()) {
      await this.stations.save(this.stations.create({
        lineId: line.id, name: s.name, seq: s.seq ?? i + 1,
        capacity: s.capacity ?? 30, district: line.district,
      }));
    }
    return (await this.listLines()).find(x => x.id === line.id);
  }

  async addStation(lineId: number, dto: any) {
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException('线路不存在');
    return this.stations.save(this.stations.create({
      lineId, name: dto.name, seq: dto.seq ?? 99,
      capacity: dto.capacity ?? 30, district: dto.district ?? line.district,
    }));
  }

  async patchStation(id: number, dto: any) {
    const st = await this.stations.findOne({ where: { id } });
    if (!st) throw new NotFoundException('站点不存在');
    Object.assign(st, {
      status: dto.status ?? st.status, note: dto.note ?? st.note,
      capacity: dto.capacity ?? st.capacity, name: dto.name ?? st.name,
    });
    await this.stations.save(st);
    if (['construction', 'closed'].includes(st.status)) {
      await this.notifyRoles(['dispatcher', 'operator'],
        `站点状态变更：${st.name}`,
        `站点 ${st.name} 当前状态为 ${st.status}。${st.note || '请关注相关线路'}，必要时安排绕行或临时改站。`,
        'warning');
    }
    return st;
  }

  async listSchedules() {
    const list = await this.schedules.find({ order: { lineId: 'ASC', departureTime: 'ASC' } });
    const lines = await this.lines.find();
    const tripsToday = await this.trips.find({ where: { date: todayStr() } });
    return list.map(s => ({
      ...s,
      line: lines.find(l => l.id === s.lineId),
      tripToday: tripsToday.find(t => t.scheduleId === s.id) || null,
    }));
  }

  async createSchedule(dto: any) {
    if (!dto.lineId || !dto.name || !dto.direction || !dto.departureTime || !dto.shiftLabel)
      throw new BadRequestException('班次字段不完整');
    return this.schedules.save(this.schedules.create(dto));
  }

  listVehicles() { return this.vehicles.find({ order: { id: 'ASC' } }); }

  async createVehicle(dto: any) {
    if (!dto.plate) throw new BadRequestException('车牌必填');
    if (await this.vehicles.findOne({ where: { plate: dto.plate } }))
      throw new BadRequestException('车牌已存在');
    return this.vehicles.save(this.vehicles.create({
      plate: dto.plate, seats: dto.seats ?? 45, note: dto.note,
    }));
  }

  async patchVehicle(id: number, dto: any) {
    const v = await this.vehicles.findOne({ where: { id } });
    if (!v) throw new NotFoundException('车辆不存在');
    Object.assign(v, { status: dto.status ?? v.status, note: dto.note ?? v.note });
    await this.vehicles.save(v);
    return v;
  }

  listDrivers() { return this.users.find({ where: { role: 'driver' }, order: { id: 'ASC' } }); }

  async listEmployees(companyId?: number) {
    const where: any = { role: 'employee', active: true };
    if (companyId) where.companyId = Number(companyId);
    return this.users.find({ where, order: { id: 'ASC' } });
  }

  async createDriver(dto: any) {
    if (!dto.username || !dto.password || !dto.realName)
      throw new BadRequestException('司机账号字段不完整');
    if (await this.users.findOne({ where: { username: dto.username } }))
      throw new BadRequestException('用户名已存在');
    return this.users.save(this.users.create({
      username: dto.username,
      passwordHash: await bcrypt.hash(dto.password, 10),
      realName: dto.realName, role: 'driver', phone: dto.phone,
      licenseNo: dto.licenseNo,
      safetyTrainingExpiry: dto.safetyTrainingExpiry ?? todayStr(), active: true,
    }));
  }

  listHolidays() { return this.holidays.find({ order: { date: 'ASC' } }); }
  async createHoliday(dto: any) {
    if (!dto.date || !dto.type || !dto.name) throw new BadRequestException('节假日字段不完整');
    return this.holidays.save(this.holidays.create(dto));
  }

  // ==================== 员工预约 ====================
  async bookingView(date: string) {
    const schedules = await this.schedules.find({ where: { valid: true }, order: { id: 'ASC' } });
    const lines = await this.lines.find();
    const stations = await this.stations.find({ order: { seq: 'ASC' } });
    const res = await this.reservations.find({ where: { date } });
    const trips = await this.trips.find({ where: { date } });
    return schedules.map(s => ({
      ...s,
      line: lines.find(l => l.id === s.lineId),
      stations: stations.filter(st => st.lineId === s.lineId),
      bookedCount: res.filter(r => r.scheduleId === s.id && r.status !== 'cancelled').length,
      trip: trips.find(t => t.scheduleId === s.id) || null,
    }));
  }

  async createReservation(user: any, dto: any) {
    if (!dto.date || !dto.scheduleId || !dto.stationId)
      throw new BadRequestException('日期、班次、上车点必填');
    const sched = await this.schedules.findOne({ where: { id: dto.scheduleId } });
    if (!sched) throw new NotFoundException('班次不存在');
    const station = await this.stations.findOne({ where: { id: dto.stationId } });
    if (!station || station.lineId !== sched.lineId)
      throw new BadRequestException('站点与线路不匹配');
    if (station.status === 'closed') throw new BadRequestException('该站点已关闭，请选择邻近站点');
    const holiday = await this.holidays.findOne({ where: { date: dto.date, type: 'suspended' } });
    if (holiday) throw new BadRequestException(`${dto.date} 因${holiday.name}停运，无法预约`);

    const dup = await this.reservations.findOne({
      where: { date: dto.date, employeeId: user.userId, scheduleId: dto.scheduleId },
    });
    if (dup && dup.status !== 'cancelled') throw new BadRequestException('该班次已预约，请勿重复提交');

    const stationCount = await this.reservations.count({
      where: { date: dto.date, scheduleId: dto.scheduleId, stationId: dto.stationId,
        status: In(['booked', 'on_manifest', 'boarded', 'late', 'changed']) },
    });
    if (stationCount >= station.capacity)
      throw new BadRequestException(`站点 ${station.name} 该班次候车容量已满，请改选其他站点`);

    const emp = await this.users.findOne({ where: { id: user.userId } });
    const r = await this.reservations.save(this.reservations.create({
      date: dto.date, employeeId: user.userId, companyId: emp.companyId,
      scheduleId: dto.scheduleId, stationId: dto.stationId,
      withLuggage: !!dto.withLuggage, tempOvertime: !!dto.tempOvertime,
      overtimeNote: dto.overtimeNote, isVisitor: false, status: 'booked',
    }));
    if (r.tempOvertime) {
      await this.notifyRoles(['dispatcher'],
        '临时加班乘车申请',
        `员工 ${emp.realName} 申请 ${dto.date} 班次 ${sched.name} 加班乘车：${dto.overtimeNote || '无备注'}`,
        'warning');
    }
    return r;
  }

  async myReservations(userId: number) {
    const list = await this.reservations.find({
      where: { employeeId: userId }, order: { date: 'DESC', id: 'DESC' }, take: 50,
    });
    const tripIds = [...new Set(list.map(r => r.tripId).filter(Boolean))] as number[];
    const trips = tripIds.length ? await this.trips.find({ where: { id: In(tripIds) } }) : [];
    return list.map(r => ({ ...r, trip: trips.find(t => t.id === r.tripId) || null }));
  }

  async cancelReservation(user: any, id: number) {
    const r = await this.reservations.findOne({ where: { id } });
    if (!r) throw new NotFoundException('预约不存在');
    if (r.employeeId !== user.userId && !['dispatcher', 'operator'].includes(user.role))
      throw new ForbiddenException('无权取消他人预约');
    if (r.tripId && ['boarded', 'late', 'changed'].includes(r.status))
      throw new BadRequestException('已上车记录不可取消');
    r.status = 'cancelled';
    await this.reservations.save(r);
    return { ok: true };
  }

  async changeStation(user: any, id: number, stationId: number, note?: string) {
    const r = await this.reservations.findOne({ where: { id } });
    if (!r) throw new NotFoundException('预约不存在');
    const isDriver = user.role === 'driver' && r.tripId;
    if (r.employeeId !== user.userId && !isDriver)
      throw new ForbiddenException('无权修改该预约');
    const st = await this.stations.findOne({ where: { id: stationId } });
    if (!st) throw new BadRequestException('站点不存在');
    if (!isDriver && st.lineId !== r.scheduleId) throw new BadRequestException('站点不属于该线路');
    if (isDriver) {
      r.boardedStationId = stationId;
      r.changeNote = `司机登记临时改站：${st.name} ${note || ''}`;
    } else {
      if (r.tripId) throw new BadRequestException('已入名单，请由司机登记临时改站');
      r.stationId = stationId;
    }
    await this.reservations.save(r);
    return r;
  }

  // ==================== 调度：名单 / 车次 ====================
  async listTrips(date?: string) {
    const where: any = {};
    if (date) where.date = date;
    const trips = await this.trips.find({ where, order: { id: 'DESC' }, take: 100 });
    const ids = trips.map(t => t.id);
    const manifest = ids.length
      ? await this.reservations.find({ where: { tripId: In(ids) }, order: { seatNo: 'ASC' } })
      : [];
    return trips.map(t => ({ ...t, reservations: manifest.filter(m => m.tripId === t.id) }));
  }

  async generateManifest(dto: { date: string; scheduleId: number; vehicleId?: number; driverId?: number }) {
    const { date, scheduleId } = dto;
    const booked = await this.reservations.find({
      where: { date, scheduleId, status: 'booked' },
      order: { id: 'ASC' },
    });
    if (!booked.length)
      throw new BadRequestException('当前没有待入名单的预约（可能已生成或无人预约）');
    const existed = await this.trips.findOne({ where: { date, scheduleId } });
    if (existed && !['cancelled', 'arrived'].includes(existed.status))
      throw new BadRequestException('该班次车次已存在，请勿重复生成');

    // 选车：指定车辆优先，否则自动匹配座位数
    let vehicle: Vehicle | null = null;
    if (dto.vehicleId) {
      vehicle = await this.vehicles.findOne({ where: { id: dto.vehicleId } });
      if (!vehicle) throw new NotFoundException('车辆不存在');
      if (['maintenance', 'breakdown'].includes(vehicle.status))
        throw new BadRequestException(`车辆 ${vehicle.plate} 不可用（${vehicle.status}）`);
    } else {
      const avail = await this.vehicles.find({
        where: { status: 'available' }, order: { seats: 'ASC' },
      });
      vehicle = avail.find(v => v.seats >= booked.length) || avail[0] || null;
    }
    if (!vehicle) throw new BadRequestException('没有可用车辆，请先维护车辆或指定车辆');

    let driver: User | null = null;
    if (dto.driverId) {
      driver = await this.users.findOne({ where: { id: dto.driverId, role: 'driver' } });
      if (!driver) throw new NotFoundException('司机不存在');
      if (driver.safetyTrainingExpiry && driver.safetyTrainingExpiry < date)
        throw new BadRequestException(`司机 ${driver.realName} 安全培训已过期，不可排班`);
    }

    const sched = await this.schedules.findOne({ where: { id: scheduleId } });
    const line = await this.lines.findOne({ where: { id: sched.lineId } });

    // 座位约束：超载部分不允许入名单
    const seats = vehicle.seats;
    const accepted = booked.slice(0, seats);
    const overflow = booked.slice(seats);

    const trip = await this.trips.save(this.trips.create({
      date, scheduleId, vehicleId: vehicle.id, driverId: driver?.id ?? null,
      status: 'planned', plannedDepart: sched.departureTime,
      emptySeats: Math.max(0, seats - accepted.length),
      qrToken: crypto.randomBytes(8).toString('hex'),
    }));

    // 乘车名单：按站点顺序排座，行李乘客占相邻位标记
    const withStations = [];
    for (const r of accepted) {
      const st = await this.stations.findOne({ where: { id: r.stationId } });
      withStations.push({ r, seq: st?.seq ?? 99 });
    }
    withStations.sort((a, b) => a.seq - b.seq || a.r.id - b.r.id);
    let seat = 1;
    const feeSplit: Record<string, { companyId: number; companyName: string; passengers: number; fee: number }> = {};
    for (const { r } of withStations) {
      r.tripId = trip.id;
      r.status = 'on_manifest';
      r.seatNo = seat++;
      await this.reservations.save(r);
      const emp = await this.users.findOne({ where: { id: r.employeeId } });
      const cname = emp?.company?.name || `企业#${r.companyId}`;
      const key = String(r.companyId);
      if (!feeSplit[key]) feeSplit[key] = { companyId: r.companyId, companyName: cname, passengers: 0, fee: 0 };
      feeSplit[key].passengers += 1;
    }
    // 多企业共线：按乘车人数比例分摊基准车费
    const totalPax = accepted.length;
    for (const k of Object.keys(feeSplit)) {
      feeSplit[k].fee = Math.round(line.baseFare * feeSplit[k].passengers / totalPax);
    }
    trip.feeSplit = Object.values(feeSplit);
    trip.manifest = {
      total: accepted.length,
      withLuggage: accepted.filter(r => r.withLuggage).length,
      tempOvertime: accepted.filter(r => r.tempOvertime).map(r => ({ id: r.id, note: r.overtimeNote })),
      overflow: overflow.map(r => ({ reservationId: r.id, employeeId: r.employeeId })),
    };
    await this.trips.save(trip);
    if (vehicle.status === 'available') { vehicle.status = 'in_use'; await this.vehicles.save(vehicle); }

    // 通知五方相关人
    for (const { r } of withStations) {
      await this.notify(r.employeeId, '乘车名单已生成',
        `您已列入 ${date} ${sched.name}（${line.name}）乘车名单，座位号 ${r.seatNo}，车牌 ${vehicle.plate}，请按时到站。`);
    }
    if (driver) await this.notify(driver.id, '新派车任务', `${date} ${sched.name}，车辆 ${vehicle.plate}，乘客 ${accepted.length} 人，请发车前确认。`);
    await this.notifyRoles(['dispatcher'], '名单已生成',
      `${date} ${sched.name}：${vehicle.plate}，${accepted.length} 人上车${overflow.length ? `，${overflow.length} 人超载待分流` : ''}`);

    return { tripId: trip.id, accepted: accepted.length, overflow: overflow.length, feeSplit: trip.feeSplit };
  }

  async assignTrip(id: number, dto: { vehicleId?: number; driverId?: number }) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (dto.vehicleId) {
      const v = await this.vehicles.findOne({ where: { id: dto.vehicleId } });
      if (!v) throw new NotFoundException('车辆不存在');
      const count = await this.reservations.count({ where: { tripId: id } });
      if (v.seats < count) throw new BadRequestException(`该车仅 ${v.seats} 座，名单 ${count} 人，无法调换`);
      trip.vehicleId = v.id;
    }
    if (dto.driverId) {
      const d = await this.users.findOne({ where: { id: dto.driverId, role: 'driver' } });
      if (!d) throw new NotFoundException('司机不存在');
      if (d.safetyTrainingExpiry && d.safetyTrainingExpiry < trip.date)
        throw new BadRequestException('该司机安全培训已过期');
      trip.driverId = d.id;
    }
    await this.trips.save(trip);
    return trip;
  }

  // 司机发车前确认
  async confirmTrip(driverId: number, id: number, dto: { vehicleCheck: string; routeOk: boolean }) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    if (!trip.vehicleId) throw new BadRequestException('车辆尚未分配');
    if (!dto?.routeOk) throw new BadRequestException('请确认路线无异常后再发车');
    trip.status = 'confirmed';
    await this.trips.save(trip);
    return trip;
  }

  async departTrip(driverId: number, id: number) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    if (trip.status === 'suspended' || trip.status === 'cancelled')
      throw new BadRequestException('该车次已停运/取消');
    if (!['confirmed', 'boarding'].includes(trip.status))
      throw new BadRequestException('请先完成发车前确认');
    trip.status = 'departed';
    trip.actualDepart = new Date();
    await this.trips.save(trip);
    // 未到乘客标记 no_show
    const list = await this.reservations.find({ where: { tripId: id } });
    let noShow = 0;
    for (const r of list) {
      if (['on_manifest'].includes(r.status)) { r.status = 'no_show'; noShow++; await this.reservations.save(r); }
    }
    trip.noShowCount = noShow;
    trip.boardedCount = list.filter(r => ['boarded', 'late', 'changed'].includes(r.status)).length;
    trip.emptySeats = (trip.vehicle?.seats || 0) - trip.boardedCount;
    await this.trips.save(trip);
    return trip;
  }

  // 到厂：生成考勤档案 + 司机绩效
  async arriveTrip(driverId: number, id: number) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    if (trip.status !== 'departed') throw new BadRequestException('仅行驶中的车次可以到厂确认');

    const sched = await this.schedules.findOne({ where: { id: trip.scheduleId } });
    // 计划到厂 = 实际发车（缺省回退计划发车）+ 标准车程，衡量“途中晚点”而非演示时刻差
    const baseDepart = trip.actualDepart || combine(trip.date, sched.departureTime);
    const plannedArrive = new Date(baseDepart.getTime() + ROUTE_MINUTES * 60000);
    const now = new Date();
    trip.actualArrive = now;
    trip.delayMinutes = Math.max(0, Math.round((now.getTime() - plannedArrive.getTime()) / 60000));
    trip.status = 'arrived';
    const list = await this.reservations.find({ where: { tripId: id } });
    trip.boardedCount = list.filter(r => ['boarded', 'late', 'changed'].includes(r.status)).length;
    trip.emptySeats = (trip.vehicle?.seats || 0) - trip.boardedCount;
    await this.trips.save(trip);

    // 关联事件（拥堵/故障/绕行/晚点 → 决定豁免）
    const tripEvents = await this.events.find({ where: { tripId: id } });
    const exemptEvent = tripEvents.find(e => e.compensationType === 'exempt_attendance'
      && ['resolved', 'processing'].includes(e.status));

    for (const r of list) {
      const emp = await this.users.findOne({ where: { id: r.employeeId } });
      const company = emp?.company;
      const grace = company?.lateGraceMinutes ?? 10;
      const rec = this.attendance.create({
        date: trip.date, employeeId: r.employeeId, companyId: r.companyId,
        tripId: id, reservationId: r.id, scheduledArrive: plannedArrive,
      });
      if (r.status === 'no_show') {
        rec.status = 'no_show';
        rec.lateReason = 'missed';
        rec.makeupFee = company?.lateFeeBase ?? 20;
        rec.feeReason = '未到浪费座位，收取补车费';
        await this.notify(r.employeeId, '考勤记录：未乘车',
          `${trip.date} ${sched.name} 记录为未到，产生补车费 ${rec.makeupFee} 元，如有异议可在系统发起申诉。`, 'warning');
      } else {
        rec.actualArrive = now;
        let late = trip.delayMinutes;
        if (r.status === 'late') late += 15; // 个人到站点迟到
        rec.lateMinutes = late;
        rec.lateReason = trip.delayMinutes > 0 ? 'late_arrival' : (r.status === 'late' ? 'personal' : undefined);
        if (exemptEvent) {
          rec.status = 'exempt'; rec.exempt = true;
          rec.exemptReason = `因${exemptEvent.type}事件豁免（${exemptEvent.description.slice(0, 40)}）`;
        } else {
          rec.status = late > grace ? 'late' : 'normal';
          if (rec.status === 'late') {
            rec.makeupFee = company?.lateFeeBase ?? 20;
            rec.feeReason = `迟到 ${late} 分钟超出宽限 ${grace} 分钟`;
            await this.notify(r.employeeId, '考勤记录：迟到',
              `${trip.date} ${sched.name} 到厂晚点 ${late} 分钟，计迟到并产生补车费 ${rec.makeupFee} 元，可发起申诉。`, 'warning');
          }
        }
      }
      await this.attendance.save(rec);
    }

    // 司机绩效：晚点扣分、满载奖、责任事件罚款
    const evTypes = tripEvents.map(e => e.type);
    let safety = 100 - Math.min(60, trip.delayMinutes);
    let bonus = 0, penalty = 0;
    if (trip.emptySeats === 0 && trip.boardedCount > 0) bonus = 50;
    if (evTypes.includes('breakdown')) { penalty += 100; safety -= 20; }
    if (evTypes.includes('detour')) { penalty += 30; safety -= 5; }
    safety = Math.max(0, safety);
    await this.performances.save(this.performances.create({
      driverId: trip.driverId, tripId: id, date: trip.date,
      safetyScore: safety, bonus, penalty,
      note: `晚点 ${trip.delayMinutes} 分钟，载客 ${trip.boardedCount}，未到 ${trip.noShowCount}`,
    }));

    if (trip.vehicleId) {
      const v = await this.vehicles.findOne({ where: { id: trip.vehicleId } });
      if (v && v.status === 'in_use') { v.status = 'available'; await this.vehicles.save(v); }
    }
    await this.notifyRoles(['dispatcher', 'operator'], '车次到厂',
      `${trip.date} ${sched.name} 已到厂，晚点 ${trip.delayMinutes} 分钟，考勤档案与司机绩效已归档。`);

    // 晚点且存在道路事故等外部事件时，平台自动取证生成晚点考勤豁免证明（待 HR 批量确认）
    await this.certificates.maybeAutoGenerate(id);

    return { ok: true, delayMinutes: trip.delayMinutes };
  }

  // 极端天气 / 临时安检停运
  async suspendTrip(id: number, dto: { reason: string; type?: string }, user: any) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (['arrived', 'cancelled'].includes(trip.status))
      throw new BadRequestException('已结束车次不可停运');
    trip.status = 'suspended';
    await this.trips.save(trip);
    const ev = await this.events.save(this.events.create({
      tripId: id, type: dto.type || 'weather', severity: 'critical',
      description: dto.reason, createdById: user.userId, createdByRole: user.role,
      status: 'open', compensationType: 'exempt_attendance',
    }));
    const list = await this.reservations.find({ where: { tripId: id } });
    for (const r of list) {
      await this.notify(r.employeeId, '班次停运通知',
        `${trip.date} 您乘坐的班次停运：${dto.reason}。本次考勤统一豁免，请勿自行赶路。`, 'critical');
    }
    if (trip.driverId) await this.notify(trip.driverId, '班次停运', dto.reason, 'critical');
    await this.notifyRoles(['hr', 'operator'], '班次停运',
      `车次 #${id} 停运：${dto.reason}，涉及 ${list.length} 名员工，考勤自动豁免。`, 'critical');
    return ev;
  }

  // ==================== 司机：签到 ====================
  async driverTrips(driverId: number) {
    const all = await this.trips.find({
      where: { driverId }, order: { date: 'DESC', id: 'DESC' }, take: 30,
    });
    const scheds = await this.schedules.find();
    return all.map(t => ({ ...t, schedule: scheds.find(s => s.id === t.scheduleId) }));
  }

  async tripManifest(driverId: number, id: number) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    const list = await this.reservations.find({
      where: { tripId: id }, order: { seatNo: 'ASC' },
    });
    return { trip, reservations: list };
  }

  async board(driverId: number, id: number, dto: {
    reservationId?: number; employeeNo?: string; stationId?: number;
    proxy?: boolean; proxyNote?: string;
  }) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    if (!['confirmed', 'boarding', 'departed'].includes(trip.status))
      throw new BadRequestException('请先完成发车前确认再开始签到');

    let r: Reservation | null = null;
    if (dto.reservationId) r = await this.reservations.findOne({ where: { id: dto.reservationId, tripId: id } });
    if (!r && dto.employeeNo) {
      const u = await this.users.findOne({ where: { employeeNo: dto.employeeNo } });
      if (u) r = await this.reservations.findOne({ where: { employeeId: u.id, tripId: id } });
    }
    if (!r) throw new NotFoundException('名单中找不到该乘客（扫码/工牌不匹配）');
    if (['boarded', 'late', 'changed'].includes(r.status))
      throw new BadRequestException('该乘客已签到，疑似重复刷卡');

    // 临时改站
    if (dto.stationId && dto.stationId !== r.stationId) {
      const st = await this.stations.findOne({ where: { id: dto.stationId } });
      r.boardedStationId = dto.stationId;
      r.changeNote = `司机登记临时改站：${st?.name || dto.stationId}`;
      r.status = 'changed';
    } else {
      // 发车前签到为正常；发车后才赶到刷卡记个人迟到（此时名单通常已置未到，需司机补录）
      const sched = await this.schedules.findOne({ where: { id: trip.scheduleId } });
      if (trip.status === 'departed') {
        r.status = 'late';
        r.changeNote = (r.changeNote || '') + '发车后补签到，按迟到处理';
      } else {
        r.status = 'boarded';
      }
      void sched;
    }
    r.boardedAt = new Date();
    // 代刷登记
    if (dto.proxy) {
      r.proxyBoarded = true;
      r.proxyNote = dto.proxyNote || '司机现场登记代刷，待企业核实';
      await this.events.save(this.events.create({
        tripId: id, type: 'security_check', severity: 'warning',
        description: `乘客 #${r.id}（座位 ${r.seatNo}）存在代刷嫌疑/登记：${r.proxyNote}`,
        createdById: driverId, createdByRole: 'driver', status: 'open', affectedCount: 1,
      }));
      await this.notify(r.employeeId, '代刷登记提醒',
        '您的上车记录被登记为代刷，将由企业 HR 核实，如为本人刷卡请发起申诉。', 'warning');
    }
    await this.reservations.save(r);
    if (trip.status === 'confirmed') { trip.status = 'boarding'; await this.trips.save(trip); }
    return r;
  }

  async markNoShow(driverId: number, id: number, reservationId: number) {
    const trip = await this.trips.findOne({ where: { id } });
    if (!trip || trip.driverId !== driverId) throw new ForbiddenException('无权操作');
    const r = await this.reservations.findOne({ where: { id: reservationId, tripId: id } });
    if (!r) throw new NotFoundException('预约不存在');
    r.status = 'no_show';
    await this.reservations.save(r);
    return r;
  }

  // ==================== 途中事件（五方协同） ====================
  async listEvents(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const evs = await this.events.find({ where, order: { id: 'DESC' }, take: 100 });
    const userIds = [...new Set(evs.flatMap(e => [e.createdById, e.handledById].filter(Boolean)))] as number[];
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    return evs.map(e => ({
      ...e,
      creator: users.find(u => u.id === e.createdById)?.realName,
      handler: users.find(u => u.id === e.handledById)?.realName,
    }));
  }

  async createEvent(dto: any, user: any) {
    if (!dto.type || !dto.description) throw new BadRequestException('事件类型与描述必填');
    let affected = 0;
    let trip: Trip | null = null;
    if (dto.tripId) {
      trip = await this.trips.findOne({ where: { id: dto.tripId } });
      if (!trip) throw new NotFoundException('车次不存在');
      affected = await this.reservations.count({ where: { tripId: dto.tripId } });
    }
    const ev = await this.events.save(this.events.create({
      tripId: dto.tripId ?? null, type: dto.type,
      severity: dto.severity || (['breakdown', 'weather', 'suspension'].includes(dto.type) ? 'critical' : 'warning'),
      description: dto.description, createdById: user.userId, createdByRole: user.role,
      affectedCount: affected,
      compensationType: dto.type === 'weather' ? 'exempt_attendance' : 'none',
    }));

    // 员工、司机、调度、HR、园区运营进入同一趟车协同
    const title = `途中事件：${this.eventTypeName(dto.type)}`;
    if (trip) {
      const list = await this.reservations.find({ where: { tripId: trip.id } });
      const companyIds = [...new Set(list.map(r => r.companyId))];
      for (const r of list)
        await this.notify(r.employeeId, title, `${dto.description}。平台已同步调度与园区运营，考勤将按规则处理。`, 'warning');
      if (trip.driverId) await this.notify(trip.driverId, title, dto.description, 'warning');
      const hrs = await this.users.find({ where: companyIds.flatMap(cid => [{ role: 'hr', companyId: cid }]) });
      for (const h of hrs) await this.notify(h.id, title, `您企业有 ${list.filter(r => r.companyId === h.companyId).length} 名员工在该车次上：${dto.description}`, 'warning');
    }
    await this.notifyRoles(['dispatcher', 'operator'], title,
      `${dto.description}（影响约 ${affected} 人，上报人：${user.realName}/${user.role}）`, ev.severity === 'critical' ? 'critical' : 'warning');
    return ev;
  }

  async resolveEvent(id: number, dto: {
    resolution: string; compensationType: string;
  }, user: any) {
    const ev = await this.events.findOne({ where: { id } });
    if (!ev) throw new NotFoundException('事件不存在');
    if (!['dispatcher', 'operator'].includes(user.role))
      throw new ForbiddenException('仅调度/园区运营可关闭事件');
    ev.status = 'resolved';
    ev.resolution = dto.resolution;
    ev.compensationType = dto.compensationType || 'none';
    ev.handledById = user.userId;
    await this.events.save(ev);

    // 联动考勤豁免 / 补车费
    if (ev.tripId && ['exempt_attendance', 'makeup_bus', 'refund'].includes(ev.compensationType)) {
      const recs = await this.attendance.find({ where: { tripId: ev.tripId } });
      for (const rec of recs) {
        if (ev.compensationType === 'exempt_attendance') {
          rec.exempt = true; rec.status = 'exempt';
          rec.exemptReason = `事件 #${ev.id} 处理：${ev.resolution.slice(0, 40)}`;
        }
        if (['makeup_bus', 'refund'].includes(ev.compensationType)) {
          rec.makeupFee = 0; rec.feeReason = `事件 #${ev.id}：园区安排补车/退费，员工不承担`;
        }
        await this.attendance.save(rec);
        await this.notify(rec.employeeId, '事件处理结果通知',
          `车次 #${ev.tripId} 事件已处理：${ev.resolution}。您的考勤/费用已按「${this.compName(ev.compensationType)}」更新。`);
      }
      if (!recs.length) {
        const list = await this.reservations.find({ where: { tripId: ev.tripId } });
        for (const r of list)
          await this.notify(r.employeeId, '事件处理结果通知',
            `车次 #${ev.tripId} 事件已处理：${ev.resolution}（${this.compName(ev.compensationType)}），考勤将在到厂时豁免。`);
      }
    }
    return ev;
  }

  // ==================== 考勤 / 申诉 / 绩效 ====================
  async listAttendance(dto: { date?: string; companyId?: number; employeeId?: number; status?: string }) {
    const qb = this.attendance.createQueryBuilder('a').orderBy('a.id', 'DESC').limit(200);
    if (dto.date) qb.andWhere('a.date = :d', { d: dto.date });
    if (dto.companyId) qb.andWhere('a.companyId = :c', { c: Number(dto.companyId) });
    if (dto.employeeId) qb.andWhere('a.employeeId = :e', { e: Number(dto.employeeId) });
    if (dto.status) qb.andWhere('a.status = :s', { s: dto.status });
    const recs = await qb.getMany();
    const users = await this.users.find({ where: { id: In([...new Set(recs.map(r => r.employeeId))]) } });
    return recs.map(r => ({ ...r, employee: users.find(u => u.id === r.employeeId) }));
  }

  async myAttendance(userId: number) {
    return this.attendance.find({ where: { employeeId: userId }, order: { id: 'DESC' }, take: 50 });
  }

  async adjustAttendance(id: number, dto: { exempt?: boolean; makeupFee?: number; note?: string }, user: any) {
    const rec = await this.attendance.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('考勤记录不存在');
    if (dto.exempt !== undefined) {
      rec.exempt = dto.exempt;
      rec.status = dto.exempt ? 'exempt' : (rec.lateMinutes > 0 ? 'late' : 'normal');
      rec.exemptReason = dto.exempt ? (dto.note || `${user.role}人工核准豁免`) : null;
    }
    if (dto.makeupFee !== undefined) {
      rec.makeupFee = Math.max(0, Number(dto.makeupFee));
      rec.feeReason = dto.note || rec.feeReason;
    }
    await this.attendance.save(rec);
    await this.notify(rec.employeeId, '考勤调整通知',
      `您 ${rec.date} 的考勤已调整：状态 ${rec.status}，补车费 ${rec.makeupFee} 元。${dto.note || ''}`);
    return rec;
  }

  listAppeals(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.appeals.find({ where, order: { id: 'DESC' }, take: 100 });
  }
  myAppeals(userId: number) {
    return this.appeals.find({ where: { employeeId: userId }, order: { id: 'DESC' } });
  }

  async createAppeal(user: any, dto: { attendanceId?: number; reason: string; evidence?: string }) {
    if (!dto.reason) throw new BadRequestException('申诉理由必填');
    let attendanceId = dto.attendanceId ? Number(dto.attendanceId) : null;
    if (!attendanceId) {
      const latest = await this.attendance.findOne({
        where: { employeeId: user.userId }, order: { id: 'DESC' },
      });
      attendanceId = latest?.id ?? null;
    }
    const a = await this.appeals.save(this.appeals.create({
      employeeId: user.userId, attendanceId, reason: dto.reason, evidence: dto.evidence,
      status: 'pending',
    }));
    await this.notifyRoles(['hr', 'operator'], '新迟到申诉',
      `员工 ${user.realName} 提交申诉：${dto.reason.slice(0, 50)}`, 'warning');
    return a;
  }

  async reviewAppeal(id: number, dto: {
    action: 'approve' | 'reject' | 'escalate'; reply: string;
    grantExemption?: boolean; refundFee?: boolean;
  }, user: any) {
    const a = await this.appeals.findOne({ where: { id } });
    if (!a) throw new NotFoundException('申诉不存在');
    if (!['hr', 'operator'].includes(user.role)) throw new ForbiddenException('仅 HR/园区运营可处理申诉');
    a.reply = dto.reply;
    a.handledById = user.userId;
    a.grantExemption = !!dto.grantExemption;
    a.refundFee = !!dto.refundFee;
    if (dto.action === 'escalate') a.status = 'operator_review';
    else if (dto.action === 'reject') a.status = 'rejected';
    else {
      a.status = 'approved';
      if (a.attendanceId) {
        const rec = await this.attendance.findOne({ where: { id: a.attendanceId } });
        if (rec) {
          if (dto.grantExemption) {
            rec.exempt = true; rec.status = 'exempt';
            rec.exemptReason = `申诉 #${a.id} 成立：${dto.reply.slice(0, 40)}`;
          }
          if (dto.refundFee) { rec.makeupFee = 0; rec.feeReason = '申诉成立，退还补车费'; }
          await this.attendance.save(rec);
        }
      }
    }
    await this.appeals.save(a);
    await this.notify(a.employeeId, '申诉处理结果',
      `您的申诉 #${a.id} 结果：${a.status === 'approved' ? '成立' : a.status === 'rejected' ? '驳回' : '升级处理'}。${dto.reply || ''}`,
      a.status === 'approved' ? 'info' : 'warning');
    return a;
  }

  async listPerformances() {
    const list = await this.performances.find({ order: { id: 'DESC' }, take: 100 });
    const drivers = await this.users.find({ where: { role: 'driver' } });
    return list.map(p => ({ ...p, driver: drivers.find(d => d.id === p.driverId) }));
  }

  // ==================== 线路调整提案（双确认） ====================
  async listProposals() {
    return this.proposals.find({ order: { id: 'DESC' }, take: 100 });
  }

  async createProposal(dto: any, user: any) {
    if (!dto.title || !dto.type || !dto.content) throw new BadRequestException('提案标题/类型/内容必填');
    const p = await this.proposals.save(this.proposals.create({
      lineId: dto.lineId ?? null, type: dto.type, title: dto.title,
      content: dto.content, impactSummary: dto.impactSummary,
      estimatedSaving: dto.estimatedSaving ?? 0,
      effectiveDate: dto.effectiveDate ?? null,
      status: 'proposed', raisedById: user.userId,
      companyConfirmations: [], employeeConfirmations: [],
    }));
    await this.notifyRoles(['hr'], '新线路调整方案待确认',
      `${p.title}：${(dto.impactSummary || '').slice(0, 60)}。请企业负责人评估确认。`, 'warning');
    return p;
  }

  // 计算提案涉线企业：关联线路的共线企业；园区级提案（无线路）视为全部企业
  private async involvedCompanyIds(manager: DataSource | any, p: LineProposal): Promise<number[]> {
    if (p.lineId) {
      const line = await manager.getRepository(Line).findOne({
        where: { id: p.lineId }, relations: { companies: true },
      });
      if (!line) throw new NotFoundException('提案关联线路不存在');
      return line.companies.map(c => c.id);
    }
    const all = await manager.getRepository(Company).find({ select: { id: true } });
    return all.map(c => c.id);
  }

  // 以当前持久化确认集合重新计算完整双确认矩阵：
  // 每家涉线企业 HR 均确认 且 每家涉线企业配置的员工代表均确认
  private matrixComplete(p: LineProposal, companyIds: number[]) {
    const cc = p.companyConfirmations || [];
    const ec = p.employeeConfirmations || [];
    const companiesDone = companyIds.every(cid => cc.some((c: any) => c.companyId === cid && c.confirmed));
    const employeesDone = companyIds.every(cid => ec.some((c: any) => c.companyId === cid && c.confirmed));
    return { companiesDone, employeesDone, complete: companiesDone && employeesDone };
  }

  async confirmProposal(id: number, side: 'company' | 'employee', user: any, note?: string) {
    return this.ds.transaction(async (manager) => {
      // 行锁串行化同一提案的并发确认：后来的事务在锁释放后读到已提交的最新矩阵
      const p = await manager.getRepository(LineProposal).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw new NotFoundException('提案不存在');
      if (['confirmed', 'rejected', 'cancelled'].includes(p.status))
        throw new BadRequestException('提案已闭环，不可再确认');

      const companyIds = await this.involvedCompanyIds(manager, p);
      if (!companyIds.length) throw new BadRequestException('提案没有涉线企业，无法确认');
      const now = new Date().toISOString();

      if (side === 'company') {
        if (user.role !== 'hr') throw new ForbiddenException('仅涉线企业 HR 可代表企业确认');
        if (!user.companyId || !companyIds.includes(Number(user.companyId)))
          throw new ForbiddenException('贵企业不在该提案关联线路的共线企业范围内，无权确认');
        // 以锁定后读到的持久化集合为基准合并，防止并发确认互相覆盖
        const arr = [...(p.companyConfirmations || [])];
        if (arr.find((c: any) => c.companyId === Number(user.companyId)))
          throw new BadRequestException('贵企业已完成确认，请勿重复确认');
        const company = await manager.getRepository(Company).findOne({ where: { id: Number(user.companyId) } });
        arr.push({ companyId: company.id, name: company.name, confirmed: true, by: user.realName, at: now, note: note || '' });
        p.companyConfirmations = arr;
      } else {
        if (user.role !== 'employee')
          throw new ForbiddenException('仅企业配置的员工代表可代表员工确认');
        // 必须是某家涉线企业配置的 representative（同企业 + 姓名一致），普通员工无权
        if (!user.companyId || !companyIds.includes(Number(user.companyId)))
          throw new ForbiddenException('您所在企业不在提案涉线范围内');
        const myCompany = await manager.getRepository(Company).findOne({ where: { id: Number(user.companyId) } });
        const isRep = !!myCompany?.representative
          && myCompany.representative.trim() === (user.realName || '').trim();
        if (!isRep)
          throw new ForbiddenException('您不是本企业配置的员工代表，无权代表员工确认');
        const arr = [...(p.employeeConfirmations || [])];
        if (arr.find((c: any) => c.companyId === myCompany.id))
          throw new BadRequestException('贵企业员工代表已完成确认，请勿重复确认');
        arr.push({ companyId: myCompany.id, name: myCompany.name, confirmed: true, by: user.realName, at: now, note: note || '' });
        p.employeeConfirmations = arr;
      }

      // 事务内以锁后持久化确认集合重算状态
      const m = this.matrixComplete(p, companyIds);
      p.status = m.complete ? 'employee_confirmed' : m.companiesDone ? 'company_confirmed' : 'proposed';
      await manager.getRepository(LineProposal).save(p);

      if (m.complete) {
        const targets = await manager.getRepository(User).find({
          where: [{ role: 'operator', active: true }, { role: 'dispatcher', active: true }],
        });
        for (const u of targets) {
          await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
            userId: u.id, title: '线路提案双确认通过',
            content: `《${p.title}》涉线 ${companyIds.length} 家企业 HR 与员工代表均已确认，可发布执行。`,
          }));
        }
      }
      return p;
    });
  }

  async applyProposal(id: number, user: any) {
    if (user.role !== 'operator') throw new ForbiddenException('仅园区运营可发布执行');
    return this.ds.transaction(async (manager) => {
      // 行锁：两个 operator 并发发布时，后者等待并读到前者已提交的 confirmed
      const p = await manager.getRepository(LineProposal).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw new NotFoundException('提案不存在');
      if (p.status === 'confirmed')
        throw new BadRequestException('提案已发布，请勿重复操作（影响不重复落地）');
      if (['rejected', 'cancelled'].includes(p.status))
        throw new BadRequestException('提案已驳回/取消，不可发布');

      // 锁后用持久化确认集合复核完整矩阵，任一企业 HR 或员工代表缺失即回滚
      const companyIds = await this.involvedCompanyIds(manager, p);
      const m = this.matrixComplete(p, companyIds);
      if (p.status !== 'employee_confirmed' || !m.complete) {
        const missingHr = companyIds.filter(cid => !(p.companyConfirmations || []).some((c: any) => c.companyId === cid && c.confirmed));
        const missingRep = companyIds.filter(cid => !(p.employeeConfirmations || []).some((c: any) => c.companyId === cid && c.confirmed));
        throw new BadRequestException(
          `双确认不完整，禁止发布（缺 HR 企业 ${missingHr.length} 家、缺员工代表企业 ${missingRep.length} 家）。提案状态与线路均未变更。`,
        );
      }

      // 条件状态迁移：仅 employee_confirmed → confirmed 恰好一行生效，保证并发下只有一个 operator 发布成功
      const migrated = await manager.createQueryBuilder()
        .update(LineProposal)
        .set({ status: 'confirmed' })
        .where('id = :id AND status = :status', { id, status: 'employee_confirmed' })
        .execute();
      if (migrated.affected !== 1) {
        throw new BadRequestException('提案已被其他操作发布，本次发布未生效（影响未落地）');
      }
      p.status = 'confirmed';

      // 车辆/司机/企业费用影响与执行通知在同一事务内一次写入
      let line: Line | null = null;
      if (p.lineId && ['suspend', 'relocation'].includes(p.type)) {
        line = await manager.getRepository(Line).findOne({ where: { id: p.lineId } });
        if (line) {
          line.status = p.type === 'suspend' ? 'suspended' : 'relocated';
          await manager.getRepository(Line).save(line);
        }
      }

      const targets = await manager.getRepository(User).find({
        where: [{ role: 'hr', active: true }, { role: 'dispatcher', active: true }],
      });
      for (const u of targets) {
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: u.id, title: '线路调整已执行',
          content: `《${p.title}》已于 ${p.effectiveDate || '今日'} 生效：${(p.impactSummary || '').slice(0, 60)}。请同步车辆、司机排班与企业费用。`,
        }));
      }
      return p;
    });
  }

  async rejectProposal(id: number, user: any, note?: string) {
    const p = await this.proposals.findOne({ where: { id } });
    if (!p) throw new NotFoundException('提案不存在');
    p.status = 'rejected';
    p.content += `\n[驳回 by ${user.realName}] ${note || ''}`;
    await this.proposals.save(p);
    return p;
  }

  // ==================== 访客 / 门禁 ====================
  async listVisitorPasses(date?: string) {
    const where: any = {};
    if (date) where.visitDate = date;
    return this.visitorPasses.find({ where, order: { id: 'DESC' }, take: 100 });
  }

  async createVisitorPass(user: any, dto: any) {
    if (!dto.visitorName || !dto.hostName || !dto.visitDate)
      throw new BadRequestException('访客姓名/接待人/到访日期必填');
    const companyId = dto.hostCompanyId || user.companyId;
    const qr = 'V-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    return this.visitorPasses.save(this.visitorPasses.create({
      visitorName: dto.visitorName, phone: dto.phone,
      hostCompanyId: companyId, hostName: dto.hostName,
      visitDate: dto.visitDate, stationId: dto.stationId, scheduleId: dto.scheduleId,
      qrCode: qr, status: 'registered', createdById: user.userId,
    }));
  }

  async visitorBoard(code: string) {
    const p = await this.visitorPasses.findOne({ where: { qrCode: code } });
    if (!p) throw new NotFoundException('访客码无效');
    if (p.visitDate !== todayStr()) throw new BadRequestException('访客码不在有效期');
    if (p.status === 'boarded' || p.status === 'checked_in')
      throw new BadRequestException('访客已使用该凭证');
    p.status = 'boarded';
    await this.visitorPasses.save(p);
    return p;
  }

  async gateScan(dto: { gateName: string; code: string; direction: 'in' | 'out' }, user: any) {
    // 员工工牌
    const emp = await this.users.findOne({ where: { employeeNo: dto.code } });
    if (emp) {
      const log = await this.gateLogs.save(this.gateLogs.create({
        gateName: dto.gateName, personType: 'employee', personRef: dto.code,
        personName: emp.realName, direction: dto.direction, result: 'allow',
      }));
      return log;
    }
    // 访客二维码
    const v = await this.visitorPasses.findOne({ where: { qrCode: dto.code } });
    if (v) {
      if (v.visitDate !== todayStr()) {
        return this.gateLogs.save(this.gateLogs.create({
          gateName: dto.gateName, personType: 'visitor', personRef: dto.code,
          personName: v.visitorName, direction: dto.direction, result: 'deny',
          note: '访客码非今日有效',
        }));
      }
      if (dto.direction === 'in') v.status = 'checked_in';
      await this.visitorPasses.save(v);
      return this.gateLogs.save(this.gateLogs.create({
        gateName: dto.gateName, personType: 'visitor', personRef: dto.code,
        personName: v.visitorName, direction: dto.direction, result: 'allow',
        note: `接待：${v.hostName}`,
      }));
    }
    return this.gateLogs.save(this.gateLogs.create({
      gateName: dto.gateName, personType: 'unknown', personRef: dto.code,
      direction: dto.direction, result: 'deny', note: '无法识别的凭证',
    }));
  }

  listGateLogs() {
    return this.gateLogs.find({ order: { id: 'DESC' }, take: 100 });
  }

  // ==================== 总览 ====================
  async dashboard() {
    const t = todayStr();
    const [companies, lines, vehicles, drivers, tripsToday, reservationsToday,
      openEvents, pendingAppeals, attendanceToday, activeVisitors] = await Promise.all([
      this.companies.count(),
      this.lines.count(),
      this.vehicles.find(),
      this.users.count({ where: { role: 'driver', active: true } }),
      this.trips.find({ where: { date: t } }),
      this.reservations.find({ where: { date: t } }),
      this.events.count({ where: { status: In(['open', 'processing']) } }),
      this.appeals.count({ where: { status: In(['pending', 'hr_review', 'operator_review']) } }),
      this.attendance.find({ where: { date: t } }),
      this.visitorPasses.count({ where: { visitDate: t } }),
    ]);
    return {
      companies, lines,
      vehicles: { total: vehicles.length, available: vehicles.filter(v => v.status === 'available').length },
      drivers,
      tripsToday: tripsToday.length,
      reservationsToday: reservationsToday.filter(r => r.status !== 'cancelled').length,
      boardedToday: reservationsToday.filter(r => ['boarded', 'late', 'changed'].includes(r.status)).length,
      noShowToday: reservationsToday.filter(r => r.status === 'no_show').length,
      openEvents, pendingAppeals, activeVisitors,
      attendanceToday: {
        total: attendanceToday.length,
        late: attendanceToday.filter(a => a.status === 'late').length,
        exempt: attendanceToday.filter(a => a.status === 'exempt').length,
        noShow: attendanceToday.filter(a => a.status === 'no_show').length,
        feeTotal: attendanceToday.reduce((s, a) => s + (a.makeupFee || 0), 0),
      },
    };
  }

  // ==================== 字典 ====================
  eventTypeName(t: string) {
    return ({
      congestion: '道路拥堵', breakdown: '车辆故障', construction: '站点施工',
      missed_bus: '员工错过班车', overtime: '企业临时加班', detour: '司机绕行',
      late_arrival: '班车到厂晚点', weather: '极端天气', suspension: '停运',
      security_check: '临时安检/代刷', relocation: '企业搬迁',
    } as any)[t] || t;
  }
  private compName(t: string) {
    return ({ none: '无', exempt_attendance: '考勤豁免', makeup_bus: '补车费用由园区承担', refund: '退还补车费', reschedule: '改乘下一班' } as any)[t] || t;
  }
}
