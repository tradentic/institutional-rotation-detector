# Admin Frontend

Next.js 15 admin application for the Institutional Rotation Detector.

## Features

- **Dashboard**: Overview of workflow execution status and quick actions
- **Workflow Launcher**: One-click workflow execution with dynamic forms (Phase 2)
- **Q&A Console**: Interactive graph exploration with pre-baked questions (Phase 4)
- **Live Monitor**: Real-time workflow monitoring with SSE (Phase 3)
- **Results Viewer**: Browse rotation events and analysis results (Phase 5)

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)
- Running Temporal server
- Running Supabase instance

### Installation

```bash
cd apps/admin
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Build

```bash
pnpm build
pnpm start
```

## Project Structure

```
apps/admin/
├── app/                    # Next.js App Router
│   ├── admin/             # Admin pages
│   │   ├── layout.tsx     # Admin shell with navigation
│   │   ├── page.tsx       # Dashboard
│   │   ├── workflows/     # Workflow launcher (Phase 2)
│   │   ├── qa/            # Q&A console (Phase 4)
│   │   ├── monitor/       # Live monitor (Phase 3)
│   │   └── results/       # Results viewer (Phase 5)
│   ├── api/               # API routes
│   │   ├── workflows/     # Workflow operations
│   │   └── qa/            # Q&A operations
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Landing page
│   └── globals.css        # Global styles
├── components/
│   ├── ui/                # shadcn/ui components
│   ├── workflow/          # Workflow components
│   ├── qa/                # Q&A components
│   ├── monitor/           # Monitor components
│   └── results/           # Results components
├── lib/
│   ├── temporal-client.ts # Temporal integration
│   ├── supabase-client.ts # Supabase integration
│   └── utils.ts           # Utility functions
└── types/                 # TypeScript types
```

## Implementation Phases

- ✅ **Phase 1 (Week 1)**: Foundation, routing, basic UI
- 🚧 **Phase 2 (Week 2)**: Workflow launcher
- 🚧 **Phase 3 (Week 3)**: Live monitor with SSE
- 🚧 **Phase 4 (Week 4)**: Q&A console
- 🚧 **Phase 5 (Week 5)**: Results viewer
- 🚧 **Phase 6 (Week 6)**: Dashboard polish

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Tailwind CSS + shadcn/ui
- **TypeScript**: Full type safety
- **Temporal**: Workflow orchestration
- **Supabase**: Database client
- **Validation**: Zod schemas

## Documentation

See [ADMIN_FRONTEND_DESIGN.md](../../docs/ADMIN_FRONTEND_DESIGN.md) for the complete design and implementation plan.
