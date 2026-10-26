import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

export interface AuthUser {
  sub: string;
  email: string;
  roles: string[];
  perms: string[];
  locale: string;
}

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
export const Perms = (...perms: string[]) => SetMetadata('perms', perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    let user: AuthUser;
    try {
      user = this.jwt.verify<AuthUser>(header.slice(7), { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = user;

    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<string[] | undefined>('roles', targets);
    if (roles?.length && !roles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException('Insufficient role');
    }
    const perms = this.reflector.getAllAndOverride<string[] | undefined>('perms', targets);
    if (perms?.length && !perms.every((p) => user.perms.includes(p))) {
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}
