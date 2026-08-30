import { IncomingMessage } from 'node:http';

export interface Guard {
    canActivate(req: IncomingMessage): boolean | Promise<boolean>;
}

export class AuthGuard implements Guard {
    canActivate(req: IncomingMessage): boolean {
        return !!req.headers.authorization;
    }
}
