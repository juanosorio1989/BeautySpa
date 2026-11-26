import type { RenderedMessage } from "../templates/types.js";
import type { ChannelProvider, DeliveryTarget } from "./channel-provider.js";

/** TEST ONLY (`PUSH_PROVIDER=fake`, refused outside `NODE_ENV=test`): records every call, sends nothing. */
export class FakePushProvider implements ChannelProvider {
  readonly channel = "PUSH" as const;
  readonly name = "fake";
  readonly calls: { msg: RenderedMessage; target: DeliveryTarget }[] = [];

  send(msg: RenderedMessage, target: DeliveryTarget): Promise<{ providerMessageId?: string }> {
    this.calls.push({ msg, target });
    return Promise.resolve({});
  }
}
