/**
 * AI Content Service for GeoPolitiq
 * Generates geopolitics posts using OpenRouter API with Gemini 2.0 Flash
 */

const axios = require('axios');
const { marked } = require('marked');
const aiConfig = require('../config/ai');
const Post = require('../models/Post');
const tagMatcher = require('./tagMatcher');
const { sanitizeTables } = require('../utils/tableSanitizer');

// State for API key and model rotation
let currentApiKeyIndex = 0;
let currentModelIndex = 0;

/**
 * Domains that block hotlinking - skip these
 */
const BLOCKED_DOMAINS = [
    'reuters.com', 'gettyimages.com', 'shutterstock.com',
    'alamy.com', 'istockphoto.com', 'depositphotos.com',
    'dreamstime.com', 'stock.adobe.com', 'newscom.com'
];

/**
 * Validate if an image URL is accessible and returns actual image content
 */
async function validateImageUrl(imageUrl) {
    try {
        // Skip blocked domains
        for (const domain of BLOCKED_DOMAINS) {
            if (imageUrl.includes(domain)) {
                return false;
            }
        }

        // Make HEAD request to check if image is accessible
        const response = await axios.head(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*'
            },
            timeout: 5000,
            maxRedirects: 3
        });

        // Check status code
        if (response.status !== 200) {
            return false;
        }

        // Check content type is an image
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
            return false;
        }

        // Check content length (should be at least 5KB to be a real image)
        const contentLength = parseInt(response.headers['content-length'] || '0', 10);
        if (contentLength > 0 && contentLength < 5000) {
            return false; // Too small, likely a placeholder
        }

        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Search for a relevant news image using Google Images scraping
 * Validates each image before returning
 */
