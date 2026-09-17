// Meta's per-message webhook status callback (change.value.statuses[]) —
// see extractStatusEvents.ts. Distinct from MessageLogStatus/
// WhatsappManualReplyStatus's own `status` column, which only ever
// recorded whether the synchronous HTTP call to Meta's Send API succeeded,
// never what happened to the message afterward.
export enum WhatsappDeliveryStatus {
  Sent = 'sent',
  Delivered = 'delivered',
  Read = 'read',
  Failed = 'failed',
}
