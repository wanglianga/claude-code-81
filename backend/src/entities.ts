import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, OneToMany, ManyToMany, JoinTable, Index
} from 'typeorm';

// ============ 组织与用户 ============
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ unique: true }) code: string;
  // 企业考勤规则：宽限分钟、白班上班时间、夜班上班时间、迟到扣款等
  @Column({ default: 10 }) lateGraceMinutes: number;
  @Column({ default: '08:30' }) dayShiftStart: string;
  @Column({ default: '20:00' }) nightShiftStart: string;
  @Column({ default: 20 }) lateFeeBase: number;
  @Column({ nullable: true }) representative: string; // 员工代表
  @OneToMany('User', 'company') users: any[];
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) username: string;
  @Column() passwordHash: string;
  @Column() realName: string;
  // employee | driver | dispatcher | hr | operator | admin
  @Column() role: string;
  @Column({ nullable: true }) employeeNo: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) licenseNo: string;
  @Column({ type: 'date', nullable: true }) safetyTrainingExpiry: string;
  @Column({ nullable: true }) homeStationId: number;
  @ManyToOne('Company', 'users', { nullable: true, eager: true })
  company: Company;
  @Column({ nullable: true }) companyId: number;
  @Column({ default: true }) active: boolean;
}

// ============ 线路 / 站点 / 班次 ============
@Entity('lines')
export class Line {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ unique: true }) code: string;
  @Column({ default: '东区' }) district: string;
  // active | suspended | relocated
  @Column({ default: 'active' }) status: string;
  @Column({ default: 45 }) baseFare: number; // 单趟基准费用（企业分摊用）
  @ManyToMany('Company')
  @JoinTable({ name: 'line_companies' })
  companies: Company[];
  @OneToMany('Station', 'line') stations: any[];
  @OneToMany('Schedule', 'line') schedules: any[];
}

@Entity('stations')
export class Station {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column() seq: number;                 // 线路上的顺序
  @Column({ default: '东区' }) district: string;
  @Column({ default: 30 }) capacity: number; // 站点容量（同批次候车人数）
  // normal | construction | closed
  @Column({ default: 'normal' }) status: string;
  @Column({ nullable: true }) note: string;
  @ManyToOne('Line', 'stations') line: Line;
  @Column() lineId: number;
}

@Entity('schedules')
export class Schedule {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;              // 如：东线早班
  // to_park（上班）| from_park（下班）
  @Column() direction: string;
  @Column({ type: 'time' }) departureTime: string;
  @Column() shiftLabel: string;        // 早班/白班/夜班
  @Column({ default: true }) valid: boolean;
  @ManyToOne('Line', 'schedules') line: Line;
  @Column() lineId: number;
}

// ============ 车辆 / 司机（司机用 User role=driver） ============
@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) plate: string;
  @Column({ default: 45 }) seats: number;
  // available | in_use | maintenance | breakdown
  @Column({ default: 'available' }) status: string;
  @Column({ nullable: true }) note: string;
}

// ============ 车次（一趟车） ============
@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @ManyToOne('Schedule', { eager: true }) schedule: Schedule;
  @Column() scheduleId: number;
  @ManyToOne('Vehicle', { eager: true, nullable: true }) vehicle: Vehicle;
  @Column({ nullable: true }) vehicleId: number;
  @ManyToOne('User', { eager: true, nullable: true }) driver: User;
  @Column({ nullable: true }) driverId: number;
  // planned | confirmed | boarding | departed | arrived | cancelled | suspended
  @Column({ default: 'planned' }) status: string;
  @Column({ type: 'time', nullable: true }) plannedDepart: string;
  @Column({ type: 'timestamptz', nullable: true }) actualDepart: Date;
  @Column({ type: 'timestamptz', nullable: true }) actualArrive: Date;
  @Column({ default: 0 }) delayMinutes: number;
  @Column({ default: 0 }) boardedCount: number;
  @Column({ default: 0 }) noShowCount: number;
  @Column({ default: 0 }) emptySeats: number;
  @Column({ default: '' }) qrToken: string;
  @Column({ type: 'jsonb', nullable: true }) manifest: any;
  @Column({ type: 'jsonb', nullable: true }) feeSplit: any; // 多企业费用分摊
}

