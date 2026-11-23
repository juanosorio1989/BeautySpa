import { Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { MAILER, type Mailer } from "../mail/mailer.js";
import { MessageContextService } from "./message-context.service.js";
import { CHANNEL_PROVIDERS, type ChannelProvider } from "./providers/channel-provider.js";
import { ConsolePushProvider } from "./providers/console-push.provider.js";
import { EmailProvider } from "./providers/email.provider.js";
import { FakePushProvider } from "./providers/fake-push.provider.js";
import { QueueBookingEvents } from "./queue-booking-events.js";

/** Notification producers for the API process; `BookingModule` binds `BookingEvents` to `QueueBookingEvents`. */
@Module({ providers: [QueueBookingEvents], exports: [QueueBookingEvents] })
export class NotificationsModule {}

/**
 * One provider per channel sent: EMAIL over the `Mailer` (named after `EMAIL_PROVIDER`), PUSH by
 * `PUSH_PROVIDER` (`fake` in tests, `console` in dev). `webpush` is not wired yet (plan 05 Task 9) and
 * fails at module init.
 */
export function channelProvidersFactory(env: Env, mailer: Mailer): ChannelProvider[] {
  let push: ChannelProvider;
  switch (env.PUSH_PROVIDER) {
    case "fake":
      push = new FakePushProvider();
      break;
    case "console":
      push = new ConsolePushProvider();
      break;
    default:
      throw new Error("PUSH_PROVIDER=webpush is not implemented yet (plan 05 Task 9); use console in development");
  }
  return [new EmailProvider(mailer, env.EMAIL_PROVIDER), push];
}

/** Worker side of notifications: message context loading and the channel providers. */
@Module({
  providers: [
    MessageContextService,
    { provide: CHANNEL_PROVIDERS, inject: [ENV, MAILER], useFactory: channelProvidersFactory },
  ],
  exports: [MessageContextService, CHANNEL_PROVIDERS],
})
export class NotificationDeliveryModule {}
