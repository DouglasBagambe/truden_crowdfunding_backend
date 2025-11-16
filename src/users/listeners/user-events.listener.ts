import { Injectable, Logger } from '@nestjs/common';
import { OnEvent as NestOnEvent } from '@nestjs/event-emitter';
import { UserEvent } from './user.events';
import type { UserEventPayload } from './user.events';

const OnEvent = NestOnEvent as (
  event: string | symbol,
  options?: Parameters<typeof NestOnEvent>[1],
) => MethodDecorator;

@Injectable()
export class UserEventsListener {
  private readonly logger = new Logger(UserEventsListener.name);

  @OnEvent(UserEvent.Created)
  handleUserCreated(payload: UserEventPayload) {
    this.logEvent(UserEvent.Created, payload);
  }

  @OnEvent(UserEvent.UpdatedProfile)
  handleProfileUpdated(payload: UserEventPayload) {
    this.logEvent(UserEvent.UpdatedProfile, payload);
  }

  @OnEvent(UserEvent.LinkedWallet)
  handleWalletLinked(payload: UserEventPayload) {
    this.logEvent(UserEvent.LinkedWallet, payload);
  }

  @OnEvent(UserEvent.UnlinkedWallet)
  handleWalletUnlinked(payload: UserEventPayload) {
    this.logEvent(UserEvent.UnlinkedWallet, payload);
  }

  @OnEvent(UserEvent.RoleChanged)
  handleRoleChanged(payload: UserEventPayload) {
    this.logEvent(UserEvent.RoleChanged, payload);
  }

  @OnEvent(UserEvent.KycUpdated)
  handleKycUpdated(payload: UserEventPayload) {
    this.logEvent(UserEvent.KycUpdated, payload);
  }

  @OnEvent(UserEvent.Blocked)
  handleUserBlocked(payload: UserEventPayload) {
    this.logEvent(UserEvent.Blocked, payload);
  }

  @OnEvent(UserEvent.Unblocked)
  handleUserUnblocked(payload: UserEventPayload) {
    this.logEvent(UserEvent.Unblocked, payload);
  }

  @OnEvent(UserEvent.LoggedIn)
  handleUserLoggedIn(payload: UserEventPayload) {
    this.logEvent(UserEvent.LoggedIn, payload);
  }

  private logEvent(event: UserEvent, payload: UserEventPayload) {
    this.logger.debug(`${event}: ${payload.userId}`, payload.changes);
  }
}
