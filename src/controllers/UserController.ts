import 'reflect-metadata';
import { Get, Controller, Param, Query, Body, Post } from '../decorators';

@Controller('users')
export class UserController {
    @Get(':id')
    getUser(@Body() body: any, @Param('id') id: string, @Query('sd') sd: string) {
        return `User ${id} ${sd}`;
    }

    @Post(':bd')
    getUse(@Body() body: string, @Param('bd') db: string) {
        return `User ${JSON.stringify(body)}`;
    }

    @Post(':fac')
    postUser(@Body() body: string, @Param('fac') id: string) {
        return 'User';
    }

    @Get()
    health() {
        return { ok: true };
    }
}
