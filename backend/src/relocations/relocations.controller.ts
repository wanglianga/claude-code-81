import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth/roles.guard';
import { RelocationService } from './relocations.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RelocationController {
  constructor(private readonly svc: RelocationService) {}

  // 临停推荐（调度/运营/司机可查）：统一仅返回 normal 站点，带日期班次时附实时剩余容量
  @Roles('dispatcher', 'operator', 'admin', 'driver')
  @Get('relocations/recommend')
  recommend(@Query('lineId') lineId: string, @Query('stationId') stationId: string,
            @Query('date') date: string, @Query('scheduleId') scheduleId: string) {
    return this.svc.recommend(+lineId, +stationId, date, scheduleId ? +scheduleId : undefined);
  }

  @Roles('dispatcher', 'operator', 'admin')
  @Post('relocations')
  create(@CurrentUser() u: any, @Body() dto: any) { return this.svc.create(dto, u); }

  @Get('relocations')
  list(@Query('date') date: string) { return this.svc.list(date); }

  @Get('relocations/:id')
  detail(@Param('id') id: string) { return this.svc.detail(+id); }

  // 员工确认/拒绝临停改站
  @Roles('employee')
  @Post('relocations/:id/confirm')
  confirm(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.confirmByEmployee(u, +id, dto);
  }

  @Roles('employee')
  @Get('my/relocations')
  mine(@CurrentUser() u: any) { return this.svc.myRelocations(u.userId); }

  // 司机导航与点名
  @Roles('driver')
  @Get('driver/trips/:id/navigation')
  nav(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.driverNavigation(u.userId, +id);
  }
  @Roles('driver')
  @Post('driver/trips/:id/roll-call')
  rollCall(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.rollCall(u.userId, +id, dto);
  }
  @Get('driver/trips/:id/roll-calls')
  listRollCalls(@Param('id') id: string) { return this.svc.listRollCalls(+id); }

  @Roles('dispatcher', 'operator', 'admin')
  @Post('relocations/:id/complete')
  complete(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.complete(u, +id); }
}
