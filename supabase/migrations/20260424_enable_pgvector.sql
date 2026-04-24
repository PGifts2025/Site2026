-- Enable the pgvector extension.
--
-- Session 1 scope: extension only. Embedding columns, indexes, and the
-- embedding pipeline are explicitly deferred to session 2 per the
-- integration plan (see CLAUDE.md "Laltex Integration Architecture").
--
-- pgvector 0.8.0 is available on this Supabase project (Postgres 17.4).
-- Verified post-install with:
--   SELECT extversion FROM pg_extension WHERE extname = 'vector';

CREATE EXTENSION IF NOT EXISTS vector;
