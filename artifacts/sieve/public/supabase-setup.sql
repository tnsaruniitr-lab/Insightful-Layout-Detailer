-- Tryps AEO/GEO Automation — Supabase read replica setup
-- Run this once in your Supabase SQL editor, then the app will auto-sync data here.

-- 1. Enable pgvector (already enabled on Supabase by default, safe to run again)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE brain_domain_tag AS ENUM ('seo', 'geo', 'aeo', 'content', 'entity', 'general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brain_status AS ENUM ('canonical', 'candidate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rule_type AS ENUM ('diagnostic', 'mapping', 'scoring', 'warning');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. brands
CREATE TABLE IF NOT EXISTS brands (
  id                       serial PRIMARY KEY,
  name                     text NOT NULL,
  icp_description          text,
  positioning_statement    text,
  target_geographies_json  text,
  product_truths_json      text,
  tone_descriptors_json    text,
  created_at               timestamptz DEFAULT now()
);

-- 4. documents
CREATE TABLE IF NOT EXISTS documents (
  id               serial PRIMARY KEY,
  title            text NOT NULL,
  domain_tag       brain_domain_tag DEFAULT 'general',
  trust_level      text DEFAULT 'medium',
  source_type      text,
  raw_text_status  text,
  error_message    text,
  created_at       timestamptz DEFAULT now()
);

-- 5. principles
CREATE TABLE IF NOT EXISTS principles (
  id                serial PRIMARY KEY,
  title             text NOT NULL,
  statement         text,
  explanation       text,
  domain_tag        brain_domain_tag,
  confidence_score  numeric(4,3),
  source_count      integer DEFAULT 1,
  source_refs_json  text DEFAULT '[]',
  status            brain_status DEFAULT 'candidate',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 6. rules
CREATE TABLE IF NOT EXISTS rules (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  rule_type         rule_type,
  if_condition      text,
  then_logic        text,
  domain_tag        brain_domain_tag,
  confidence_score  numeric(4,3),
  source_refs_json  text DEFAULT '[]',
  status            brain_status DEFAULT 'candidate',
  created_at        timestamptz DEFAULT now()
);

-- 7. playbooks
CREATE TABLE IF NOT EXISTS playbooks (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  summary           text,
  use_when          text,
  avoid_when        text,
  expected_outcomes text,
  domain_tag        brain_domain_tag,
  confidence_score  numeric(4,3),
  source_refs_json  text DEFAULT '[]',
  status            brain_status DEFAULT 'candidate',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 8. anti_patterns
CREATE TABLE IF NOT EXISTS anti_patterns (
  id                serial PRIMARY KEY,
  title             text NOT NULL,
  description       text,
  signals_json      text DEFAULT '[]',
  domain_tag        brain_domain_tag,
  risk_level        risk_level DEFAULT 'medium',
  source_refs_json  text DEFAULT '[]',
  status            brain_status DEFAULT 'candidate',
  created_at        timestamptz DEFAULT now()
);

-- 9. examples
CREATE TABLE IF NOT EXISTS examples (
  id                serial PRIMARY KEY,
  title             text NOT NULL,
  description       text,
  domain_tag        brain_domain_tag,
  source_refs_json  text DEFAULT '[]',
  created_at        timestamptz DEFAULT now()
);
