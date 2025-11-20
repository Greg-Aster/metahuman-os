/**
 * Example Plugin: Sentiment Analyzer
 *
 * A more advanced example that demonstrates:
 * - Processing text input
 * - Returning structured data
 * - Using context
 * - Error handling
 */

export default {
  metadata: {
    id: 'sentiment_analyzer',
    name: 'Sentiment Analyzer',
    version: '1.0.0',
    author: 'MetaHuman Team',
    description: 'Analyzes the sentiment of text using simple keyword matching',
    category: 'custom',
    color: '#51cf66',
    bgColor: '#2f9e44',
  },

  inputs: [
    {
      name: 'text',
      type: 'string',
      description: 'Text to analyze',
    },
  ],

  outputs: [
    {
      name: 'sentiment',
      type: 'string',
      description: 'Detected sentiment (positive, negative, neutral)',
    },
    {
      name: 'score',
      type: 'number',
      description: 'Sentiment score (-1 to 1)',
    },
    {
      name: 'keywords',
      type: 'array',
      description: 'Detected sentiment keywords',
    },
    {
      name: 'success',
      type: 'boolean',
    },
  ],

  properties: {
    sensitivity: 0.5, // Threshold for sentiment detection
  },

  executor: async (inputs, context, properties) => {
    try {
      const text = inputs[0];

      if (!text || typeof text !== 'string') {
        return {
          sentiment: 'neutral',
          score: 0,
          keywords: [],
          success: false,
          error: 'Invalid text input',
        };
      }

      // Simple keyword-based sentiment analysis
      const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'happy', 'joy'];
      const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'sad', 'angry', 'frustrating'];

      const lowerText = text.toLowerCase();
      const words = lowerText.split(/\s+/);

      let positiveCount = 0;
      let negativeCount = 0;
      const foundKeywords = [];

      for (const word of words) {
        if (positiveWords.includes(word)) {
          positiveCount++;
          foundKeywords.push({ word, type: 'positive' });
        } else if (negativeWords.includes(word)) {
          negativeCount++;
          foundKeywords.push({ word, type: 'negative' });
        }
      }

      // Calculate score
      const total = positiveCount + negativeCount;
      let score = 0;
      let sentiment = 'neutral';

      if (total > 0) {
        score = (positiveCount - negativeCount) / total;

        const sensitivity = properties?.sensitivity || 0.5;
        if (score > sensitivity) {
          sentiment = 'positive';
        } else if (score < -sensitivity) {
          sentiment = 'negative';
        }
      }

      console.log(`[SentimentAnalyzer Plugin] Analyzed: "${text.substring(0, 50)}..." → ${sentiment} (${score.toFixed(2)})`);

      return {
        sentiment,
        score,
        keywords: foundKeywords,
        success: true,
      };

    } catch (error) {
      console.error('[SentimentAnalyzer Plugin] Error:', error);
      return {
        sentiment: 'neutral',
        score: 0,
        keywords: [],
        success: false,
        error: error.message,
      };
    }
  },
};
