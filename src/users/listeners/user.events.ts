export enum UserEvent {
  Created = 'users.created',
  UpdatedProfile = 'users.profile.updated',
  LinkedWallet = 'users.wallet.linked',
  UnlinkedWallet = 'users.wallet.unlinked',
  RoleChanged = 'users.role.changed',
  KycUpdated = 'users.kyc.updated',
  Blocked = 'users.blocked',
  Unblocked = 'users.unblocked',
  LoggedIn = 'users.logged_in',
}

export interface UserEventPayload {
  userId: string;
  primaryWallet: string;
  changes?: Record<string, unknown>;
}
