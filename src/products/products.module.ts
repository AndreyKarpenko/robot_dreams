import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../db/repositories.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [RepositoriesModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
