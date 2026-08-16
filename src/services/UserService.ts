import { Injectable } from '../decorators/injectable';
import { CreateUserDto } from '../dto/create-user.dto';

@Injectable()
export class UserService {
    readonly created: CreateUserDto[] = [];

    findById(id: string) {
        return { id };
    }

    findAll(limit?: string) {
        return { limit };
    }

    create(dto: CreateUserDto) {
        this.created.push(dto);
        return dto;
    }
}
