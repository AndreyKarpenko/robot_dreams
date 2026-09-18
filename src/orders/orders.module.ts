import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../db/repositories.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [RepositoriesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
