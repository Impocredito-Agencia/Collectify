import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-11 — one-time cleanup of the failed-message
// backlog that piled up while WHATSAPP_SENDING_PAUSED (2026-09-06) has
// been blocking every send: none of these ~1000 rows will ever be
// retried while sending stays paused, so they were just noise on the
// "Envíos fallidos" to-do list rather than anything actionable. Deletes
// every message_logs row with status = 'failed', regardless of age —
// message_log_items.message_log_id is ON DELETE CASCADE (see that
// entity), so each deleted log's items go with it automatically. Sent
// rows are untouched, and this runs once via the normal migration
// pipeline — it has no effect on anything generated after it runs.
//
// Deliberately irreversible: down() is a no-op since there's no way to
// reconstruct deleted send history. Not a schema change either, just
// data — kept as a migration (not a one-off script) so it runs exactly
// once, automatically, the same way every other migration does on
// deploy (see railway.toml's `migration:run && start:prod`).
export class CleanupFailedMessageLogs1789800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "message_logs" WHERE "status" = 'failed'`,
    );
  }

  public async down(): Promise<void> {}
}
