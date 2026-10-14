CREATE TABLE IF NOT EXISTS visitors (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS site_profiles (id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id), brand jsonb NOT NULL, profile jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS generated_prompts (id uuid PRIMARY KEY, site_profile_id uuid NOT NULL REFERENCES site_profiles(id) ON DELETE CASCADE, type text NOT NULL, text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS checks (id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id), site_profile_id uuid NOT NULL REFERENCES site_profiles(id), prompt_id uuid NOT NULL REFERENCES generated_prompts(id), prompt_text text NOT NULL, brand jsonb NOT NULL, selected_providers jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', estimated_cost numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), deadline_at timestamptz NOT NULL, refunded boolean NOT NULL DEFAULT false, idempotency_key uuid NOT NULL, UNIQUE(visitor_id,idempotency_key));
CREATE TABLE IF NOT EXISTS llm_runs (id uuid PRIMARY KEY, check_id uuid NOT NULL REFERENCES checks(id) ON DELETE CASCADE, provider_id text NOT NULL, repeat_index integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'queued', reason text, answer_text text, citations jsonb NOT NULL DEFAULT '[]', model_reported text, web_search_used boolean NOT NULL DEFAULT false, latency_ms integer, from_cache boolean NOT NULL DEFAULT false, cache_created_at timestamptz, analysis jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE TABLE IF NOT EXISTS response_cache (key text PRIMARY KEY, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS usage_events (id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id), check_id uuid UNIQUE REFERENCES checks(id) ON DELETE CASCADE, ip_hash text NOT NULL, domain text NOT NULL, cost numeric NOT NULL DEFAULT 0, refunded boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS leads (id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id), name text NOT NULL, email text NOT NULL, phone text, consent_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE generated_prompts ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS intelligence_cost_events(id uuid PRIMARY KEY,cost numeric NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS usage_visitor_idx ON usage_events(visitor_id,created_at);
CREATE INDEX IF NOT EXISTS usage_ip_idx ON usage_events(ip_hash,created_at);
CREATE INDEX IF NOT EXISTS usage_domain_idx ON usage_events(domain,created_at);
CREATE INDEX IF NOT EXISTS runs_check_idx ON llm_runs(check_id);

ALTER TABLE checks ADD COLUMN IF NOT EXISTS prompt_kind text NOT NULL DEFAULT 'suggested';
ALTER TABLE checks ADD COLUMN IF NOT EXISTS prompt_bias boolean NOT NULL DEFAULT false;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS browser_evidence jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS browser_provider_health(provider_id text PRIMARY KEY,status text NOT NULL,reason text,checked_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE checks ADD COLUMN IF NOT EXISTS prompts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS prompt_id uuid;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS prompt_index integer NOT NULL DEFAULT 0;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS prompt_text text;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS prompt_bias boolean NOT NULL DEFAULT false;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'queued';
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS phase_message text NOT NULL DEFAULT 'Waiting for an available browser.';
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE llm_runs ADD COLUMN IF NOT EXISTS phase_updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS runs_prompt_idx ON llm_runs(check_id,prompt_index,provider_id);
-- Preserve old single-question evidence and its direct-brand label on upgrade.
UPDATE llm_runs r SET prompt_id=c.prompt_id,prompt_text=c.prompt_text,prompt_bias=c.prompt_bias,
 phase=CASE WHEN r.status='ok' THEN 'completed' WHEN r.status IN ('queued','running') THEN r.phase ELSE 'failed' END,
 phase_message=CASE WHEN r.status='ok' THEN 'Answer and evidence saved.' WHEN r.status IN ('queued','running') THEN r.phase_message ELSE coalesce(r.reason,'This source did not return an answer.') END
 FROM checks c WHERE c.id=r.check_id AND r.prompt_text IS NULL;
-- Allowance rows must outlive their 7-day checks so the 30-day limit holds.
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_check_id_fkey;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_check_id_fkey FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE SET NULL;
