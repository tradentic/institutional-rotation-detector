# Architecture Cleanup Plan: Remove Unused Vector Store

**Date:** 2025-11-09
**Status:** Implementation Plan
**Goal:** Remove legacy vector store infrastructure in favor of pure GraphRAG + Long Context

## Background

The system was initially designed with vector store RAG, but pivoted to:
- **Graph algorithms** for finding relationships
- **Long context (128K+)** for synthesis (no semantic filtering)

This decision aligns with using GPT-5's massive context windows where semantic pre-filtering is unnecessary.

However, legacy vector store code remains in the codebase, causing confusion.

---

## Components to Remove

### 1. Database Schema Changes

**File:** `supabase/migrations/016_remove_vector_store.sql`

```sql
-- Remove vector search function (unused)
DROP FUNCTION IF EXISTS match_filing_chunks(vector(1536), float, int, text[]);

-- Drop vector index (no longer needed)
DROP INDEX IF EXISTS filing_chunks_embedding_idx;

-- Option A: Drop embedding column entirely
ALTER TABLE filing_chunks DROP COLUMN IF EXISTS embedding;

-- Option B: Keep column but mark as deprecated (safer for rollback)
COMMENT ON COLUMN filing_chunks.embedding IS 'DEPRECATED: No longer used. System uses graph + long context instead of vector RAG.';
```

**Recommendation:** Option B (keep column, mark deprecated) for 1-2 releases, then Option A.

### 2. Activity Files to Remove/Simplify

#### Remove: `rag.activities.ts`

**Current usage:**
- `ingestFilingChunk()` - ❌ Never called
- `explainEdge()` - ⚠️ Used in `/api/explain` but with dummy embedding

**Action:**
1. Delete `apps/temporal-worker/src/activities/rag.activities.ts`
2. Remove API endpoint `/api/explain` OR reimplement using long context

#### Simplify: `filing-chunks.activities.ts`

**Keep:**
- `chunkFiling()` - Text chunking (no embeddings)
- `createClusterSummary()` - Cluster summarization

**Remove:**
- `generateEmbedding()` function (lines 43-59)
- OpenAI embeddings API calls
- Embedding generation logic from `chunkFiling()`

**Updated `chunkFiling()` (simplified):**
```typescript
export async function chunkFiling(input: ChunkFilingInput): Promise<ChunkFilingResult> {
  const supabase = createSupabaseClient();
  const sec = createSecClient();

  const { data: filing } = await supabase
    .from('filings')
    .select('accession, url, cik, form')
    .eq('accession', input.accession)
    .maybeSingle();

  if (!filing) throw new Error(`Filing not found: ${input.accession}`);

  const filingText = await sec.fetchFilingText(filing.url);
  const chunks = chunkText(filingText, chunkSize, overlap);

  // Store chunks (text only, no embeddings)
  for (let i = 0; i < chunks.length; i++) {
    await supabase.from('filing_chunks').upsert(
      {
        accession: input.accession,
        chunk_no: i,
        content: chunks[i],
      },
      { onConflict: 'accession,chunk_no' }
    );
  }

  return {
    accession: input.accession,
    chunksCreated: chunks.length,
    embeddingsGenerated: 0,  // No longer generating embeddings
  };
}
```

### 3. API Routes to Remove/Fix

#### Option A: Remove `/api/explain` endpoint
**File:** `apps/api/routes/explain.post.ts`

If not used by frontend, simply delete.

#### Option B: Reimplement with long context
```typescript
// apps/api/routes/explain.post.ts
import { executeWorkflow } from '../../temporal-worker/client.js';

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  if (!body?.edgeIds) {
    return new Response('Missing edgeIds', { status: 400 });
  }

  // Use graphQueryWorkflow instead of rag.activities
  const result = await executeWorkflow('graphQueryWorkflow', {
    edgeIds: body.edgeIds,
    question: body.question || 'Explain these rotation events',
    from: body.from,
    to: body.to,
    hops: 1,
  });

  return Response.json({ explanation: result.explanation?.content });
}
```

### 4. Workflow Simplification

**File:** `clusterEnrichment.workflow.ts`

**Current state:** References `chunkFiling` but skips it (line 44-45)

**Action:** Remove chunkFiling reference entirely

```typescript
// Remove this from workflow interface
const activities = proxyActivities<{
  createClusterSummary(input: CreateClusterSummaryInput): Promise<CreateClusterSummaryResult>;
  // chunkFiling(input: { accession: string }): Promise<{ chunksCreated: number }>;  // ← DELETE
}>({...});

export async function clusterEnrichmentWorkflow(input: ClusterEnrichmentInput) {
  await upsertWorkflowSearchAttributes({...});

  const summaryResult = await activities.createClusterSummary({
    clusterId: input.clusterId,
  });

  return {
    summary: summaryResult.summary,
    // filingsChunked: 0,  // ← DELETE (no longer relevant)
  };
}
```

### 5. Test Files to Update/Remove

**Files:**
- `apps/temporal-worker/src/__tests__/rag.test.ts` - Delete entirely
- `apps/temporal-worker/src/__tests__/longcontext.test.ts` - Update to remove embedding references

