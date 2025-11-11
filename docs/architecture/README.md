# Architecture Documentation

System design, data models, and technical architecture.

## Documents

- **[Architecture Overview](ARCHITECTURE.md)** - Complete system design and component architecture
- **[Data Model](DATA_MODEL.md)** - Database schema, tables, and relationships
- **[Workflows](WORKFLOWS.md)** - Temporal workflow reference and patterns
- **[Temporal GPT-5 Workflow Review](TEMPORAL_GPT5_WORKFLOW_REVIEW.md)** - AI-powered workflow implementation
- **[Cadence (Deprecated)](CADENCE.md)** - Historical Cadence documentation (archived)

## Key Concepts

### System Components

- **Temporal Workflows** - Durable workflow orchestration
- **Activities** - Stateless business logic execution
- **PostgreSQL + Supabase** - Data persistence and REST API
- **OpenAI GPT-5** - AI-powered analysis and generation

### Data Flow

1. SEC filings ingested via EDGAR API
2. Positions and ownership tracked in PostgreSQL
3. Rotation detection via Temporal workflows
4. Knowledge graphs built and analyzed
5. Results exposed via REST API

---

[← Back to Documentation Index](../index.md)
