import {
  CanActivate, ExecutionContext, Injectable, ForbiddenException,
  createParamDecorator, SetMetadata,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);

export const ROLES_KEY = 'required_roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || [];
    if (required.length === 0) return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('未登录');
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`需要角色: ${required.join(' / ')}`);
    }
    return true;
  }
}