// ============ 预约 ============
@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @ManyToOne('User', { eager: true }) employee: User;
  @Column() employeeId: number;
  @Column() companyId: number;
  @ManyToOne('Schedule', { eager: true }) schedule: Schedule;
  @Column() scheduleId: number;
  @Column({ nullable: true }) tripId: number;
  @ManyToOne('Station', { eager: true, nullable: true }) station: Station;
  @Column() stationId: number;
  @Column({ default: false }) withLuggage: boolean;
  @Column({ default: false }) tempOvertime: boolean;
  @Column({ nullable: true }) overtimeNote: string;
  @Column({ default: false }) isVisitor: boolean;
  // booked(已预约) | on_manifest(已入名单) | boarded(已上车) | late(迟到上车)
  // | no_show(未到) | changed(改站) | cancelled
  @Column({ default: 'booked' }) status: string;
  @Column({ nullable: true }) seatNo: number;
  @Column({ type: 'timestamptz', nullable: true }) boardedAt: Date;
  @Column({ nullable: true }) boardedStationId: number;
  @Column({ default: false }) proxyBoarded: boolean;   // 代刷标记
  @Column({ nullable: true }) proxyNote: string;
  @Column({ nullable: true }) changeNote: string;
  @Column({ nullable: true }) originalStationId: number; // 临时改站前的原站点
  @Column({ nullable: true }) relocationId: number;      // 关联临时改站单
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 晚点考勤豁免证明 ============
// 道路事故等班车晚点场景：平台依据 GPS、站点签到、到厂时间与企业规则自动取证生成，
// 标明影响企业与班次，HR 按「企业 × 班次」批量确认后，一次回写考勤/司机绩效/线路复盘。
@Entity('late_certificates')
export class LateCertificate {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) certNo: string;          // 证明编号，如 LATE-20260915-0007
  @Column({ nullable: true }) tripId: number;
  @Column({ nullable: true }) eventId: number;       // 关联途中事件（事故上报）
  @Column() date: string;                            // 乘车日期（type:date）
  @Column({ nullable: true }) scheduleId: number;
  @Column({ nullable: true }) lineId: number;
  @Column({ nullable: true }) driverId: number;
  @Column({ nullable: true }) vehicleId: number;
  // accident | congestion | breakdown | construction | detour | weather | other
  @Column() reasonType: string;
  @Column() reasonText: string;                      // 统一晚点原因，员工端/HR端看到同一份
  @Column({ nullable: true }) incidentLocation: string;
  @Column({ type: 'timestamptz', nullable: true }) incidentAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) gpsDepartAt: Date;   // GPS 实际离场
  @Column({ type: 'timestamptz', nullable: true }) gpsArriveAt: Date;   // GPS 到厂
  @Column({ type: 'timestamptz', nullable: true }) plannedArrive: Date; // 计划到厂
  @Column({ default: 0 }) delayMinutes: number;
  @Column({ default: 0 }) boardedCount: number;
  // auto_generated（平台自动生成）| pending_hr（待HR确认）| confirmed（已确认并回写）
  // | partially_confirmed（部分企业/班次确认）| rejected | cancelled
  @Column({ default: 'auto_generated' }) status: string;
  @Column({ default: false }) systemGenerated: boolean;
  @Column({ type: 'jsonb', nullable: true }) evidence: any;            // 取证摘要（GPS/签到/规则）
  @Column({ type: 'jsonb', nullable: true }) impactSummary: any;       // 影响企业×班次汇总
  @Column({ type: 'text', nullable: true }) generatorNote: string;
  @Column({ nullable: true }) createdById: number;
  @Column({ nullable: true }) createdByRole: string;
  @Column({ type: 'timestamptz', nullable: true }) confirmedAt: Date;  // 全部批次回写完成
  @Column({ nullable: true }) reviewId: number;        // 关联线路复盘
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @OneToMany('LateCertificateAffected', 'certificate') items: any[];
}

