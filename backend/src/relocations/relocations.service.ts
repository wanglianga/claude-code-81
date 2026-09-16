import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  Line, Station, Schedule, Reservation, Trip, User, Notification,
  StationRelocation, RelocationConfirmation, RollCall,
} from '../entities';

const AFFECTED_RES = ['booked', 'on_manifest'];
// 计算容量时视为占用候车名额的预约状态（已取消/未到不占）
const OCCUPYING_RES = ['booked', 'on_manifest', 'boarded', 'late', 'changed'];

@Injectable()
export class RelocationService {
  constructor(
    @InjectRepository(StationRelocation) private relos: Repository<StationRelocation>,
    @InjectRepository(RelocationConfirmation) private confirms: Repository<RelocationConfirmation>,
    @InjectRepository(RollCall) private rollCalls: Repository<RollCall>,
    @InjectRepository(Station) private stations: Repository<Station>,
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
    @InjectRepository(Reservation) private reservations: Repository<Reservation>,
    @InjectRepository(Trip) private trips: Repository<Trip>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Notification) private notifications: Repository<Notification>,
    private ds: DataSource,
  ) {}

  private async notify(userId: number, title: string, content: string, category = 'warning') {
    await this.notifications.save(this.notifications.create({ userId, title, content, category }));
  }

  // 统一的临停可停靠判定：仅 normal 站点可作为临停（施工/关闭等一律不可）
  private isDockable(s: Station) {
    return s.status === 'normal';
  }

  // 同日期 + 班次集合下，目标临停站的候车占用数（既有预约 + 其它改站单已迁入/待迁入名额）
  // managerOrDs 可为事务 EntityManager 或 DataSource（二者均有 getRepository）
  private async stationOccupancy(
    ctx: any, tempStationId: number, date: string, scheduleIds: number[],
    excludeReservationIds: number[] = [],
  ) {
    // 1) 当前已在临停站的预约（含已 accept、stationId 已改到该站的改站）
    const qb = ctx.getRepository(Reservation).createQueryBuilder('r')
      .where('r.date = :date', { date })
      .andWhere('r.scheduleId IN (:...sids)', { sids: scheduleIds })
      .andWhere('r."stationId" = :sid', { sid: tempStationId })
      .andWhere('r.status IN (:...st)', { st: OCCUPYING_RES });
    if (excludeReservationIds.length)
      qb.andWhere('r.id NOT IN (:...ex)', { ex: excludeReservationIds });
    const atStation = await qb.getCount();

    // 2) 其它进行中改站单指向该站、但其预约尚未迁到该站的确认名额（pending/accepted）
    const relos = await ctx.getRepository(StationRelocation).find({
      where: { date, temporaryStationId: tempStationId, status: In(['proposed', 'confirmed']) },
    });
    let pendingNotMoved = 0;
    for (const r of relos) {
      if (r.scheduleId && !scheduleIds.includes(r.scheduleId)) continue;
      const confs = await ctx.getRepository(RelocationConfirmation).find({
        where: { relocationId: r.id, status: In(['pending', 'accepted']) },
      });
      for (const c of confs) {
        if (excludeReservationIds.includes(c.reservationId)) continue;
        const res = await ctx.getRepository(Reservation).findOne({ where: { id: c.reservationId } });
        if (res && res.stationId !== tempStationId) pendingNotMoved++;
      }
    }
    return atStation + pendingNotMoved;
  }

  // 临停推荐：同线路仅 normal 站点；按站序就近，附步行距离/安全点/剩余容量（需结合日期班次）
  async recommend(lineId: number, stationId: number, date?: string, scheduleId?: number) {
    const origin = await this.stations.findOne({ where: { id: stationId } });
    if (!origin) throw new NotFoundException('原站点不存在');
    const all = await this.stations.find({ where: { lineId }, order: { seq: 'ASC' } });
    let scheduleIds: number[] = [];
    if (date && scheduleId) scheduleIds = [Number(scheduleId)];
    else if (date) {
      const ss = await this.schedules.find({ where: { lineId, valid: true } });
      scheduleIds = ss.map(s => s.id);
    }
    const result: any[] = [];
    for (const s of all) {
      if (s.id === stationId) continue;
      const gap = Math.abs(s.seq - origin.seq);
      const walkMeters = gap <= 1 ? 260 : gap * 320;
      const dockable = this.isDockable(s);
      let remaining: number | null = null;
      if (date && scheduleIds.length) {
        const occ = await this.stationOccupancy(this.ds.manager, s.id, date, scheduleIds);
        remaining = s.capacity - occ;
      }      result.push({
        temporaryStationId: s.id,
        name: s.name,
        seq: s.seq,
        walkMeters,
        capacity: s.capacity,
        remainingCapacity: remaining,
        safePickupPoint: `${s.name}东门公交港湾（有照明、非机动车隔离）`,
        walkRoute: `由${origin.name}沿人行道步行约 ${walkMeters} 米至${s.name}，途经 2 处人行横道，均有信号灯`,
        dockable,
        statusNote: !dockable
          ? (s.status === 'construction' ? '该站点施工中，禁止作为临停点' : '该站点不可停靠')
          : (remaining !== null && remaining <= 0 ? '该站点候车容量已满，不可分流' : '可安全停靠'),
        recommendScore: (dockable ? 100 : 0) - gap * 20 - (remaining !== null && remaining <= 0 ? 80 : 0),
      });
    }
    return result.sort((a, b) => b.recommendScore - a.recommendScore);
  }

  // 调度/运营发起临时改站
  async create(dto: any, user: any) {
    if (!dto.date || !dto.originalStationId) throw new BadRequestException('日期与原站点必填');
    const origin = await this.stations.findOne({ where: { id: Number(dto.originalStationId) } });
    if (!origin) throw new NotFoundException('原站点不存在');
    const lineId = Number(dto.lineId || origin.lineId);
    if (!dto.temporaryStationId) throw new BadRequestException('请选择推荐临时站点');
    const temp = await this.stations.findOne({ where: { id: Number(dto.temporaryStationId) } });
    if (!temp || temp.lineId !== lineId) throw new BadRequestException('临时站点必须与原站点同线路');
    if (temp.id === origin.id) throw new BadRequestException('临时站点不能与原站点相同');
    // 统一可停靠判定：仅 normal；施工/关闭等一律拒绝（与推荐、员工确认同源）
    if (!this.isDockable(temp))
      throw new BadRequestException(`临时站点「${temp.name}」当前状态为${temp.status === 'construction' ? '施工' : temp.status}，不可停靠，无法下发安全上车指引`);

    // 影响班次：指定班次或当天该线全部班次
    let scheduleIds: number[] = dto.scheduleId ? [Number(dto.scheduleId)] : [];
    if (!scheduleIds.length) {
      const ss = await this.schedules.find({ where: { lineId, valid: true } });
      scheduleIds = ss.map(s => s.id);
    }
    if (!scheduleIds.length) throw new BadRequestException('该线路当天没有可改站的班次');

    let reloId: number;
    await this.ds.transaction(async (manager) => {
      // 行锁目标临停站点（串行化并发改站），锁后再读一次状态
      const lockedTemp = await manager.getRepository(Station).findOne({
        where: { id: temp.id }, lock: { mode: 'pessimistic_write' },
      });
      if (!this.isDockable(lockedTemp))
        throw new BadRequestException(`临时站点「${lockedTemp.name}」已不可停靠（${lockedTemp.status}），请改选其它临停点`);

      // 读取受影响预约（同日期/班次/原站点、待乘车）；并发安全由上面的目标站点行锁保证，
      // 不对 Reservation 加 FOR UPDATE（其 eager 关系会生成外连接，PG 不允许锁 nullable 侧）
      const affected = await manager.getRepository(Reservation).find({
        where: { date: dto.date, scheduleId: In(scheduleIds), stationId: origin.id, status: In(AFFECTED_RES) },
        order: { id: 'ASC' },
      });
      const targets = affected.filter(r => AFFECTED_RES.includes(r.status));
      if (!targets.length) throw new BadRequestException('该站点/班次当前没有待乘车的受影响员工');

      // 容量：同日期/班次既有候车 + 进行中其它改站迁入名额
      const occ = await this.stationOccupancy(manager, temp.id, dto.date, scheduleIds);
      let remaining = lockedTemp.capacity - occ;
      if (remaining < targets.length) {
        if (dto.allowPartial) {
          // 明确分流方案：只对不超过剩余容量的前 N 人生成改站确认，其余不分流
          if (remaining <= 0)
            throw new BadRequestException(`临时站点「${lockedTemp.name}」候车容量已满（${lockedTemp.capacity}人），请选择其它临停点或拆分分流`);
        } else {
          throw new BadRequestException(
            `临时站点「${lockedTemp.name}」剩余候车容量仅 ${Math.max(0, remaining)} 人，无法承接本次 ${targets.length} 名员工；`
            + `请选择其它临停点，或勾选“按容量分流（其余员工保留原方案/另行通知）”`,
          );
        }
      }
      const acceptedTargets = dto.allowPartial ? targets.slice(0, Math.max(0, remaining)) : targets;
      remaining -= acceptedTargets.length;

      const gap = Math.abs(lockedTemp.seq - origin.seq);
      const walkMeters = dto.walkMeters ?? (gap <= 1 ? 260 : gap * 320);
      const relo = await manager.getRepository(StationRelocation).save(
        manager.getRepository(StationRelocation).create({
          date: dto.date, scheduleId: dto.scheduleId ? Number(dto.scheduleId) : null,
          originalStationId: origin.id, temporaryStationId: lockedTemp.id, lineId,
          safePickupPoint: dto.safePickupPoint || `${lockedTemp.name}东门公交港湾（有照明、非机动车隔离）`,
          walkMeters,
          walkRoute: dto.walkRoute
            || `由${origin.name}沿人行道步行约 ${walkMeters} 米至${lockedTemp.name}，途经人行横道（有信号灯）`,
          reason: dto.reason || '道路施工，原站点无法停靠',
          affectedCount: acceptedTargets.length, status: 'proposed',
          createdById: user.userId, createdByRole: user.role,
        }),
      );

      // 通知范围：被分流员工 + 当班车司机；逐人建立确认单（仅容量内员工）
      const driverIds = new Set<number>();
      for (const r of acceptedTargets) {
        r.relocationId = relo.id;
        r.originalStationId = r.originalStationId ?? origin.id;
        await manager.getRepository(Reservation).save(r);
        await manager.getRepository(RelocationConfirmation).save(
          manager.getRepository(RelocationConfirmation).create({
            relocationId: relo.id, reservationId: r.id, employeeId: r.employeeId, status: 'pending',
          }),
        );
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: r.employeeId, title: '临时改站通知（请确认）',
          content: `${dto.date} 您的乘车站点「${origin.name}」因${relo.reason}无法停靠，`
            + `临时上车点改为「${lockedTemp.name}」，${relo.safePickupPoint}，步行约 ${walkMeters} 米。请尽快在 App 内确认，未确认将进入司机点名提醒。`,
          category: 'critical',
        }));
        const trip = await manager.getRepository(Trip).findOne({
          where: { date: dto.date, scheduleId: r.scheduleId },
        });
        if (trip?.driverId) driverIds.add(trip.driverId);
      }
      for (const did of driverIds) {
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: did, title: '导航变更：临时改站',
          content: `${origin.name} 施工无法停靠，改停 ${lockedTemp.name}（${relo.safePickupPoint}），`
            + `导航与乘车名单已更新，共 ${acceptedTargets.length} 名员工分流至该站（该站改站后剩余容量 ${remaining} 人），未确认员工请按点名表逐一核对防止漏接。`,
          category: 'critical',
        }));
      }
      reloId = relo.id;
    });
    // 事务提交后再读取完整详情（避免外层连接读不到未提交数据）
    return this.detail(reloId);
  }

  async list(date?: string) {
    const where: any = {};
    if (date) where.date = date;
    const list = await this.relos.find({ where, order: { id: 'DESC' }, take: 100 });
    const ids = list.map(r => r.id);
    const confs = ids.length ? await this.confirms.find({ where: { relocationId: In(ids) } }) : [];
    const st = await this.stations.find();
    return list.map(r => ({
      ...r,
      originalStationName: st.find(s => s.id === r.originalStationId)?.name,
      temporaryStationName: st.find(s => s.id === r.temporaryStationId)?.name,
      acceptedCount: confs.filter(c => c.relocationId === r.id && c.status === 'accepted').length,
      declinedCount: confs.filter(c => c.relocationId === r.id && c.status === 'declined').length,
      pendingCount: confs.filter(c => c.relocationId === r.id && c.status === 'pending').length,
    }));
  }

  async detail(id: number) {
    const relo = await this.relos.findOne({ where: { id } });
    if (!relo) throw new NotFoundException('临时改站单不存在');
    const origin = await this.stations.findOne({ where: { id: relo.originalStationId } });
    const temp = await this.stations.findOne({ where: { id: relo.temporaryStationId } });
    const confs = await this.confirms.find({ where: { relocationId: id }, order: { id: 'ASC' } });
    const users = await this.users.find({ where: { id: In(confs.map(c => c.employeeId)) } });
    const reservations = await this.reservations.find({ where: { relocationId: id } });
    const roll = await this.rollCalls.find({ where: { relocationId: id } });
    return {
      ...relo,
      originalStation: origin, temporaryStation: temp,
      confirmations: confs.map(c => ({
        ...c,
        employee: users.find(u => u.id === c.employeeId),
        reservation: reservations.find(r => r.id === c.reservationId),
        rollCall: roll.find(rc => rc.reservationId === c.reservationId),
      })),
    };
  }

  // 员工确认/拒绝
  async confirmByEmployee(user: any, id: number, dto: { accept: boolean; note?: string }) {
    const relo = await this.relos.findOne({ where: { id } });
    if (!relo) throw new NotFoundException('临时改站单不存在');
    const cf = await this.confirms.findOne({ where: { relocationId: id, employeeId: user.userId } });
    if (!cf) throw new ForbiddenException('您不在本次改站通知范围内');
    if (cf.status !== 'pending') throw new BadRequestException('您已确认，请勿重复操作');

    await this.ds.transaction(async (manager) => {
      cf.status = dto.accept ? 'accepted' : 'declined';
      cf.confirmedAt = new Date();
      cf.note = dto.note || null;
      await manager.getRepository(RelocationConfirmation).save(cf);

      const r = await manager.getRepository(Reservation).findOne({ where: { id: cf.reservationId } });
      const temp = await manager.getRepository(Station).findOne({ where: { id: relo.temporaryStationId } });
      const origin = await manager.getRepository(Station).findOne({ where: { id: relo.originalStationId } });
      if (r) {
        if (dto.accept) {
          // 锁定临停站点并按同日期/班次重算容量，满员则拒绝迁入（不写名单/导航）
          const lockedTemp = await manager.getRepository(Station).findOne({
            where: { id: temp.id }, lock: { mode: 'pessimistic_write' },
          });
          if (!this.isDockable(lockedTemp))
            throw new BadRequestException(`临时站点「${lockedTemp.name}」当前不可停靠（${lockedTemp.status}），无法确认改站，请联系调度分流`);
          const scheduleIds = relo.scheduleId ? [relo.scheduleId]
            : (await manager.getRepository(Schedule).find({ where: { lineId: relo.lineId, valid: true } })).map(s => s.id);
          // 排除本人（其 pending 名额此前已计入，迁入后改由 atStation 计入，不重复占）
          const occ = await this.stationOccupancy(manager, lockedTemp.id, relo.date, scheduleIds, [r.id]);
          if (lockedTemp.capacity - occ <= 0)
            throw new BadRequestException(`临时站点「${lockedTemp.name}」候车容量已满（${lockedTemp.capacity}人），请改选其它临停点或由调度拆分分流`);
          const note = `施工临停改站：${origin.name} → ${lockedTemp.name}（员工已确认，步行约${relo.walkMeters}米）`;
          // 用显式列更新，避免 eager 的 station 关系对象覆盖外键
          await manager.createQueryBuilder().update(Reservation)
            .set({ originalStationId: r.originalStationId ?? origin.id, stationId: lockedTemp.id, changeNote: note })
            .where('id = :id', { id: r.id })
            .execute();
        } else {
          const note = `员工未确认改站（${dto.note || '无法前往临停点'}），列入司机点名/分流`;
          await manager.createQueryBuilder().update(Reservation)
            .set({ changeNote: note })
            .where('id = :id', { id: r.id })
            .execute();
        }
      }

      // 通知调度与司机确认进度
      const targets = await manager.getRepository(User).find({
        where: [{ role: 'dispatcher', active: true }, { role: 'operator', active: true }],
      });
      for (const u of targets) {
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: u.id,
          title: dto.accept ? '员工已确认临停改站' : '员工无法前往临停点',
          content: `${user.realName} ${dto.accept ? '已确认' : '拒绝'}由 ${origin.name} 改至 ${temp.name}${dto.note ? `：${dto.note}` : ''}`,
        }));
      }
      const trip = await manager.getRepository(Trip).findOne({
        where: { date: relo.date, scheduleId: relo.scheduleId || undefined },
      });
      if (trip?.driverId) {
        await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
          userId: trip.driverId, title: '改站确认进度更新',
          content: `${user.realName} ${dto.accept ? '将在临停点上车' : '可能无法到临停点，请到点核对并点名'}`,
        }));
      }
    });
    return this.detail(id);
  }

  async myRelocations(userId: number) {
    const confs = await this.confirms.find({ where: { employeeId: userId }, order: { id: 'DESC' } });
    if (!confs.length) return [];
    const relos = await this.relos.find({ where: { id: In(confs.map(c => c.relocationId)) } });
    const stations = await this.stations.find();
    return confs.map(c => {
      const relo = relos.find(r => r.id === c.relocationId);
      if (!relo) return null;
      return {
        ...c,
        relocation: {
          ...relo,
          originalStationName: stations.find(s => s.id === relo.originalStationId)?.name,
          temporaryStationName: stations.find(s => s.id === relo.temporaryStationId)?.name,
        },
      };
    }).filter(Boolean);
  }

  // 司机导航：本车次的临停点、安全上车点、步行路线、每位员工应接站点与确认状态
  async driverNavigation(driverId: number, tripId: number) {
    const trip = await this.trips.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('车次不存在');
    if (trip.driverId !== driverId) throw new ForbiddenException('这不是您的车次');
    const relos = await this.relos.find({ where: { date: trip.date } });
    const active = [];
    for (const relo of relos) {
      if (relo.scheduleId && relo.scheduleId !== trip.scheduleId) continue;
      const confs = await this.confirms.find({ where: { relocationId: relo.id } });
      const list = await this.reservations.find({ where: { tripId, relocationId: relo.id } });
      if (!list.length) continue;
      const temp = await this.stations.findOne({ where: { id: relo.temporaryStationId } });
      const origin = await this.stations.findOne({ where: { id: relo.originalStationId } });
      active.push({
        relocationId: relo.id, reason: relo.reason, status: relo.status,
        origin, temporary: temp,
        safePickupPoint: relo.safePickupPoint, walkMeters: relo.walkMeters, walkRoute: relo.walkRoute,
        passengers: list.map(r => ({
          reservationId: r.id, employeeId: r.employeeId,
          pickupStationId: r.stationId, // 已确认员工已改为临停点
          confirmed: confs.find(c => c.reservationId === r.id)?.status === 'accepted',
          declined: confs.find(c => c.reservationId === r.id)?.status === 'declined',
        })),
        unconfirmedCount: list.filter(r => confs.find(c => c.reservationId === r.id)?.status === 'pending').length,
      });
    }
    return {
      tripId,
      navigationNote: active.length
        ? `导航已变更：${active.map(a => `跳过 ${a.origin.name}，改停 ${a.temporary.name}`).join('；')}`
        : '本车次暂无临时改站',
      temporaryStops: active,
    };
  }

  // 司机点名：保留未上车原因、站点时间、员工确认状态，防止改站漏接
  async rollCall(driverId: number, tripId: number, dto: any) {
    const trip = await this.trips.findOne({ where: { id: tripId } });
    if (!trip || trip.driverId !== driverId) throw new ForbiddenException('无权操作该车次');
    const r = await this.reservations.findOne({ where: { id: Number(dto.reservationId), tripId } });
    if (!r) throw new NotFoundException('名单中无此预约');
    const allowed = ['on_board', 'no_show', 'refused_change', 'absent', 'resolved'];
    if (!allowed.includes(dto.result)) throw new BadRequestException('点名结果不合法');

    const reloId = r.relocationId || null;
    const cf = reloId ? await this.confirms.findOne({ where: { relocationId: reloId, reservationId: r.id } }) : null;
    const rc = await this.rollCalls.save(this.rollCalls.create({
      tripId, employeeId: r.employeeId, reservationId: r.id, relocationId: reloId,
      stationId: r.stationId, result: dto.result,
      reason: dto.reason || (dto.result === 'refused_change' ? '员工未确认改站，未到临停点' : undefined),
      stationTime: dto.stationTime ? new Date(dto.stationTime) : new Date(),
      employeeConfirmed: cf?.status === 'accepted',
      handledById: driverId,
    }));

    if (dto.result === 'on_board') {
      if (!['boarded', 'late', 'changed'].includes(r.status)) {
        r.status = trip.status === 'departed' ? 'late' : 'changed';
        r.boardedAt = new Date();
        r.changeNote = `${r.changeNote || ''}｜司机临停点点名接到`.trim();
        await this.reservations.save(r);
      }
    } else if (['no_show', 'refused_change', 'absent'].includes(dto.result)) {
      r.status = 'no_show';
      r.changeNote = `${r.changeNote || ''}｜点名未接：${dto.result} ${dto.reason || ''}`.trim();
      await this.reservations.save(r);
      await this.notify(r.employeeId, '临停点点名未乘车登记',
        `您在临时站点的乘车被登记为「${dto.result}」，原因：${dto.reason || '未到临停点'}。如有异议可联系调度或发起申诉。`, 'warning');
    }
    return rc;
  }

  async listRollCalls(tripId: number) {
    return this.rollCalls.find({ where: { tripId }, order: { id: 'DESC' } });
  }

  async complete(user: any, id: number) {
    const relo = await this.relos.findOne({ where: { id } });
    if (!relo) throw new NotFoundException('临时改站单不存在');
    relo.status = 'completed';
    relo.completedAt = new Date();
    await this.relos.save(relo);
    return relo;
  }
}
