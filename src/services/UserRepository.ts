import { Injectable } from '../decorators';
import { getRequestId } from '../context/request-context';
import { NotFoundError } from '../errors/not-found.error';

@Injectable()
export class UserRepository {
    users = [
        { name: '111111', id: 1 },
        { name: '222222', id: 2 },
        { name: '333333', id: 3 },
    ];

    async findById(id: string) {
        await Promise.resolve();

        const requestId = getRequestId();
        console.log(requestId);

        const user = this.users.find((user) => user.id === Number(id));
        if (!user) {
            throw new NotFoundError('User not found');
        }
        return user;
    }
}
