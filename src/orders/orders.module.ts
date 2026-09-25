import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../db/repositories.module';
import { OrderEventsService } from './order-events.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
