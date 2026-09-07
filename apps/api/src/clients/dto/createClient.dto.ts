import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsPositive,
  IsString,
  IsUrl,
} from 'class-validator';

import { DocumentType } from '../entities/client.entity';
import { normalizePhoneNumber } from '../normalizePhoneNumber';

export class CreateClientDto {
  @ApiProperty({ example: 'Juana' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: '1234567890', description: 'Cédula' })
  @IsString()
  @IsNotEmpty()
  documentNumber!: string;

  @ApiProperty({ example: '+573001234567' })
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber('CO')
  phoneNumber!: string;

  @ApiPropertyOptional({
    example: 2000000,
    description:
      'Maximum credit exposure ("cupo") — unset means no cupo is enforced ' +
      'for this client. See docs/phases/PHASE_10_CLIENT_CAPACITY.md.',
  })
  @IsOptional()
  @IsPositive()
  creditLimit?: number;

  // --- Extended profile (KYC), Phase 21 — all optional here at the DTO
  // level, including dataProcessingConsent: bulk-imported clients (see
  // ClientLoanImportService) build this same DTO without it, so it can't
  // be a class-validator requirement without breaking that path. Requiring
  // it for the manual creation flow is enforced as a business rule in
  // ClientsService.create() instead — see that method's comment. ---

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiPropertyOptional({ example: '1998-04-12' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'Bogotá D.C.' })
  @IsOptional()
  @IsString()
  documentIssuePlace?: string;

  @ApiPropertyOptional({ example: '2015-03-20' })
  @IsOptional()
  @IsDateString()
  documentIssueDate?: string;

  @ApiPropertyOptional({ example: 'juana.perez@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+573009876543' })
  @IsOptional()
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber('CO')
  alternatePhoneNumber?: string;

  @ApiPropertyOptional({
    example: 'Cra 45 #12-30, Barrio Centro',
    description:
      'At least one of homeAddress/workAddress is required (enforced in ClientsService, not by ' +
      'this decorator, since it is a cross-field either/or rule) — applies to every interactive ' +
      'creation, and unlike dataProcessingConsent/documentType, is NOT exempted for bulk import.',
  })
  @IsOptional()
  @IsString()
  homeAddress?: string;

  @ApiPropertyOptional({
    example: 'Av. Siempre Viva 742',
    description:
      'At least one of homeAddress/workAddress is required — see homeAddress.',
  })
  @IsOptional()
  @IsString()
  workAddress?: string;

  @ApiPropertyOptional({ example: 'Medellín' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Comerciante' })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({ example: 'Almacén La Economía' })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({ example: 1800000 })
  @IsOptional()
  @IsPositive()
  monthlyIncome?: number;

  @ApiPropertyOptional({
    description:
      'Externally-hosted URL (image or PDF) — same api-never-touches-bytes rule as Payment.imageUrl.',
  })
  @IsOptional()
  @IsUrl()
  idDocumentFrontUrl?: string;

  @ApiPropertyOptional({ description: 'Externally-hosted URL (image or PDF).' })
  @IsOptional()
  @IsUrl()
  idDocumentBackUrl?: string;

  @ApiPropertyOptional({
    description:
      'Externally-hosted URL. Never required — sensitive/biometric data under Ley 1581 de 2012.',
  })
  @IsOptional()
  @IsUrl()
  selfieImageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Whether the client signed the data-processing authorization. Required (enforced in ' +
      'ClientsService, not by this decorator) when creating a client through the interactive ' +
      'form; not enforced for Excel-imported clients.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dataProcessingConsent?: boolean;

  @ApiPropertyOptional({
    description:
      'Optional evidence of the signed physical authorization (photo or PDF) — never required.',
  })
  @IsOptional()
  @IsUrl()
  consentDocumentUrl?: string;
}
