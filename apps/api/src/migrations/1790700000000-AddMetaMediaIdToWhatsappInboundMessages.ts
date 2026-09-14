import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-14 — an audio/video message a client sends over
// WhatsApp must never be re-hosted to Cloudinary (unlike image/document —
// see WhatsappMediaService's own comment), but should still be listenable/
// watchable from the inbox. Meta's own media id is kept here instead, so
// the file can be fetched fresh from Meta's Media API on demand (see
// WhatsappController's inbound-messages/:id/media endpoint) without ever
// persisting a copy anywhere outside WhatsApp itself.
export class AddMetaMediaIdToWhatsappInboundMessages1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ADD COLUMN "meta_media_id" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" DROP COLUMN "meta_media_id"`,
    );
  }
}
