import { chunksWithoutEmbedding, setChunkEmbedding, upsertVec, vecAvailable } from './db.ts';
import { embedTexts } from './retrieval.ts';

export async function embedMissingChunks(batch = 64): Promise<{ embedded: number; vecEnabled: boolean }> {
  let embedded = 0;
  for (;;) {
    const rows = chunksWithoutEmbedding(batch);
    if (!rows.length) break;
    const vecs = await embedTexts(rows.map((item) => item.text));
    if (!vecs || vecs.length !== rows.length) break;
    rows.forEach((row, index) => {
      setChunkEmbedding(row.id, vecs[index]);
      if (vecAvailable()) upsertVec(row.id, vecs[index]);
      embedded += 1;
    });
  }
  return { embedded, vecEnabled: vecAvailable() };
}

