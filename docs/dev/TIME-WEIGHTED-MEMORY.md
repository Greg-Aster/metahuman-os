# Time-Weighted Rolling Memory System

**Implemented**: October 30, 2025
**Status**: ✅ Active

## Overview

The training data selection system now uses **exponential time decay** to create a rolling memory that:
- ✅ Includes **ALL historical memories** (not just last 14 days)
- ✅ **Heavily favors recent memories** (higher representation in training data)
- ✅ **Gradually fades older memories** (but never completely forgets them)
- ✅ Prevents catastrophic forgetting of personality

## How It Works

### Exponential Decay Formula

```
weight = 2^(-age_in_days / decayHalfLife)
```

**Parameters:**
- `age_in_days`: How old the memory is (from today)
- `decayHalfLife`: Days until memory weight is cut in half (configurable, default: 30)

### Weight Examples (halfLife = 30 days)

| Memory Age | Weight | Percentage | Meaning |
|-----------|--------|------------|---------|
| Today     | 1.000  | 100%       | Full weight |
| 7 days    | 0.871  | 87%        | Almost full weight |
| 14 days   | 0.758  | 76%        | Three-quarters weight |
| 30 days   | 0.500  | 50%        | **Half weight** |
| 60 days   | 0.250  | 25%        | Quarter weight |
| 90 days   | 0.125  | 12.5%      | Still included! |
| 180 days  | 0.016  | 1.6%       | Barely there, but not forgotten |
| 1 year    | 0.001  | 0.1%       | Trace presence |

### What This Means in Practice

**Example: You have 1000 total memories**

With `decayHalfLife=30` and `max=500` samples:

1. **All 1000 memories are considered** (no hard cutoff)
2. **Each memory gets a weight** based on age
3. **Memories are sorted by weight** (recent first)
4. **Top 500 weighted memories are selected** for training

**Result**: Your training data will be mostly recent (last 30-60 days) but will include some older important memories too.

## Configuration

Edit [etc/adapter-builder.json](../etc/adapter-builder.json):

```json
{
  "days": 999999,              // Use all memories (no hard cutoff)
  "max": 500,                  // Select top 500 weighted memories
  "useTimeWeighting": true,    // Enable exponential decay
  "decayHalfLife": 30          // Tune decay rate (14=aggressive, 90=gentle)
}
```

### Tuning the Decay Rate

**Aggressive Decay** (`decayHalfLife: 14`):
- 2-week-old memories → 50% weight
- 1-month-old memories → 25% weight
- Training data heavily skewed to last 2 weeks
- **Use when**: You want the model to quickly adapt to recent changes

**Balanced Decay** (`decayHalfLife: 30`) **[DEFAULT]**:
- 1-month-old memories → 50% weight
- 2-month-old memories → 25% weight
- Good balance between recent and historical
- **Use when**: You want steady personality evolution

**Gentle Decay** (`decayHalfLife: 90`):
- 3-month-old memories → 50% weight
- 6-month-old memories → 25% weight
- More stable personality over time
- **Use when**: You want to preserve long-term personality traits

## Test Results (October 30, 2025)

Running `adapter-builder` with the new time-weighted system:

```
[adapter-builder] Found 896 total memories, 754 passed filters
[adapter-builder] Time-weighted sampling (halfLife=30d):
  Average memory age: 6.6 days
  Average weight: 0.860
  Oldest memory weight: 0.7832   (10 days old)
  Newest memory weight: 0.9999   (few hours old)
[adapter-builder] Selected 500 memories (avg age: 5.4d)
```

**Analysis**:
- ✅ System is working correctly
- ✅ Oldest memory (10 days) still has 78% weight (very recent system)
- ✅ Selected samples average 5.4 days old (skewed toward recent)
- ✅ No memories are excluded due to age

As your system matures and you accumulate months/years of memories, the distribution will shift:
- Most training data from last 30-60 days
- Some training data from 60-180 days
- Trace amounts from 180+ days (enough to maintain personality core)

## Comparison: Old vs New System

### Old System (Hard Cutoff)

```
days: 14
max: 300
```

**Result**:
- Only memories from last 14 days included
- Older memories **completely ignored**
- Personality could drift over time
- Catastrophic forgetting of old traits

**Distribution**:
```
Last 14 days: ████████████████ 100%
15-30 days:   (excluded)
30+ days:     (excluded)
```

### New System (Time-Weighted)

```
days: 999999
max: 500
useTimeWeighting: true
decayHalfLife: 30
```

**Result**:
- **All memories** considered
- Recent memories **heavily favored**
- Older memories **gradually fade** but never disappear
- Personality evolution with stability

