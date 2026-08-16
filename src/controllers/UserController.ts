import { Body, Controller, Get, Param, Post, Query } from '../decorators';
import { CreateUserDto } from '../dto/create-user.dto';
import { UserService } from '../services';

@Controller('users')
export class UserController {
    constructor(public readonly userService: UserService) {}

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.userService.findById(id);
    }

    @Get()
    findAll(@Query('limit') limit: string) {
        return this.userService.findAll(limit);
    }

    @Post()
    create(@Body() dto: CreateUserDto) {
        return this.userService.create(dto);
    }
}
