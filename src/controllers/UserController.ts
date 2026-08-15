import 'reflect-metadata';
import { Get, Controller, Param, Query, Body, Post } from '../decorators';

@Controller('users')
export class UserController {
    @Get(':id')
    getUser(@Param('red') id: string, @Query('sd') asd: string) {
        return 'User';
    }

    @Get(':dsdfsdf')
    getUse(@Body() body: string, @Param('id') id: string, @Param('dsdfsdf') dsdfsdf: string) {
        return 'User';
    }

    @Post(':id')
    postUser(@Body() body: string, @Param('id') id: string) {
        return 'User';
    }
}
