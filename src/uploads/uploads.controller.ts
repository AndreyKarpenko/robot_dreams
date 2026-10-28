import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntentDto } from './dto/intent.dto';
import { UploadsService } from './uploads.service';

function headerOne(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  intent(
    @CurrentUser() user: AccessClaims,
    @Body() dto: IntentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    // filename is validated by the pipe and then dropped. It never reaches the key.
    void dto.filename;
    return this.uploads.intent(user.userId, {
      contentType: dto.contentType,
      size: dto.size,
      idempotencyKey: headerOne(idempotencyKey),
    });
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: AccessClaims, @Param('id') id: string) {
    return this.uploads.resume(user.userId, id);
  }

  @Post(':id/commit')
  @HttpCode(HttpStatus.OK)
  commit(@CurrentUser() user: AccessClaims, @Param('id') id: string) {
    return this.uploads.commit(user.userId, id);
  }
}
