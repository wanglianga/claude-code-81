import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth/roles.guard';
import { LineRelocationService } from './line-relocation.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class LineRelocationController {
  constructor(private readonly svc: LineRelocationService) {}

  @Roles('operator', 'admin', 'dispatcher')
  @Post('line-relocations')
  create(@CurrentUser() u: any, @Body() dto: any) { return this.svc.create(dto, u); }

  @Get('line-relocations')
  list(@CurrentUser() u: any) { return this.svc.list(u); }

  @Get('line-relocations/:id')
  detail(@Param('id') id: string) { return this.svc.detail(+id); }

  @Roles('operator', 'admin', 'dispatcher')
  @Post('line-relocations/:id/options')
  genOptions(@Param('id') id: string) { return this.svc.generateOptions(+id); }

  // 员工代表 / HR 反馈
  @Roles('employee', 'hr', 'operator', 'admin')
  @Post('line-relocations/:id/feedback')
  feedback(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.feedback(+id, dto, u);
  }

  @Roles('hr')
  @Post('line-relocations/:id/hr-summary')
  hrSummary(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.hrSummary(+id, dto.note, u);
  }

  @Roles('operator', 'admin', 'dispatcher')
  @Post('line-relocations/:id/adjust')
  adjust(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.adjust(+id, dto, u);
  }

  @Roles('hr', 'operator', 'admin')
  @Post('line-relocations/:id/confirm-company')
  confirmCompany(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.confirmCompany(+id, u);
  }

  @Roles('employee', 'operator', 'admin')
  @Post('line-relocations/:id/confirm-employee')
  confirmEmployee(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.confirmEmployee(+id, u);
  }

  // 过渡期员工选择
  @Roles('employee')
  @Post('line-relocations/:id/choose')
  choose(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.choose(+id, dto, u);
  }

  @Roles('employee')
  @Get('my/line-relocation-choices')
  myChoices(@CurrentUser() u: any) { return this.svc.myChoices(u.userId); }

  @Roles('operator', 'admin')
  @Post('line-relocations/:id/effectuate')
  effectuate(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.effectuate(+id, u);
  }

  @Roles('operator', 'admin')
  @Post('line-relocations/:id/cancel')
  cancel(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.cancel(+id, u);
  }
}
