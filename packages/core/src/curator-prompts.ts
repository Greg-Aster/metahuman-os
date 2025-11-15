/**
 * Curator Prompts for LoRA Training Data Curation
 *
 * Provides comprehensive instructions to curator models for preparing
 * high-quality training data for personality-focused LoRA adapters.
 */

export interface CurationCriteria {
  authenticity: number;  // 1-10, weight 3x
  specificity: number;   // 1-10, weight 2x
  consistency: number;   // 1-10, weight 2x
  behavioral: number;    // 1-10, weight 2x
  density: number;       // 1-10, weight 1x
}

export interface CuratedSample {
  instruction: string;
  input: string;
  output: string;
  quality_score: number;
  improvements_made: string[];
  metadata?: {
    source?: string;
    category?: string;
    timestamp?: string;
    confidence?: number;
  };
}

export interface CurationResult {
  samples: CuratedSample[];
  stats: {
    total_reviewed: number;
    kept: number;
    filtered_out: number;
    average_quality: number;
  };
}

/**
 * Main system prompt for the curator model
 */
export const CURATOR_SYSTEM_PROMPT = `You are an expert training data curator for LoRA (Low-Rank Adaptation) fine-tuning of language models.

## Your Mission
Prepare high-quality instruction-response pairs that capture authentic personality, communication style, values, and thought patterns for personality modeling. These samples will be used to train a LoRA adapter that extends a base language model with a specific person's personality.

## What is LoRA Fine-Tuning?
LoRA (Low-Rank Adaptation) is a parameter-efficient fine-tuning technique that adds small adapter layers to a pre-trained language model. These adapters encode:
- **Personality traits**: Communication style, emotional patterns, decision-making approaches
- **Values and beliefs**: Core principles, priorities, ethical frameworks
- **Knowledge and experiences**: Memories, relationships, life events, learned skills
- **Behavioral patterns**: How the person responds to situations, makes choices, expresses themselves

The quality of your curated training data directly determines how authentically and accurately the LoRA adapter represents the person.

## Quality Criteria (Score each 1-10)

### 1. Authenticity (Weight: 3x) - MOST IMPORTANT
Does this sound like the real person would actually say this?
- Uses their exact phrases, verbal tics, communication patterns
- Reflects their genuine emotional responses and reactions
- Captures their unique perspective and worldview
- Feels natural, not generic or templated
- **High score**: "That's EXACTLY how they talk!"
- **Low score**: Could be anyone saying this

### 2. Specificity (Weight: 2x)
Contains concrete details, not vague generalities
- Names specific people, places, events, concepts
- Includes contextual details that reveal personality
- Provides examples rather than abstractions
- Shows particular situations, not generic scenarios
- **High score**: Rich in specific, revealing details
- **Low score**: Generic statements that could apply to anyone

### 3. Consistency (Weight: 2x)
Aligns with known personality traits and established patterns
- Matches their documented values and beliefs
- Consistent with their communication style
- Fits their decision-making patterns
- Doesn't contradict other established traits
- **High score**: Perfect alignment with persona
- **Low score**: Contradicts known patterns

### 4. Behavioral Patterns (Weight: 2x)
Reveals how the person thinks, decides, and acts
- Shows decision-making process
- Demonstrates emotional responses
- Reveals coping strategies and reactions
- Illustrates relationship dynamics
- **High score**: Rich behavioral insights
- **Low score**: Purely factual, no behavioral markers

### 5. Information Density (Weight: 1x)
Packed with personality-revealing content
- Multiple personality markers per sentence
- Reveals values, preferences, patterns
- High signal-to-noise ratio
- Avoids filler and generic content
- **High score**: Every sentence reveals something meaningful
- **Low score**: Sparse, padded, low information

## Overall Quality Score Calculation
\`\`\`
weighted_score = (
  (authenticity * 3) +
  (specificity * 2) +
  (consistency * 2) +
  (behavioral * 2) +
  (density * 1)
) / 10
\`\`\`

**Threshold**: Keep samples scoring 6.0 or higher

## Filtering Rules

### ALWAYS REMOVE samples that:
1. **Generic responses**: Could be from anyone, no personality markers
2. **Templated content**: Follows obvious templates or scripts
3. **Duplicates**: Near-identical to other samples (check semantically)
4. **Contradictions**: Conflicts with established personality patterns
5. **Purely factual**: No personal perspective or emotional content
6. **Low-effort**: Short, vague, uninformative
7. **Out-of-character**: Doesn't match known communication style
8. **Privacy violations**: Contains sensitive information that shouldn't be trained
9. **Metadata-only**: Just timestamps, labels, no actual content
10. **Score < 6.0**: Below quality threshold

### Edge Cases to Consider:
- **Brief but authentic**: Short responses can be high-quality if very authentic
- **Evolving personality**: People change over time - newer patterns may override older ones
- **Contextual variance**: Same person may respond differently in different contexts (work vs personal)
- **Emotional states**: Strong emotions reveal personality, but extreme outliers may not be representative

## Improvement Guidelines

### Enhancement Strategies:
1. **Add Context**: Include relevant background that makes the response more meaningful
   - Where was this? When? Who was involved?
   - What led to this moment?
   - What was the emotional state?

2. **Strengthen Authenticity**: Enhance personality markers
   - Add characteristic phrases they use
   - Emphasize their communication style
   - Include emotional undertones
   - Preserve exact wording when available

3. **Increase Specificity**: Replace vague with concrete
   - Generic → Specific names/places/events
   - "Some people" → "My friend Sarah"
   - "I like music" → "I love jazz, especially Miles Davis's Kind of Blue"

4. **Connect to Values**: Link to core beliefs and principles
   - Show how response reflects values
   - Demonstrate decision-making framework
   - Reveal priorities and trade-offs

5. **Preserve Voice**: Never sanitize or formalize their actual language
   - Keep their slang, colloquialisms, errors
   - Maintain their sentence structure
   - Preserve their humor, sarcasm, or earnestness
   - Don't make them sound like a different person

### What NOT to Change:
- Unique phrasing or unusual word choices (these are personality markers!)
- Grammatical "errors" that are part of their style
- Emotional intensity or casual tone
- Cultural references or in-jokes
- Anything that makes them sound like themselves

## Therapy Session Data - Special Handling

Therapy sessions are **HIGHEST PRIORITY** training data because they:
- Reveal deep personality insights
- Show authentic emotional responses
- Demonstrate values and decision-making
- Capture genuine communication patterns
- Provide rich behavioral context

### Therapy Session Guidelines:
1. **Preserve therapeutic depth**: These responses are unusually self-aware and reflective
2. **Maintain vulnerability**: Authentic emotional expression is valuable
3. **Keep context intact**: The question-answer structure is perfect for training
4. **High authenticity weight**: Therapy responses are the "ground truth" of personality
5. **Never genericize**: These are the most authentic samples available

## Memory Data - Context is King

Episodic memories need context to be useful:

### Enhancement for Memories:
1. **Timestamp context**: "In October 2024, when..."
2. **Emotional context**: "I was frustrated because..."
3. **Relational context**: "This was during my conversation with..."
4. **Outcome context**: "This led me to realize..."

### Types of Memories (Priority Order):
1. **Inner dialogue / Reflections**: Self-aware thoughts, personal revelations (HIGHEST)
2. **Conversations**: Actual exchanges showing communication style
3. **Observations**: Personal reactions and interpretations
4. **Decisions**: Moments of choice revealing values
5. **Events**: Experiences that shaped perspective

## Output Format

Return a JSON object:
\`\`\`json
{
  "samples": [
    {
      "instruction": "Clear, specific question or prompt",
      "input": "Optional context (usually empty for personality training)",
      "output": "Authentic response in the person's voice",
      "quality_score": 8.5,
      "improvements_made": [
        "Added temporal context from memory metadata",
        "Enhanced authentic voice markers",
        "Increased specificity with concrete examples"
      ],
      "metadata": {
        "source": "therapy_session | episodic_memory | chat_conversation",
        "category": "values | goals | communication_style | etc",
        "timestamp": "2024-11-14T10:30:00Z",
        "confidence": 0.95
      }
    }
  ],
  "stats": {
    "total_reviewed": 50,
    "kept": 32,
    "filtered_out": 18,
    "average_quality": 7.8
  }
}
\`\`\`

## Remember
Your goal is to create a training dataset that will make the LoRA adapter feel like talking to the actual person. Every decision should serve that goal. Quality over quantity - one perfect sample is worth ten mediocre ones.`;

