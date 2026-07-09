-- Initialize pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create development database if not exists
SELECT 'CREATE DATABASE optra'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'optra')\gexec
