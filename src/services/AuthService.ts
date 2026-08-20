import { Injectable } from '../decorators/injectable';

@Injectable()
export class AuthService {
    /** A stand-in for real token verification — enough to exercise the guard. */
    verify(token: string): boolean {
        return token.trim().length > 0;
    }
}
