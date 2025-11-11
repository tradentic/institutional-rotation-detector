/**
 * Pre-baked Q&A Questions
 *
 * Curated questions for testing graph discovery and Q&A functionality.
 * Covers different query types and complexity levels.
 */

export interface QAPreset {
  id: string;
  name: string;
  category: 'basic' | 'graph-exploration' | 'statistical' | 'cross-community' | 'temporal';
  description: string;
  questions: string[];
  ticker?: string; // Optional ticker context
  icon: string;
  estimatedDuration: string;
}

export const QA_PRESETS: QAPreset[] = [
  // Basic Graph Exploration
  {
    id: 'aapl-rotations',
    name: 'AAPL Institutional Rotations',
    category: 'graph-exploration',
    description: 'Explore institutional holder movements in Apple stock',
    icon: '🍎',
    ticker: 'AAPL',
    estimatedDuration: '30-45s',
    questions: [
      'Which institutions increased their positions in AAPL the most?',
      'Which institutions exited their AAPL positions?',
      'What are the most notable rotation patterns in AAPL?',
    ],
  },
  {
    id: 'msft-holders',
    name: 'MSFT Major Holders',
    category: 'graph-exploration',
    description: 'Analyze top institutional holders of Microsoft',
    icon: '🪟',
    ticker: 'MSFT',
    estimatedDuration: '30-45s',
    questions: [
      'Who are the top 10 institutional holders of MSFT?',
      'Which institutions have been consistently holding MSFT?',
      'Are there any new large institutional positions in MSFT?',
    ],
  },
  {
    id: 'tsla-volatility',
    name: 'TSLA Holder Volatility',
    category: 'graph-exploration',
    description: 'Investigate volatile institutional activity in Tesla',
    icon: '⚡',
    ticker: 'TSLA',
    estimatedDuration: '30-45s',
    questions: [
      'Which institutions have been most active in trading TSLA?',
      'What was the biggest single position change in TSLA?',
      'How volatile has institutional ownership been in TSLA?',
    ],
  },

  // Cross-Community Analysis
  {
    id: 'tech-sector-patterns',
    name: 'Tech Sector Rotation Patterns',
    category: 'cross-community',
    description: 'Identify patterns across tech stocks (AAPL, MSFT, GOOGL)',
    icon: '💻',
    estimatedDuration: '60-90s',
    questions: [
      'Which institutions are rotating between tech stocks?',
      'Are there coordinated buying or selling patterns across AAPL, MSFT, and GOOGL?',
      'Which institutions prefer specific tech companies over others?',
    ],
  },
  {
    id: 'growth-vs-value',
    name: 'Growth vs Value Rotations',
    category: 'cross-community',
    description: 'Analyze institutional shifts between growth and value stocks',
    icon: '⚖️',
    estimatedDuration: '60-90s',
    questions: [
      'Which institutions are rotating from growth to value stocks?',
      'Which institutions are increasing growth stock exposure?',
      'What patterns exist in sector rotation strategies?',
    ],
  },

  // Statistical Analysis
  {
    id: 'correlation-analysis',
    name: 'Position Correlation Analysis',
    category: 'statistical',
    description: 'Statistical correlation between institutional positions',
    icon: '📊',
    estimatedDuration: '45-60s',
    questions: [
      'Which institutions have highly correlated position changes?',
      'Are there any anomalous correlation patterns?',
      'Which institutions move independently from the herd?',
    ],
  },
  {
    id: 'outlier-detection',
    name: 'Outlier Position Changes',
    category: 'statistical',
    description: 'Identify unusual position changes statistically',
    icon: '🎯',
    estimatedDuration: '45-60s',
    questions: [
      'What are the statistical outliers in position changes?',
      'Which institutions made unusually large moves?',
      'Are there any suspicious trading patterns?',
    ],
  },

  // Temporal Analysis
  {
    id: 'quarterly-trends',
    name: 'Quarterly Trend Analysis',
    category: 'temporal',
    description: 'Analyze trends across quarters',
    icon: '📈',
    estimatedDuration: '60-90s',
    questions: [
      'How have institutional positions evolved quarter over quarter?',
      'Which quarters showed the most institutional activity?',
      'What are the emerging trends in institutional holdings?',
    ],
  },
  {
    id: 'seasonal-patterns',
    name: 'Seasonal Rotation Patterns',
    category: 'temporal',
    description: 'Identify seasonal patterns in institutional behavior',
    icon: '🍂',
    estimatedDuration: '60-90s',
    questions: [
      'Are there seasonal patterns in institutional buying or selling?',
      'Which quarters typically see the most rotation activity?',
      'Do institutions rebalance at specific times of year?',
    ],
  },

  // Basic Graph Discovery
  {
    id: 'graph-structure',
    name: 'Graph Structure Overview',
    category: 'basic',
    description: 'Understand the overall graph structure',
    icon: '🔍',
    estimatedDuration: '20-30s',
    questions: [
      'How many institutions and issuers are in the graph?',
      'What is the density of the institutional ownership network?',
      'What are the most connected nodes in the graph?',
    ],
  },
  {
    id: 'community-detection',
    name: 'Community Detection',
    category: 'graph-exploration',
    description: 'Identify communities in the ownership graph',
    icon: '🏘️',
    estimatedDuration: '45-60s',
    questions: [
      'What communities exist in the institutional ownership network?',
      'Which institutions cluster together based on their holdings?',
      'Are there distinct investment style communities?',
    ],
  },

  // Advanced Queries
  {
    id: 'smart-money',
    name: 'Smart Money Tracking',
    category: 'graph-exploration',
    description: 'Track historically successful institutional investors',
    icon: '🧠',
    estimatedDuration: '60-90s',
    questions: [
      'Which institutions have the best historical performance indicators?',
      'What are the top performers buying or selling now?',
      'Are there consensus positions among top performers?',
    ],
  },
  {
    id: 'risk-indicators',
    name: 'Risk Indicator Analysis',
    category: 'statistical',
    description: 'Analyze risk indicators in institutional positions',
    icon: '⚠️',
    estimatedDuration: '60-90s',
    questions: [
      'Which positions show elevated concentration risk?',
      'Are there crowded trades that could pose systemic risk?',
      'Which institutions have the most diversified portfolios?',
    ],
  },

  // Real-world Use Cases
  {
    id: 'earnings-positioning',
    name: 'Pre-Earnings Positioning',
    category: 'temporal',
    description: 'Analyze institutional positioning before earnings',
    icon: '📅',
    estimatedDuration: '45-60s',
    questions: [
      'How do institutions position ahead of earnings reports?',
      'Which institutions increase exposure before earnings?',
      'Are there patterns in pre-earnings rotation activity?',
    ],
  },
  {
    id: 'market-stress',
    name: 'Market Stress Behavior',
    category: 'temporal',
    description: 'Study institutional behavior during market stress',
    icon: '🌊',
    estimatedDuration: '60-90s',
    questions: [
      'How do institutions behave during market downturns?',
      'Which institutions are contrarian buyers during stress?',
      'What are the flight-to-quality patterns?',
    ],
  },

  // Quick Tests
  {
    id: 'simple-lookup',
    name: 'Simple Institution Lookup',
    category: 'basic',
    description: 'Quick lookup of specific institution holdings',
    icon: '🔎',
    estimatedDuration: '15-20s',
    questions: [
      'What stocks does BlackRock hold?',
      'What is Vanguard\'s largest position?',
    ],
  },
];

// Category metadata
export const QA_CATEGORIES = [
  {
    id: 'basic' as const,
    label: 'Basic Discovery',
    description: 'Simple graph queries and lookups',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    id: 'graph-exploration' as const,
    label: 'Graph Exploration',
    description: 'Deep dives into network structure',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  {
    id: 'statistical' as const,
    label: 'Statistical Analysis',
    description: 'Quantitative analysis and outlier detection',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
  },
  {
    id: 'cross-community' as const,
    label: 'Cross-Community',
    description: 'Multi-issuer pattern analysis',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
  {
    id: 'temporal' as const,
    label: 'Temporal Analysis',
    description: 'Time-series and trend analysis',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
] as const;

// Helper to get category info
export function getCategoryInfo(category: QAPreset['category']) {
  return QA_CATEGORIES.find((c) => c.id === category) || QA_CATEGORIES[0];
}

// Helper to filter presets by category
export function getPresetsByCategory(category?: QAPreset['category']) {
  if (!category) return QA_PRESETS;
  return QA_PRESETS.filter((preset) => preset.category === category);
}
