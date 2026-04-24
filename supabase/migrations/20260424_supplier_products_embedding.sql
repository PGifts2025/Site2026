-- Session 2: add embedding + source-hash + embedded_at columns to
-- supplier_products, plus an ivfflat cosine index on the embedding.
--
-- Model: text-embedding-3-small (1536 dimensions) — decided at session
-- level. See CLAUDE.md §26 "Embedding Pipeline" for rationale.
--
-- Idempotency pattern: the sync / re-embed logic hashes the source text
-- (SHA-256, 64-char hex) and stores it alongside the embedding. On
-- subsequent runs, if the newly-computed hash matches the stored one,
-- the OpenAI API call is skipped entirely. This protects the nightly
-- re-sync (session 3) from re-embedding the whole catalogue for no
-- reason — critical cost control at 10k+ rows.

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS embedding              vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_source_hash  TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at            TIMESTAMPTZ;

COMMENT ON COLUMN supplier_products.embedding IS
  '1536-dim vector from OpenAI text-embedding-3-small. Built from buildEmbeddingSourceText() in site/scripts/lib/embedding.js.';

COMMENT ON COLUMN supplier_products.embedding_source_hash IS
  'SHA-256 hex of the source text used to produce embedding. Skip re-embed when unchanged.';

-- ivfflat, cosine ops. lists=100 is tuned for the <10k-row catalogue we
-- will reach at the end of session 3. At that scale the heuristic of
-- "lists ~= sqrt(N)" puts us between 50 and 100. Revisit when the
-- catalogue crosses 10k rows — either bump lists or swap to HNSW.
--
-- Note on cost: ivfflat index creation is instant with 1 embedded row
-- but will take 1–several minutes when the full catalogue is embedded
-- in session 3. Plan session 3 to embed first, THEN create the index
-- (or DROP + CREATE it after batch). For session 2 we create it now so
-- the search script proves the full query path including index use.

CREATE INDEX IF NOT EXISTS supplier_products_embedding_idx
  ON supplier_products
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON INDEX supplier_products_embedding_idx IS
  'ivfflat lists=100 tuned for <10k rows; revisit when catalogue exceeds that (bump lists or move to HNSW).';
