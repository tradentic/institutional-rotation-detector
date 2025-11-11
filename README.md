# Institutional Rotation Detector

A sophisticated system for detecting and analyzing institutional investor rotation patterns in equity securities using SEC filings data, knowledge graphs, and AI-powered analysis.

## Overview

This project identifies when institutional investors (hedge funds, mutual funds, asset managers) rotate in and out of stock positions by analyzing SEC filings (13F, N-PORT, Form 4, beneficial ownership), options flow data, and market microstructure signals. It detects coordinated selling/buying patterns, builds knowledge graphs of institutional flows, and scores rotation events using multiple financial signals including insider transactions and options activity.

## Key Features

- **Automated SEC Filing Ingestion**: Downloads and processes 13F, N-PORT, beneficial ownership, and Form 4 filings from EDGAR
- **🆕 Form 4 Insider Transactions**: Tracks insider buying/selling with 2-day reporting lag (vs 45-day 13F) for rotation validation and early signals
- **🆕 Options Flow Analysis**: Real-time options activity tracking via UnusualWhales API for predictive rotation signals (unusual activity, put/call ratios, IV skew)
- **Rotation Detection**: Identifies institutional dump events and subsequent uptake patterns
- **Multi-Signal Scoring**: Combines multiple indicators (dump magnitude, uptake, ultra-high-frequency trading, options overlay, short interest relief, insider activity)
- **Real-Time Microstructure Layer**: Detects institutional flows 1-3 days after occurrence (vs 45-day 13F lag) using ATS/dark pool data, VPIN toxicity metrics, and broker-dealer attribution
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
│  - FINRA Integration   - GPT-5 Analysis (CoT)   │
│  - Position Tracking   - Scoring Engine         │
│  - Rate Limiting       - E2B Code Execution     │
└────────┬────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│      Supabase / PostgreSQL + pgvector           │
│  - Filings & Positions  - Graph Nodes & Edges   │
│  - Rotation Events      - Community Summaries   │
└─────────────────────────────────────────────────┘
```

## Quick Start

**🚀 New to the project? Start here: [QUICK_START.md](QUICK_START.md)**

### Local Development (Recommended)

For a complete local development environment with Supabase and Temporal running locally:

```bash
# 1. Clone repository
git clone https://github.com/yourusername/institutional-rotation-detector.git
cd institutional-rotation-detector

# 2. Install CLIs
brew install supabase/tap/supabase temporal

# 3. Start Supabase (Terminal 1)
supabase start

# 4. Start Temporal (Terminal 2)
temporal server start-dev

# 5. Setup & Start Worker (Terminal 3)
./tools/setup-temporal-attributes.sh

# Sync environment variables automatically
./tools/sync-supabase-env.sh   # Extracts Supabase credentials
./tools/sync-temporal-env.sh   # Configures Temporal settings
./tools/sync-api-env.sh        # Syncs API config

cd apps/temporal-worker
nano .env.local
# Add: OPENAI_API_KEY and SEC_USER_AGENT
# (Supabase and Temporal config already synced!)

pnpm install && pnpm run build
node dist/worker.js
```

**See [QUICK_START.md](QUICK_START.md) for step-by-step instructions and troubleshooting.**
**See [Local Development Guide](docs/LOCAL_DEVELOPMENT.md) for advanced configuration.**

### Cloud Deployment

For production deployment with Supabase Cloud and Temporal Cloud:

**Prerequisites:**
- Supabase Cloud account
- Temporal Cloud account (or self-hosted Temporal)
- OpenAI API key
- Cloud provider account (AWS/GCP/Azure)

```bash
# Clone repository
git clone https://github.com/yourusername/institutional-rotation-detector.git
cd institutional-rotation-detector

# Configure for cloud (see docs/SETUP.md and docs/DEPLOYMENT.md)
cp .env.example apps/temporal-worker/.env
# Edit .env with cloud credentials

# Deploy worker (see docs/DEPLOYMENT.md for options)
# - AWS ECS Fargate
# - Google Cloud Run
# - Kubernetes
```

**See [Setup Guide](docs/SETUP.md) and [Deployment Guide](docs/DEPLOYMENT.md) for details.**

### Run Your First Analysis

```bash
# Start a workflow via Temporal CLI
temporal workflow start \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{"ticker":"AAPL","from":"2024Q1","to":"2024Q1","runKind":"daily"}'

# Or via API (if API server is running)
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily"

# Query rotation events
curl "http://localhost:3000/api/events?ticker=AAPL"

# Get rotation graph
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

1. **Dump Detection**: Identifies large institutional sell-offs (≥30% position reduction or ≥1.0% of float) with robust z-score analysis
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

### Getting Started
- **[Local Development](docs/LOCAL_DEVELOPMENT.md)** - Complete local setup with Supabase and Temporal
- **[Setup Guide](docs/SETUP.md)** - Production installation and configuration
- **[Quick Start Examples](docs/WORKFLOWS.md#running-workflows)** - Run your first workflows

### System Documentation
- **[Architecture](docs/ARCHITECTURE.md)** - System design and component overview
- **[Workflows](docs/WORKFLOWS.md)** - Temporal workflow reference and patterns
- **[API Reference](docs/API.md)** - REST endpoint documentation
- **[Data Model](docs/DATA_MODEL.md)** - Database schema and relationships

### Domain Knowledge
- **[Rotation Detection](docs/ROTATION_DETECTION.md)** - Algorithm and methodology
- **[Microstructure Layer](docs/MICROSTRUCTURE.md)** - Real-time flow detection with VPIN and broker attribution ([Technical Spec](docs/spec/MICROSTRUCTURE_TECHNICAL.md))
- **[GraphRAG](docs/GRAPHRAG.md)** - Graph-based analysis and AI synthesis
- **[Data Sources](docs/DATA_SOURCES.md)** - SEC EDGAR, UnusualWhales, FINRA, IEX, ETF integrations
- **[UnusualWhales API Analysis](docs/unusualwhales-api-analysis.md)** - Comprehensive options flow endpoint analysis

### Operations
- **[Deployment](docs/DEPLOYMENT.md)** - Production deployment guide
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Development](docs/DEVELOPMENT.md)** - Contributing and development guide

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Orchestration**: Temporal.io (durable workflow engine)
- **Database**: PostgreSQL with pgvector extension
- **Data Platform**: Supabase
- **AI/ML**: OpenAI GPT-5 (Responses API) with Chain of Thought and E2B code execution
- **Graph Algorithms**: Custom PageRank and Louvain implementation
- **Data Sources**: SEC EDGAR API, UnusualWhales API, FINRA OTC, IEX Exchange

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
