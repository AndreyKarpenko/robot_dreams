import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';
import { AuthService, TokenPair } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AccessClaims } from './jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

export class LoginDto {
  @IsString()
  @Matches(/^[^\s@]+@[^\s@]+$/)
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refresh_token: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AccessClaims): Promise<void> {
    await this.auth.logout(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessClaims): { id: string; role: string } {
    return { id: user.userId, role: user.role };
  }
}
