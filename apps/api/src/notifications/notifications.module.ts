import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../common/clock.js";
import { ENV, type Env } from "../config/env.js";
import { MAILER, type Mailer } from "../mail/mailer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MessageContextService } from "./message-context.service.js";
import { CHANNEL_PROVIDERS, type ChannelProvider } from "./providers/channel-provider.js";
import { ConsolePushProvider } from "./providers/console-push.provider.js";
import { EmailProvider } from "./providers/email.provider.js";
import { FakePushProvider } from "./providers/fake-push.provider.js";
import { WebPushProvider } from "./providers/web-push.provider.js";
import { QueueBookingEvents } from "./queue-booking-events.js";

/** Notification producers for the API process; `BookingModule` binds `BookingEvents` to `QueueBookingEvents`. */
@Module({ providers: [QueueBookingEvents], exports: [QueueBookingEvents] })
export class NotificationsModule {}

/**
 * One provider per channel sent: EMAIL over the `Mailer` (named after `EMAIL_PROVIDER`), PUSH by
 * `PUSH_PROVIDER` (`fake` in tests, `console` in dev, `webpush` with the VAPID keys `loadEnv` validated).
 */
export function channelProvidersFactory(
  env: Env,
  mailer: Mailer,
  prisma: PrismaService,
  clock: Clock,
): ChannelProvider[] {
  let push: ChannelProvider;
  switch (env.PUSH_PROVIDER) {
    case "fake":
      push = new FakePushProvider();
      break;
    case "console":
      push = new ConsolePushProvider();
      break;
    case "webpush":
      push = new WebPushProvider(prisma, clock, {
        subject: env.VAPID_SUBJECT!,
        publicKey: env.VAPID_PUBLIC_KEY!,
        privateKey: env.VAPID_PRIVATE_KEY!,
      });
      break;
  }
  return [new EmailProvider(mailer, env.EMAIL_PROVIDER), push];
}

/** Worker side of notifications: message context loading and the channel providers. */
@Module({
  providers: [
    MessageContextService,
    { provide: CHANNEL_PROVIDERS, inject: [ENV, MAILER, PrismaService, CLOCK], useFactory: channelProvidersFactory },
  ],
  exports: [MessageContextService, CHANNEL_PROVIDERS],
})
export class NotificationDeliveryModule {}
