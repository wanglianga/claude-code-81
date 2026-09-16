import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth/roles.guard';
import { SupplementService } from './supplements.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupplementController {
  constructor(private readonly svc: SupplementService) {}

  // HR 发起补车前的车辆/司机工时/费用预检
  @Roles('hr', 'operator', 'admin', 'dispatcher')
  @Post('supplements/check')
  check(@Body() dto: any) { return this.svc.check(dto); }

  // HR 发起加班补车申请
  @Roles('hr', 'operator', 'admin')
  @Post('supplements')
  apply(@CurrentUser() u: any, @Body() dto: any) { return this.svc.apply(dto, u); }

  @Roles('hr', 'operator', 'admin', 'dispatcher', 'driver')
  @Get('supplements')
  list(@CurrentUser() u: any, @Query('status') status: string,
       @Query('companyId') companyId: string, @Query('date') date: string) {
    const cid = u.role === 'hr' ? u.companyId : (companyId ? Number(companyId) : undefined);
    return this.svc.list(status, cid, date, u.role === 'driver' ? u.userId : undefined);
  }

  @Get('supplements/:id')
  detail(@Param('id') id: string) { return this.svc.detail(+id); }

  // 调度审核派单（含工时/休息硬校验）或驳回
  @Roles('dispatcher', 'operator', 'admin')
  @Post('supplements/:id/dispatch')
  dispatch(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.dispatch(+id, dto, u);
  }

  @Roles('driver', 'dispatcher', 'operator', 'admin')
  @Post('supplements/:id/depart')
  depart(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.depart(+id, u); }

  @Roles('driver', 'dispatcher', 'operator', 'admin')
  @Post('supplements/:id/complete')
  complete(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.complete(+id, u); }

  @Roles('driver')
  @Get('driver/supplements')
  mine(@CurrentUser() u: any) { return this.svc.driverBuses(u.userId); }

  // 月度结算
  @Get('billings')
  listBillings() { return this.svc.listBillings(); }

  @Get('billings/preview')
  preview(@Query('period') period: string) { return this.svc.billingPreview(period); }

  @Roles('operator', 'admin', 'dispatcher')
  @Post('billings/:period/confirm')
  confirm(@CurrentUser() u: any, @Param('period') period: string) {
    return this.svc.confirmBilling(period, u);
  }
}
