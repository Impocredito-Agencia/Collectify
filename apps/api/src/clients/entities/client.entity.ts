import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../database/decimal.transformer';

export enum DocumentType {
  CedulaCiudadania = 'cedula_ciudadania',
  CedulaExtranjeria = 'cedula_extranjeria',
  Pasaporte = 'pasaporte',
}

// Client request, 2026-09-08 — see AddGenderToClients1789000000000's own
// comment. Nullable, never required — a fillable field, not mandatory.
export enum Gender {
  Male = 'masculino',
  Female = 'femenino',
  Other = 'otro',
}

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Index({ unique: true })
  @Column()
  documentNumber!: string;

  @Index()
  @Column()
  phoneNumber!: string;

  // Nullable — unset means no cupo enforced (see ClientsService.
  // getCreditUsage). "Cupo usado" is capital + accrued interest (the same
  // outstandingBalance already computed per loan for LoanSummary), not
  // stored — see docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  creditLimit!: number | null;

  // --- Extended profile (KYC), Phase 21 — all nullable; see
  // docs/phases/PHASE_21_CLIENT_PROFILE.md for the confirmed field list
  // and the reasoning behind each decision below. ---

  @Column({ type: 'enum', enum: DocumentType, nullable: true })
  documentType!: DocumentType | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender!: Gender | null;

  @Column({ type: 'varchar', nullable: true })
  documentIssuePlace!: string | null;

  @Column({ type: 'date', nullable: true })
  documentIssueDate!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  alternatePhoneNumber!: string | null;

  @Column({ type: 'text', nullable: true })
  homeAddress!: string | null;

  @Column({ type: 'text', nullable: true })
  workAddress!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  occupation!: string | null;

  @Column({ type: 'varchar', nullable: true })
  employerName!: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  monthlyIncome!: number | null;

  // Externally-hosted URL only — the api never touches image/PDF bytes,
  // same rule as Payment.imageUrl (Phase 12). Accepts either an image or a
  // PDF (e.g. an already-combined scan) — enforced client-side, not here.
  @Column({ type: 'varchar', nullable: true })
  idDocumentFrontUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  idDocumentBackUrl!: string | null;

  // Never enforced as required, anywhere — this is sensitive/biometric
  // data under Ley 1581 de 2012, and no activity may be conditioned on a
  // titular providing it. See the Phase 21 legal summary shared with the
  // business owner.
  @Column({ type: 'varchar', nullable: true })
  selfieImageUrl!: string | null;

  // Required (enforced in ClientsService.create, not here — see that
  // file's comment) when a client is created through the interactive
  // ClientForm; deliberately NOT enforced for Excel-imported clients
  // (docs/phases/PHASE_8_EXCEL_IMPORT.md), which default to false and get
  // this filled in later from the client's profile. The actual
  // authorization happens on paper/in person, outside this software —
  // this column and the two below only record that it happened.
  @Column({ default: false })
  dataProcessingConsent!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  consentGivenAt!: Date | null;

  // Optional photo/PDF of the signed physical authorization — evidence,
  // not the authorization itself. Confirmed with the business owner as a
  // "give them the tool, whether they use it is their call" field: never
  // enforced as required.
  @Column({ type: 'varchar', nullable: true })
  consentDocumentUrl!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
