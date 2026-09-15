import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth/roles.guard';
import { CertificateService } from './certificates.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificateController {
  constructor(private readonly svc: CertificateService) {}

  // 平台取证生成晚点证明（调度/运营/管理员）
  @Roles('dispatcher', 'operator', 'admin')
  @Post('late-certificates/generate')
  generate(@CurrentUser() u: any, @Body() dto: any) {
    return this.svc.generate(dto, u);
  }

  // 晚点证明列表（HR 自动收窄到本企业）
  @Get('late-certificates')
  list(@CurrentUser() u: any, @Query('status') status: string) {
    return this.svc.listCertificates(u, status);
  }

  // 员工端：我的晚点证明
  @Roles('employee')
  @Get('my/late-certificates')
  mine(@CurrentUser() u: any) {
    return this.svc.myCertificates(u.userId);
  }

  // 证明详情（含证据、影响企业×班次、逐人回写状态、复盘）
  @Get('late-certificates/:id')
  detail(@CurrentUser() u: any, @Param('id') id: string) {
    return this.svc.detail(+id, u);
  }

  // HR 按 企业 × 班次 批量确认豁免并回写
  @Roles('hr', 'operator', 'admin')
  @Post('late-certificates/:id/batch-confirm')
  batchConfirm(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.batchConfirm(+id, dto, u);
  }

  // HR 批量驳回
  @Roles('hr', 'operator', 'admin')
  @Post('late-certificates/:id/batch-reject')
  batchReject(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.batchReject(+id, dto, u);
  }

  // 线路复盘列表
  @Get('line-reviews')
  listReviews() { return this.svc.listReviews(); }

  // 运营/调度补充复盘措施
  @Roles('operator', 'admin', 'dispatcher')
  @Post('late-certificates/:id/review')
  updateReview(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: any) {
    return this.svc.updateReview(+id, dto, u);
  }
}
