-- Manual migration: embedding_vector columns + HNSW indexes for brain-object tables
-- NOT managed by drizzle-kit (drizzle-orm 0.45 does not support the vector
-- type natively — columns and indexes are maintained via raw SQL).
-- Requires the vector extension from 0001_pgvector_hnsw.sql to be applied first.

-- Embedding columns (OpenAI text-embedding-3-small, 1536 dims)
ALTER TABLE principles
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE playbooks
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE anti_patterns
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

-- HNSW indexes for approximate nearest-neighbour cosine similarity search.
-- Similarity search query pattern:
--   SELECT * FROM <table> ORDER BY embedding_vector <=> $1::vector LIMIT $2
CREATE INDEX IF NOT EXISTS principles_embedding_hnsw
  ON principles USING hnsw (embedding_vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS rules_embedding_hnsw
  ON rules USING hnsw (embedding_vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS playbooks_embedding_hnsw
  ON playbooks USING hnsw (embedding_vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS anti_patterns_embedding_hnsw
  ON anti_patterns USING hnsw (embedding_vector vector_cosine_ops);
