import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ExtractJwt } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'commute-platform-dev-secret',
    });
  }

  async validate(payload: any) {
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      realName: payload.realName,
      companyId: payload.companyId ?? null,
    };
  }
}
