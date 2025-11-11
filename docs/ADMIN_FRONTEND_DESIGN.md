# Admin Frontend Design & Implementation Plan

**Next.js 15 Admin Application for Institutional Rotation Detector**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [UI/UX Design](#uiux-design)
- [Feature Breakdown](#feature-breakdown)
- [Component Structure](#component-structure)
- [API Integration](#api-integration)
- [Implementation Plan](#implementation-plan)
- [Tech Stack](#tech-stack)
- [Deployment](#deployment)

---

## Overview

### Purpose

Build a Next.js 15 admin application that provides:

1. **Workflow Launcher** - One-click workflow execution with real-time progress monitoring
2. **Q&A Console** - Interactive graph exploration and analysis with pre-baked questions
3. **Workflow Monitor** - Live console showing workflow execution details
4. **Results Viewer** - Visualize rotation events, graphs, and analysis results

### Key Requirements

- ✅ **Modern UI**: Tailwind CSS with shadcn/ui components
- ✅ **Real-time Updates**: Server-sent events for workflow progress
- ✅ **Type Safety**: Full TypeScript with shared types from Temporal worker
- ✅ **Responsive**: Works on desktop and tablet
- ✅ **Performant**: React Server Components with strategic client components
- ✅ **Developer-friendly**: Easy testing of all workflows and features

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Next.js 15 App                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │              App Router (RSC)                      │ │
│  │  /admin                 - Dashboard                │ │
│  │  /admin/workflows       - Workflow Launcher        │ │
│  │  /admin/qa             - Q&A Console               │ │
│  │  /admin/results        - Results Viewer            │ │
│  │  /admin/monitor        - Live Workflow Monitor     │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │              API Routes (Route Handlers)           │ │
│  │  POST /api/workflows/start    - Start workflow     │ │
│  │  GET  /api/workflows/[id]     - Get workflow state │ │
│  │  GET  /api/workflows/stream   - SSE progress       │ │
│  │  POST /api/qa/explore         - Graph Q&A          │ │
│  │  POST /api/qa/statistical     - Statistical Q&A    │ │
│  │  POST /api/qa/community       - Community Q&A      │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│              Temporal Client                            │
│  - Start workflows                                      │
│  - Query workflow state                                 │
│  - Monitor execution                                    │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│            Temporal Worker                              │
│  - Execute workflows                                    │
│  - Run activities                                       │
│  - Store results in Supabase                            │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Click → Client Component → API Route → Temporal Client → Workflow
                                                                    │
                                                                    ▼
User UI ← SSE Stream ← API Route ← Temporal Query ← Workflow State
                                                                    │
                                                                    ▼
Results View ← API Route ← Supabase ← Activity Results
```

---

## UI/UX Design

### 1. Dashboard (`/admin`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo] Institutional Rotation Detector Admin           │
├─────────────────────────────────────────────────────────┤
│  [Dashboard] [Workflows] [Q&A] [Results] [Monitor]      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Quick Stats                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │   Running   │ │  Completed  │ │   Failed    │       │
│  │      3      │ │     127     │ │      2      │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                          │
│  Recent Workflows                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ● ingestIssuer (AAPL) - Running - 45% complete  │   │
│  │ ✓ graphBuild (MSFT) - Completed - 2 min ago     │   │
│  │ ✗ rotationDetect (TSLA) - Failed - 1 hour ago   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Quick Actions                                           │
│  [Launch Workflow] [Run Q&A] [View Results]             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2. Workflow Launcher (`/admin/workflows`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Workflow Launcher                          [Dashboard] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Workflow Categories                                     │
│                                                          │
│  ┌─ Data Ingestion ────────────────────────────────┐    │
│  │                                                  │    │
│  │  [📥 Ingest Issuer]     [📊 Ingest Quarter]     │    │
│  │  Fetch all filings      Process single quarter  │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─ Graph Analysis ─────────────────────────────────┐   │
│  │                                                   │   │
│  │  [🌐 Build Graph]  [🔍 Summarize]  [💬 Explore]  │   │
│  │  Construct graph   Detect communities  CoT Q&A   │   │
│  │                                                   │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─ Advanced Analytics ─────────────────────────────┐   │
│  │                                                   │   │
│  │  [📈 Event Study]  [🧮 Statistical]  [🔗 Cross]  │   │
│  │  Market impact     E2B Python       Communities  │   │
│  │                                                   │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  Selected: Ingest Issuer                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Ticker:     [AAPL____________]                     │ │
│  │ From:       [2024Q1__________]                     │ │
│  │ To:         [2024Q4__________]                     │ │
│  │ Run Kind:   [daily ▾]                              │ │
│  │ Min Pct:    [5_______________]                     │ │
│  │                                                    │ │
│  │         [Cancel]  [Launch Workflow →]              │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3. Q&A Console (`/admin/qa`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Q&A Console                                [Dashboard] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Pre-Baked Questions              Custom Question       │
│  ┌──────────────────────────┐     ┌──────────────────┐  │
│  │ Graph Exploration        │     │ Ask your own...  │  │
│  │ ────────────────────     │     └──────────────────┘  │
│  │ □ Who's rotating AAPL?   │                            │
│  │ □ Tech sector patterns   │     [Graph Explorer ▾]    │
│  │ □ Vanguard holdings      │                            │
│  │                          │     Ticker: [AAPL_______]  │
│  │ Statistical Analysis     │     From:   [2024-01-01_]  │
│  │ ────────────────────     │     To:     [2024-03-31_]  │
│  │ □ Dump vs CAR corr.      │                            │
│  │ □ Find outliers          │     [Ask Question →]       │
│  │ □ Regression analysis    │                            │
│  │                          │                            │
│  │ Cross-Community          │                            │
│  │ ────────────────────     │                            │
│  │ □ Sector-wide rotations  │                            │
│  │ □ Q1 2024 patterns       │                            │
│  │ □ Coordinated behavior   │                            │
│  └──────────────────────────┘                            │
│                                                          │
│  Console Output                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ > Running: Who's rotating in/out of AAPL Q1 2024? │ │
│  │                                                    │ │
│  │ [Session ID: explore-abc123]                       │ │
│  │                                                    │ │
│  │ Turn 1: Loading graph data... ✓                   │ │
│  │ Turn 2: Analyzing rotation patterns...            │ │
│  │                                                    │ │
│  │ Answer:                                            │ │
│  │ Major institutional sellers in AAPL Q1 2024:       │ │
│  │ • Vanguard Group: -$2.3B (cluster-xyz)             │ │
│  │ • BlackRock: -$1.8B (cluster-abc)                  │ │
│  │ • State Street: -$900M (cluster-def)               │ │
│  │                                                    │ │
│  │ Major buyers:                                      │ │
│  │ • Berkshire Hathaway: +$1.2B (rotation event R=8) │ │
│  │ • Fidelity: +$850M (strong uptake signal)          │ │
│  │                                                    │ │
│  │ Tokens: 12.5K input / 1.2K output / 3.2K reasoning │ │
│  │                                                    │ │
│  │ [View Full Details] [Export JSON]                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 4. Live Monitor (`/admin/monitor`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Workflow Monitor                           [Dashboard] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Active Workflows (3)                [Pause] [Clear]    │
│  ┌────────────────────────────────────────────────────┐ │
│  │ workflow-abc123 - ingestIssuer (AAPL)              │ │
│  │ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ 45% - Processing 2024Q2      │ │
│  │ [View Details ▾]                                   │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ workflow-def456 - graphExplore (Q&A Session)       │ │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% - Generating insights    │ │
│  │ [View Details ▾]                                   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Console Output                            [Auto-scroll]│
│  ┌────────────────────────────────────────────────────┐ │
│  │ 14:23:45 [workflow-abc123] Started                 │ │
│  │ 14:23:46 [workflow-abc123] Activity: resolveCIK    │ │
│  │ 14:23:47 [workflow-abc123] CIK: 0000320193         │ │
│  │ 14:23:48 [workflow-abc123] Child: ingestQuarter Q1 │ │
│  │ 14:24:12 [workflow-abc123] Child: Q1 completed     │ │
│  │ 14:24:13 [workflow-abc123] Child: ingestQuarter Q2 │ │
│  │ 14:24:15 [workflow-def456] Turn 1: Loading data    │ │
│  │ 14:24:18 [workflow-def456] Turn 2: Analyzing...    │ │
│  │ 14:24:45 [workflow-abc123] Activity: fetchFilings  │ │
│  │ 14:24:46 [workflow-abc123] Found 127 filings       │ │
│  │ 14:24:50 [workflow-def456] Turn 3: Final insights  │ │
│  │ 14:24:55 [workflow-def456] ✓ Completed (tokens: 8K)│ │
│  │ 14:25:01 [workflow-abc123] Activity: parse13F      │ │
│  │ 14:25:15 [workflow-abc123] Parsed 2,341 positions  │ │
│  │                                                    │ │
│  │ [Filter by workflow ▾] [Export Logs]               │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 5. Results Viewer (`/admin/results`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Results Viewer                             [Dashboard] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [Rotation Events] [Graphs] [Communities] [Analysis]    │
│                                                          │
│  Filters: Ticker [AAPL ▾]  Period [2024Q1 ▾]  R≥ [5__] │
│                                                          │
│  Rotation Events (23 found)              [Export CSV]   │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Cluster      │ R-Score │ CAR    │ Date      │ AI   │ │
│  ├────────────────────────────────────────────────────┤ │
│  │ cluster-xyz  │   8.2   │ +12.3% │ 2024-03-15│ [📊] │ │
│  │ cluster-abc  │   7.8   │  +9.1% │ 2024-02-22│ [📊] │ │
│  │ cluster-def  │   6.5   │  +7.8% │ 2024-01-30│ [📊] │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Selected Event: cluster-xyz                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ AI Analysis (Anomaly Score: 7.2/10)                │ │
│  │                                                    │ │
│  │ Narrative:                                         │ │
│  │ Coordinated institutional selling detected across  │ │
│  │ multiple large index funds. Vanguard, BlackRock,   │ │
│  │ and State Street reduced positions by 30-40%       │ │
│  │ simultaneously, consistent with Russell rebalance. │ │
│  │                                                    │ │
│  │ Trading Implications:                              │ │
│  │ Strong rotation signal. Subsequent uptake by       │ │
│  │ value-oriented funds suggests rebalancing rather   │ │
│  │ than fundamental concerns. CAR +12.3% confirms.    │ │
│  │                                                    │ │
│  │ Suspicion Flags: [Russell EOW] [High Uptake]       │ │
│  │ Confidence: 0.85                                   │ │
│  │                                                    │ │
│  │ [View Graph] [View Filings] [Export JSON]          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Feature Breakdown

### Feature 1: Workflow Launcher

**User Stories:**
1. As an admin, I want to launch any workflow with one click
2. As an admin, I want form validation before launching
3. As an admin, I want to see workflow parameters clearly
4. As an admin, I want pre-filled examples for quick testing

**Components:**
- `WorkflowCard` - Card for each workflow type with description
- `WorkflowForm` - Dynamic form based on workflow input schema
- `WorkflowPresets` - Pre-filled examples (AAPL, MSFT, etc.)

**Workflows to Support:**

| Workflow | Input Parameters | Example Preset |
|----------|------------------|----------------|
| `ingestIssuer` | ticker, from, to, runKind, minPct | AAPL 2024Q1-Q4 |
| `rotationDetect` | cik, cusips, quarter, ticker | AAPL 2024Q1 |
| `graphBuild` | cik, quarter, ticker | AAPL 2024Q1 |
| `graphSummarize` | cik, quarter, ticker | AAPL 2024Q1 |
| `graphExplore` | questions, periodStart, periodEnd | See Q&A presets |
| `statisticalAnalysis` | analysisType, periodStart, periodEnd | Correlation |
| `crossCommunityAnalysis` | periodStart, periodEnd | Q1 2024 patterns |
| `eventStudy` | anchorDate, cik, ticker | AAPL 2024-03-15 |

### Feature 2: Q&A Console

**Pre-Baked Questions:**

**Graph Exploration (uses `graphExplore` workflow):**
```typescript
const graphQuestions = [
  {
    id: 'aapl-rotation',
    title: "Who's rotating in/out of AAPL Q1 2024?",
    category: 'Graph Exploration',
    workflow: 'graphExplore',
    params: {
      ticker: 'AAPL',
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      hops: 2,
      questions: [
        'What institutions are rotating in and out?',
        'Are these the same institutions that rotated in Q4 2023?',
        'What are the 3 most important insights?',
      ],
    },
  },
  {
    id: 'tech-sector',
    title: 'Tech sector rotation patterns',
    category: 'Graph Exploration',
    workflow: 'graphExplore',
    params: {
      ticker: 'QQQ', // Nasdaq ETF as proxy
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      hops: 2,
      questions: [
        'What tech stocks are seeing institutional rotation?',
        'Which funds are most active in tech rotations?',
        'Any coordination patterns across tech names?',
      ],
    },
  },
  {
    id: 'vanguard-holdings',
    title: "Analyze Vanguard's rotation activity",
    category: 'Graph Exploration',
    workflow: 'graphExplore',
    params: {
      rootNodeId: 'entity:vanguard',
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      hops: 2,
      questions: [
        'What positions did Vanguard rotate in Q1?',
        'Are these rotations consistent with index rebalancing?',
        'Which stocks saw the largest flows?',
      ],
    },
  },
];
```

**Statistical Analysis (uses `statisticalAnalysis` workflow):**
```typescript
const statisticalQuestions = [
  {
    id: 'dump-car-correlation',
    title: 'Dump Z-score vs CAR correlation',
    category: 'Statistical Analysis',
    workflow: 'statisticalAnalysis',
    params: {
      analysisType: 'correlation',
      periodStart: '2023-01-01',
      periodEnd: '2024-12-31',
      variables: ['dumpz', 'car_m5_p20'],
    },
  },
  {
    id: 'outlier-detection',
    title: 'Find outlier rotation events',
    category: 'Statistical Analysis',
    workflow: 'statisticalAnalysis',
    params: {
      analysisType: 'anomaly',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      method: 'isolation_forest',
    },
  },
  {
    id: 'regression-analysis',
    title: 'Regression: Signals → R-score',
    category: 'Statistical Analysis',
    workflow: 'statisticalAnalysis',
    params: {
      analysisType: 'regression',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      dependent: 'r_score',
      independent: ['dumpz', 'u_same', 'uhf_same', 'opt_same'],
    },
  },
];
```

**Cross-Community Analysis (uses `crossCommunityAnalysis` workflow):**
```typescript
const communityQuestions = [
  {
    id: 'sector-wide',
    title: 'Sector-wide rotation patterns Q1 2024',
    category: 'Cross-Community',
    workflow: 'crossCommunityAnalysis',
    params: {
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      minCommunities: 3,
    },
  },
  {
    id: 'q1-patterns',
    title: 'What systemic patterns emerged in Q1 2024?',
    category: 'Cross-Community',
    workflow: 'crossCommunityAnalysis',
    params: {
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
    },
  },
  {
    id: 'coordinated-behavior',
    title: 'Identify coordinated institutional behavior',
    category: 'Cross-Community',
    workflow: 'crossCommunityAnalysis',
    params: {
      periodStart: '2024-01-01',
      periodEnd: '2024-06-30',
      minCommunities: 5,
    },
  },
];
```

**User Flow:**
1. User clicks pre-baked question OR enters custom question
2. App creates workflow with parameters
3. Real-time streaming shows progress (Turn 1, Turn 2, etc.)
4. Results displayed with token usage stats
5. User can export JSON or view full details

### Feature 3: Live Monitor

**Real-Time Updates:**
- Server-Sent Events (SSE) for workflow progress
- WebSocket fallback if needed
- Console auto-scrolls with new events
- Filter by workflow ID or type
- Export logs to file

**Event Types:**
```typescript
type WorkflowEvent =
  | { type: 'started'; workflowId: string; workflowType: string }
  | { type: 'activity'; workflowId: string; activity: string; status: 'started' | 'completed' }
  | { type: 'progress'; workflowId: string; percent: number; message: string }
  | { type: 'child'; workflowId: string; childId: string; childType: string }
  | { type: 'completed'; workflowId: string; result: unknown }
  | { type: 'failed'; workflowId: string; error: string };
```

### Feature 4: Results Viewer

**Tabs:**
1. **Rotation Events** - Paginated table with filtering
2. **Graphs** - Visual graph viewer (future: react-force-graph)
3. **Communities** - Community summaries with PageRank
4. **Analysis Results** - Q&A responses, statistical results

**Export Formats:**
- JSON - Full data export
- CSV - Tabular data for Excel
- Markdown - Formatted reports

---

## Component Structure

### Directory Structure

```
apps/admin/
├── app/
│   ├── (auth)/              # Future: authentication
│   │   └── login/
│   ├── admin/
│   │   ├── layout.tsx       # Admin shell with nav
│   │   ├── page.tsx         # Dashboard
│   │   ├── workflows/
│   │   │   └── page.tsx     # Workflow launcher
│   │   ├── qa/
│   │   │   └── page.tsx     # Q&A console
│   │   ├── monitor/
│   │   │   └── page.tsx     # Live monitor
│   │   └── results/
│   │       └── page.tsx     # Results viewer
│   ├── api/
│   │   ├── workflows/
│   │   │   ├── start/
│   │   │   │   └── route.ts
│   │   │   ├── [id]/
│   │   │   │   └── route.ts
│   │   │   └── stream/
│   │   │       └── route.ts # SSE endpoint
│   │   └── qa/
│   │       ├── explore/
│   │       │   └── route.ts
│   │       ├── statistical/
│   │       │   └── route.ts
│   │       └── community/
│   │           └── route.ts
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Landing page
├── components/
│   ├── ui/                  # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── badge.tsx
│   │   └── ...
│   ├── workflow/
│   │   ├── workflow-card.tsx
│   │   ├── workflow-form.tsx
│   │   ├── workflow-preset.tsx
│   │   └── workflow-progress.tsx
│   ├── qa/
│   │   ├── question-picker.tsx
│   │   ├── qa-console.tsx
│   │   ├── qa-output.tsx
│   │   └── custom-question-form.tsx
│   ├── monitor/
│   │   ├── console-output.tsx
│   │   ├── workflow-list.tsx
│   │   └── event-filter.tsx
│   └── results/
│       ├── rotation-table.tsx
│       ├── event-detail.tsx
│       └── export-button.tsx
├── lib/
│   ├── temporal-client.ts   # Temporal connection
│   ├── supabase-client.ts   # Supabase connection
│   ├── workflow-schemas.ts  # Zod validation
│   ├── qa-presets.ts        # Pre-baked questions
│   └── utils.ts
├── types/
│   └── workflows.ts         # Shared types
└── package.json
```

### Key Components

#### 1. WorkflowCard Component

```tsx
// components/workflow/workflow-card.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WorkflowCardProps {
  id: string;
  title: string;
  description: string;
  category: 'ingestion' | 'graph' | 'analytics';
  icon: React.ReactNode;
  onSelect: () => void;
}

export function WorkflowCard({ id, title, description, category, icon, onSelect }: WorkflowCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={onSelect}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <CardTitle>{title}</CardTitle>
              <Badge variant="secondary" className="mt-1">
                {category}
              </Badge>
            </div>
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full">
          Configure & Launch
        </Button>
      </CardContent>
    </Card>
  );
}
```

#### 2. QAConsole Component

```tsx
// components/qa/qa-console.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface QAConsoleProps {
  onRunQuestion: (questionId: string) => Promise<void>;
}

export function QAConsole({ onRunQuestion }: QAConsoleProps) {
  const [output, setOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async (questionId: string) => {
    setIsRunning(true);
    setOutput(prev => [...prev, `> Running: ${questionId}...`]);

    try {
      await onRunQuestion(questionId);
    } catch (error) {
      setOutput(prev => [...prev, `✗ Error: ${error.message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="p-4">
      <ScrollArea className="h-[500px] font-mono text-sm">
        {output.map((line, i) => (
          <div key={i} className="py-1">
            {line}
          </div>
        ))}
      </ScrollArea>
    </Card>
  );
}
```

#### 3. WorkflowProgress Component (with SSE)

```tsx
// components/workflow/workflow-progress.tsx
'use client';

import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';

interface WorkflowProgressProps {
  workflowId: string;
}

export function WorkflowProgress({ workflowId }: WorkflowProgressProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Running...');
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/workflows/stream?id=${workflowId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'progress') {
        setProgress(data.percent);
        setStatus(data.message);
      }

      setEvents(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.message}`]);
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [workflowId]);

  return (
    <Card className="p-4">
      <div className="mb-4">
        <div className="flex justify-between mb-2">
          <span className="text-sm font-medium">{status}</span>
          <span className="text-sm text-muted-foreground">{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      <div className="bg-slate-950 text-green-400 p-4 rounded-md font-mono text-xs h-[300px] overflow-auto">
        {events.map((event, i) => (
          <div key={i}>{event}</div>
        ))}
      </div>
    </Card>
  );
}
```

---

## API Integration

### 1. Temporal Client Setup

```typescript
// lib/temporal-client.ts
import { Connection, WorkflowClient } from '@temporalio/client';

let cachedClient: WorkflowClient | null = null;

export async function getTemporalClient(): Promise<WorkflowClient> {
  if (cachedClient) return cachedClient;

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  cachedClient = new WorkflowClient({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  return cachedClient;
}
```

### 2. Start Workflow API Route

```typescript
// app/api/workflows/start/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';
import { z } from 'zod';

const startWorkflowSchema = z.object({
  workflowType: z.string(),
  workflowId: z.string().optional(),
  input: z.record(z.any()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowType, workflowId, input } = startWorkflowSchema.parse(body);

    const client = await getTemporalClient();

    const handle = await client.start(workflowType, {
      taskQueue: 'rotation-detector',
      workflowId: workflowId || `${workflowType}-${Date.now()}`,
      args: [input],
    });

    return NextResponse.json({
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });
  } catch (error) {
    console.error('Failed to start workflow:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### 3. Workflow Stream (SSE) API Route

```typescript
// app/api/workflows/stream/route.ts
import { NextRequest } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('id');

  if (!workflowId) {
    return new Response('Missing workflow ID', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const client = await getTemporalClient();
      const handle = client.getHandle(workflowId);

      try {
        // Poll workflow status
        const interval = setInterval(async () => {
          try {
            const description = await handle.describe();

            const event = {
              type: 'progress',
              workflowId,
              status: description.status.name,
              message: `Workflow ${description.status.name}`,
            };

            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
            );

            if (description.status.name === 'COMPLETED' || description.status.name === 'FAILED') {
              clearInterval(interval);
              controller.close();
            }
          } catch (error) {
            controller.error(error);
            clearInterval(interval);
          }
        }, 1000);

        // Cleanup on close
        request.signal.addEventListener('abort', () => {
          clearInterval(interval);
          controller.close();
        });
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 4. Q&A API Routes

```typescript
// app/api/qa/explore/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, periodStart, periodEnd, questions } = body;

    const client = await getTemporalClient();

    const handle = await client.start('graphExploreWorkflow', {
      taskQueue: 'rotation-detector',
      workflowId: `qa-explore-${Date.now()}`,
      args: [{
        ticker,
        periodStart,
        periodEnd,
        questions,
      }],
    });

    // Wait for result (or return workflowId for polling)
    const result = await handle.result();

    return NextResponse.json({
      workflowId: handle.workflowId,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Goals:**
- ✅ Next.js 15 app setup
- ✅ shadcn/ui component library
- ✅ Temporal client integration
- ✅ Basic routing structure

**Tasks:**
1. Initialize Next.js 15 with TypeScript
   ```bash
   npx create-next-app@latest apps/admin --typescript --tailwind --app
   ```
2. Install dependencies
   ```bash
   pnpm add @temporalio/client @supabase/supabase-js zod
   pnpm add -D @types/node
   ```
3. Setup shadcn/ui
   ```bash
   npx shadcn-ui@latest init
   npx shadcn-ui@latest add button card input select badge progress scroll-area
   ```
4. Create directory structure (see above)
5. Setup environment variables
   ```
   TEMPORAL_ADDRESS=localhost:7233
   TEMPORAL_NAMESPACE=default
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   ```
6. Create layout and basic navigation

**Deliverables:**
- Working Next.js app with routing
- Temporal client connection
- Basic UI components

### Phase 2: Workflow Launcher (Week 2)

**Goals:**
- ✅ Workflow card grid
- ✅ Dynamic forms for each workflow
- ✅ Launch workflows via API
- ✅ Basic validation

**Tasks:**
1. Create workflow type definitions
2. Build WorkflowCard component
3. Build WorkflowForm component with Zod schemas
4. Implement `/api/workflows/start` route
5. Create workflow presets
6. Add form validation
7. Test launching each workflow type

**Deliverables:**
- Functional workflow launcher
- All 8+ workflows supported
- Pre-filled examples

### Phase 3: Live Monitor (Week 3)

**Goals:**
- ✅ SSE streaming from Temporal
- ✅ Console output component
- ✅ Real-time progress bars
- ✅ Filter and export logs

**Tasks:**
1. Implement `/api/workflows/stream` SSE route
2. Create WorkflowProgress component with SSE
3. Build ConsoleOutput component
4. Add workflow filtering
5. Implement log export (JSON, TXT)
6. Test with long-running workflows

**Deliverables:**
- Real-time workflow monitoring
- Live console output
- Export functionality

### Phase 4: Q&A Console (Week 4)

**Goals:**
- ✅ Pre-baked questions
- ✅ Custom question form
- ✅ Streaming results display
- ✅ Token usage tracking

**Tasks:**
1. Define all pre-baked questions (see Feature 2)
2. Create QuestionPicker component
3. Build QAConsole component
4. Implement `/api/qa/*` routes
5. Add custom question form
6. Display results with formatting
7. Show token usage stats

**Deliverables:**
- Functional Q&A console
- 9+ pre-baked questions
- Custom question support

### Phase 5: Results Viewer (Week 5)

**Goals:**
- ✅ Rotation events table
- ✅ Event detail view with AI analysis
- ✅ Export capabilities
- ✅ Filtering and pagination

**Tasks:**
1. Create RotationTable component
2. Implement pagination and filtering
3. Build EventDetail component
4. Display AI analysis fields
5. Add export buttons (CSV, JSON, MD)
6. Integrate with Supabase for data fetching

**Deliverables:**
- Results viewer with all tabs
- Export functionality
- AI analysis display

### Phase 6: Dashboard & Polish (Week 6)

**Goals:**
- ✅ Dashboard with stats
- ✅ Recent workflows widget
- ✅ Quick actions
- ✅ Error handling and loading states

**Tasks:**
1. Create dashboard with stats cards
2. Build recent workflows widget
3. Add quick action buttons
4. Implement error boundaries
5. Add loading skeletons
6. Polish UI/UX
7. Add keyboard shortcuts
8. Test edge cases

**Deliverables:**
- Complete dashboard
- Polished UX
- Error handling

---

## Tech Stack

### Core Dependencies

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@temporalio/client": "^1.11.0",
    "@supabase/supabase-js": "^2.39.0",
    "zod": "^3.22.0",
    "date-fns": "^3.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "lucide-react": "^0.344.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

### UI Components (shadcn/ui)

- `button` - Primary actions
- `card` - Content containers
- `input` - Form inputs
- `select` - Dropdowns
- `badge` - Status indicators
- `progress` - Progress bars
- `scroll-area` - Scrollable containers
- `table` - Data tables
- `dialog` - Modals
- `tabs` - Tab navigation
- `toast` - Notifications

### Styling

- **Tailwind CSS** - Utility-first styling
- **CSS Variables** - Theme customization
- **Dark Mode** - Support via `next-themes`

---

## Deployment

### Development

```bash
cd apps/admin
pnpm install
pnpm dev
# Open http://localhost:3000/admin
```

### Production Build

```bash
pnpm build
pnpm start
```

### Environment Variables

```env
# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional: Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret
```

### Deployment Options

1. **Vercel** (Recommended for Next.js)
   ```bash
   vercel deploy
   ```

2. **Docker**
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build
   CMD ["npm", "start"]
   ```

3. **Self-Hosted**
   - PM2 for process management
   - Nginx reverse proxy
   - SSL with Let's Encrypt

---

## Future Enhancements

### Phase 7: Advanced Features

1. **Authentication**
   - NextAuth.js integration
   - Role-based access control
   - Session management

2. **Graph Visualization**
   - react-force-graph integration
   - Interactive node exploration
   - Visual rotation flows

3. **Advanced Monitoring**
   - Workflow metrics dashboard
   - Performance analytics
   - Cost tracking

4. **Scheduled Workflows**
   - Cron-based scheduling
   - Workflow templates
   - Batch operations

5. **Notifications**
   - Email alerts on completion
   - Slack integration
   - Webhook support

6. **Collaboration**
   - Share Q&A sessions
   - Export reports
   - Comments and annotations

---

## Success Metrics

### User Experience
- ✅ Workflows launchable in < 3 clicks
- ✅ Real-time feedback < 1s latency
- ✅ Pre-baked questions execute in < 30s
- ✅ All results exportable

### Technical
- ✅ 100% type safety
- ✅ < 100ms API response times (excluding workflow execution)
- ✅ SSE connections stable for 10+ minutes
- ✅ Zero data loss on workflow failures

### Testing Coverage
- ✅ All workflows tested end-to-end
- ✅ All pre-baked questions validated
- ✅ Error states handled gracefully
- ✅ Loading states prevent duplicate actions

---

## Next Steps

1. **Review this plan** - Confirm scope and priorities
2. **Setup repository** - Initialize Next.js app in `apps/admin/`
3. **Start Phase 1** - Foundation and routing
4. **Iterate** - Build, test, refine each phase
5. **Deploy** - Staging environment for testing

---

**Questions or changes needed? Let's discuss before implementation!**
