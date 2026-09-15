import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth/roles.guard';
import { BusinessService } from './business.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessController {
  constructor(private readonly svc: BusinessService) {}

  // ---------- 总览 / 通知 ----------
  @Get('dashboard')
  dashboard() { return this.svc.dashboard(); }

  @Get('notifications')
  notifications(@CurrentUser() u: any) { return this.svc.myNotifications(u.userId); }
  @Post('notifications/:id/read')
  readNoti(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.readNotification(u.userId, +id);
  }

  // ---------- 基础数据 ----------
  @Get('companies') listCompanies() { return this.svc.listCompanies(); }
  @Roles('operator', 'admin')
  @Post('companies') createCompany(@Body() dto: any) { return this.svc.createCompany(dto); }

  @Get('lines') listLines() { return this.svc.listLines(); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('lines') createLine(@Body() dto: any) { return this.svc.createLine(dto); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('lines/:id/stations')
  addStation(@Param('id') id: string, @Body() dto: any) { return this.svc.addStation(+id, dto); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('stations/:id')
  patchStation(@Param('id') id: string, @Body() dto: any) { return this.svc.patchStation(+id, dto); }

  @Get('schedules') listSchedules() { return this.svc.listSchedules(); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('schedules') createSchedule(@Body() dto: any) { return this.svc.createSchedule(dto); }

  @Get('vehicles') listVehicles() { return this.svc.listVehicles(); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('vehicles') createVehicle(@Body() dto: any) { return this.svc.createVehicle(dto); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('vehicles/:id') patchVehicle(@Param('id') id: string, @Body() dto: any) {
    return this.svc.patchVehicle(+id, dto);
  }

  @Get('drivers') listDrivers() { return this.svc.listDrivers(); }
  @Get('employees')
  listEmployees(@Query('companyId') companyId: string) {
    return this.svc.listEmployees(companyId ? Number(companyId) : undefined);
  }
  @Roles('operator', 'admin')
  @Post('drivers') createDriver(@Body() dto: any) { return this.svc.createDriver(dto); }

  @Get('holidays') listHolidays() { return this.svc.listHolidays(); }
  @Roles('operator', 'admin', 'dispatcher')
  @Post('holidays') createHoliday(@Body() dto: any) { return this.svc.createHoliday(dto); }

  // ---------- 员工预约 ----------
  @Get('booking-view')
  bookingView(@Query('date') date: string) { return this.svc.bookingView(date); }

  @Roles('employee')
  @Post('reservations')
  createReservation(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.createReservation(u, dto);
  }
  @Get('my/reservations')
  myReservations(@CurrentUser() u: any) { return this.svc.myReservations(u.userId); }
  @Post('reservations/:id/cancel')
  cancelReservation(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.cancelReservation(u, +id);
  }
  @Post('reservations/:id/change-station')
  changeStation(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.changeStation(u, +id, dto.stationId, dto.note);
  }

  // ---------- 调度 / 车次 ----------
  @Get('trips') listTrips(@Query('date') date: string) { return this.svc.listTrips(date); }
  @Roles('dispatcher', 'operator', 'admin')
  @Post('trips/generate')
  generateManifest(@Body() dto: any) { return this.svc.generateManifest(dto); }
  @Roles('dispatcher', 'operator', 'admin')
  @Post('trips/:id/assign')
  assignTrip(@Param('id') id: string, @Body() dto: any) { return this.svc.assignTrip(+id, dto); }
  @Roles('dispatcher', 'operator', 'admin')
  @Post('trips/:id/suspend')
  suspendTrip(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.suspendTrip(+id, dto, u);
  }

  // ---------- 司机端 ----------
  @Roles('driver')
  @Get('driver/trips')
  driverTrips(@CurrentUser() u: any) { return this.svc.driverTrips(u.userId); }
  @Roles('driver')
  @Get('driver/trips/:id/manifest')
  tripManifest(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.tripManifest(u.userId, +id);
  }
  @Roles('driver')
  @Post('driver/trips/:id/confirm')
  confirmTrip(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.confirmTrip(u.userId, +id, dto);
  }
  @Roles('driver')
  @Post('driver/trips/:id/depart')
  departTrip(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.departTrip(u.userId, +id);
  }
  @Roles('driver')
  @Post('driver/trips/:id/arrive')
  arriveTrip(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.arriveTrip(u.userId, +id);
  }
  @Roles('driver')
  @Post('driver/trips/:id/board')
  board(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.board(u.userId, +id, dto);
  }
  @Roles('driver')
  @Post('driver/trips/:id/no-show/:rid')
  markNoShow(@CurrentUser() u: any, @Param('id') id: string, @Param('rid') rid: string) {
    return this.svc.markNoShow(u.userId, +id, +rid);
  }

  // ---------- 途中事件（五方协同） ----------
  @Get('events') listEvents(@Query('status') status: string) { return this.svc.listEvents(status); }
  @Post('events')
  createEvent(@CurrentUser() u: any, @Body() dto: any) { return this.svc.createEvent(dto, u); }
  @Roles('dispatcher', 'operator', 'admin')
  @Post('events/:id/resolve')
  resolveEvent(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.resolveEvent(+id, dto, u);
  }

  // ---------- 考勤 ----------
  @Get('attendance')
  listAttendance(@Query() q: any) { return this.svc.listAttendance(q); }
  @Get('my/attendance')
  myAttendance(@CurrentUser() u: any) { return this.svc.myAttendance(u.userId); }
  @Roles('hr', 'operator', 'admin')
  @Post('attendance/:id/adjust')
  adjustAttendance(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.adjustAttendance(+id, dto, u);
  }

  // ---------- 申诉 ----------
  @Get('appeals')
  listAppeals(@Query('status') status: string) { return this.svc.listAppeals(status); }
  @Get('my/appeals')
  myAppeals(@CurrentUser() u: any) { return this.svc.myAppeals(u.userId); }
  @Roles('employee')
  @Post('appeals')
  createAppeal(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.createAppeal(u, dto);
  }
  @Roles('hr', 'operator', 'admin')
  @Post('appeals/:id/review')
  reviewAppeal(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.reviewAppeal(+id, dto, u);
  }

  // ---------- 司机绩效 ----------
  @Roles('operator', 'admin', 'dispatcher', 'hr', 'driver')
  @Get('performances')
  listPerformances() { return this.svc.listPerformances(); }

  // ---------- 线路提案双确认 ----------
  @Get('proposals') listProposals() { return this.svc.listProposals(); }
  @Roles('operator', 'dispatcher', 'admin')
  @Post('proposals') createProposal(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.createProposal(dto, u);
  }
  @Post('proposals/:id/confirm/:side')
  confirmProposal(@CurrentUser() u: any, @Param('id') id: string,
                  @Param('side') side: 'company' | 'employee', @Body() dto: any) {
    return this.svc.confirmProposal(+id, side, u, dto?.note);
  }
  @Roles('operator', 'admin')
  @Post('proposals/:id/apply')
  applyProposal(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.applyProposal(+id, u);
  }
  @Roles('operator', 'hr', 'admin')
  @Post('proposals/:id/reject')
  rejectProposal(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.rejectProposal(+id, u, dto?.note);
  }

  // ---------- 访客 ----------
  @Get('visitors') listVisitors(@Query('date') date: string) {
    return this.svc.listVisitorPasses(date);
  }
  @Roles('hr', 'operator', 'dispatcher', 'admin')
  @Post('visitors') createVisitor(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.createVisitorPass(u, dto);
  }
  @Post('visitors/board/:code')
  visitorBoard(@Param('code') code: string) { return this.svc.visitorBoard(code); }

  // ---------- 门禁 ----------
  @Post('gate/scan')
  gateScan(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.gateScan(dto, u);
  }
  @Get('gate-logs') listGateLogs() { return this.svc.listGateLogs(); }
}