// 证明影响名单：受影响员工（按企业 × 班次展开，便于批量处理）
@Entity('late_certificate_affected')
export class LateCertificateAffected {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne('LateCertificate', 'items', { onDelete: 'CASCADE' })
  certificate: LateCertificate;
  @Column() certificateId: number;
  @Column() employeeId: number;
  @Column() companyId: number;
  @Column({ nullable: true }) scheduleId: number;
  @Column({ nullable: true }) attendanceId: number;   // 回写的考勤档案
  @Column({ nullable: true }) stationName: string;    // 签到站点
  @Column({ type: 'timestamptz', nullable: true }) boardedAt: Date; // 站点签到时间
  @Column({ default: 0 }) lateMinutes: number;       // 总晚点（公共+个人）
  @Column({ default: 0 }) commonLateMinutes: number; // 车次公共晚点（事故/拥堵，可豁免）
  @Column({ default: 0 }) personalLateMinutes: number;// 个人到站迟到（发车后补签到等，不豁免）
  @Column({ default: 0 }) graceMinutes: number;       // 企业宽限规则快照
  @Column({ default: 0 }) originalFee: number;        // 原补车费
  // pending（待本企业HR处理）| exempt（公共+个人均无责，整条豁免）
  // | partial_exempt（事故公共晚点已豁免，保留个人迟到结算）| rejected（HR驳回）
  @Column({ default: 'pending' }) status: string;
  // full（整条豁免）| partial（仅豁免事故公共晚点）| none（驳回）
  @Column({ nullable: true }) resolution: string;
  @Column({ default: false }) writeback: boolean;     // 是否已回写考勤系统
  @Column({ nullable: true }) handledById: number;
  @Column({ type: 'timestamptz', nullable: true }) handledAt: Date;
  @Column({ nullable: true }) handleNote: string;
  @CreateDateColumn() createdAt: Date;
}

// ============ 线路复盘（晚点证明确认后联动生成/更新） ============
@Entity('line_reviews')
export class LineReview {
  @PrimaryGeneratedColumn() id: number;
  @Column({ nullable: true }) lineId: number;
  @Column({ nullable: true }) certificateId: number;
  @Column({ nullable: true }) tripId: number;
  @Column({ type: 'date' }) date: string;
  @Column() title: string;
  @Column({ type: 'text' }) rootCause: string;        // 与晚点证明一致的晚点原因
  @Column({ type: 'text', nullable: true }) measures: string;  // 整改措施
  @Column({ default: 0 }) delayMinutes: number;
  @Column({ default: 0 }) affectedCount: number;
  @Column({ default: 0 }) exemptedCount: number;      // 事故晚点整条豁免人数（无个人迟到）
  @Column({ default: 0 }) partialExemptCount: number; // 事故部分豁免、仍保留个人迟到人数
  // open（待复盘）| reviewed（已复盘）
  @Column({ default: 'open' }) status: string;
  @Column({ nullable: true }) handledById: number;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 考勤到厂档案 ============
@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column() employeeId: number;
  @Column() companyId: number;
  @Column({ nullable: true }) tripId: number;
  @Column({ nullable: true }) reservationId: number;
  @Column({ type: 'timestamptz', nullable: true }) scheduledArrive: Date;
  @Column({ type: 'timestamptz', nullable: true }) actualArrive: Date;
  @Column({ default: 0 }) lateMinutes: number;
  @Column({ default: 0 }) commonLateMinutes: number;  // 车次公共晚点（事故/拥堵）
  @Column({ default: 0 }) personalLateMinutes: number;// 个人到站迟到（发车后补签到等）
  // normal | late | exempt | partial_exempt | no_show
  @Column({ default: 'normal' }) status: string;
  @Column({ nullable: true }) lateReason: string; // congestion|breakdown|construction|missed|detour|personal|overtime|accident
  @Column({ default: false }) exempt: boolean;    // 考勤豁免
  @Column({ nullable: true }) exemptReason: string;
  @Column({ default: 0 }) makeupFee: number;      // 补车费用
  @Column({ nullable: true }) feeReason: string;
  @Column({ nullable: true }) certificateId: number; // 晚点考勤豁免证明回写来源
}

