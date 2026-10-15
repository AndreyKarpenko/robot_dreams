import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../db/repositories.module';
import { OrderEventsService } from './order-events.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [RepositoriesModule, AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
