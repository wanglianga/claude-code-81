import { Controller, Post, Body, Get, UseGuards, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities';
import { JwtAuthGuard, CurrentUser } from './roles.guard';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    const user = await this.users.findOne({ where: { username: body.username } });
    if (!user || !user.active) throw new UnauthorizedException('账号不存在或已停用');
    const ok = await bcrypt.compare(body.password || '', user.passwordHash);
    if (!ok) throw new UnauthorizedException('密码错误');
    const token = await this.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
      realName: user.realName,
      companyId: user.companyId ?? null,
    });
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        role: user.role,
        employeeNo: user.employeeNo,
        phone: user.phone,
        companyId: user.companyId ?? null,
        companyName: user.company?.name ?? null,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() u: any) {
    return u;
  }
}
