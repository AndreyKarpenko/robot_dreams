import { Injectable } from '../decorators';
import { CreateUserDto } from '../dto/create-user.dto';
import { getRequestId } from '../context/request-context';
import { UserRepository } from './UserRepository';

@Injectable()
export class UserService {
    readonly created: CreateUserDto[] = [];

    constructor(private readonly userRepository: UserRepository) {}

    getRequestId() {
        return getRequestId();
    }

    findById(id: string) {
        return this.userRepository.findById(id);
    }

    findAll(limit?: string) {
        return { limit };
    }

    create(dto: CreateUserDto) {
        this.created.push(dto);
        return dto;
    }
}
