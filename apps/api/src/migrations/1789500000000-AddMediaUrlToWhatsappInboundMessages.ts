import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-11 — see WhatsappInboundMessage.mediaUrl's own
// comment: the Cloudinary URL a client's WhatsApp attachment gets
// re-hosted to, once WhatsappMediaService downloads it from Meta.
export class AddMediaUrlToWhatsappInboundMessages1789500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ADD COLUMN "media_url" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" DROP COLUMN "media_url"`,
    );
  }
}
