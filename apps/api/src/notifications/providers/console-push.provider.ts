import { Logger } from "@nestjs/common";
import type { RenderedMessage } from "../templates/types.js";
import type { ChannelProvider } from "./channel-provider.js";

/** DEV ONLY (`PUSH_PROVIDER=console`, refused in production): logs the push title only, sends nothing. */
export class ConsolePushProvider implements ChannelProvider {
  readonly channel = "PUSH" as const;
  readonly name = "console";
  private readonly logger = new Logger(ConsolePushProvider.name);

  send(msg: RenderedMessage): Promise<{ providerMessageId?: string }> {
    this.logger.log(`Push: ${msg.push.title}`);
    return Promise.resolve({});
  }
}
