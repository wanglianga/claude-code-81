import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import * as entities from './entities';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { CertificateModule } from './certificates/certificates.module';
import { RelocationModule } from './relocations/relocations.module';
import { SupplementModule } from './supplements/supplements.module';
import { HealthController } from './health.controller';

const allEntities = Object.values(entities);

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USER || 'commute',
      password: process.env.DB_PASSWORD || 'commute123',
      database: process.env.DB_NAME || 'commute',
      entities: allEntities,
      synchronize: true,
      logging: false,
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'commute-platform-dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
    AuthModule,
    BusinessModule,
    CertificateModule,
    RelocationModule,
    SupplementModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
