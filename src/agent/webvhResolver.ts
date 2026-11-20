import type {
  AgentContext,
  DidResolutionOptions,
  DidResolutionResult,
  ParsedDid,
} from '@credo-ts/core';
import { WebVhDidResolver } from '@credo-ts/webvh';

/**
 * Credo's did:webvh resolver, plus a check that the document returned is the
 * one that was asked for.
 *
 * @credo-ts/webvh 0.6.3 (didwebvh-ts 2.8) verifies the log's hash chain and
 * signatures but does not compare the SCID in the requested DID with the log's
 * SCID: on 2026-11-20, resolving
 *   did:webvh:QmaJp6pm…:gist.githubusercontent.com:brianorwhatever:9c46…:raw
 * returned the document of did:webvh:QmPEQVM1… (the only DID in that log).
 * The SCID binds a DID to its genesis entry, so without this check whoever
 * controls the domain can swap in a new log and every existing DID there
 * resolves to it, i.e. did:webvh degrades to did:web.
 *
 * Requiring didDocument.id === the requested DID closes that. Side effect: a
 * DID that has moved domains (portable: true) only resolves under its current
 * DID, not the old one.
 */
export class StrictWebVhDidResolver extends WebVhDidResolver {
  async resolve(
    agentContext: AgentContext,
    did: string,
    parsed?: ParsedDid,
    _options?: DidResolutionOptions,
  ): Promise<DidResolutionResult> {
    const requested = parsed?.did ?? did;
    const result = await super.resolve(agentContext, requested);
    if (result.didDocument && result.didDocument.id !== requested) {
      return {
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'notFound',
          message: `did:webvh log for ${requested} describes a different DID (${result.didDocument.id})`,
        },
      };
    }
    return result;
  }
}
