export const DealRoomEvents = {
  DOCUMENT_UPLOADED: 'dealroom.document.uploaded',
  DOCUMENT_DOWNLOADED: 'dealroom.document.downloaded',
  ACCESS_GRANTED: 'dealroom.access.granted',
  ACCESS_REVOKED: 'dealroom.access.revoked',
  DOCUMENT_DELETED: 'dealroom.document.deleted',
} as const;

export type DealRoomEventName =
  (typeof DealRoomEvents)[keyof typeof DealRoomEvents];
