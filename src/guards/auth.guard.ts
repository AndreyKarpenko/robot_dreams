import { Injectable } from '../decorators';
import type { CanActivate, ExecutionContext } from '../lifecycle';
import { AuthService } from '../services/AuthService';

/**
 * A guard answers one question — "may this request reach the handler?" — and it
 * answers it before the pipes run, so an unauthorized request is never validated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authService: AuthService) {}

    canActivate(context: ExecutionContext): boolean {
        const header = context.req.headers.authorization;

        if (!header) {
            return false;
        }

        const [scheme, token] = header.split(' ');

        if (scheme?.toLowerCase() !== 'bearer' || !token) {
            return false;
        }

        return this.authService.verify(token);
    }
}
