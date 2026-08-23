import { Injectable } from '../decorators';
import { CreateUserDto } from '../dto/create-user.dto';
import { NotFoundError } from '../errors/not-found.error';
import { getRequestId } from '../context/request-context';

@Injectable()
export class UserService {
    readonly created: CreateUserDto[] = [];
    users = [
        { name: '111111', id: 1 },
        { name: '222222', id: 2 },
        { name: '333333', id: 3 },
    ];

    getRequestId() {
        return getRequestId();
    }

    findById(id: string) {
        const user = this.users.find((user) => user.id === Number(id));
        if (!user) {
            throw new NotFoundError('User not found');
        }
        return user;
    }

    findAll(limit?: string) {
        return { limit };
    }

    create(dto: CreateUserDto) {
        this.created.push(dto);
        return dto;
    }
}
