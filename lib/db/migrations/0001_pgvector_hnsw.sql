-- Manual migration: pgvector column and HNSW index
-- Applied 2026-04-05. NOT managed by drizzle-kit (drizzle-orm 0.45 does not support
-- the vector type natively, so this column is maintained via raw SQL).

-- Embedding column (OpenAI text-embedding-3-small, 1536 dims)
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector_pgv vector(1536);

-- HNSW index for approximate nearest-neighbour cosine similarity search.
-- Used by: SELECT ... FROM document_chunks ORDER BY embedding_vector_pgv <=> $1::vector LIMIT $2
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding_vector_pgv vector_cosine_ops);

-- Verify
-- \d document_chunks
-- \di document_chunks_embedding_hnsw
