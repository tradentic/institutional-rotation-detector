# Operations & Deployment

Production deployment guides and operational documentation.

## Deployment

- **[Deployment Guide](DEPLOYMENT.md)** - Complete production deployment guide

### Deployment Options

#### Cloud Providers
- **AWS ECS Fargate** - Recommended for production
- **Google Cloud Run** - Serverless container deployment
- **Azure Container Instances** - Azure-native deployment

#### Orchestration
- **Kubernetes** - Self-managed or managed (EKS, GKE, AKS)
- **Docker Compose** - Local or small-scale deployments

### Infrastructure Requirements

#### Temporal
- **Temporal Cloud** - Managed service (recommended)
- **Self-Hosted Temporal** - On-premises or cloud VMs

#### Database
- **Supabase Cloud** - Managed PostgreSQL with REST API
- **Self-Hosted PostgreSQL** - Requires pgvector extension

#### Dependencies
- **OpenAI API** - GPT-5 access required
- **SEC EDGAR** - No authentication, respect rate limits
- **UnusualWhales API** - API key required for options data

## Operational Considerations

### Monitoring
- Temporal UI for workflow visibility
- PostgreSQL query performance
- API rate limit tracking
- Error rate monitoring

### Scaling
- Temporal workers: Horizontal scaling based on workflow load
- Database: Connection pooling and read replicas
- API: Load balancing and caching

### Backup & Recovery
- Database backups (automated via Supabase or manual)
- Temporal workflow state (persisted in Temporal cluster)
- Configuration management (environment variables)

---

[← Back to Documentation Index](../index.md)
