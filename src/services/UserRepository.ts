import { requestContext } from '../context/request-context';
import { Injectable } from '../decorators';
import { CreateUserDto } from '../dto/create-user.dto';
import { NotFoundError } from '../errors';
import { LoggerService } from './LoggerService';

export type UserRecord = {
    id: string;
    email: string;
};

/** A user plus the request that produced it — the id comes from the store. */
export type TracedUser = UserRecord & {
    requestId: string;
};

function seed(): Map<string, UserRecord> {
    const ids = [...Array.from({ length: 10 }, (_, index) => String(index + 1)), '42'];

    return new Map(ids.map((id) => [id, { id, email: `user${id}@example.com` }]));
}

/**
 * Two levels below the handler (controller -> service -> repository) and still
 * able to name the current request without anyone passing it down.
 */
@Injectable()
export class UserRepository {
    private readonly users = seed();
    private nextId = 100;

    constructor(private readonly logger: LoggerService) {}

    findById(id: string): TracedUser {
        this.logger.log(`UserRepository.findById(${id})`);

        const user = this.users.get(id);

        if (!user) {
            throw new NotFoundError(`User "${id}" was not found`);
        }

        return this.trace(user);
    }

    findAll(limit?: number): TracedUser[] {
        this.logger.log(`UserRepository.findAll(${limit ?? 'all'})`);

        const users = [...this.users.values()];

        return (limit === undefined ? users : users.slice(0, limit)).map((user) =>
            this.trace(user),
        );
    }

    create(dto: CreateUserDto): TracedUser {
        this.logger.log(`UserRepository.create(${dto.email})`);

        const user: UserRecord = { id: String(this.nextId++), email: dto.email };
        this.users.set(user.id, user);

        return this.trace(user);
    }

    private trace(user: UserRecord): TracedUser {
        return { ...user, requestId: requestContext.getRequestId() ?? 'no-request-id' };
    }
}
