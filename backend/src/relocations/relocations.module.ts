import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelocationController } from './relocations.controller';
import { RelocationService } from './relocations.service';
import * as entities from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature(Object.values(entities))],
  controllers: [RelocationController],
  providers: [RelocationService],
  exports: [RelocationService],
})
export class RelocationModule {}
