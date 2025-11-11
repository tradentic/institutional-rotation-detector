---
id: index
title: Documentation
slug: /
sidebar_position: 1
---

# Institutional Rotation Detector Documentation

Welcome to the Institutional Rotation Detector documentation. This system detects and analyzes institutional investor rotation patterns in equity securities using SEC filings data, knowledge graphs, and AI-powered analysis.

## 🚀 Getting Started

New to the project? Start here:

- **[Quick Start](../QUICK_START.md)** - Get up and running in 10 steps
- **[Setup Guide](guides/SETUP.md)** - Complete installation and configuration
- **[Local Development](guides/LOCAL_DEVELOPMENT.md)** - Setting up your development environment
- **[Troubleshooting](guides/TROUBLESHOOTING.md)** - Common issues and solutions

## 📚 Documentation Sections

### Guides

Step-by-step guides for getting started and developing:

- [Setup Guide](guides/SETUP.md) - Installation and configuration
- [Local Development](guides/LOCAL_DEVELOPMENT.md) - Local development environment setup
- [Development Guide](guides/DEVELOPMENT.md) - Contributing and development workflow
- [Troubleshooting](guides/TROUBLESHOOTING.md) - Common issues and solutions

### Architecture

System design and technical architecture:

- [Architecture Overview](architecture/ARCHITECTURE.md) - System design and components
- [Data Model](architecture/DATA_MODEL.md) - Database schema and relationships
- [Workflows](architecture/WORKFLOWS.md) - Temporal workflow reference
- [Temporal GPT-5 Workflow Review](architecture/TEMPORAL_GPT5_WORKFLOW_REVIEW.md) - AI-powered workflow patterns
- [Cadence (Deprecated)](architecture/CADENCE.md) - Historical Cadence documentation

### Features

Core features and algorithms:

- [Rotation Detection](features/ROTATION_DETECTION.md) - Institutional rotation detection algorithm
- [Scoring System](features/SCORING.md) - Multi-signal scoring methodology
- [GraphRAG](features/GRAPHRAG.md) - Graph-based retrieval augmented generation
- [Microstructure Analysis](features/MICROSTRUCTURE.md) - Real-time market microstructure layer

### Data & APIs

Data sources and API documentation:

- [Data Sources](data/DATA_SOURCES.md) - SEC EDGAR, UnusualWhales, FINRA, IEX integrations
- [REST API Reference](data/API.md) - HTTP API endpoints
- [UnusualWhales API Analysis](data/unusualwhales-api-analysis.md) - Options flow data analysis
- [UnusualWhales Endpoint Scoring](data/unusualwhales-endpoint-groups-scoring.md) - API endpoint evaluation
- API Specifications: [Bundled](data/uw-api-bundled.yaml) | [Full](data/uw-api.yaml)

### Operations

Deployment and operational guides:

- [Deployment Guide](operations/DEPLOYMENT.md) - Production deployment (AWS, GCP, Kubernetes)

### Technical Specifications

Detailed technical specifications and audits:

- [Rotation Score v5](specs/rotation_score_v_5.md) - Latest scoring algorithm specification
- [Rotation Score v5 Audit](specs/AUDIT_rotation_score_v_5.md) - Algorithm validation and testing
- [v5 Implementation Changes](specs/IMPLEMENTATION_v5_changes.md) - Version 5 change log
- [Microstructure Technical Spec](specs/MICROSTRUCTURE_TECHNICAL.md) - Detailed microstructure implementation
- [Coding Agent Prompt](specs/coding_agent_prompt_v_1.md) - AI agent guidelines
- [Requirements Verification](specs/requirements-verification.md) - Feature requirement tracking

### Internal Documentation

Internal guides and historical documents (for maintainers):

- [Architecture Cleanup Plan](internal/ARCHITECTURE_CLEANUP_PLAN.md) - Refactoring roadmap
- [Coding Agent Guidelines](internal/CODING_AGENT_GUIDELINES.md) - AI coding assistant usage
- [Chain of Thought Workflows](internal/COT_WORKFLOWS_GUIDE.md) - CoT workflow patterns
- [Custom Tools Guide](internal/CUSTOM_TOOLS_GUIDE.md) - Custom tool development
- [E2B Usage Guide](internal/E2B_USAGE_GUIDE.md) - E2B code execution sandbox
- [GPT-5 Implementation Plan](internal/GPT5_IMPLEMENTATION_PLAN.md) - GPT-5 migration planning
- [GPT-5 Migration Guide](internal/GPT5_MIGRATION_GUIDE.md) - GPT-5 upgrade instructions
- [Shared Library Usage](internal/SHARED_LIBRARY_USAGE.md) - Monorepo library guidelines
- [Vector Store Removal](internal/VECTOR_STORE_REMOVAL_SUMMARY.md) - Vector storage deprecation
- [Old Documentation Index](internal/DOCUMENTATION_INDEX.md) - Previous index (archived)

## 🏗️ Project Overview

### Key Features

- **Automated SEC Filing Ingestion** - 13F, N-PORT, beneficial ownership, Form 4
- **Rotation Detection** - Identifies institutional dump events and uptake patterns
- **Multi-Signal Scoring** - Combines dump magnitude, uptake, UHF trading, options, short interest
- **Real-Time Microstructure** - Detects flows 1-3 days after occurrence using ATS/dark pool data
- **Knowledge Graph Construction** - Builds relationship graphs of institutional flows
- **GraphRAG Analysis** - AI-powered community detection and summarization
- **Event Study Pipeline** - Cumulative abnormal return (CAR) analysis
- **REST API** - Query endpoints for rotation events, graphs, and explanations

### Technology Stack

- **Runtime**: Node.js with TypeScript
- **Orchestration**: Temporal.io (durable workflow engine)
- **Database**: PostgreSQL with pgvector extension
- **Data Platform**: Supabase
- **AI/ML**: OpenAI GPT-5 (Responses API) with Chain of Thought
- **Graph Algorithms**: Custom PageRank and Louvain implementation
- **Data Sources**: SEC EDGAR, UnusualWhales, FINRA OTC, IEX Exchange

## 📖 Quick Links

- [Main README](../README.md) - Project overview
- [Quick Start](../QUICK_START.md) - 10-step setup guide
- [GitHub Repository](https://github.com/yourusername/institutional-rotation-detector)

## 🆘 Getting Help

- **Documentation Issues**: Open an issue on GitHub
- **Questions**: Use GitHub Discussions
- **Temporal Support**: https://temporal.io/slack

---

**Last Updated**: 2025-11-11 | **Version**: 1.0.0
