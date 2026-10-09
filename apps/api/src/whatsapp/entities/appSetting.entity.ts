import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Human request, 2026-10-09 — a value an admin changes from the panel
// rather than a deploy (the first one: the bank account the cuenta_bancaria
// template sends, which the business swaps from time to time). One row per
// key, upserted; see BankAccountService for the only key in use so far.
export enum AppSettingKey {
  PaymentBankAccount = 'payment_bank_account',
}

@Entity('app_settings')
export class AppSetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  key!: AppSettingKey;

  @Column({ type: 'text' })
  value!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