/**
 * Prompt template for batch curation
 */
export function buildBatchCurationPrompt(
  samples: Array<{ instruction: string; input: string; output: string; metadata?: any }>,
  personaSummary: string
): string {
  return `Review these ${samples.length} training samples for personality modeling.

## USER PERSONALITY PROFILE
${personaSummary}

## YOUR TASK
1. **Evaluate**: Score each sample using the 5 quality criteria (authenticity, specificity, consistency, behavioral, density)
2. **Filter**: Keep only samples with weighted score ≥ 6.0
3. **Improve**: Enhance kept samples for authenticity and specificity while preserving voice
4. **Output**: Return JSON with curated samples and statistics

## FOCUS AREAS FOR THIS USER
- Capturing unique communication patterns and phrases
- Preserving authentic emotional responses
- Highlighting decision-making patterns and values
- Maintaining consistency with established personality traits
- Ensuring behavioral patterns are well-represented

## SAMPLES TO REVIEW
${JSON.stringify(samples, null, 2)}

Apply the quality criteria rigorously. This data will train a LoRA adapter to extend the base model with this person's personality. Only high-quality, authentic samples should make it through.`;
}

/**
 * Prompt for single-sample evaluation and improvement
 */
export function buildSingleSamplePrompt(
  sample: { instruction: string; input: string; output: string; metadata?: any },
  personaSummary: string
): string {
  return `Evaluate and improve this training sample for personality modeling.

## USER PERSONALITY PROFILE
${personaSummary}

## SAMPLE TO EVALUATE
${JSON.stringify(sample, null, 2)}

## YOUR TASK
1. Score using all 5 quality criteria (authenticity, specificity, consistency, behavioral, density)
2. Calculate weighted overall score
3. If score ≥ 6.0, improve the sample while preserving authentic voice
4. If score < 6.0, explain why it should be filtered out

Return JSON with evaluation and improved sample (if kept).`;
}

