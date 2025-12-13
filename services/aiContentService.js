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

// ═══════════════════════════════════════════════════════════
// DEDUPLICATION UTILITIES
// ═══════════════════════════════════════════════════════════

/**
 * Common stopwords to ignore when comparing titles
 */
const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by', 'about',
    'and', 'or', 'but', 'not', 'this', 'that', 'it', 'its', 'they',
    'from', 'has', 'have', 'had', 'will', 'would', 'could', 'should',
    'says', 'said', 'after', 'before', 'over', 'amid', 'during', 'into',
    'new', 'news', 'report', 'reports', 'update', 'latest', 'breaking',
    'today', 'now', 'just', 'more', 'than', 'also', 'how', 'why', 'what',
    'who', 'when', 'where', 'which', 'while', 'between', 'against', 'under'
]);

/**
 * Extract meaningful keywords from a title
 */
function extractKeywords(title) {
    if (!title) return [];
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Calculate Jaccard similarity between two word arrays
 * Returns value between 0 (no overlap) and 1 (identical)
 */
function calculateSimilarity(words1, words2) {
    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = words1.filter(w => set2.has(w));
    const union = new Set([...words1, ...words2]);

    return intersection.length / union.size;
}

/**
 * Check if a title is similar to any existing post titles
 * Returns { similar: boolean, matchedTitle: string?, similarity: number }
 */
function isSimilarToExisting(newTitle, existingTitles, threshold = 0.6) {
    const newKeywords = extractKeywords(newTitle);

    for (const existingTitle of existingTitles) {
        const existingKeywords = extractKeywords(existingTitle);
        const similarity = calculateSimilarity(newKeywords, existingKeywords);

        if (similarity >= threshold) {
            return {
                similar: true,
                matchedTitle: existingTitle,
                similarity: Math.round(similarity * 100)
            };
        }
    }

    return { similar: false, matchedTitle: null, similarity: 0 };
}

/**
 * Get cluster priorities based on recent post distribution
 * Returns array of clusters that need more coverage
 */
async function getClusterPriorities() {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentPosts = await Post.find({
        publishTime: { $gte: last24Hours },
        status: 'published'
    }).select('topicCluster').lean();

    const clusterCounts = {
        USA: 0,
        India: 0,
        UK: 0,
        EU: 0,
        Global: 0
    };

    recentPosts.forEach(p => {
        if (p.topicCluster && clusterCounts.hasOwnProperty(p.topicCluster)) {
            clusterCounts[p.topicCluster]++;
        }
    });

    // Find clusters with less than 2 posts in last 24 hours
    const priorityClusters = Object.entries(clusterCounts)
        .filter(([_, count]) => count < 2)
        .map(([cluster]) => cluster);

    console.log('[AI] Cluster distribution (24h):', clusterCounts);
    console.log('[AI] Priority clusters:', priorityClusters.length > 0 ? priorityClusters.join(', ') : 'None');

    return priorityClusters;
}

// ═══════════════════════════════════════════════════════════
// IMAGE VALIDATION
// ═══════════════════════════════════════════════════════════

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
function buildPrompt(existingTitles = [], avoidKeywords = [], priorityClusters = [], skipAvoidSection = false) {
    // Build avoid section with titles AND keywords
    let avoidSection = '';
    if (!skipAvoidSection && (existingTitles.length > 0 || avoidKeywords.length > 0)) {
        const titlePart = existingTitles.length > 0
            ? `\n**RECENTLY COVERED TOPICS (find DIFFERENT stories):**\n${existingTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
            : '';

        const keywordPart = avoidKeywords.length > 0
            ? `\n**OVERUSED KEYWORDS (avoid stories focused on these):** ${avoidKeywords.slice(0, 15).join(', ')}`
            : '';

        avoidSection = titlePart + keywordPart + '\n\nIMPORTANT: Find stories about DIFFERENT people, events, or topics. Do NOT cover the same news with slightly different wording.';
    }

    // Build priority section
    const prioritySection = priorityClusters.length > 0
        ? `\n**PRIORITY REGIONS (need more coverage):** ${priorityClusters.join(', ')} - Try to include at least one story from these regions.`
        : '';

    const now = new Date();
    const todayFormatted = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const dateISO = now.toISOString().split('T')[0];

    return `You are a professional news journalist API. Today is ${todayFormatted} (${dateISO}).

**CRITICAL - READ THIS FIRST:**
- You MUST return a valid JSON array. This is NON-NEGOTIABLE.
- Do NOT explain, apologize, or say you cannot do something.
- Do NOT start your response with "I cannot", "I'm unable", "Unfortunately", etc.
- If you cannot find perfect matches, find the CLOSEST available news stories.
- ALWAYS output at least 3-5 articles as a JSON array.
- Your ONLY valid response format is: [{"title": "...", ...}, {"title": "...", ...}]

**OUTPUT FORMAT: JSON ARRAY ONLY**
- Return ONLY valid JSON starting with [ and ending with ]
- No explanations, no markdown code blocks, no text before/after JSON
- If search results are limited, write about available stories

**DATE REQUIREMENT: TODAY (${dateISO})**
- Search for news published TODAY
- Include specific dates, times, and sources in your articles

**REGIONS (one article each, find what's available):**
1. USA - Politics, economy, tech, sports, or major US news
2. INDIA - Politics, cricket, Bollywood, economy, or major India news  
3. UK - Politics, royals, sports, or major UK news
4. EU - European affairs, economy, or major EU news
5. GLOBAL - International affairs, UN, climate, space, or world news

If a region has no news today, substitute with another interesting story from any region.

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

**JSON FORMAT (return exactly this structure):**
[
  {
    "title": "Specific headline with key name/number (60-90 chars)",
    "tldr": "One-sentence summary with key fact (150-200 chars)",
    "metaTitle": "SEO-optimized title for search engines (50-60 chars, include key terms)",
    "metaDescription": "Compelling search snippet with call-to-action (150-160 chars)",
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
${prioritySection}

START YOUR RESPONSE WITH [ (opening bracket) - NO OTHER TEXT ALLOWED.`;
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
 * Multiple strategies to extract valid JSON from various response formats
 */
function parseResponse(responseText) {
    try {
        // Log first 500 chars for debugging
        console.log('[AI] Raw response preview:', responseText.substring(0, 500));

        let cleaned = responseText.trim();

        // Check if response is clearly not JSON (starts with "I" or explanatory text)
        if (cleaned.startsWith('I ') || cleaned.startsWith('I\'m') || cleaned.startsWith('Unfortunately')) {
            console.error('[AI] Model returned explanatory text instead of JSON');
            console.error('[AI] Full response:', responseText.substring(0, 1000));
            throw new Error('Model returned text instead of JSON. Prompt enforcement failed.');
        }

        // Strategy 1: Remove markdown code blocks
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
        cleaned = cleaned.replace(/\s*```$/i, '');

        // Also handle triple backticks anywhere in the response
        cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');

        // Strategy 2: Try to find JSON array in the response
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            cleaned = arrayMatch[0];
            console.log('[AI] Found JSON array, length:', cleaned.length);
        } else {
            // Strategy 3: No array found - check if there's at least an object
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (objMatch) {
                cleaned = '[' + objMatch[0] + ']';
                console.log('[AI] Found JSON object, wrapped in array');
            } else {
                console.error('[AI] No JSON structure found in response');
                console.error('[AI] Cleaned response:', cleaned.substring(0, 500));
                throw new Error('No JSON array or object found in response');
            }
        }

        // Strategy 4: Fix common JSON issues
        // Remove trailing commas before ] or }
        cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

        // Fix escaped quotes that might be double-escaped
        cleaned = cleaned.replace(/\\\\"/g, '\\"');

        // Remove any BOM or invisible characters
        cleaned = cleaned.replace(/^\uFEFF/, '');

        // Strategy 5: Handle truncated JSON
        let openBrackets = (cleaned.match(/\[/g) || []).length;
        let closeBrackets = (cleaned.match(/\]/g) || []).length;
        let openBraces = (cleaned.match(/\{/g) || []).length;
        let closeBraces = (cleaned.match(/\}/g) || []).length;

        if (openBraces > closeBraces || openBrackets > closeBrackets) {
            console.log('[AI] Detected truncated JSON, attempting to salvage...');
            console.log(`[AI] Brackets: [ ${openBrackets} vs ] ${closeBrackets}, { ${openBraces} vs } ${closeBraces}`);

            // Try to find the last complete object
            const lastCompleteObject = cleaned.lastIndexOf('},');
            if (lastCompleteObject > 0) {
                cleaned = cleaned.substring(0, lastCompleteObject + 1) + ']';
                console.log('[AI] Salvaged up to last complete object at position:', lastCompleteObject);
            } else {
                const lastBrace = cleaned.lastIndexOf('}');
                if (lastBrace > 0) {
                    cleaned = cleaned.substring(0, lastBrace + 1) + ']';
                    console.log('[AI] Salvaged up to last closing brace at position:', lastBrace);
                }
            }
        }

        // Attempt to parse
        let posts;
        try {
            posts = JSON.parse(cleaned);
        } catch (parseError) {
            console.error('[AI] Initial parse failed:', parseError.message);

            // Strategy 6: Try to fix common issues and parse again
            // Sometimes there are newlines inside strings that need escaping
            cleaned = cleaned.replace(/\n(?=[^"]*"[^"]*(?:"[^"]*"[^"]*)*$)/g, '\\n');

            try {
                posts = JSON.parse(cleaned);
            } catch (secondError) {
                console.error('[AI] Second parse attempt failed:', secondError.message);
                console.error('[AI] Final cleaned response (first 1000 chars):', cleaned.substring(0, 1000));
                throw new Error('Failed to parse AI response as JSON after multiple attempts');
            }
        }

        if (!Array.isArray(posts)) {
            throw new Error('Response is not an array');
        }

        // Filter out incomplete posts - require at minimum title, content, and tldr
        const validPosts = posts.filter(post => {
            if (!post || !post.title || !post.content || !post.tldr) {
                console.log('[AI] Skipping incomplete post:', post?.title?.substring(0, 50) || 'no title');
                return false;
            }
            return true;
        });

        console.log(`[AI] Parsed ${validPosts.length} valid posts out of ${posts.length} total`);

        // Log titles of valid posts for debugging
        validPosts.forEach((post, i) => {
            console.log(`[AI] Post ${i + 1}: ${post.title.substring(0, 60)}...`);
        });

        return validPosts;
    } catch (error) {
        console.error('[AI] Failed to parse response:', error.message);
        console.error('[AI] Response length:', responseText.length);
        console.error('[AI] Response preview:', responseText.substring(0, 500));
        throw new Error('Failed to parse AI response as JSON');
    }
}

/**
 * Get existing post data for deduplication
 * Returns { titles: string[], sourceUrls: string[], keywords: string[] }
 */
async function getExistingPostData() {
    const posts = await Post.find({})
        .sort({ createdAt: -1 })
        .limit(100) // Increased from 50 to 100
        .select('title sourceUrl')
        .lean();

    const titles = posts.map(p => p.title);
    const sourceUrls = posts.map(p => p.sourceUrl).filter(Boolean);

    // Extract unique keywords from all titles
    const allKeywords = new Set();
    titles.forEach(title => {
        extractKeywords(title).forEach(kw => allKeywords.add(kw));
    });

    // Get top 30 most common keywords
    const keywordCounts = {};
    titles.forEach(title => {
        extractKeywords(title).forEach(kw => {
            keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        });
    });

    const topKeywords = Object.entries(keywordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([kw]) => kw);

    return { titles, sourceUrls, keywords: topKeywords };
}

/**
 * Generate posts using AI
 * Includes retry mechanism and passes deduplication data to save function
 */
async function generatePosts() {
    console.log('[AI] Starting post generation...');

    // Get existing post data for deduplication
    const existingData = await getExistingPostData();
    console.log(`[AI] Found ${existingData.titles.length} existing posts to check against`);
    console.log(`[AI] Top keywords to avoid: ${existingData.keywords.slice(0, 10).join(', ')}`);

    // Get priority clusters for balanced coverage
    const priorityClusters = await getClusterPriorities();

    // First attempt: with avoid section and priority clusters
    try {
        const prompt = buildPrompt(existingData.titles, existingData.keywords, priorityClusters, false);
        const responseText = await callOpenRouter(prompt);
        const posts = parseResponse(responseText);

        if (posts.length > 0) {
            return { posts, existingData };
        }
        console.log('[AI] First attempt returned 0 posts, retrying without avoid section...');
    } catch (error) {
        console.log(`[AI] First attempt failed: ${error.message}`);
        console.log('[AI] Retrying without avoid section...');
    }

    // Second attempt: without avoid section (fresh stories)
    try {
        const freshPrompt = buildPrompt([], [], priorityClusters, true);
        const responseText = await callOpenRouter(freshPrompt);
        const posts = parseResponse(responseText);
        return { posts, existingData };
    } catch (error) {
        console.error('[AI] Second attempt also failed:', error.message);
        throw error;
    }
}

/**
 * Save generated posts to database with multi-layer deduplication
 */
async function saveGeneratedPosts(posts, existingData = { titles: [], sourceUrls: [] }) {
    const savedPosts = [];

    // Make copies we can update as we save posts
    const existingTitles = [...existingData.titles];
    const existingSourceUrls = new Set(existingData.sourceUrls);

    for (const postData of posts) {
        try {
            console.log(`[AI] Processing: ${postData.title}`);

            // ═══════════════════════════════════════════════════════════
            // DEDUPLICATION LAYER 1: Title Similarity Check
            // ═══════════════════════════════════════════════════════════
            const similarityCheck = isSimilarToExisting(postData.title, existingTitles, 0.6);
            if (similarityCheck.similar) {
                console.log(`[AI] ⚠️ Skipping similar title (${similarityCheck.similarity}% match)`);
                console.log(`[AI]    New: ${postData.title.substring(0, 60)}...`);
                console.log(`[AI]    Existing: ${similarityCheck.matchedTitle.substring(0, 60)}...`);
                continue;
            }

            // ═══════════════════════════════════════════════════════════
            // DEDUPLICATION LAYER 2: Source URL Check
            // Skip YouTube/video URLs as they're not unique news sources
            // ═══════════════════════════════════════════════════════════
            const isVideoUrl = postData.sourceUrl && (
                postData.sourceUrl.includes('youtube.com') ||
                postData.sourceUrl.includes('youtu.be') ||
                postData.sourceUrl.includes('vimeo.com') ||
                postData.sourceUrl.includes('dailymotion.com')
            );

            if (postData.sourceUrl && !isVideoUrl && existingSourceUrls.has(postData.sourceUrl)) {
                console.log(`[AI] ⚠️ Skipping duplicate source URL: ${postData.sourceUrl}`);
                continue;
            }

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

            // ═══════════════════════════════════════════════════════════
            // DEDUPLICATION LAYER 3: Exact Slug Check (safety net)
            // ═══════════════════════════════════════════════════════════
            const existingSlug = await Post.findOne({ slug });
            if (existingSlug) {
                console.log(`[AI] ⚠️ Skipping duplicate slug: ${slug}`);
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
                // SEO fields - use AI-generated or fallback to title/tldr, always truncate to schema limits
                metaTitle: (postData.metaTitle || postData.title).substring(0, 60),
                metaDescription: (postData.metaDescription || postData.tldr).substring(0, 160),
                status: 'published',
                publishTime: new Date()
            });

            await newPost.save();
            savedPosts.push(newPost);

            // Update tracking lists to catch duplicates within same batch
            existingTitles.push(postData.title);
            if (postData.sourceUrl) {
                existingSourceUrls.add(postData.sourceUrl);
            }

            console.log(`[AI] ✅ Saved: ${newPost.title}`);
        } catch (error) {
            console.error(`[AI] Failed to save post:`, error.message);
        }
    }

    console.log(`[AI] 📊 Summary: ${savedPosts.length} saved out of ${posts.length} generated`);
    return savedPosts;
}

/**
 * Main generation function
 */
async function runGeneration() {
    try {
        const { posts, existingData } = await generatePosts();
        const saved = await saveGeneratedPosts(posts, existingData);
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
    getExistingPostData,
    deleteAllPosts,
    searchNewsImage
};
