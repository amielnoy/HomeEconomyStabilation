import type { ConsentAcceptance, ConsentPort, LocalConsentRepository } from './consent.js';

/* Local storage stays authoritative for what the UI shows as "current": the remote
   side is write-through only, never read back here. A household that accepted on a
   different device will not see that reflected on this one until it accepts again
   here too — reconciling local and remote state is a separate, not-yet-built piece.
   `local` is typed as the concrete browser-storage repository, not the broader
   ConsentPort, specifically because its current() is synchronous — that's what lets
   this class expose a synchronous current() too, matching how the UI already reads it. */
export class WriteThroughConsentRepository implements ConsentPort {
  constructor(private readonly input: {
    local: LocalConsentRepository;
    remote: ConsentPort;
    signedIn: () => boolean;
    onRemoteError?: (cause: unknown) => void;
  }) {}

  current(): ConsentAcceptance | null {
    return this.input.local.current();
  }

  async accept(locale: string): Promise<ConsentAcceptance> {
    const acceptance = await this.input.local.accept(locale);
    if (this.input.signedIn()) {
      void Promise.resolve(this.input.remote.accept(locale)).catch((cause) => this.input.onRemoteError?.(cause));
    }
    return acceptance;
  }

  async withdraw(): Promise<void> {
    await this.input.local.withdraw();
    if (this.input.signedIn()) {
      void Promise.resolve(this.input.remote.withdraw()).catch((cause) => this.input.onRemoteError?.(cause));
    }
  }
}