// ============ 途中事件（五方协同） ============
@Entity('trip_events')
export class TripEvent {
  @PrimaryGeneratedColumn() id: number;
  @Column({ nullable: true }) tripId: number;
  // congestion | breakdown | construction | missed_bus | overtime | detour
  // | late_arrival | weather | suspension | security_check | relocation
  @Column() type: string;
  @Column({ default: 'info' }) severity: string; // info | warning | critical
  @Column() description: string;
  @Column() createdById: number;
  @Column({ nullable: true }) createdByRole: string;
  // open | processing | resolved
  @Column({ default: 'open' }) status: string;
  @Column({ default: 0 }) affectedCount: number;
  @Column({ nullable: true }) resolution: string;
  @Column({ nullable: true }) handledById: number;
  // none | exempt_attendance | makeup_bus | refund | reschedule
  @Column({ default: 'none' }) compensationType: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 员工申诉 ============
@Entity('appeals')
export class Appeal {
  @PrimaryGeneratedColumn() id: number;
  @Column() employeeId: number;
  @Column({ nullable: true }) attendanceId: number;
  @Column() reason: string;
  @Column({ nullable: true }) evidence: string;
  // pending | hr_review | operator_review | approved | rejected
  @Column({ default: 'pending' }) status: string;
  @Column({ nullable: true }) reply: string;
  @Column({ nullable: true }) handledById: number;
  // 申诉成立时联动：豁免考勤 / 退还补车费
  @Column({ default: false }) grantExemption: boolean;
  @Column({ default: false }) refundFee: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 司机绩效 ============
@Entity('driver_performances')
export class DriverPerformance {
  @PrimaryGeneratedColumn() id: number;
  @Column() driverId: number;
  @Column({ nullable: true }) tripId: number;
  @Column({ type: 'date' }) date: string;
  @Column({ default: 100 }) safetyScore: number;
  @Column({ default: 0 }) bonus: number;
  @Column({ default: 0 }) penalty: number;
  @Column({ nullable: true }) note: string;
  @Column({ nullable: true }) certificateId: number; // 晚点证明联动（非责任晚点可撤销扣分）
}

// ============ 线路调整提案（双确认） ============
@Entity('line_proposals')
export class LineProposal {
  @PrimaryGeneratedColumn() id: number;
  @Column({ nullable: true }) lineId: number;
  // adjust | new_line | suspend | extend | relocation
  @Column() type: string;
  @Column() title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ type: 'text', nullable: true }) impactSummary: string;
  @Column({ default: 0 }) estimatedSaving: number;
  // draft | proposed | company_confirmed | employee_confirmed | confirmed | rejected | cancelled
  @Column({ default: 'proposed' }) status: string;
  @Column() raisedById: number;
  @Column({ type: 'date', nullable: true }) effectiveDate: string;
  @Column({ type: 'jsonb', nullable: true }) companyConfirmations: any; // [{companyId,name,confirmed,by,at}]
  @Column({ type: 'jsonb', nullable: true }) employeeConfirmations: any;// [{lineId,name,confirmed,by,at}]
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 临时访客 ============
@Entity('visitor_passes')
export class VisitorPass {
  @PrimaryGeneratedColumn() id: number;
  @Column() visitorName: string;
  @Column({ nullable: true }) phone: string;
  @Column() hostCompanyId: number;
  @Column() hostName: string;
  @Column({ type: 'date' }) visitDate: string;
  @Column({ nullable: true }) stationId: number;
  @Column({ nullable: true }) scheduleId: number;
  @Column({ nullable: true }) qrCode: string;
  // registered | boarded | checked_in | cancelled | expired
  @Column({ default: 'registered' }) status: string;
  @Column() createdById: number;
  @CreateDateColumn() createdAt: Date;
}

// ============ 门禁记录 ============
@Entity('gate_logs')
export class GateLog {
  @PrimaryGeneratedColumn() id: number;
  @Column() gateName: string;
  // employee | visitor
  @Column() personType: string;
  @Column() personRef: string; // 工号 / 访客码
  @Column({ nullable: true }) personName: string;
  // in | out
  @Column() direction: string;
  // allow | deny
  @Column({ default: 'allow' }) result: string;
  @Column({ nullable: true }) note: string;
  @CreateDateColumn() createdAt: Date;
}

// ============ 节假日 / 调休 / 停运 ============
@Entity('holidays')
export class Holiday {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  // holiday | adjusted_workday | suspended
  @Column() type: string;
  @Column() name: string;
  @Column({ nullable: true }) note: string;
}

// ============ 站点施工临时改站 ============
@Entity('station_relocations')
export class StationRelocation {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column({ nullable: true }) scheduleId: number;   // 影响班次（null=当天该站全部班次）
  @Column() originalStationId: number;
  @Column() temporaryStationId: number;
  @Column({ nullable: true }) lineId: number;
  // 推荐临时站点信息（安全上车点、步行距离、步行路线）
  @Column({ nullable: true }) safePickupPoint: string;
  @Column({ default: 0 }) walkMeters: number;
  @Column({ type: 'text', nullable: true }) walkRoute: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ default: 0 }) affectedCount: number;
  // proposed（已通知待员工确认）| confirmed（员工均已确认/可执行）| completed | cancelled
  @Column({ default: 'proposed' }) status: string;
  @Column() createdById: number;
  @Column({ nullable: true }) createdByRole: string;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// 员工对临时改站的确认