---

## Documentation Updates

### Update: `ARCHITECTURE.md`

Remove references to vector search, clarify long context approach:

```markdown
## Why No Vector Store?

This system uses **GraphRAG + Long Context** instead of traditional vector store RAG:

1. **Graph algorithms** provide structure (who's connected to whom)
2. **Long context windows** (128K GPT-4, 200K+ GPT-5) handle synthesis
3. **No semantic filtering needed** - modern LLMs are good at finding relevant info in long context

**Benefits:**
- ✅ Simpler architecture (no embedding generation/storage)
- ✅ Lower latency (no vector search overhead)
- ✅ No embedding drift (embeddings don't go stale)
- ✅ Future-proof (scales with LLM context windows)
- ✅ Lower cost (no embedding API calls)

**Trade-off:**
- More input tokens sent to LLM (but manageable with 128K+ windows)
```

### Update: `GRAPHRAG.md`

Remove "Part 2: Long Context Synthesis" references to embeddings:

```markdown
## Part 2: Long Context Synthesis

**No Vector Search:**
This system does NOT use semantic search or embeddings. Instead:

1. Graph algorithms identify relevant edges (connections)
2. Bundle ALL filing text from those edges
3. Send to GPT-4 Turbo (128K context window)
4. LLM extracts relevant information and synthesizes answer

**Rationale:** With 128K+ context windows, semantic pre-filtering is unnecessary overhead.
Modern LLMs are excellent at finding relevant information within large contexts.
```

### Update: `DATA_MODEL.md`

Deprecate filing_chunks.embedding column:

```markdown
### `filing_chunks`

Filing text chunks for long context synthesis.

**Schema:**
```sql
CREATE TABLE filing_chunks (
  accession text REFERENCES filings(accession),
  chunk_no int,
  content text,
  -- embedding vector(1536),  -- DEPRECATED: No longer used
  PRIMARY KEY (accession, chunk_no)
);
```

**Note:** The `embedding` column is deprecated and will be removed in a future release.
The system uses graph structure + long context instead of vector similarity search.
```

### Create: `MIGRATION_GUIDE.md`

Document the architectural decision:

```markdown
# Migration Guide: Vector Store → GraphRAG + Long Context

## Why We Removed Vector Store

**Original approach:** Vector embeddings + semantic search
**New approach:** Graph structure + long context windows

**Reason:** Modern LLMs (GPT-4, GPT-5) have massive context windows (128K+) that can handle
entire document sets without semantic pre-filtering. Vector search adds complexity without
meaningful benefit.

## What Changed

- ❌ Removed: Embedding generation, vector search, semantic filtering
- ✅ Kept: Graph algorithms (Louvain, PageRank, k-hop traversal)
- ✅ Enhanced: Long context synthesis (bundles all relevant text)

## Impact

- **Cost:** Lower (no embedding API calls)
- **Latency:** Similar or better (no vector search overhead)
- **Quality:** Same or better (LLM sees full context)
- **Complexity:** Much lower (removed entire subsystem)
```

---

## Implementation Steps

### Phase 1: Preparation (No Breaking Changes)

1. ✅ Mark embedding column as deprecated
2. ✅ Add warnings to rag.activities.ts functions
3. ✅ Update documentation
4. 🚀 Deploy and monitor

### Phase 2: Remove Dead Code (Breaking API Changes)

1. ❌ Delete rag.activities.ts
2. ❌ Remove /api/explain endpoint (or reimplement)
3. ❌ Remove embedding generation from filing-chunks.activities.ts
4. ❌ Clean up workflow references
5. 🧪 Update tests
6. 🚀 Deploy

### Phase 3: Schema Cleanup (Requires Migration)

1. 🗑️ Drop vector indexes
2. 🗑️ Drop match_filing_chunks function
3. 🗑️ Drop embedding column
4. 🚀 Deploy migration

---

## Rollback Plan

If needed to revert:

1. **Phase 1 rollback:** No-op (nothing removed yet)
2. **Phase 2 rollback:** Restore deleted files from git
3. **Phase 3 rollback:** Restore schema from backup, rerun old migrations

**Recommendation:** Wait 2 releases between Phase 2 and Phase 3 to ensure stability.

---

## Metrics to Monitor

Pre/post cleanup:

| Metric | Before | After | Expected Change |
|--------|--------|-------|-----------------|
| Avg query latency | ~8-12s | ~7-10s | -15% (less overhead) |
| Cost per query | $0.15 | $0.13 | -13% (no embedding calls) |
| Code complexity | High | Low | -30% LOC |
| Storage (DB) | High | Low | -40% (no embeddings) |

---

## Decision Log

**Date:** 2025-11-09
**Decision:** Remove vector store, use GraphRAG + Long Context exclusively
**Rationale:**
- Modern LLMs have sufficient context windows (128K+, growing to millions)
- Vector search adds complexity without meaningful benefit
- Aligns with GPT-5 vision (massive contexts + uploaded documents)
- Simplifies architecture, reduces costs

**Approved By:** [User]
**Status:** Implementation in progress
