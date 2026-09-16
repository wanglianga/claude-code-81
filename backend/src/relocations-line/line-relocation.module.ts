import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LineRelocationController } from './line-relocation.controller';
import { LineRelocationService } from './line-relocation.service';
import * as entities from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature(Object.values(entities))],
  controllers: [LineRelocationController],
  providers: [LineRelocationService],
})
export class LineRelocationModule {}