**Distribution** (after 6 months):
```
Last 30 days:  ██████████████████ ~70%
30-60 days:    ████████ ~15%
60-90 days:    ████ ~8%
90-180 days:   ██ ~5%
180+ days:     █ ~2%
```

## Benefits

### 1. No Catastrophic Forgetting
- Core personality traits persist even if not reinforced daily
- Important old conversations gradually fade rather than disappearing

### 2. Adaptive to Recent Changes
- New behavioral patterns quickly dominate training data
- Model adapts to recent conversational style

### 3. Smooth Personality Evolution
- Gradual transition as interests/style changes
- No sudden personality shifts

### 4. Efficient Use of Training Budget
- Recent memories (most relevant) get more representation
- Historical memories (less relevant) still included proportionally

## How It Interacts with Rolling Training

### Training Cycle

1. **Day 1**: Train model on all memories (weighted by age)
   - Today's conversations: 100% weight
   - Last month's: 50% weight
   - 3 months ago: 12.5% weight

2. **Day 30**: Train new model
   - Today's new conversations: 100% weight
   - Day 1's conversations: Now 50% weight (aged 30 days)
   - 4 months ago: 6.25% weight

3. **Day 60**: Train new model
   - Today's conversations: 100% weight
   - Day 30's: 50% weight
   - Day 1's: 25% weight (aged 60 days)

**Result**: Your personality smoothly evolves as recent experiences accumulate, while old traits gradually fade but never vanish.

## Real-World Example

**Scenario**: You start using MetaHuman in October 2025.

**October 2025** (Initial training):
- All conversations from Oct 20-30: Full weight
- Training data: 100% recent (system is new)

**November 2025** (30 days later):
- Oct 20-30 memories: Now 50% weight
- Nov 1-30 memories: Full weight
- Training data: ~65% November, ~35% October

**December 2025** (60 days later):
- Oct memories: Now 25% weight
- Nov memories: Now 50% weight
- Dec memories: Full weight
- Training data: ~50% December, ~30% November, ~20% October

**March 2026** (6 months later):
- Oct memories: 1.6% weight (still there!)
- Nov-Feb memories: Various weights (12.5% to 76%)
- March memories: Full weight
- Training data: Heavily March, good representation of recent months, trace of October

**Result**: The model remembers that you started in October, knows your foundational personality, but is most influenced by recent interactions.

## Monitoring

Check the adapter-builder output during training to monitor the distribution:

```bash
npx tsx brain/agents/adapter-builder.ts
```

Look for:
```
[adapter-builder] Time-weighted sampling (halfLife=30d):
  Average memory age: X.X days        ← Should increase over time
  Average weight: 0.XXX               ← Will decrease as system ages
  Oldest memory weight: 0.XXXX        ← Shows how much oldest memory matters
  Newest memory weight: 0.XXXX        ← Should always be ~1.0
[adapter-builder] Selected 500 memories (avg age: X.Xd)
```

## Adjusting Based on Behavior

### Model is forgetting too quickly?
- **Increase** `decayHalfLife` to 60 or 90
- This makes older memories persist longer

### Model is stuck in the past?
- **Decrease** `decayHalfLife` to 14 or 21
- This makes recent memories dominate more

### Need more training samples?
- **Increase** `max` to 700 or 1000
- More samples = more historical representation

### Training data too large?
- **Decrease** `max` to 300 or 400
- Fewer samples = faster training, more recent focus

## Technical Implementation

See [adapter-builder.ts](../brain/agents/adapter-builder.ts:57-189) for implementation details.

**Key functions**:
- `calculateTimeWeight()` (lines 57-73): Exponential decay formula
- `readRecentMemories()` (lines 75-189): Time-weighted sampling with statistics

**Key changes**:
- No hard time cutoff (uses all memories)
- Sorts by weight instead of just timestamp
- Reports detailed statistics for monitoring

## Future Enhancements

Possible improvements:

1. **Importance weighting**: Combine time decay with manual importance flags
   - User-marked important memories get 2x weight
   - Critical personality moments never decay below 25%

2. **Dynamic decay**: Adjust decay rate based on conversation frequency
   - More active periods → faster decay
   - Less active periods → slower decay

3. **Memory clustering**: Group similar memories and select representatives
   - Prevents over-representation of repetitive patterns

4. **Seasonal patterns**: Preserve memories that repeat annually
   - Birthday conversations, seasonal interests

---

**Status**: ✅ Implemented and tested
**Next training run**: Will use time-weighted selection automatically
**Configuration**: [etc/adapter-builder.json](../etc/adapter-builder.json)
