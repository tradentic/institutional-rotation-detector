# Deployment Guide

Production deployment guide for the Institutional Rotation Detector.

## Table of Contents

- [Overview](#overview)
- [Architecture Options](#architecture-options)
- [Prerequisites](#prerequisites)
- [Supabase Cloud Setup](#supabase-cloud-setup)
- [Temporal Cloud Setup](#temporal-cloud-setup)
- [Worker Deployment](#worker-deployment)
- [API Deployment](#api-deployment)
- [Monitoring](#monitoring)
- [Security](#security)
- [Scaling](#scaling)
- [Maintenance](#maintenance)

## Overview

This guide covers deploying the Institutional Rotation Detector to production environments. The recommended approach uses managed services for reliability and scalability.

**Recommended Stack:**
- **Database**: Supabase Cloud (managed PostgreSQL + pgvector)
- **Orchestration**: Temporal Cloud
- **Worker**: Docker containers on AWS ECS, Google Cloud Run, or Kubernetes
- **API**: Serverless functions (Vercel, Netlify) or containerized (ECS, Cloud Run)

---

## Architecture Options

### Option 1: Fully Managed (Recommended)

**Components:**
- Supabase Cloud (database)
- Temporal Cloud (orchestration)
- AWS ECS Fargate (worker)
- Vercel (API)

**Pros:**
- Minimal operational overhead
- Auto-scaling
- High availability
- Managed backups

**Cons:**
- Higher cost
- Vendor lock-in

**Monthly Cost Estimate:** $200-500 (depending on usage)

---

### Option 2: Self-Hosted

**Components:**
- Self-hosted PostgreSQL with pgvector
- Self-hosted Temporal server
- Kubernetes cluster for workers
- Docker Swarm or Kubernetes for API

**Pros:**
- Lower cost at scale
- Full control
- No vendor lock-in

**Cons:**
- Higher operational complexity
- Requires DevOps expertise
- Manual scaling and backups

**Monthly Cost Estimate:** $100-300 (compute only)

---

### Option 3: Hybrid

**Components:**
- Supabase Cloud (database)
- Self-hosted Temporal server
- Cloud provider compute (workers)
- Serverless API

**Pros:**
- Balanced cost and complexity
- Leverage managed database
- Control over orchestration

**Cons:**
- Some operational overhead
- Partial vendor lock-in

---

## Prerequisites

### Accounts

- [ ] Supabase account (https://supabase.com)
- [ ] Temporal Cloud account (https://temporal.io/cloud) OR Temporal server setup
- [ ] Cloud provider account (AWS, GCP, or Azure)
- [ ] Domain name (optional, for custom URLs)
- [ ] OpenAI API account

### Tools

```bash
# Supabase CLI
brew install supabase/tap/supabase

# Temporal CLI
brew install temporal

# Docker
brew install --cask docker

# Cloud provider CLI (choose one)
brew install awscli       # AWS
brew install google-cloud-sdk  # GCP
brew install azure-cli    # Azure

# Kubernetes (optional)
brew install kubectl
brew install helm
```

---

## Supabase Cloud Setup

### 1. Create Project

1. Go to https://app.supabase.com
2. Click "New Project"
3. Choose organization
4. Enter project details:
   - **Name**: institutional-rotation-detector
   - **Database Password**: Generate strong password (save securely)
   - **Region**: Choose closest to your users
   - **Pricing Plan**: Pro ($25/month minimum)

### 2. Enable pgvector Extension

```sql
-- In Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Apply Migrations

**Method 1: Using Supabase CLI**

```bash
# Link local project to cloud
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push
```

**Method 2: Using SQL Editor**

Copy and run each migration file in order:
1. `db/migrations/001_init.sql`
2. `db/migrations/002_indexes.sql`
3. `db/migrations/010_graphrag_init.sql`
4. `db/migrations/011_graphrag_indexes.sql`

### 4. Configure Connection Pooling

1. Navigate to Database → Connection Pooling
2. Enable **Transaction Mode**
3. Set pool size: **20** (adjust based on worker count)
4. Note the pooler connection string

### 5. Get Credentials

Navigate to Project Settings → API:

```bash
# Project URL
SUPABASE_URL=https://your-project.supabase.co

# Public anon key
SUPABASE_ANON_KEY=eyJhbG...

# Secret service_role key (DO NOT commit to git)
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# Database connection string
DATABASE_URL=postgresql://postgres.your-project:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

### 6. Configure Backups

1. Navigate to Database → Backups
2. Enable **Point-in-Time Recovery** (PITR)
3. Configure backup retention (7-30 days)

---

## Temporal Cloud Setup

### 1. Create Account

1. Go to https://temporal.io/cloud
2. Sign up for cloud account
3. Complete verification

### 2. Create Namespace

1. In Temporal Cloud console, click "Create Namespace"
2. Enter details:
   - **Namespace**: rotation-detector-prod
   - **Region**: Choose closest to workers
   - **Retention**: 30 days
3. Generate certificates:
   - Download client certificate
   - Download client key
   - Save CA certificate

### 3. Configure Workers

**Download Certificates:**

```bash
# Create directory for certs
mkdir -p ~/.temporal/certs

# Download from Temporal Cloud console
# Or use Temporal Cloud CLI:
temporal cloud namespace certificates download \
  --namespace rotation-detector-prod \
  --output-dir ~/.temporal/certs
```

**Environment Variables:**

```bash
TEMPORAL_NAMESPACE=rotation-detector-prod
TEMPORAL_ADDRESS=rotation-detector-prod.tmprl.cloud:7233
TEMPORAL_CLIENT_CERT_PATH=~/.temporal/certs/client.crt
TEMPORAL_CLIENT_KEY_PATH=~/.temporal/certs/client.key
```

### 4. Create Search Attributes

```bash
temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name Ticker --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name CIK --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name FilerCIK --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name Form --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name Accession --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name PeriodEnd --type Datetime

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name WindowKey --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name BatchId --type Keyword

temporal operator search-attribute create \
  --namespace rotation-detector-prod \
  --name RunKind --type Keyword
```

---

## Worker Deployment

### Option 1: AWS ECS Fargate (Recommended)

**1. Build Docker Image**

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY apps/temporal-worker/package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source
COPY apps/temporal-worker/dist ./dist

# Set environment
ENV NODE_ENV=production

# Run worker
CMD ["node", "dist/worker.js"]
```

Build and push:

```bash
# Build
docker build -t rotation-detector-worker:latest .

# Tag for ECR
docker tag rotation-detector-worker:latest \
  123456789.dkr.ecr.us-west-2.amazonaws.com/rotation-detector-worker:latest

# Login to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin \
  123456789.dkr.ecr.us-west-2.amazonaws.com

# Push
docker push 123456789.dkr.ecr.us-west-2.amazonaws.com/rotation-detector-worker:latest
```

**2. Create ECS Task Definition**

```json
{
  "family": "rotation-detector-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "123456789.dkr.ecr.us-west-2.amazonaws.com/rotation-detector-worker:latest",
      "essential": true,
      "environment": [
        {
          "name": "TEMPORAL_NAMESPACE",
          "value": "rotation-detector-prod"
        },
        {
          "name": "TEMPORAL_ADDRESS",
          "value": "rotation-detector-prod.tmprl.cloud:7233"
        }
      ],
      "secrets": [
        {
          "name": "SUPABASE_SERVICE_ROLE_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:123456789:secret:supabase-key"
        },
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:123456789:secret:openai-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/rotation-detector-worker",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "worker"
        }
      }
    }
  ]
}
```

**3. Create ECS Service**

```bash
aws ecs create-service \
  --cluster rotation-detector \
  --service-name worker \
  --task-definition rotation-detector-worker:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

**4. Configure Auto-Scaling**

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/rotation-detector/worker \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/rotation-detector/worker \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

`scaling-policy.json`:
```json
{
  "TargetValue": 70.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
  },
  "ScaleOutCooldown": 300,
  "ScaleInCooldown": 300
}
```

---

### Option 2: Google Cloud Run

**1. Build and Deploy**

```bash
# Build
gcloud builds submit --tag gcr.io/your-project/rotation-detector-worker

# Deploy
gcloud run deploy rotation-detector-worker \
  --image gcr.io/your-project/rotation-detector-worker \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 4Gi \
  --cpu 2 \
  --set-env-vars TEMPORAL_NAMESPACE=rotation-detector-prod \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest \
  --set-secrets OPENAI_API_KEY=openai-key:latest \
  --no-allow-unauthenticated
```

---

### Option 3: Kubernetes

**1. Create Deployment**

`k8s/worker-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rotation-detector-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: rotation-detector-worker
  template:
    metadata:
      labels:
        app: rotation-detector-worker
    spec:
      containers:
      - name: worker
        image: your-registry/rotation-detector-worker:latest
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        env:
        - name: TEMPORAL_NAMESPACE
          value: "rotation-detector-prod"
        - name: TEMPORAL_ADDRESS
          value: "rotation-detector-prod.tmprl.cloud:7233"
        envFrom:
        - secretRef:
            name: rotation-detector-secrets
---
apiVersion: v1
kind: Secret
metadata:
  name: rotation-detector-secrets
type: Opaque
stringData:
  SUPABASE_SERVICE_ROLE_KEY: "your-key"
  OPENAI_API_KEY: "your-key"
  SEC_USER_AGENT: "YourCompany contact@yourcompany.com"
```

**2. Apply**

```bash
kubectl apply -f k8s/worker-deployment.yaml
```

**3. Configure HPA**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: rotation-detector-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: rotation-detector-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

## API Deployment

### Option 1: Vercel (Serverless)

**1. Install Vercel CLI**

```bash
npm install -g vercel
```

**2. Configure `vercel.json`**

```json
{
  "functions": {
    "apps/api/routes/**/*.ts": {
      "runtime": "vercel-node@20.x",
      "maxDuration": 60
    }
  },
  "env": {
    "SUPABASE_URL": "@supabase-url",
    "SUPABASE_ANON_KEY": "@supabase-anon-key",
    "TEMPORAL_NAMESPACE": "@temporal-namespace",
    "TEMPORAL_ADDRESS": "@temporal-address"
  }
}
```

**3. Deploy**

```bash
vercel --prod
```

---

### Option 2: AWS Lambda + API Gateway

**1. Package Functions**

```bash
# Install dependencies
cd apps/api
npm install

# Create deployment package
zip -r api.zip .
```

**2. Create Lambda Function**

```bash
aws lambda create-function \
  --function-name rotation-detector-api \
  --runtime nodejs20.x \
  --handler routes/run.post.handler \
  --zip-file fileb://api.zip \
  --role arn:aws:iam::123456789:role/lambda-execution \
  --environment Variables={SUPABASE_URL=https://your-project.supabase.co,...}
```

**3. Create API Gateway**

```bash
# Create REST API
aws apigateway create-rest-api --name rotation-detector-api

# Configure routes and integrations
# ...
```

---

## Monitoring

### Application Monitoring

**CloudWatch (AWS)**

```bash
# Create log groups
aws logs create-log-group --log-group-name /ecs/rotation-detector-worker
aws logs create-log-group --log-group-name /lambda/rotation-detector-api

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name worker-high-cpu \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold
```

**Datadog Integration**

```yaml
# In ECS task definition
{
  "name": "datadog-agent",
  "image": "public.ecr.aws/datadog/agent:latest",
  "environment": [
    {
      "name": "DD_API_KEY",
      "value": "your-dd-api-key"
    },
    {
      "name": "DD_SITE",
      "value": "datadoghq.com"
    }
  ]
}
```

### Temporal Monitoring

**Temporal Cloud Console:**
- Navigate to Metrics tab
- View workflow success rate
- Monitor activity duration
- Set up alerts

**Custom Metrics:**

```typescript
import { Context } from '@temporalio/activity';

export async function myActivity() {
  const startTime = Date.now();

  try {
    // Do work
    const result = await doWork();

    // Log metric
    const duration = Date.now() - startTime;
    Context.current().log.info('Activity completed', {
      duration,
      success: true,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    Context.current().log.error('Activity failed', {
      duration,
      error: error.message,
    });
    throw error;
  }
}
```

### Database Monitoring

**Supabase:**
- Navigate to Database → Metrics
- Monitor query performance
- Check connection pool usage
- Set up alerting

**Custom Queries:**

```sql
-- Slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Security

### Secrets Management

**AWS Secrets Manager:**

```bash
# Store secrets
aws secretsmanager create-secret \
  --name supabase-service-role-key \
  --secret-string "your-key"

aws secretsmanager create-secret \
  --name openai-api-key \
  --secret-string "your-key"

# Reference in ECS task definition (see above)
```

**Environment Variables:**

```bash
# ✅ Good: Use secrets manager
OPENAI_API_KEY=arn:aws:secretsmanager:...

# ❌ Bad: Hardcoded
OPENAI_API_KEY=sk-abc123...
```

### Network Security

**VPC Configuration:**

```bash
# Create private subnet for workers
aws ec2 create-subnet \
  --vpc-id vpc-xxx \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-west-2a

# Create security group
aws ec2 create-security-group \
  --group-name rotation-detector-worker \
  --description "Security group for workers" \
  --vpc-id vpc-xxx

# Allow only necessary outbound traffic
aws ec2 authorize-security-group-egress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

### API Security

**Rate Limiting:**

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later.',
});

app.use('/api/', limiter);
```

**Authentication (Optional):**

```typescript
import jwt from 'jsonwebtoken';

function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use('/api/', authenticate);
```

---

## Scaling

### Worker Scaling

**Metrics to Monitor:**
- Task queue lag (Temporal)
- CPU utilization
- Memory usage
- Workflow execution time

**Auto-Scaling Triggers:**
- Scale out if queue lag > 100 tasks
- Scale out if CPU > 70%
- Scale in if CPU < 30% for 10 minutes

**Manual Scaling:**

```bash
# AWS ECS
aws ecs update-service \
  --cluster rotation-detector \
  --service worker \
  --desired-count 5

# Kubernetes
kubectl scale deployment rotation-detector-worker --replicas=5
```

### Database Scaling

**Supabase:**
- Upgrade to larger instance size
- Enable read replicas
- Optimize indexes

**Connection Pooling:**

```typescript
// Use connection pooler for high concurrency
DATABASE_URL=postgresql://postgres.your-project:[PASSWORD]@pooler.supabase.com:5432/postgres
```

---

## Maintenance

### Backups

**Supabase Automated Backups:**
- Daily backups (retained 7 days on Pro plan)
- Point-in-Time Recovery (PITR)

**Manual Backups:**

```bash
# Export database
pg_dump postgresql://postgres:password@host:5432/db > backup.sql

# Restore
psql postgresql://postgres:password@host:5432/db < backup.sql
```

### Updates

**Worker Updates:**

```bash
# Build new image
docker build -t rotation-detector-worker:v1.2.0 .

# Push to registry
docker push your-registry/rotation-detector-worker:v1.2.0

# Update ECS task definition
aws ecs register-task-definition --cli-input-json file://task-def-v1.2.0.json

# Update service (rolling update)
aws ecs update-service \
  --cluster rotation-detector \
  --service worker \
  --task-definition rotation-detector-worker:2
```

**Database Migrations:**

```bash
# Test migration on staging
supabase db push --db-url postgresql://staging...

# Apply to production
supabase db push --db-url postgresql://production...
```

### Monitoring Costs

**AWS Cost Explorer:**
- Monitor ECS costs
- Track RDS/Supabase costs
- Set billing alarms

**Optimization:**
- Use spot instances for non-critical workers
- Right-size containers
- Review CloudWatch log retention

---

## Related Documentation

- [Setup Guide](SETUP.md) - Initial setup
- [Local Development](LOCAL_DEVELOPMENT.md) - Dev environment
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues
- [Architecture](ARCHITECTURE.md) - System design

---

For questions or issues, see [main README](../README.md#support).
