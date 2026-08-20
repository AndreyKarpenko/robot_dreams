import { Body, Controller, Get, Param, Post, Query, UseGuards } from '../decorators';
import { createUserSchema, type CreateUserDto } from '../dto/create-user.dto';
import { AuthGuard } from '../guards/auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
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
    @UseGuards(AuthGuard)
    create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {
        return this.userService.create(dto);
    }
}
