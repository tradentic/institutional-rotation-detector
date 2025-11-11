export default function MonitorPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Live Monitor</h2>
        <p className="text-muted-foreground">
          Real-time workflow execution monitoring and console output
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Live monitor with SSE coming in Phase 3
        </p>
      </div>
    </div>
  )
}
