/**
 * Results Data Types and Utilities
 *
 * Types and helper functions for working with rotation detection results.
 */

// Rotation event from the database
export interface RotationEvent {
  id: string;
  ticker: string;
  institution: string;
  quarter: string;
  rotationType: 'entry' | 'exit' | 'increase' | 'decrease';
  previousShares: number;
  currentShares: number;
  shareChange: number;
  percentChange: number;
  previousValue: number; // in USD
  currentValue: number; // in USD
  valueChange: number; // in USD
  detectedAt: Date;
}

// AI analysis results
export interface AIAnalysis {
  id: string;
  eventId: string;
  anomalyScore: number; // 0-100
  narrative: string;
  tradingImplications: string[];
  confidenceScore: number; // 0-1
  reasoningTokens: number;
  generatedAt: Date;
}

// Results summary
export interface ResultsSummary {
  totalEvents: number;
  totalInstitutions: number;
  totalIssuers: number;
  entryCount: number;
  exitCount: number;
  increaseCount: number;
  decreaseCount: number;
  averageAnomalyScore: number;
  quarters: string[];
}

// Filter options
export interface ResultsFilter {
  ticker?: string;
  institution?: string;
  quarter?: string;
  rotationType?: RotationEvent['rotationType'] | 'all';
  minAnomalyScore?: number;
  minPercentChange?: number;
  sortBy?: 'date' | 'percentChange' | 'valueChange' | 'anomalyScore';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

// Paginated results
export interface PaginatedResults {
  events: RotationEvent[];
  analyses: Map<string, AIAnalysis>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Export formats
export type ExportFormat = 'csv' | 'json' | 'markdown';

// Helper functions

export function getRotationTypeColor(type: RotationEvent['rotationType']): string {
  switch (type) {
    case 'entry':
      return 'text-green-600 bg-green-50 border-green-200';
    case 'exit':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'increase':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'decrease':
      return 'text-orange-600 bg-orange-50 border-orange-200';
  }
}

export function getRotationTypeIcon(type: RotationEvent['rotationType']): string {
  switch (type) {
    case 'entry':
      return '📥';
    case 'exit':
      return '📤';
    case 'increase':
      return '📈';
    case 'decrease':
      return '📉';
  }
}

export function getRotationTypeLabel(type: RotationEvent['rotationType']): string {
  switch (type) {
    case 'entry':
      return 'Entry';
    case 'exit':
      return 'Exit';
    case 'increase':
      return 'Increase';
    case 'decrease':
      return 'Decrease';
  }
}

export function formatShares(shares: number): string {
  if (shares >= 1_000_000) {
    return `${(shares / 1_000_000).toFixed(2)}M`;
  } else if (shares >= 1_000) {
    return `${(shares / 1_000).toFixed(2)}K`;
  }
  return shares.toLocaleString();
}

export function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  } else if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatPercentChange(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

export function getAnomalyScoreColor(score: number): string {
  if (score >= 80) return 'text-red-600 bg-red-50 border-red-200';
  if (score >= 60) return 'text-orange-600 bg-orange-50 border-orange-200';
  if (score >= 40) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return 'text-green-600 bg-green-50 border-green-200';
}

export function getAnomalyScoreLabel(score: number): string {
  if (score >= 80) return 'Very High';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

// Export to CSV
export function exportToCSV(events: RotationEvent[], analyses: Map<string, AIAnalysis>): string {
  const headers = [
    'ID',
    'Ticker',
    'Institution',
    'Quarter',
    'Type',
    'Previous Shares',
    'Current Shares',
    'Share Change',
    'Percent Change',
    'Previous Value',
    'Current Value',
    'Value Change',
    'Anomaly Score',
    'Detected At',
  ];

  const rows = events.map((event) => {
    const analysis = analyses.get(event.id);
    return [
      event.id,
      event.ticker,
      event.institution,
      event.quarter,
      event.rotationType,
      event.previousShares,
      event.currentShares,
      event.shareChange,
      event.percentChange,
      event.previousValue,
      event.currentValue,
      event.valueChange,
      analysis?.anomalyScore || '',
      event.detectedAt.toISOString(),
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

// Export to JSON
export function exportToJSON(events: RotationEvent[], analyses: Map<string, AIAnalysis>): string {
  const data = events.map((event) => ({
    ...event,
    analysis: analyses.get(event.id),
  }));

  return JSON.stringify(data, null, 2);
}

// Export to Markdown
export function exportToMarkdown(
  events: RotationEvent[],
  analyses: Map<string, AIAnalysis>
): string {
  let markdown = '# Institutional Rotation Detection Results\n\n';
  markdown += `Generated: ${new Date().toISOString()}\n\n`;
  markdown += `Total Events: ${events.length}\n\n`;

  markdown += '---\n\n';

  events.forEach((event, index) => {
    const analysis = analyses.get(event.id);

    markdown += `## ${index + 1}. ${event.institution} - ${event.ticker}\n\n`;

    markdown += '### Event Details\n\n';
    markdown += `- **Type**: ${getRotationTypeIcon(event.rotationType)} ${getRotationTypeLabel(event.rotationType)}\n`;
    markdown += `- **Quarter**: ${event.quarter}\n`;
    markdown += `- **Share Change**: ${formatShares(event.previousShares)} → ${formatShares(event.currentShares)} (${formatPercentChange(event.percentChange)})\n`;
    markdown += `- **Value Change**: ${formatCurrency(event.previousValue)} → ${formatCurrency(event.currentValue)} (${formatCurrency(event.valueChange)})\n`;
    markdown += `- **Detected**: ${event.detectedAt.toLocaleDateString()}\n\n`;

    if (analysis) {
      markdown += '### AI Analysis\n\n';
      markdown += `- **Anomaly Score**: ${analysis.anomalyScore}/100 (${getAnomalyScoreLabel(analysis.anomalyScore)})\n`;
      markdown += `- **Confidence**: ${(analysis.confidenceScore * 100).toFixed(0)}%\n\n`;

      markdown += '**Narrative:**\n\n';
      markdown += `${analysis.narrative}\n\n`;

      markdown += '**Trading Implications:**\n\n';
      analysis.tradingImplications.forEach((implication) => {
        markdown += `- ${implication}\n`;
      });
      markdown += '\n';
    }

    markdown += '---\n\n';
  });

  return markdown;
}

// Download helper
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export based on format
export function exportResults(
  events: RotationEvent[],
  analyses: Map<string, AIAnalysis>,
  format: ExportFormat
) {
  const timestamp = new Date().toISOString().split('T')[0];
  let content: string;
  let filename: string;
  let mimeType: string;

  switch (format) {
    case 'csv':
      content = exportToCSV(events, analyses);
      filename = `rotation-results-${timestamp}.csv`;
      mimeType = 'text/csv';
      break;
    case 'json':
      content = exportToJSON(events, analyses);
      filename = `rotation-results-${timestamp}.json`;
      mimeType = 'application/json';
      break;
    case 'markdown':
      content = exportToMarkdown(events, analyses);
      filename = `rotation-results-${timestamp}.md`;
      mimeType = 'text/markdown';
      break;
  }

  downloadFile(content, filename, mimeType);
}
