-- Supabase Schema for Swarm Agent Management
-- Run this SQL in your Supabase dashboard SQL editor

-- Users table (stores machine-level user IDs)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents table (stores agent definitions)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  use_when TEXT,
  claude_md_content TEXT,
  args JSONB DEFAULT '[]',
  mcp_requirements JSONB DEFAULT '[]',
  allowed_commands JSONB DEFAULT '[]',
  repos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_user_id ON agents(user_id);

-- Agent instances table (stores workspace instances for each agent)
CREATE TABLE agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  index INTEGER NOT NULL,
  tag TEXT,
  working_dir TEXT NOT NULL,
  ready BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_instances_user_agent ON agent_instances(user_id, agent_id);

-- Session records table (stores session history)
CREATE TABLE session_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES agent_instances(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  instance_index INTEGER,
  instance_tag TEXT,
  prompt TEXT,
  log_dir TEXT,
  claude_session_id TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX idx_sessions_user ON session_records(user_id);

-- Cron definitions table (stores scheduled jobs)
CREATE TABLE cron_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  schedule JSONB NOT NULL,
  args JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crons_user_agent ON cron_definitions(user_id, agent_id);