@Entity('relocation_confirmations')
export class RelocationConfirmation {
  @PrimaryGeneratedColumn() id: number;
  @Column() relocationId: number;
  @Column() reservationId: number;
  @Column() employeeId: number;
  // pending（待确认）| accepted（已知晓前往临停点）| declined（无法前往，需点名/分流）
  @Column({ default: 'pending' }) status: string;
  @Column({ type: 'timestamptz', nullable: true }) confirmedAt: Date;
  @Column({ nullable: true }) note: string;
  @CreateDateColumn() createdAt: Date;
}

// 司机点名记录（改站后防止漏接）
@Entity('roll_calls')
export class RollCall {
  @PrimaryGeneratedColumn() id: number;
  @Column() tripId: number;
  @Column() employeeId: number;
  @Column({ nullable: true }) reservationId: number;
  @Column({ nullable: true }) relocationId: number;
  @Column({ nullable: true }) stationId: number;      // 实际应接站点（临停点）
  // on_board（已上车）| no_show | refused_change（拒绝改站未乘）| absent | resolved
  @Column() result: string;
  @Column({ type: 'text', nullable: true }) reason: string;   // 未上车原因
  @Column({ type: 'timestamptz', nullable: true }) stationTime: Date; // 站点到达/点名时间
  @Column({ default: false }) employeeConfirmed: boolean;      // 员工是否已确认改站
  @Column({ nullable: true }) handledById: number;
  @CreateDateColumn() createdAt: Date;
}

// ============ 企业加班补车 ============
@Entity('supplement_buses')
export class SupplementBus {
  @PrimaryGeneratedColumn() id: number;
  @Column() busNo: string;                  // 补车单号 BC-YYYYMMDD-####
  @Column({ type: 'date' }) date: string;
  @Column() companyId: number;
  @Column() createdById: number;            // HR
  @Column({ nullable: true }) scheduleId: number;
  @Column({ type: 'timestamptz' }) departAt: Date;   // 计划发车（深夜）
  @Column({ type: 'timestamptz', nullable: true }) actualDepartAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) actualArriveAt: Date;
  @Column({ nullable: true }) lineId: number;
  @Column({ nullable: true }) stationId: number;     // 上车点（园区/约定点）
  @Column() destination: string;
  @Column({ default: 1 }) passengerCount: number;
  @Column({ type: 'text' }) reason: string;          // 加班说明
  @Column({ nullable: true }) vehicleId: number;
  @Column({ nullable: true }) driverId: number;
  // pending（待调度审核）| approved（已派车）| rejected | departed | completed | settled
  @Column({ default: 'pending' }) status: string;
  @Column({ nullable: true }) reviewedById: number;
  @Column({ type: 'text', nullable: true }) reviewNote: string;
  // 费用拆分（企业承担/园区承担、司机工时费、里程/车辆费）
  @Column({ type: 'jsonb', nullable: true }) feeSplit: any;
  @Column({ default: 0 }) totalFee: number;
  @Column({ default: 0 }) driverWorkMinutes: number;  // 司机本次工时（分钟）
  @Column({ default: false }) restReset: boolean;     // 完成后已重算休息
  @Column({ type: 'timestamptz', nullable: true }) restDueAt: Date; // 连续驾驶后强制休息至
  @Column({ nullable: true }) billingId: number;      // 进入的月结核账单
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// 补车乘车人（员工乘车记录进入月结）
@Entity('supplement_passengers')
export class SupplementPassenger {
  @PrimaryGeneratedColumn() id: number;
  @Column() supplementBusId: number;
  @Column() employeeId: number;
  @Column() companyId: number;
  // booked | boarded | no_show
  @Column({ default: 'booked' }) status: string;
  @Column({ type: 'timestamptz', nullable: true }) boardedAt: Date;
  @CreateDateColumn() createdAt: Date;
}

// ============ 园区月度结算 ============
@Entity('monthly_billings')
export class MonthlyBilling {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) period: string;           // YYYY-MM
  // draft（汇总中）| confirmed（已月结）
  @Column({ default: 'draft' }) status: string;
  @Column({ type: 'jsonb', nullable: true }) companyBreakdown: any; // 按企业/人数/工时拆分
  @Column({ default: 0 }) totalAmount: number;
  @Column({ default: 0 }) supplementCount: number;
  @Column({ nullable: true }) confirmedById: number;
  @Column({ type: 'timestamptz', nullable: true }) confirmedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ============ 通知 ============
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn() id: number;
  @Column() userId: number;
  @Column() title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ default: false }) read: boolean;
  @Column({ default: 'info' }) category: string;
  @CreateDateColumn() createdAt: Date;
}
