# Institutional Rotation Detector

A sophisticated system for detecting and analyzing institutional investor rotation patterns in equity securities using SEC filings data, knowledge graphs, and AI-powered analysis.

## Overview

This project identifies when institutional investors (hedge funds, mutual funds, asset managers) rotate in and out of stock positions by analyzing SEC Form 13F filings, N-PORT data, and beneficial ownership reports. It detects coordinated selling/buying patterns, builds knowledge graphs of institutional flows, and scores rotation events using multiple financial signals.

## Key Features

- **Automated SEC Filing Ingestion**: Downloads and processes 13F, N-PORT, and beneficial ownership filings from EDGAR
- **Rotation Detection**: Identifies institutional dump events and subsequent uptake patterns
- **Multi-Signal Scoring**: Combines multiple indicators (dump magnitude, uptake, ultra-high-frequency trading, options overlay, short interest relief)
- **Knowledge Graph Construction**: Builds relationship graphs showing flows between institutional holders
- **GraphRAG Analysis**: Leverages graph-based retrieval augmented generation for community detection and summarization
- **Event Study Pipeline**: Performs cumulative abnormal return (CAR) analysis on detected rotation events
- **REST API**: Query endpoints for rotation events, graphs, and explanations
- **Temporal.io Orchestration**: Reliable, scalable workflow execution with visibility and error handling

## Architecture

```
┌─────────────────┐
│   REST API      │  ← Query rotation events, graphs, communities
└────────┬────────┘
         │
┌────────▼────────────────────────────────────────┐
│         Temporal Workflows                      │
│  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Ingest       │  │ Analysis                │ │
│  │ - Issuer     │  │ - Rotation Detection    │ │
│  │ - Quarter    │  │ - Event Study           │ │
│  │              │  │ - Graph Build           │ │
│  │              │  │ - Graph Summarize       │ │
│  │              │  │ - Graph Query           │ │
│  └──────────────┘  └─────────────────────────┘ │
└────────┬────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│         Activities (Business Logic)             │
│  - SEC EDGAR Client    - Graph Algorithms       │
│  - FINRA Integration   - OpenAI Analysis        │
│  - Position Tracking   - Scoring Engine         │
│  - Rate Limiting       - Vector Embeddings      │
└────────┬────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│      Supabase / PostgreSQL + pgvector           │
│  - Filings & Positions  - Graph Nodes & Edges   │
│  - Rotation Events      - Community Summaries   │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with pgvector extension
- Temporal.io server (local or cloud)
- Supabase account (or PostgreSQL with compatible API)
- OpenAI API key

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/institutional-rotation-detector.git
cd institutional-rotation-detector

# Install dependencies
cd apps/temporal-worker
npm install

# Set up database (see docs/SETUP.md for details)
psql -d your_database -f db/migrations/001_init.sql
psql -d your_database -f db/migrations/002_indexes.sql
psql -d your_database -f db/migrations/010_graphrag_init.sql
psql -d your_database -f db/migrations/011_graphrag_indexes.sql

# Configure environment variables
cp .env.example .env
# Edit .env with your credentials

# Start Temporal worker
npm run build
node dist/worker.js
```

### Run Your First Analysis

```bash
# Analyze Apple (AAPL) for Q1 2024
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily"

# Query rotation events
curl "http://localhost:3000/api/events?ticker=AAPL"

# Get rotation graph for a period
curl "http://localhost:3000/api/graph?ticker=AAPL&period=2024-01"
```

## Project Structure

```
institutional-rotation-detector/
├── apps/
│   ├── api/              # REST API endpoints
│   └── temporal-worker/  # Temporal workflows and activities
├── db/
│   └── migrations/       # Database schema migrations
├── docs/                 # Detailed documentation
│   ├── SETUP.md          # Installation and configuration guide
│   ├── ARCHITECTURE.md   # System design and patterns
│   ├── WORKFLOWS.md      # Temporal workflow reference
│   └── ...
└── tools/                # Utility scripts
```

## Core Concepts

### Rotation Detection

The system identifies institutional rotation through a multi-step process:

1. **Dump Detection**: Identifies large institutional sell-offs (>5% position reduction)
2. **Uptake Analysis**: Measures subsequent buying by other institutions
3. **Signal Integration**: Combines ultra-high-frequency trading patterns, options overlay, and short interest relief
4. **Scoring**: Generates R-score indicating rotation probability and magnitude
5. **Event Study**: Calculates cumulative abnormal returns (CAR) around rotation events

### Graph Analysis

- **Nodes**: Institutional entities (managers, funds, ETFs), securities, filings
- **Edges**: Position changes between entities and securities
- **Communities**: Detected clusters of coordinated institutional flows
- **Summaries**: AI-generated explanations of community behavior patterns

### Workflows

- `ingestIssuerWorkflow`: Fetches and processes all filings for a ticker across quarters
- `rotationDetectWorkflow`: Analyzes a quarter for rotation signals
- `graphBuildWorkflow`: Constructs knowledge graph from position data
- `graphSummarizeWorkflow`: Generates community summaries using GraphRAG
- `eventStudyWorkflow`: Calculates market impact metrics

## Documentation

- **[Setup Guide](docs/SETUP.md)** - Detailed installation and configuration
- **[Architecture](docs/ARCHITECTURE.md)** - System design and component overview
- **[API Reference](docs/API.md)** - REST endpoint documentation (Phase 2)
- **[Workflows](docs/WORKFLOWS.md)** - Temporal workflow catalog (Phase 2)
- **[Data Model](docs/DATA_MODEL.md)** - Database schema reference (Phase 2)
- **[Development](docs/DEVELOPMENT.md)** - Contributing and development guide (Phase 2)

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Orchestration**: Temporal.io (durable workflow engine)
- **Database**: PostgreSQL with pgvector extension
- **Data Platform**: Supabase
- **AI/ML**: OpenAI GPT-4 for summarization and analysis
- **Graph Algorithms**: Custom PageRank and Louvain implementation
- **Data Sources**: SEC EDGAR API, FINRA

## Use Cases

- **Quantitative Research**: Identify institutional flow patterns as trading signals
- **Risk Management**: Detect coordinated selling before broader market impact
- **Market Microstructure**: Study institutional behavior and coordination
- **Regulatory Analysis**: Track institutional ownership changes and reporting patterns
- **Academic Research**: Dataset for studying institutional herding and rotation

## Contributing

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) (Phase 2) for contributing guidelines.

## License

[Your License Here]

## Support

For questions, issues, or feature requests, please open an issue on GitHub.

---

**Status**: Active Development | **Version**: 1.0.0 | **Last Updated**: 2025-11-08
