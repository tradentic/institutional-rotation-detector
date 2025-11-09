# Documentation Index

Quick reference for navigating the Institutional Rotation Detector documentation.

## 📚 Documentation Structure

### User-Facing Guides (`docs/*.md`)
Practical guides for using and deploying the system.

### Technical Specifications (`docs/spec/*.md`)
Detailed algorithms, formulas, and implementation notes.

---

## Getting Started

| Document | Purpose | Audience |
|----------|---------|----------|
| [Local Development](LOCAL_DEVELOPMENT.md) | Complete local setup guide | Developers |
| [Setup Guide](SETUP.md) | Production installation | DevOps |
| [Workflows](WORKFLOWS.md#running-workflows) | Quick start examples | Everyone |

---

## Core Concepts

### Rotation Detection
- **[Rotation Detection Guide](ROTATION_DETECTION.md)** - Overview and methodology
- **[Scoring Specification](spec/rotation_score_v_5.md)** - Technical details of scoreV4_1

### Microstructure Layer 🆕
- **[Microstructure Guide](MICROSTRUCTURE.md)** - Real-time flow detection
  - Quick start
  - Usage examples
  - Database schema
  - API reference
- **[Technical Specification](spec/MICROSTRUCTURE_TECHNICAL.md)** - Detailed algorithms
  - Broker-dealer mapping
  - VPIN (toxicity)
  - Kyle's lambda (price impact)
  - Lee-Ready classification
  - Academic references

### Graph Analysis
- **[GraphRAG Guide](GRAPHRAG.md)** - Knowledge graph construction and AI synthesis

---

## System Documentation

| Document | Content |
|----------|---------|
| [Architecture](ARCHITECTURE.md) | System design and components |
| [Workflows](WORKFLOWS.md) | Temporal workflow reference |
| [API Reference](API.md) | REST endpoint documentation |
| [Data Model](DATA_MODEL.md) | Database schema |
| [Data Sources](DATA_SOURCES.md) | SEC EDGAR, FINRA, ETF integrations |

---

## Operations

| Document | Purpose |
|----------|---------|
| [Deployment](DEPLOYMENT.md) | Production deployment guide |
| [Troubleshooting](TROUBLESHOOTING.md) | Common issues and solutions |
| [Development](DEVELOPMENT.md) | Contributing guidelines |

---

## Finding Information

### "How do I...?"

**Set up locally?**
→ [Local Development](LOCAL_DEVELOPMENT.md)

**Deploy to production?**
→ [Setup Guide](SETUP.md) + [Deployment](DEPLOYMENT.md)

**Run my first workflow?**
→ [Workflows - Running Workflows](WORKFLOWS.md#running-workflows)

**Query rotation events?**
→ [API Reference](API.md)

**Use the microstructure layer?**
→ [Microstructure Guide](MICROSTRUCTURE.md)

**Understand VPIN calculation?**
→ [Microstructure Technical Spec](spec/MICROSTRUCTURE_TECHNICAL.md#vpin-volume-synchronized-pin)

**Understand the scoring algorithm?**
→ [Rotation Detection](ROTATION_DETECTION.md) + [Scoring Spec](spec/rotation_score_v_5.md)

**Build knowledge graphs?**
→ [GraphRAG Guide](GRAPHRAG.md)

**Troubleshoot errors?**
→ [Troubleshooting](TROUBLESHOOTING.md)

---

## Documentation Patterns

### User Guides
- **Location:** `docs/*.md`
- **Style:** Practical, example-driven
- **Audience:** Users, developers, operators
- **Length:** Concise (300-500 lines)

### Technical Specifications
- **Location:** `docs/spec/*.md`
- **Style:** Detailed, mathematical, comprehensive
- **Audience:** Researchers, ML engineers, advanced developers
- **Length:** Comprehensive (500-1000 lines)

### Examples

**User Guide Pattern:**
```markdown
# Feature Name

Quick overview.

## Quick Start
[Step-by-step instructions]

## Usage Examples
[Code examples with output]

## API Reference
[Function signatures and params]

## Common Queries
[SQL/TypeScript examples]
```

**Technical Spec Pattern:**
```markdown
# Feature - Technical Specification

## Algorithm Details
[Formulas, pseudocode]

## Implementation Notes
[Edge cases, optimizations]

## Academic References
[Papers, citations]

## Validation Methodology
[Testing, backtesting]
```

---

## Contributing Documentation

When adding new features:

1. **Create user guide:** `docs/FEATURE.md`
   - Focus on practical usage
   - Include quick start and examples
   - Keep it concise (300-500 lines)

2. **Create technical spec:** `docs/spec/FEATURE_TECHNICAL.md`
   - Document algorithms and formulas
   - Include academic references
   - Comprehensive (500-1000 lines)

3. **Update main README:**
   - Add to "Key Features" section
   - Link from appropriate documentation category

4. **Update this index:**
   - Add to relevant section
   - Include in "Finding Information"

---

## External Resources

- **Temporal.io Docs:** https://docs.temporal.io/
- **Supabase Docs:** https://supabase.com/docs
- **SEC EDGAR:** https://www.sec.gov/edgar/searchedgar/companysearch.html
- **FINRA OTC Transparency:** https://www.finra.org/filing-reporting/trf/ats-transparency

---

Last updated: 2024-11-09
