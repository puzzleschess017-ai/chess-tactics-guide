-- CHESS TRAINING — Supabase Database Schema & Row Level Security (RLS)
-- Run this migration in the Supabase SQL Editor or via `supabase db push`.
-- Prerequisite: Enable "Anonymous Sign-Ins" in Supabase Dashboard -> Authentication -> Providers.

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Profiles (linked to auth.users; supports anonymous accounts and future OAuth/Email linking)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Chess Player',
  is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  linked_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2. User Settings (Board appearance, Sound, General preferences)
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Training Sessions (Unified session log across all modules)
CREATE TABLE IF NOT EXISTS public.training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  accuracy NUMERIC(5,2) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  best_metric NUMERIC(10,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_user_created
  ON public.training_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_sessions_user_module
  ON public.training_sessions (user_id, module);

ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own training sessions"
  ON public.training_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own training sessions"
  ON public.training_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own training sessions"
  ON public.training_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Module Personal Records (Keyed by user_id + module)
CREATE TABLE IF NOT EXISTS public.module_records (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  records JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module)
);

ALTER TABLE public.module_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own module records"
  ON public.module_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own module records"
  ON public.module_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own module records"
  ON public.module_records FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Puzzle Collections (Saved puzzles, Woodpecker sets, custom PGN imports)
CREATE TABLE IF NOT EXISTS public.puzzle_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'mixed',
  puzzles JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puzzle_collections_user
  ON public.puzzle_collections (user_id, updated_at DESC);

ALTER TABLE public.puzzle_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own puzzle collections"
  ON public.puzzle_collections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. Woodpecker Training Cycles
CREATE TABLE IF NOT EXISTS public.woodpecker_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES public.puzzle_collections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  target_cycles INTEGER NOT NULL DEFAULT 3,
  current_cycle INTEGER NOT NULL DEFAULT 1,
  current_index INTEGER NOT NULL DEFAULT 0,
  shuffle BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  active_correct INTEGER NOT NULL DEFAULT 0,
  active_incorrect INTEGER NOT NULL DEFAULT 0,
  cycle_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  puzzle_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_woodpecker_cycles_user
  ON public.woodpecker_cycles (user_id, updated_at DESC);

ALTER TABLE public.woodpecker_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own woodpecker cycles"
  ON public.woodpecker_cycles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. Optional Hosted Puzzle Bank (for importing Lichess puzzles into Supabase Postgres)
CREATE TABLE IF NOT EXISTS public.puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating INTEGER NOT NULL,
  rating_deviation INTEGER NOT NULL DEFAULT 75,
  popularity INTEGER NOT NULL DEFAULT 90,
  nb_plays INTEGER NOT NULL DEFAULT 1000,
  themes TEXT NOT NULL,
  game_url TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON public.puzzles (rating);
CREATE INDEX IF NOT EXISTS idx_puzzles_themes ON public.puzzles USING GIN (to_tsvector('english', themes));

ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated and anonymous users can read puzzles"
  ON public.puzzles FOR SELECT
  TO authenticated
  USING (TRUE);

-- Auto-create profile trigger when a new anonymous or linked user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, is_anonymous, linked_email, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.is_anonymous, TRUE),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.raw_user_meta_data->>'display_name', 'Chess Player')
  )
  ON CONFLICT (id) DO UPDATE SET
    linked_email = EXCLUDED.linked_email,
    display_name = CASE
      WHEN EXCLUDED.display_name <> 'Chess Player' THEN EXCLUDED.display_name
      ELSE public.user_profiles.display_name
    END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Omogući prijavu sa korisničkim imenom (username)
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT linked_email INTO v_email
  FROM public.user_profiles
  WHERE LOWER(display_name) = LOWER(TRIM(p_username))
  LIMIT 1;
  RETURN v_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated;