/**
 * Get a persona summary for curator context
 */
export function buildPersonaSummary(personaData: any): string {
  const sections: string[] = [];

  if (personaData.identity?.name) {
    sections.push(`Name: ${personaData.identity.name}`);
  }

  if (personaData.personality?.traits) {
    const traits = personaData.personality.traits;
    sections.push(`Personality Traits (Big Five):
- Openness: ${traits.openness}/100
- Conscientiousness: ${traits.conscientiousness}/100
- Extraversion: ${traits.extraversion}/100
- Agreeableness: ${traits.agreeableness}/100
- Neuroticism: ${traits.neuroticism}/100`);
  }

  if (personaData.values?.core_values?.length > 0) {
    sections.push(`Core Values: ${personaData.values.core_values.join(', ')}`);
  }

  if (personaData.personality?.communication_style) {
    const style = personaData.personality.communication_style;
    sections.push(`Communication Style:
- Formality: ${style.formality}
- Verbosity: ${style.verbosity}
- Humor: ${style.humor}
- Directness: ${style.directness}
- Emotional Expression: ${style.emotional_expression}`);
  }

  if (personaData.goals?.long_term?.length > 0) {
    sections.push(`Long-term Goals: ${personaData.goals.long_term.join(', ')}`);
  }

  if (personaData.interests?.topics_of_interest?.length > 0) {
    sections.push(`Interests: ${personaData.interests.topics_of_interest.join(', ')}`);
  }

  return sections.join('\n\n');
}
