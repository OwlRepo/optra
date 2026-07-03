-- Initialize pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create development database if not exists
SELECT 'CREATE DATABASE mnemra'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mnemra')\gexec
