/**
 * AI Configuration for GeoPolitiq
 * Model selection with pricing and web search support
 */

// Available models with pricing (per 1M tokens)
const MODELS = {
    'gemini-flash-free': {
        id: 'google/gemini-2.0-flash-exp:free',
        name: 'Gemini 2.0 Flash (Free)',
        description: 'Fast, free model with web search',
        inputPrice: 0,
        outputPrice: 0,
        hasWebSearch: true,
        dailyCostINR: 0
    },
    'perplexity-sonar': {
        id: 'perplexity/sonar',
        name: 'Perplexity Sonar',
        description: 'Good balance of quality and cost',
        inputPrice: 1,
        outputPrice: 1,
        hasWebSearch: true,
        dailyCostINR: 13
    },
    'gemini-pro': {
        id: 'google/gemini-2.5-pro-preview-06-05',
        name: 'Gemini 2.5 Pro',
        description: 'High quality with web grounding',
        inputPrice: 1.25,
        outputPrice: 10,
        hasWebSearch: true,
        dailyCostINR: 42
    },
    'perplexity-sonar-pro': {
        id: 'perplexity/sonar-pro',
        name: 'Perplexity Sonar Pro',
        description: 'Premium quality with deep search',
        inputPrice: 3,
        outputPrice: 15,
        hasWebSearch: true,
        dailyCostINR: 84
    }
};

// Current model (can be changed via admin or env)
const selectedModel = process.env.AI_MODEL || 'gemini-pro';

module.exports = {
    // OpenRouter API base URL
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',

    // Get current model config
    primaryModel: MODELS[selectedModel]?.id || MODELS['gemini-pro'].id,

    // All available models for admin UI
    availableModels: MODELS,

    // Get selected model key
    selectedModelKey: selectedModel,

    // Single API key from environment
    getApiKey: () => process.env.OPENROUTER_API_KEY || '',

    // Legacy support
    getApiKeys: () => {
        const key = process.env.OPENROUTER_API_KEY;
        return key ? [key] : [];
    },

    // Scheduler settings
    scheduler: {
        enabled: process.env.AI_SCHEDULER_ENABLED === 'true',
        cronExpression: '0 */2 * * *',
        postsPerRun: 5,
        maxDailyPosts: 50
    },

    // Generation settings
    generation: {
        maxRetries: 10,
        retryDelayMs: 3000,
        timeoutMs: 180000,
        regions: ['Global', 'USA', 'India', 'UK', 'EU']
    },

    // Validation settings
    validation: {
        imageTimeoutMs: 10000,
        minTitleLength: 20,
        maxTitleLength: 150,
        minContentLength: 300,
        maxContentLength: 15000
    },

    // HTTP headers for OpenRouter
    getHeaders: (apiKey) => ({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'https://geopolitiq.com',
        'X-Title': 'GeoPolitiq'
    }),

    // Helper to get model info
    getModelInfo: (modelKey) => MODELS[modelKey] || MODELS['gemini-pro'],

    // Helper to set model (for admin)
    setModel: (modelKey) => {
        if (MODELS[modelKey]) {
            process.env.AI_MODEL = modelKey;
            return true;
        }
        return false;
    }
};
