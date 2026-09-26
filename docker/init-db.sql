-- Initialize pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create development database if not exists
SELECT 'CREATE DATABASE optra'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'optra')\gexec

-- Umami (self-hosted analytics) gets its own database in the same shared
-- Postgres instance rather than a separate container, so it needs no new
-- backup destination or credentials — see scripts/backup.sh.
SELECT 'CREATE DATABASE umami'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami')\gexec
