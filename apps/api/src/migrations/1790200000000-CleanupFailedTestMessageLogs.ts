import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-19 — a failed test run (WhatsApp credentials/
// config not yet fixed at the time) left ~107 message_logs rows with
// status = 'failed', none of them a real send that ever should have gone
// out. Confirmed with the human these aren't actionable history, same
// reasoning as CleanupFailedMessageLogs1789800000000 — deletes every
// message_logs row with status = 'failed' again for the backlog that's
// piled up since that earlier cleanup ran. message_log_items.
// message_log_id is ON DELETE CASCADE (see that entity), so each deleted
// log's items go with it automatically. Sent rows are untouched.
//
// Deliberately irreversible: down() is a no-op since there's no way to
// reconstruct deleted send history. Not a schema change either, just
// data — kept as a migration (not a one-off script) so it runs exactly
// once, automatically, the same way every other migration does on
// deploy (see railway.toml's `migration:run && start:prod`).
export class CleanupFailedTestMessageLogs1790200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "message_logs" WHERE "status" = 'failed'`,
    );
  }

  public async down(): Promise<void> {}
}
