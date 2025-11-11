# Features & Algorithms

Core features, detection algorithms, and analysis methodologies.

## Core Features

- **[Rotation Detection](ROTATION_DETECTION.md)** - Institutional rotation detection algorithm and methodology
- **[Scoring System](SCORING.md)** - Multi-signal scoring combining dump, uptake, UHF, options, and short interest
- **[GraphRAG](GRAPHRAG.md)** - Graph-based retrieval augmented generation with AI
- **[Microstructure Analysis](MICROSTRUCTURE.md)** - Real-time market microstructure layer (1-3 day lag)

## Algorithm Overview

### Rotation Detection Pipeline

1. **Dump Detection** - Identify large institutional sell-offs (≥30% position reduction)
2. **Uptake Analysis** - Measure subsequent buying by other institutions
3. **Signal Integration** - Combine UHF trading patterns, options overlay, short interest
4. **Scoring** - Generate R-score indicating rotation probability
5. **Event Study** - Calculate cumulative abnormal returns (CAR)

### Scoring Components

- **dumpZ**: Z-score of position reduction magnitude
- **uSame**: Uptake ratio in same quarter
- **uNext**: Uptake ratio in next quarter
- **uhfSame**: Ultra-high-frequency trading overlay (same quarter)
- **uhfNext**: Ultra-high-frequency trading overlay (next quarter)
- **optSame**: Options flow overlay (same quarter)
- **optNext**: Options flow overlay (next quarter)
- **shortReliefV2**: Short interest relief signal
- **indexPenalty**: Penalty for index rebalance windows

---

[← Back to Documentation Index](../index.md)
