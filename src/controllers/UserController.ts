import { Body, Controller, Get, Param, Post, Query } from '../decorators';
import { CreateUserDto, CreateUserSchema } from '../dto/create-user.dto';
import { UserService } from '../services';

@Controller('users')
export class UserController {
    constructor(public readonly userService: UserService) {}

    @Get(':id')
    findOne(@Param('id') id: string) {
        return {
            user: this.userService.findById(id),
            requestId: this.userService.getRequestId(),
        };
    }

    @Get()
    findAll(@Query('limit') limit: string) {
        return this.userService.findAll(limit);
    }

    @Post()
    create(@Body(CreateUserSchema) dto: CreateUserDto) {
        return this.userService.create(dto);
    }
}
