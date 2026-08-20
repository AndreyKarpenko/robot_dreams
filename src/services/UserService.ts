import { Injectable } from '../decorators';
import { CreateUserDto } from '../dto/create-user.dto';
import { LoggerService } from './LoggerService';
import { TracedUser, UserRepository } from './UserRepository';

@Injectable()
export class UserService {
    constructor(
        private readonly repository: UserRepository,
        private readonly logger: LoggerService,
    ) {}

    findById(id: string): TracedUser {
        this.logger.log(`UserService.findById(${id})`);

        return this.repository.findById(id);
    }

    findAll(limit?: string): { limit?: string; users: TracedUser[] } {
        this.logger.log(`UserService.findAll(${limit ?? 'all'})`);

        const parsed = limit === undefined ? undefined : Number(limit);

        return { limit, users: this.repository.findAll(parsed) };
    }

    create(dto: CreateUserDto): TracedUser {
        this.logger.log(`UserService.create(${dto.email})`);

        return this.repository.create(dto);
    }
}