async function searchNewsImage(title) {
    try {
        // Clean up title for search query
        const searchQuery = title
            .replace(/[!?'"]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 60);

        console.log(`[AI] 🔍 Searching images for: "${searchQuery}"`);

        // Use Google Images search
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=isch&safe=active`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            timeout: 15000
        });

        const html = response.data;

        // Extract image URLs
        const pattern = /\["(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))[^"]*",\d+,\d+\]/gi;
        const matches = [...html.matchAll(pattern)];

        // Try up to 10 images, validate each one
        for (const match of matches.slice(0, 10)) {
            const imageUrl = match[1];

            if (!imageUrl ||
                !imageUrl.startsWith('https://') ||
                imageUrl.includes('google.com') ||
                imageUrl.includes('gstatic.com') ||
                imageUrl.length > 500) {
                continue;
            }

            console.log(`[AI] 🔄 Validating: ${imageUrl.substring(0, 60)}...`);

            const isValid = await validateImageUrl(imageUrl);
            if (isValid) {
                console.log(`[AI] ✅ Valid image found!`);
                return imageUrl;
            } else {
                console.log(`[AI] ❌ Image blocked/invalid, trying next...`);
            }
        }

        console.log('[AI] ⚠️ No valid images found, using Pexels fallback');
        return getDefaultImage(title);

    } catch (error) {
        console.error(`[AI] Image search failed: ${error.message}`);
        return getDefaultImage(title);
    }
}

/**
 * Default fallback image based on topic
 */
function getDefaultImage(title) {
    const text = (title || '').toLowerCase();

    // Simple topic-based fallbacks using Pexels (guaranteed to work)
    if (text.includes('trump') || text.includes('biden') || text.includes('usa') || text.includes('america')) {
        return 'https://images.pexels.com/photos/1202723/pexels-photo-1202723.jpeg?w=1280';
    }
    if (text.includes('india') || text.includes('modi')) {
        return 'https://images.pexels.com/photos/789750/pexels-photo-789750.jpeg?w=1280';
    }
    if (text.includes('uk') || text.includes('britain') || text.includes('starmer')) {
        return 'https://images.pexels.com/photos/77171/pexels-photo-77171.jpeg?w=1280';
    }
    if (text.includes('russia') || text.includes('putin') || text.includes('ukraine')) {
        return 'https://images.pexels.com/photos/3617500/pexels-photo-3617500.jpeg?w=1280';
    }
    if (text.includes('china') || text.includes('xi')) {
        return 'https://images.pexels.com/photos/2770933/pexels-photo-2770933.jpeg?w=1280';
    }

    // Default world/politics image
    return 'https://images.pexels.com/photos/1098460/pexels-photo-1098460.jpeg?w=1280';
}

/**
 * Build the prompt for content generation - REAL-TIME NEWS ONLY
 * Uses Perplexity Sonar Pro for web search to get TODAY's news
 */
function buildPrompt(existingTitles = []) {
    const avoidSection = existingTitles.length > 0
        ? `\n\n**AVOID THESE TOPICS (already published):**\n${existingTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : '';

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const dateISO = now.toISOString().split('T')[0];

    return `You are a professional news journalist API. Today is ${todayFormatted} (${dateISO}).

**OUTPUT FORMAT: JSON ARRAY ONLY**
- Return ONLY valid JSON starting with [ and ending with ]
- No explanations, no markdown code blocks, no text before/after JSON

**DATE REQUIREMENT: TODAY (${dateISO})**
- Search for news published TODAY
- Include specific dates, times, and sources in your articles

**REGIONS (one article each):**
1. USA - Politics, economy, tech, sports, or major US news
2. INDIA - Politics, cricket, Bollywood, economy, or major India news  
3. UK - Politics, royals, sports, or major UK news
4. EU - European affairs, economy, or major EU news
5. GLOBAL - International affairs, UN, climate, space, or world news

**ARTICLE QUALITY REQUIREMENTS:**
- Write like a REAL journalist, not AI
- Use EXACT quotes, names, numbers, dates from your search
- Include specific details: "At 3:45 PM local time...", "According to Reuters..."
- No vague language like "sources say" without naming the source

**CONTENT STRUCTURE (use this exact format):**
## Overview
Brief context with specific facts from today's news

## Key Developments
- Bullet points with exact quotes and data
- "Official Name said: 'exact quote here'"
- Include timestamps and locations

## Analysis
| Factor | Current Status | Implications |
|--------|----------------|--------------|
| Economic | Specific data | Impact |
| Political | Key players | Consequences |
| Social | Public reaction | Outlook |

## Expert Reactions
Direct quotes from named officials, analysts, or stakeholders

## What's Next
Concrete next steps with dates if available

**JSON FORMAT:**
[
  {
    "title": "Specific headline with key name/number (60-90 chars)",
    "tldr": "One-sentence summary with key fact (150-200 chars)",
    "content": "Full 1000+ word article following structure above",
    "tags": ["specific", "relevant", "tags", "for", "article"],
    "topicCluster": "USA",
    "authorName": "Author name or 'Staff' if not available",
    "authorOrg": "Source organization (Reuters, AP, BBC, etc.)",
    "sourceUrl": "URL to original article",
    "imageUrl": "",
    "imageSource": "",
    "imageAlt": ""
  }
]
${avoidSection}

RESPOND WITH JSON ARRAY ONLY.`;
}




/**
 * Get current API key with rotation
 */
function getApiKey() {
    const keys = aiConfig.getApiKeys();
    if (keys.length === 0) {
        throw new Error('No OpenRouter API keys configured');
    }
    return keys[currentApiKeyIndex % keys.length];
}

/**
 * Rotate to next API key
 */
function rotateApiKey() {
    const keys = aiConfig.getApiKeys();
    currentApiKeyIndex = (currentApiKeyIndex + 1) % keys.length;
    console.log(`[AI] Rotated to API key index: ${currentApiKeyIndex} `);
}

/**
 * Get current model - Use Perplexity Sonar Pro for real-time news
 */
function getCurrentModel() {
    // Force Perplexity Sonar Pro for real-time web search news
    return 'perplexity/sonar-pro';
}

/**
 * Switch to fallback model
 */
function switchToFallbackModel() {
    currentModelIndex++;
    const model = getCurrentModel();
    console.log(`[AI] Switched to fallback model: ${model} `);
    return model;
}

/**
 * Reset model to primary
 */
function resetModel() {
    currentModelIndex = 0;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call OpenRouter API with PERSISTENT RETRY until success
 */
async function callOpenRouter(prompt) {
    let retryCount = 0;
    const maxRetries = 100;
    let lastError = null;

    while (retryCount < maxRetries) {
        const apiKey = getApiKey();
        const model = getCurrentModel();

        console.log(`[AI] Attempt ${retryCount + 1}: Calling ${model.split('/').pop()} `);

        try {
            const response = await axios.post(
                aiConfig.baseUrl,
                {
                    model: model,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 16000 // Increased for longer content
                },
                {
                    headers: aiConfig.getHeaders(apiKey),
                    timeout: 120000 // 2 minute timeout for longer content
                }
            );

            if (response.data?.choices?.[0]?.message?.content) {
                console.log(`[AI] Success on attempt ${retryCount + 1} `);
                return response.data.choices[0].message.content;
            }

            throw new Error('Invalid response structure from OpenRouter');
        } catch (error) {
            lastError = error;
            console.error(`[AI] Attempt ${retryCount + 1} failed: `, error.message);

            if (error.response?.status === 429) {
                const waitTime = Math.min(5000 + (retryCount * 2000), 30000);
                console.log(`[AI] Rate limited.Waiting ${waitTime / 1000}s...`);
                rotateApiKey();
                await sleep(waitTime);
            } else if (error.response?.status === 400 || error.response?.status === 503) {
                switchToFallbackModel();
                await sleep(3000);
            } else {
                const waitTime = Math.min(2000 + (retryCount * 1000), 15000);
                console.log(`[AI] Waiting ${waitTime / 1000}s...`);
                await sleep(waitTime);
            }

            retryCount++;
        }
    }

    throw lastError || new Error('Max retries exceeded');
}

/**
 * Parse AI response - with ROBUST JSON extraction
 */
function parseResponse(responseText) {
    try {
        let cleaned = responseText.trim();

        // Check if response is clearly not JSON (starts with "I" or explanatory text)
        if (cleaned.startsWith('I ') || cleaned.startsWith('I\'m') || cleaned.startsWith('Unfortunately')) {
            console.error('[AI] Model returned explanatory text instead of JSON');
            console.error('[AI] Response preview:', responseText.substring(0, 200));
            throw new Error('Model returned text instead of JSON. Prompt enforcement failed.');
        }

        // Remove markdown code blocks
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
        cleaned = cleaned.replace(/\s*```$/i, '');

        // Try to find JSON array in the response
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            cleaned = arrayMatch[0];
        } else {
            // No array found - check if there's at least an object
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (objMatch) {
                cleaned = '[' + objMatch[0] + ']';
            } else {
                throw new Error('No JSON array or object found in response');
            }
        }

        // Fix common JSON issues
        cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

        // Handle truncated JSON
        let openBrackets = (cleaned.match(/\[/g) || []).length;
        let closeBrackets = (cleaned.match(/\]/g) || []).length;
        let openBraces = (cleaned.match(/\{/g) || []).length;
        let closeBraces = (cleaned.match(/\}/g) || []).length;

        if (openBraces > closeBraces || openBrackets > closeBrackets) {
            console.log('[AI] Detected truncated JSON, salvaging...');

            const lastCompleteObject = cleaned.lastIndexOf('},');
            if (lastCompleteObject > 0) {
                cleaned = cleaned.substring(0, lastCompleteObject + 1) + ']';
            } else {
                const lastBrace = cleaned.lastIndexOf('}');
                if (lastBrace > 0) {
                    cleaned = cleaned.substring(0, lastBrace + 1) + ']';
                }
            }
        }

        const posts = JSON.parse(cleaned);

        if (!Array.isArray(posts)) {
            throw new Error('Response is not an array');
        }

        // Filter out incomplete posts
        const validPosts = posts.filter(post =>
            post && post.title && post.content && post.tldr
        );

        console.log(`[AI] Parsed ${validPosts.length} valid posts`);
        return validPosts;
    } catch (error) {
        console.error('[AI] Failed to parse response:', error.message);
        console.error('[AI] Response preview:', responseText.substring(0, 300));
        throw new Error('Failed to parse AI response as JSON');
    }
}

/**
 * Get existing post titles from last 50 posts to avoid duplicate topics
 */
async function getTodaysTitles() {
    const posts = await Post.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .select('title')
        .lean();

    return posts.map(p => p.title);
}

/**
 * Generate posts using AI
 */
async function generatePosts() {
    console.log('[AI] Starting post generation...');

    const existingTitles = await getTodaysTitles();
    console.log(`[AI] Found ${existingTitles.length} existing posts to avoid duplicates`);

    const prompt = buildPrompt(existingTitles);
    const responseText = await callOpenRouter(prompt);
    const posts = parseResponse(responseText);

    return posts;
}

/**
 * Save generated posts to database
 */
async function saveGeneratedPosts(posts) {
    const savedPosts = [];

    for (const postData of posts) {
        try {
            console.log(`[AI] Processing: ${postData.title}`);

            // Use reliable Pexels image based on topic
            const featuredImage = await searchNewsImage(postData.title);
            const imageSource = 'Pexels';

            // Sanitize tables and convert markdown to HTML
            const cleanContent = sanitizeTables(postData.content || '');
            let bodyHtml = marked(cleanContent);
            // Apply tag backlinking for SEO
            bodyHtml = tagMatcher.linkify(bodyHtml);

            const slug = postData.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .substring(0, 100);

            const existingSlug = await Post.findOne({ slug });
            if (existingSlug) {
                console.log(`[AI] Skipping duplicate slug: ${slug}`);
                continue;
            }

            const newPost = new Post({
                title: postData.title,
                slug: slug + '-' + Date.now().toString(36),
                tldr: postData.tldr,
                rawContent: postData.content,
                bodyHtml: bodyHtml,
                tags: postData.tags || [],
                topicCluster: postData.topicCluster,
                featuredImage: featuredImage,
                imageSource: imageSource,
                imageAlt: postData.imageAlt || postData.title,
                authorName: postData.authorName || 'Staff',
                authorOrg: postData.authorOrg || '',
                sourceUrl: postData.sourceUrl || '',
                status: 'published',
                publishTime: new Date()
            });

            await newPost.save();
            savedPosts.push(newPost);
            console.log(`[AI] ✅ Saved: ${newPost.title}`);
        } catch (error) {
            console.error(`[AI] Failed to save post:`, error.message);
        }
    }

    return savedPosts;
}

/**
 * Main generation function
 */
async function runGeneration() {
    try {
        const posts = await generatePosts();
        const saved = await saveGeneratedPosts(posts);
        console.log(`[AI] Saved ${saved.length} posts. Starting verification...`);

        // Verify posts using Perplexity Sonar
        const { verifyAndFilterPosts } = require('./newsVerifier');
        const verifyResult = await verifyAndFilterPosts(saved, 70);

        console.log(`[AI] Complete. Verified: ${verifyResult.verified}, Deleted: ${verifyResult.deleted}`);
        return {
            success: true,
            count: verifyResult.verified,
            deleted: verifyResult.deleted,
            posts: saved.filter(p => true) // Note: some may have been deleted
        };
    } catch (error) {
        console.error('[AI] Generation failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Test API connection with retry
 */
async function testConnection() {
    let retryCount = 0;
    const maxRetries = 10;

    while (retryCount < maxRetries) {
        try {
            const apiKey = getApiKey();
            console.log(`[AI] Testing connection (attempt ${retryCount + 1})...`);

            const response = await axios.post(
                aiConfig.baseUrl,
                {
                    model: aiConfig.primaryModel,
                    messages: [{ role: 'user', content: 'Say "OK" only' }],
                    max_tokens: 10
                },
                {
                    headers: aiConfig.getHeaders(apiKey),
                    timeout: 15000
                }
            );

            const reply = response.data?.choices?.[0]?.message?.content;
            console.log('[AI] Connection OK');
            return { success: true, message: reply };
        } catch (error) {
            console.error(`[AI] Attempt ${retryCount + 1} failed:`, error.message);

            if (error.response?.status === 429) {
                const waitTime = 5000 + (retryCount * 2000);
                rotateApiKey();
                await sleep(waitTime);
            } else {
                await sleep(3000);
            }

            retryCount++;
        }
    }

    return { success: false, error: 'Failed after ' + maxRetries + ' attempts' };
}

/**
 * Delete all posts from database
 */
async function deleteAllPosts() {
    const result = await Post.deleteMany({});
    console.log(`[AI] Deleted ${result.deletedCount} posts`);
    return result.deletedCount;
}

module.exports = {
    generatePosts,
    saveGeneratedPosts,
    runGeneration,
    testConnection,
    buildPrompt,
    parseResponse,
    getTodaysTitles,
    deleteAllPosts,
    searchNewsImage
};
