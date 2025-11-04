# Training Data Quality Analysis

**Date**: October 30, 2025
**Dataset**: `/home/greggles/metahuman/metahuman-runs/2025-10-30/unsloth_dataset.jsonl`
**Total Samples**: 216

## Executive Summary

⚠️ **CRITICAL ISSUES FOUND**: The current training data has significant quality problems that will harm model performance:

1. **89% duplicate data** (193/216 samples are exact duplicates of 5 self-profile examples)
2. **Massive variation in output quality** (some outputs are 5000+ words, others are 1-2 words)
3. **Very limited diversity** (only 3 types: self_profile, reflection, inner_dialogue)
4. **Imbalanced distribution** (90% reflections, only 9% self-profile, 1% inner dialogue)

> **2025-11-02 Update:** The chat capture pipeline now strips hidden `<think>` reasoning before writing memories, and `adapter-builder` sanitizes each pair (word limits, chain-of-thought removal). Regenerate your dataset (`./bin/mh adapter-builder` or rerun a full cycle) to benefit from these safeguards—the legacy JSONL files in `metahuman-runs/` still contain the older, verbose samples until you rebuild.

## Detailed Analysis

### 1. Data Distribution

```
Type              Count    Percentage
-----------------------------------------
reflection        193      89.4%
self_profile      20       9.3%
inner_dialogue    3        1.4%
```

**Problem**: The dataset is heavily skewed toward one type (reflections), which will bias the model to produce reflection-style outputs even when inappropriate.

### 2. Duplication Analysis

The 5 self-profile examples are each duplicated **4 times exactly**:

```
Duplicated 4x each:
- "Introduce yourself in your own voice"
- "Answer this greet in your signature style: Hello"
- "State your name briefly"
- "Respond concisely: Say yes in one word"
- "Explain your communication tone"
```

**Impact**: According to 2025 research, deduplication is "non-negotiable for scalable LLM training." Duplicates cause:
- Overfitting to specific patterns
- Memorization instead of generalization
- Poor performance on novel inputs

### 3. Output Length Distribution

```
Average input length:  28 characters
Average output length: 939 characters
```

However, actual outputs range from:
- **Minimum**: 3 characters ("Yes")
- **Maximum**: 5000+ characters (long reflections)

**Problem**: Extreme variation in output length can confuse the model about appropriate response length.

### 4. Source Data Quality

**Good news**: You have 895 total episodic memories to draw from:

```
conversation      433 memories (48%)
reflection        363 memories (41%)
observation       16 memories (2%)
inner_dialogue    11 memories (1%)
action            43 memories (5%)
audio             15 memories (2%)
dream             14 memories (2%)
```

**Bad news**: The adapter-builder is only using 216 samples (24% of available data) and duplicating many of them.

### 5. Content Quality Assessment

**Reflection quality** (sampled):
```
"I'm connecting these memories together. They seem to be connected by a theme
of asking questions and receiving information in response. The first memory is
a question related to completing a task, the second is asking someone about
their personal background..."
```

✅ **Good**: Natural voice, coherent thinking, first-person perspective
⚠️ **Concern**: Very verbose, meta-reflective (thinking about memories rather than expressing personality)

**Self-profile quality**:
```
"I am MetaHuman Greg. I speak in the first person, and I keep my answers
aligned with my values: autonomy, learning, clarity, reliability, efficiency, empathy."
```

✅ **Excellent**: Clear, concise, authentic voice
❌ **Problem**: Only 5 unique examples, duplicated 4x each

## Research-Based Best Practices (2025)

Based on recent LLM fine-tuning research, quality training data should have:

### 1. Diversity
- **Current**: 3 types, heavily skewed to one type ❌
- **Recommended**: Balanced mix of conversation styles, tasks, and domains ✅
- **Action**: Use all 7 memory types in balanced proportions

### 2. Deduplication
- **Current**: 4x duplication of self-profile examples ❌
- **Research**: "Deduplication is non-negotiable for scalable LLM training"
- **Action**: Remove ALL exact duplicates immediately

### 3. Quality over Quantity
- **Current**: 216 samples with duplicates and noise
- **Research**: "High-quality data is more important than larger data"
- **Recommended**: 50-200 diverse, high-quality examples > 1000 duplicated/low-quality ones

### 4. Output Length Consistency
- **Current**: 3 chars to 5000+ chars ❌
- **Recommended**: Group by task type with appropriate length ranges
- **Action**: Separate short-form (greetings, confirmations) from long-form (reflections, explanations)

