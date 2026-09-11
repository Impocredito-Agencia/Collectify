import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-19 — an admin's "Pausar" on the Plantillas page
// (WhatsappCronService.pause) only ever stopped the in-memory CronJob
// instance; nothing was persisted, so onModuleInit()'s unconditional
// job.start() on every boot silently resumed every family on the very
// next deploy/restart — see WhatsappCronService's own comment on this
// date. cron_paused gives pause/resume something durable to read back.
export class AddCronPausedToMessageTemplates1790000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD COLUMN "cron_paused" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP COLUMN "cron_paused"`,
    );
  }
}
