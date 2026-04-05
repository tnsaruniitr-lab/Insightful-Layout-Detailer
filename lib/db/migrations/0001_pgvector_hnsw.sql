-- Manual migration: pgvector extension + embedding column + HNSW index
-- NOT managed by drizzle-kit (drizzle-orm 0.45 does not support the vector
-- type natively — this column is maintained via raw SQL).

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding column (OpenAI text-embedding-3-small, 1536 dims)
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

-- HNSW index for approximate nearest-neighbour cosine similarity search.
-- Similarity search query pattern:
--   SELECT * FROM document_chunks ORDER BY embedding_vector <=> $1::vector LIMIT $2
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding_vector vector_cosine_ops);
