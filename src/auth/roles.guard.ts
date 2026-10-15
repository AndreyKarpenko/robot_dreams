import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from './jwt-auth.guard';
import { ROLES_KEY } from './roles.decorator';
import type { UserRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