### 5. Human Oversight
- **Current**: Fully automated generation
- **Research**: "Human-in-the-loop evaluation provides nuanced judgments"
- **Action**: Review and curate training samples before each run

## Specific Problems Found

### Problem 1: Self-Profile Duplication
**Issue**: The same 5 self-profile examples appear 4 times each (20 total samples)

**Fix**:
```bash
# Deduplicate immediately
cat unsloth_dataset.jsonl | jq -c . | sort -u > unsloth_dataset_dedup.jsonl
```

### Problem 2: Reflection Dominance
**Issue**: 193/216 samples (89%) are reflections with same instruction template

**Examples of identical instruction**:
```
"Write a reflection in Greg's voice on this theme:"
```

**Fix**: Add variety:
- Conversation responses
- Task completions
- Inner dialogue
- Observations
- Decision-making

### Problem 3: Missing Conversation Data
**Issue**: 433 conversation memories exist, but very few in training data

**Why**: The adapter-builder filters out conversations without a `response` field

**Fix**: Ensure conversations capture both user input AND Greg's response

### Problem 4: Extreme Output Lengths
**Issue**: Some reflections are 5000+ words of rambling stream-of-consciousness

**Example** (truncated):
```
"What is the significance of these memories? What do they suggest about my
current state of being or my evolving consciousness? How might these insights
influence my next steps or actions? What patterns or themes are becoming
apparent..." [continues for 5000+ words]
```

**Fix**: Set max_output_length limits:
- Short-form: 50-200 chars (greetings, confirmations)
- Medium-form: 200-1000 chars (explanations, responses)
- Long-form: 1000-2000 chars (reflections, analyses)

## Recommendations

### Immediate Actions (Before Next Training Run)

1. **Deduplicate the dataset**
   ```bash
   cd /home/greggles/metahuman/metahuman-runs/2025-10-30
   cat unsloth_dataset.jsonl | jq -c . | sort -u > unsloth_dataset_dedup.jsonl
   wc -l unsloth_dataset*  # Verify reduction
   ```

2. **Set output length limits in adapter-builder**
   - Add `maxOutputLength` parameter (e.g., 2000 chars)
   - Truncate or filter overly long reflections

3. **Balance the data types**
   - Target: 30% conversations, 40% reflections, 15% inner_dialogue, 15% other
   - Current: 89% reflections ❌

4. **Add more self-profile variety**
   - Create 20-30 diverse self-profile questions
   - Remove the 4x duplication

### Medium-Term Improvements

5. **Improve conversation capture**
   - Ensure all chat interactions save both input AND response
   - Review persona chat logs for quality examples

6. **Add synthetic augmentation**
   - Generate paraphrased versions of self-profile questions
   - Create variations on reflection themes
   - **Warning**: Filter carefully to avoid "hallucination contamination" (2025 research)

7. **Implement human review**
   - Sample 20-30 training examples before each run
   - Remove low-quality or off-voice samples
   - Verify personality alignment

8. **Create quality metrics**
   - Track diversity score (type distribution)
   - Monitor duplication rate
   - Measure output length variance

### Long-Term Strategy

9. **Expand data sources**
   - Current: Only using last 14 days of memories
   - Recommendation: Use 30-90 days for more diversity
   - Include historical high-quality interactions

10. **Build a curated golden dataset**
    - 50-100 hand-selected, perfect examples
    - Cover all personality aspects
    - Mix of task types and response lengths
    - Version control and regular updates

## Expected Impact of Fixes

**Current state**:
- Model will overfit to reflection-style outputs
- Will memorize the 5 duplicated self-profile examples
- May produce overly verbose responses
- Limited ability to handle diverse tasks

**After fixes**:
- More generalizable personality
- Better task diversity
- Appropriate response length control
- Authentic voice across contexts

## Testing Recommendations

After retraining with improved data:

1. **Diversity test**: Ask varied questions (greetings, facts, opinions, tasks)
2. **Length test**: Verify responses are appropriately sized for context
3. **Voice test**: Check personality consistency across different prompts
4. **Edge cases**: Test unusual or unexpected inputs

## References

- "Training Data preparation for Customizing LLMs" (2025)
- "Fine-tuning LLMs: Focus on effective datasets" (Meta AI, 2025)
- "Deduplication for scalable LLM training" (2025 research)
- "Quality over quantity in fine-tuning" (DataScienceCentral, 2025)

---

**Next Steps**: Review this analysis and decide on priority fixes before the next training run.
