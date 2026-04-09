# Workspace

## Overview

**Sieve** — a marketing intelligence system (Phase 1). Ingests SEO/GEO/AEO knowledge documents, extracts structured brain objects (principles, playbooks, rules, anti-patterns), and applies that intelligence to a brand to answer questions and produce "where should this brand start?" strategy outputs.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM + pgvector (`embedding_vector_pgv vector(1536)`)
- **Object storage**: Replit Object Storage (GCS-backed, presigned URL flow)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (ESM bundle via `build.mjs`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Packages

| Package | Path | Purpose |
|---|---|---|
| `@workspace/db` | `lib/db/` | Drizzle schema, pool, typed exports |
| `@workspace/api-spec` | `lib/api-spec/` | OpenAPI 3.1 spec + Orval codegen |
| `@workspace/api-zod` | `lib/api-zod/` | Generated Zod schemas for request/response validation |
| `@workspace/api-client` | `lib/api-client/` | Generated React Query hooks (for frontend) |
| `@workspace/api-server` | `artifacts/api-server/` | Express 5 API server |

### Database Schema (13 tables)

**Brand domain**: `brands`, `competitors`
**Document domain**: `documents`, `document_chunks` (+ `embedding_vector_pgv vector(1536)` HNSW index), `uploaded_data_assets`
**Brain domain**: `principles`, `rules`, `playbooks`, `playbook_steps`, `anti_patterns`, `examples`
**Run domain**: `mapping_runs`, `mapping_run_sources`

### Vector column

The `document_chunks` table has a `embedding_vector_pgv vector(1536)` column managed outside Drizzle (raw SQL). An HNSW index exists on it: `document_chunks_embedding_hnsw`. Use raw SQL or `pool.query()` for vector similarity search.

### API Routes (all mounted at `/api`)

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Health check |
| POST | `/brands` | Create brand |
| GET/PATCH | `/brands/:id` | Get/update brand |
| GET/POST | `/brands/:id/competitors` | List/add competitors |
| DELETE | `/brands/:id/competitors/:competitorId` | Remove competitor |
| GET | `/documents` | List documents |
| POST | `/documents/upload` | Get presigned upload URL + create record |
| GET | `/documents/:id` | Get document |
| POST | `/documents/:id/process` | Trigger ingestion pipeline |
| GET | `/documents/:id/chunks` | Get document chunks |
| GET | `/principles` | List principles |
| GET | `/rules` | List rules |
| GET | `/playbooks` | List playbooks |
| GET | `/playbooks/:id` | Get playbook with steps |
| GET | `/anti-patterns` | List anti-patterns |
| GET | `/examples` | List examples |
| POST | `/brain/ask` | Q&A (AI pipeline) |
| POST | `/brain/map-brand` | Brand mapping (AI pipeline) |
| POST | `/brain/where-to-start` | Strategy start (AI pipeline) |
| GET | `/brain/audit` | Full brain health report |
| GET | `/brain/conflicts` | List contested brain objects |
| POST | `/brain/conflicts/:id/resolve` | Resolve conflict (keep/discard) |
| POST | `/brain/backfill-canonical` | Bulk promote canonical objects (requires x-audit-secret header) |
| GET | `/runs` | List runs |
| GET | `/runs/:id` | Get run with sources |
| GET | `/brands/:id/data/assets` | List data assets |
| POST | `/brands/:id/data/upload` | Upload data asset |

### Frontend App (Phase 1C - Complete)

The `artifacts/sieve` React+Vite frontend is scaffolded at port 21608 (previewPath `/`). It features 8 pages wired to the API via generated TanStack Query hooks:

| Route | Page | Description |
|---|---|---|
| `/` | Dashboard | Brand stats, processed docs count, recent runs, quick actions |
| `/knowledge` | Knowledge Hub | Upload & manage documents; filter by domain/status; trigger processing |
| `/brain` | Brain Explorer | Browse principles, rules, playbooks, anti-patterns; tabbed by type + domain |
| `/brand` | Brand Profile | View/edit brand identity and manage competitors |
| `/ask` | Ask the Brain | Q&A interface using `askBrain` endpoint |
| `/map` | Brand Mapping | Map brain intelligence to brand using `mapBrand` |
| `/strategy` | Strategy Output | Get strategy recommendations using `getBrandStrategy` |
| `/runs` | Run History | Full audit log of all intelligence executions |
| `/conflicts` | Conflict Review | Review and resolve contested brain objects flagged by semantic contradiction detection |

**Key components:**
- `use-brand-context.tsx` — manages active brand context with localStorage persistence; auto-creates Default Brand on first load (guarded with `useRef` to prevent loops)
- `components/memo-response.tsx` — renders `MemoResponse` with structured memo display and source citations
- Vite proxy: `/api` → `http://localhost:8080` for API calls in development

**Seed data:**
- 2 brands (Sieve Demo Brand + Default Brand)
- 4 principles, 3 rules, 2 playbooks (with 9 steps), 3 anti-patterns, 2 examples

### Pipeline Stubs

`artifacts/api-server/src/pipelines/` contains stubs for:
- `ingestion.ts` → `runIngestionGraph(documentId)` — triggered by POST `/documents/:id/process`
- `qa.ts` → `runQaGraph(input)` — called by POST `/brain/ask`
- `brandMapping.ts` → `runBrandMappingGraph(input)`
- `strategy.ts` → `runStrategyGraph(input)`

These stubs throw errors until Task 2 (AI Pipelines) implements them.

### Important Conventions

- Routes do NOT include `/api` prefix — already mounted at `/api` in `app.ts`
- Use `req.log` (not `console.log`) in route handlers; `logger` singleton for background tasks
- Express 5: `req.params.id` is `string | string[]` — always parse with Zod coerce
- Async handlers need `: Promise<void>` return type annotation
- OpenAPI spec: use `type: ["string", "null"]` (not `nullable: true`) for nullable fields
- Keep `info.title` as `"Api"` in `openapi.yaml` — changing it breaks generated import paths
- Vector operations use raw SQL / `pool.query()` since `embedding_vector_pgv` is not in Drizzle schema
- Brain tables (principles, rules, playbooks, anti_patterns) have `contested`, `conflict_pair_id`, and `negation_embedding_vector` columns (vector 1536) added for conflict detection
- Scoring formula: 0.55×similarity + 0.20×confidence + 0.10×sourceWeight + 0.10×authorityCorroboration + 0.05×canonicalBoost
- Authority tiers: `trustLevel` high=Tier 1 (3.0), medium=Tier 2 (1.0), low=Tier 3 (0.33)
- Canonical promotion criteria: source_count >= 3 AND confidence > 0.95 AND contested = false
- Conflict detection: negation embedding threshold 0.82; enrichment detection range 0.88–0.92
- `AUDIT_SECRET` header value for admin endpoints: `sieve-audit-2026-xK9mP3`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
