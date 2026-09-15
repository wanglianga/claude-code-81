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
  // normal | late | exempt | no_show
  @Column({ default: 'normal' }) status: string;
  @Column({ nullable: true }) lateReason: string; // congestion|breakdown|construction|missed|detour|personal|overtime
  @Column({ default: false }) exempt: boolean;    // 考勤豁免
  @Column({ nullable: true }) exemptReason: string;
  @Column({ default: 0 }) makeupFee: number;      // 补车费用
  @Column({ nullable: true }) feeReason: string;
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
