import { Injectable } from '../decorators';
import { AuthService } from './AuthService';
import { UserService } from './UserService';
import { PrismaService } from './PrismaService';

@Injectable()
export class AppService {
    constructor(authService: AuthService, userService: UserService, prismaService: PrismaService) {}

    start() {
        console.log('App started');
    }
}
