/**
 * Embedding service abstraction.
 *
 * Every offer/want is embedded server-side with the SAME model and an
 * explicit role prefix, so vectors from different items land in a
 * comparable space and offer/want matching can be done asymmetrically
 * (an offer embedding is meant to be compared against want embeddings,
 * not other offer embeddings).
 *
 * Swap the implementation of `embed()` for whichever multilingual model
 * you end up hosting (e.g. BGE-M3 / multilingual-e5-large) or calling via
 * API. Keep the instruction-prefix convention below either way.
 */

export type ItemRole = "offer" | "want";

const ROLE_PREFIX: Record<ItemRole, string> = {
  offer: "This is what the person is offering: ",
  want: "This is what the person is looking for: ",
};

export interface EmbeddingService {
  embed(text: string, role: ItemRole): Promise<number[]>;
}

/**
 * Placeholder implementation — throws until a real model/API is wired up.
 * Replace with a call to a hosted multilingual embedding model.
 */
export class UnimplementedEmbeddingService implements EmbeddingService {
  async embed(text: string, role: ItemRole): Promise<number[]> {
    void ROLE_PREFIX[role];
    void text;
    throw new Error(
      "EmbeddingService.embed() is not wired up yet — plug in a real multilingual embedding model."
    );
  }
}
