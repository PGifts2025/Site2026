-- Migration: Create User Designs Table
-- This migration creates a table to store user-created designs from the Designer tool.
-- Designs are saved as Fabric.js canvas JSON and can be loaded/edited later.
--
-- Features:
-- - Support for authenticated users (user_id)
-- - Support for anonymous users (session_id)
-- - Design thumbnails for preview
-- - Links to product templates and variants
-- - Public/private designs

-- ============================================================================
-- USER DESIGNS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_designs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- User Association (nullable for anonymous)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT,  -- For anonymous users (stored in localStorage)

  -- Product Association
  product_template_id UUID NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_template_variants(id) ON DELETE SET NULL,

  -- Design Data
  design_name TEXT DEFAULT 'Untitled Design' NOT NULL,
  design_data JSONB NOT NULL,  -- Fabric.js canvas JSON
  thumbnail_url TEXT,           -- Preview image URL
  view_name VARCHAR(50),        -- Which view: front, back, etc.

  -- Visibility
  is_public BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Constraints
  CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)  -- Must have either user_id or session_id
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for querying user's designs
CREATE INDEX IF NOT EXISTS idx_user_designs_user_id
  ON user_designs(user_id)
  WHERE user_id IS NOT NULL;

-- Index for querying anonymous designs by session
CREATE INDEX IF NOT EXISTS idx_user_designs_session_id
  ON user_designs(session_id)
  WHERE session_id IS NOT NULL;

-- Index for querying designs by product template
CREATE INDEX IF NOT EXISTS idx_user_designs_product_template
  ON user_designs(product_template_id);

-- Index for querying designs by variant
CREATE INDEX IF NOT EXISTS idx_user_designs_variant
  ON user_designs(variant_id)
  WHERE variant_id IS NOT NULL;

-- Index for ordering by creation date
CREATE INDEX IF NOT EXISTS idx_user_designs_created_at
  ON user_designs(created_at DESC);

-- Index for public designs
CREATE INDEX IF NOT EXISTS idx_user_designs_public
  ON user_designs(is_public)
  WHERE is_public = true;

-- Composite index for user/session queries with date ordering
CREATE INDEX IF NOT EXISTS idx_user_designs_user_created
  ON user_designs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_designs_session_created
  ON user_designs(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to automatically update updated_at timestamp
DROP TRIGGER IF EXISTS update_user_designs_updated_at ON user_designs;
CREATE TRIGGER update_user_designs_updated_at
  BEFORE UPDATE ON user_designs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE user_designs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own designs
CREATE POLICY "Users can view own designs"
  ON user_designs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Anonymous users can view designs by session_id
-- Note: session_id must be passed via request header or parameter
CREATE POLICY "Anonymous can view own session designs"
  ON user_designs FOR SELECT
  USING (
    user_id IS NULL AND
    session_id IS NOT NULL
  );

-- Policy: Anyone can view public designs
CREATE POLICY "Anyone can view public designs"
  ON user_designs FOR SELECT
  USING (is_public = true);

-- Policy: Users can insert their own designs
CREATE POLICY "Users can insert own designs"
  ON user_designs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Policy: Anonymous users can insert designs with session_id
CREATE POLICY "Anonymous can insert session designs"
  ON user_designs FOR INSERT
  WITH CHECK (
    user_id IS NULL AND
    session_id IS NOT NULL
  );

-- Policy: Users can update their own designs
CREATE POLICY "Users can update own designs"
  ON user_designs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy: Anonymous users can update their session designs
CREATE POLICY "Anonymous can update session designs"
  ON user_designs FOR UPDATE
  USING (
    user_id IS NULL AND
    session_id IS NOT NULL
  )
  WITH CHECK (
    user_id IS NULL AND
    session_id IS NOT NULL
  );

-- Policy: Users can delete their own designs
CREATE POLICY "Users can delete own designs"
  ON user_designs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: Anonymous users can delete their session designs
CREATE POLICY "Anonymous can delete session designs"
  ON user_designs FOR DELETE
  USING (
    user_id IS NULL AND
    session_id IS NOT NULL
  );

-- Policy: Admins can view all designs
CREATE POLICY "Admins can view all designs"
  ON user_designs FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Policy: Admins can manage all designs
CREATE POLICY "Admins can manage all designs"
  ON user_designs FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to migrate anonymous designs to user account
CREATE OR REPLACE FUNCTION migrate_session_designs_to_user(
  p_session_id TEXT,
  p_user_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  designs_migrated INTEGER;
BEGIN
  -- Update designs from session to user
  UPDATE user_designs
  SET
    user_id = p_user_id,
    session_id = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE
    session_id = p_session_id AND
    user_id IS NULL;

  GET DIAGNOSTICS designs_migrated = ROW_COUNT;

  RETURN designs_migrated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION migrate_session_designs_to_user IS 'Migrate anonymous session designs to user account after login';

-- Function to clean up old anonymous designs (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_anonymous_designs()
RETURNS INTEGER AS $$
DECLARE
  designs_deleted INTEGER;
BEGIN
  DELETE FROM user_designs
  WHERE
    user_id IS NULL AND
    session_id IS NOT NULL AND
    created_at < (timezone('utc'::text, now()) - INTERVAL '90 days');

  GET DIAGNOSTICS designs_deleted = ROW_COUNT;

  RETURN designs_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_anonymous_designs IS 'Delete anonymous designs older than 90 days (should be run periodically)';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE user_designs IS 'Stores user-created designs from the Designer tool';
COMMENT ON COLUMN user_designs.user_id IS 'References authenticated user (NULL for anonymous)';
COMMENT ON COLUMN user_designs.session_id IS 'Session identifier for anonymous users';
COMMENT ON COLUMN user_designs.design_data IS 'Fabric.js canvas JSON containing all design elements';
COMMENT ON COLUMN user_designs.thumbnail_url IS 'URL to design thumbnail preview image';
COMMENT ON COLUMN user_designs.view_name IS 'Product view name (front, back, etc.)';
COMMENT ON COLUMN user_designs.is_public IS 'Whether design is publicly viewable';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Summary of created objects:
-- ✅ 1 Table: user_designs
-- ✅ 8 Indexes for query optimization
-- ✅ 1 Trigger for automatic updated_at
-- ✅ 11 RLS Policies for security
-- ✅ 2 Helper functions: migrate_session_designs_to_user, cleanup_old_anonymous_designs

-- Next steps:
-- 1. Update supabaseService.js with design CRUD functions
-- 2. Update Designer.jsx to save/load designs
-- 3. Create UI for design management
-- 4. Implement session_id handling for anonymous users
