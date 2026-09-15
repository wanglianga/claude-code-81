import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { CertificateModule } from '../certificates/certificates.module';
import * as entities from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature(Object.values(entities)), CertificateModule],
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
