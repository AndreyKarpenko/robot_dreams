import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { validate } from './config/env.schema';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DatabaseModule,
    ProductsModule, OrdersModule
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
