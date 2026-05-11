-- Session 5 — AI Assistant schema.
--
-- Adds:
--   * ai_conversations  — per-conversation transcript + token accounting
--   * ai_quotas         — rolling-24h search quota for anonymous visitors
--   * profiles.ai_chat_enabled — feature-flag column for signed-in users
--
-- All additive — no existing column or row is mutated.
--
-- Identity model:
--   Signed-in conversations: ai_conversations.user_id IS NOT NULL
--   Anonymous conversations: ai_conversations.visitor_id_hash IS NOT NULL
--   The CHECK constraint guarantees at least one is set, never both null.
--
-- ai_quotas is anonymous-only (signed-in users are unlimited and don't
-- pass through this table). The PK is visitor_id_hash so quota state
-- naturally upserts.
--
-- See CLAUDE.md §32 for the full design (quota model, prompt caching
-- strategy, feature-flag gating, tool surface).

BEGIN;

-- =====================================================
-- 1. ai_conversations
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_conversations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id_hash             TEXT,
  messages                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Anthropic-side accounting (informational; not used to enforce quota)
  search_tool_calls           INTEGER     NOT NULL DEFAULT 0,
  alternative_tool_calls      INTEGER     NOT NULL DEFAULT 0,
  total_input_tokens          INTEGER     NOT NULL DEFAULT 0,
  total_output_tokens         INTEGER     NOT NULL DEFAULT 0,
  total_cached_input_tokens   INTEGER     NOT NULL DEFAULT 0,
  estimated_cost_usd          NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_conversations_identity_check
    CHECK (user_id IS NOT NULL OR visitor_id_hash IS NOT NULL)
);

COMMENT ON TABLE ai_conversations IS
  'One row per AI chat conversation. JSONB messages array preserves Anthropic content-block shape (text, tool_use, tool_result, thinking) verbatim, so transcripts can be replayed back through the API without parsing.';

COMMENT ON COLUMN ai_conversations.messages IS
  'Array of Anthropic-shaped messages: {role: "user"|"assistant", content: [...content blocks]}. Tool calls and results are preserved as native content blocks. Do NOT flatten to plain text — round-trip with the API depends on the full shape.';

COMMENT ON COLUMN ai_conversations.search_tool_calls IS
  'Count of searchProducts tool invocations across the conversation. Not the quota counter — that lives in ai_quotas keyed by visitor_id_hash. This is per-conversation analytics.';

CREATE INDEX IF NOT EXISTS ai_conversations_user_idx
  ON ai_conversations (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_conversations_visitor_idx
  ON ai_conversations (visitor_id_hash, updated_at DESC)
  WHERE visitor_id_hash IS NOT NULL;

CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 2. ai_quotas
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_quotas (
  visitor_id_hash    TEXT        PRIMARY KEY,
  searches_used      INTEGER     NOT NULL DEFAULT 0,
  window_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_search_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_quotas IS
  'Anonymous-only rolling 24h searchProducts quota. Signed-in users are unlimited and do not pass through this table. window_started_at slides forward when an incoming call arrives more than 24h after it (handled in scripts/lib/ai-quota.js).';

-- =====================================================
-- 3. Feature-flag column on profiles
-- =====================================================
--
-- profiles currently has 0 rows (verified live before this migration).
-- Adding NOT NULL DEFAULT false is therefore zero-risk; future rows
-- get the safe default and any seed UPDATE is a manual follow-up (see
-- §32.9). We deliberately do NOT seed Dave in this migration — the
-- specific email needs human confirmation and the seed is a one-line
-- UPDATE once confirmed.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_chat_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.ai_chat_enabled IS
  'Feature-flag for the AI chat widget on signed-in users. Combined with VITE_AI_CHAT_PUBLIC_ENABLED env var (anonymous gate). See CLAUDE.md §32.';

-- =====================================================
-- 4. RLS
-- =====================================================
--
-- ai_conversations: signed-in users can SELECT their own rows;
--                   service_role can do anything (the chat endpoint
--                   writes with service_role).
-- ai_quotas:        no user-facing reads/writes; service_role only.

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quotas        ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_conversations_owner_select
  ON ai_conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY ai_conversations_service_role_all
  ON ai_conversations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY ai_quotas_service_role_all
  ON ai_quotas FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
