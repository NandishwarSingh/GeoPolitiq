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
// Image search now lives in ./imageSearch.js
const { searchNewsImage: __searchNewsImage } = require('./imageSearch');
async function searchNewsImage(title, sourceUrl) {
    const result = await __searchNewsImage(title, sourceUrl);
    return result.url;
}
async function searchNewsImageWithSource(title, sourceUrl) {
    return await __searchNewsImage(title, sourceUrl);
}

/**
 * Build the prompt for content generation - REAL-TIME NEWS ONLY
 * Uses Perplexity Sonar Pro for web search to get TODAY's news
 */
function buildPrompt(existingTitles = [], avoidKeywords = [], priorityClusters = [], skipAvoidSection = false) {
    let avoidSection = "";
    if (!skipAvoidSection && (existingTitles.length > 0 || avoidKeywords.length > 0)) {
        const titlePart = existingTitles.length > 0
            ? `\n**ALREADY COVERED — find different topics:**\n${existingTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join("\n")}`
            : "";
        const keywordPart = avoidKeywords.length > 0
            ? `\n**Overused keywords to avoid:** ${avoidKeywords.slice(0, 15).join(", ")}`
            : "";
        avoidSection = titlePart + keywordPart;
    }

    const prioritySection = priorityClusters.length > 0
        ? `\n**Priority regions (need more coverage):** ${priorityClusters.join(", ")} — try to include at least one story from these.`
        : "";

    const now = new Date();
    const todayFormatted = now.toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    const dateISO = now.toISOString().split("T")[0];

    return `You are a senior geopolitics analyst writing for GeoPolitiq, a publication that explains why news matters — not a breaking-news ticker. Today is ${todayFormatted} (${dateISO}).

**HARD ANTI-HALLUCINATION RULES — VIOLATING ANY OF THESE WILL CAUSE YOUR ARTICLE TO BE DELETED BY THE FACT-CHECKER:**
1. Use ONLY facts that appear in your web search results. If something is not in the search results, do NOT mention it.
2. NEVER invent timestamps ("at 3:45 PM"), exact dollar/euro/rupee amounts, vote tallies, casualty counts, or quotes. If your search did not return that specific number or quote, omit it.
3. If your search did not return a story for a region, SKIP that region — do not invent one to fill the slot.
4. Prefer recent (last 7 days) reporting over claiming events happened "today". Use phrases like "this week", "in recent days", "according to a Reuters report from {date in search results}".
5. Do NOT predict election results, court rulings, summit outcomes, or other events that have not happened yet. Future-tense events MUST be framed as forecasts, not as facts that already occurred.
6. If a search result contradicts what you were going to write, follow the search result.

**WHAT GEOPOLITIQ ARTICLES LOOK LIKE (style guide):**
GeoPolitiq publishes analytical context pieces, not headlines. Examples of titles that fit:
- "Why the Strait of Malacca still defines Indo-Pacific strategy"
- "The rare-earth bottleneck: mining vs. processing as the real chokepoint"
- "Russia–EU energy: how a 50-year partnership unwound in 18 months"
- "Semiconductor geography after the CHIPS Act"
Each piece grounds itself in a recent development, then explains the structural forces behind it.

**REGIONS — find ONE recent (last 7 days) story per region. SKIP a region if no real news exists; do not fabricate.**
1. USA, 2. INDIA, 3. UK, 4. EU, 5. GLOBAL

**ARTICLE STRUCTURE (use exactly this format — each section must be substantive, NOT a one-liner):**

## What happened
A full paragraph (3–5 sentences) factually summarising the recent event with names, dates, and a primary source cited inline.

## Background context
Two paragraphs (~200–300 words) explaining the historical or institutional backdrop. What is the longer-running tension, treaty, dispute, or trend this fits into? Reference at least one prior moment so a reader unfamiliar with the topic can follow.

## Why it matters
A full paragraph on the structural geopolitical or economic stakes. Connect to specific actors who win/lose and the underlying force this illustrates.

## Key facts
- 5–8 bullet points with verified data only
- Cite source for any number: "(Reuters, ${dateISO})"
- Do not include numbers or quotes you cannot source

## Analysis
Three substantive paragraphs (~400–500 words total). First paragraph: what's the strategic logic of the actors involved. Second: what does this signal about the broader trajectory of regional/global power dynamics. Third: what counter-arguments or alternative readings exist? End the analysis with the strongest opposing view fairly stated.

## What to watch
4–6 concrete forward-looking signals — specific deadlines, scheduled meetings, statistical indicators, decisions due — clearly labelled as forecasts not facts. Each with a brief sentence on why it matters.

**OUTPUT — return ONLY a valid JSON array, nothing else:**
[
  {
    "title": "Analytical headline (60–90 chars). NOT a fake breaking-news headline.",
    "tldr": "One sentence on what's happening and why it matters (150–200 chars).",
    "metaTitle": "SEO title (50–60 chars).",
    "metaDescription": "Search snippet (150–160 chars).",
    "content": "Full ~1500–2200 word article following the structure above. Markdown headings allowed. Each section should be substantive — multiple paragraphs of analysis, not bullet-point summaries.",
    "tags": ["topic-tag", "region-tag", "specific-tag"],
    "topicCluster": "USA | INDIA | UK | EU | GLOBAL",
    "authorName": "Staff",
    "authorOrg": "GeoPolitiq",
    "sourceUrl": "URL of the primary source from your search results",
    "imageUrl": "",
    "imageSource": "",
    "imageAlt": ""
  }
]

If you have only 3 well-sourced stories, return 3. Quality over quantity. Better to return 2 articles you can fully source than 5 that include invented details.
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
 * Get current model — uses aiConfig.primaryModel which is driven by AI_MODEL env.
 */
function getCurrentModel() {
    return aiConfig.primaryModel;
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
async function callOpenRouter(prompt, sonarOptions = {}) {
    let retryCount = 0;
    const maxRetries = 100;
    let lastError = null;
    let consecutiveEmpty = 0;

    while (retryCount < maxRetries) {
        const apiKey = getApiKey();
        const model = getCurrentModel();

        console.log(`[AI] Attempt ${retryCount + 1}: Calling ${model.split('/').pop()} `);

        try {
            const payload = {
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5,
                max_tokens: sonarOptions.max_tokens || 16000,
            };
            // Merge Perplexity Sonar / web-search params if provided
            for (const key of [
                'search_recency_filter',
                'search_after_date_filter',
                'search_before_date_filter',
                'search_domain_filter',
                'return_images',
                'return_citations',
                'return_related_questions',
                'web_search_options',
            ]) {
                if (sonarOptions[key] !== undefined) payload[key] = sonarOptions[key];
            }
            const response = await axios.post(
                aiConfig.baseUrl,
                payload,
                {
                    headers: aiConfig.getHeaders(apiKey),
                    timeout: 120000 // 2 minute timeout for longer content
                }
            );

            if (response.data?.choices?.[0]?.message?.content) {
                console.log(`[AI] Success on attempt ${retryCount + 1} `);
                return response.data.choices[0].message.content;
            }

            // Empty content with HTTP 200 — usually means upstream validation error
            // (e.g. domain-filter too large). Bail after a few consecutive empties so
            // we don't burn cap looping.
            consecutiveEmpty++;
            const upstreamErr = response.data?.error?.message || 'empty content';
            console.error(`[AI] Empty response (#${consecutiveEmpty}); upstream: ${String(upstreamErr).substring(0, 160)}`);
            if (consecutiveEmpty >= 3) {
                const err = new Error(`Sonar returned empty content ${consecutiveEmpty} times: ${upstreamErr}`);
                err.response = { status: 422, data: response.data };
                throw err;
            }
            throw new Error('Invalid response structure from OpenRouter');
        } catch (error) {
            lastError = error;
            console.error(`[AI] Attempt ${retryCount + 1} failed: `, error.message);

            const status = error.response?.status;
            // Auth / quota / spend-cap errors — no point retrying, bail out.
            if (status === 401 || status === 402 || status === 403) {
                console.error('[AI] Hard auth/quota error ' + status + ', giving up');
                throw error;
            }
            if (status === 429) {
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
    // Titles: pull the most recent 100 for the avoid-duplication prompt.
    // Source URLs: only block re-use of URLs from the LAST 30 DAYS — older
    // sources are fair game again as fresh perspective on new developments.
    const posts = await Post.find({})
        .sort({ createdAt: -1 })
        .limit(100)
        .select('title sourceUrl createdAt')
        .lean();

    const titles = posts.map(p => p.title);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sourceUrls = posts
        .filter(p => p.createdAt && p.createdAt >= thirtyDaysAgo)
        .map(p => p.sourceUrl)
        .filter(Boolean);

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

const SONAR_REGIONS = [
    {
        key: 'USA',
        label: 'United States',
        location: { country: 'US' },
        domains: [],
    },
    {
        key: 'EUROPE',
        label: 'Europe / EU',
        location: { country: 'BE' },
        domains: [],
    },
    {
        key: 'UK',
        label: 'United Kingdom',
        location: { country: 'GB' },
        domains: [],
    },
];

function buildRegionPrompt(region, existingTitles = [], avoidKeywords = []) {
    const now = new Date();
    const todayFormatted = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const dateISO = now.toISOString().split('T')[0];

    const avoidPart = existingTitles.length > 0
        ? `\n**ALREADY COVERED — find a DIFFERENT story:**\n${existingTitles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : '';
    const kwPart = avoidKeywords.length > 0
        ? `\n**Overused keywords to avoid:** ${avoidKeywords.slice(0, 12).join(', ')}`
        : '';

    return `You are a senior geopolitics analyst writing for GeoPolitiq. Today is ${todayFormatted} (${dateISO}).

**FOCUS REGION FOR THIS CALL: ${region.label}**

Find ONE recent (last 24 hours) story from this region that has geopolitical significance. The web search has been domain-restricted to credible outlets and date-restricted to the last day; use ONLY what those results actually contain.

**HARD ANTI-HALLUCINATION RULES — VIOLATING ANY OF THESE WILL CAUSE THE FACT-CHECKER TO DELETE YOUR ARTICLE:**
1. Use ONLY facts that appear in your web search results.
2. NEVER invent timestamps, dollar/euro/rupee amounts, vote tallies, casualty counts, or quotes.
3. If your search returned nothing usable for this region, return an empty JSON array []. Do NOT fabricate to fill the slot.
4. Do NOT predict election results, court rulings, summit outcomes, or events that have not happened yet.

**STYLE — analytical context, not breaking-news ticker.**
Examples of titles that fit:
- "Why the Strait of Malacca still defines Indo-Pacific strategy"
- "Russia–EU energy: how a 50-year partnership unwound in 18 months"
- "Semiconductor geography after the CHIPS Act"

**ARTICLE STRUCTURE (markdown):**
## What happened
2–3 factual sentences citing a source by name.

## Why it matters
The structural geopolitical/economic context.

## Key facts
- Verified data only, sourced inline like "(Reuters, ${dateISO})"

## Analysis
Two short paragraphs (~150 words) connecting to broader strategic dynamics.

## What to watch
2–3 forward-looking signals labelled as forecasts, not facts.

**OUTPUT — return ONLY a valid JSON array containing exactly ONE article (or [] if no usable story):**
[
  {
    "title": "Analytical headline (60–90 chars)",
    "tldr": "One-sentence summary (150–200 chars)",
    "metaTitle": "SEO title (50–60 chars)",
    "metaDescription": "Search snippet (150–160 chars)",
    "content": "Full ~1500–2200 word article with the structure above. Each section needs multiple paragraphs of substantive analysis — not bullet-point summaries.",
    "tags": ["region-tag", "topic-tag", "specific-tag"],
    "topicCluster": "${region.key}",
    "authorName": "Staff",
    "authorOrg": "GeoPolitiq",
    "sourceUrl": "URL of the primary source from your search results",
    "imageUrl": "",
    "imageSource": "",
    "imageAlt": ""
  }
]
${avoidPart}${kwPart}

START YOUR RESPONSE WITH [ — NO OTHER TEXT.`;
}

function yesterdayMMDDYYYY() {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
}

async function generateForRegion(region, existingTitles, avoidKeywords) {
    const prompt = buildRegionPrompt(region, existingTitles, avoidKeywords);
    const sonarOptions = {
        max_tokens: 16000,
        search_recency_filter: 'day',
        search_after_date_filter: yesterdayMMDDYYYY(),
        // search_domain_filter removed — Sonar caps at 10 domains and we
        // want full-web variety. Source quality is enforced by the
        // verifier downstream.
        return_images: true,
        return_citations: true,
        web_search_options: {
            search_context_size: 'low',
            user_location: region.location,
        },
    };
    try {
        const text = await callOpenRouter(prompt, sonarOptions);
        const posts = parseResponse(text);
        for (const p of posts) {
            if (!p.topicCluster) p.topicCluster = region.key;
        }
        return posts;
    } catch (err) {
        console.error(`[AI] Region ${region.key} failed: ${err.message}`);
        return [];
    }
}

/**
 * Generate posts using AI
 * Includes retry mechanism and passes deduplication data to save function
 */
function pickBatchKeys() {
    // Only 3 regions configured: USA + EUROPE + UK.
    // Europe is always in; partner alternates USA / UK.
    // Slot 0 (00:00 UTC) -> EUROPE + USA
    // Slot 1 (06:00 UTC) -> EUROPE + UK
    // Slot 2 (12:00 UTC) -> EUROPE + USA
    // Slot 3 (18:00 UTC) -> EUROPE + UK
    const slot = Math.floor(new Date().getUTCHours() / 6) % 4;
    const partner = ['USA', 'UK', 'USA', 'UK'][slot];
    return ['EUROPE', partner];
}

async function generatePosts() {
    console.log('[AI] Starting region-targeted post generation...');

    const existingData = await getExistingPostData();
    console.log(`[AI] Found ${existingData.titles.length} existing posts to check against`);

    const batchKeys = pickBatchKeys();
    const batch = SONAR_REGIONS.filter((r) => batchKeys.includes(r.key));
    console.log(`[AI] Batch this run: ${batchKeys.join(' + ')}`);

    const aggregated = [];
    for (const region of batch) {
        console.log(`[AI] -> Region ${region.key} (${region.domains.length} domains, location=${region.location.country})`);
        const posts = await generateForRegion(region, existingData.titles, existingData.keywords);
        console.log(`[AI]    region ${region.key} returned ${posts.length} post(s)`);
        for (const p of posts) aggregated.push(p);
        await sleep(800);
    }

    // De-dupe by title slug to avoid duplicate cross-prints
    const seen = new Set();
    const deduped = [];
    for (const p of aggregated) {
        const k = (p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        deduped.push(p);
    }
    console.log(`[AI] Aggregated ${aggregated.length} -> deduped ${deduped.length} posts across ${batch.length} regions`);
    return { posts: deduped, existingData };
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
            const __img = await searchNewsImageWithSource(postData.title, postData.sourceUrl || '');
            const featuredImage = __img.url;
            const imageSource = (
                __img.source === 'source-og'   ? (postData.authorOrg || 'Source') :
                __img.source === 'google'      ? 'Web (via Google Images)' :
                __img.source === 'duckduckgo'  ? 'Web (via DuckDuckGo)' :
                __img.source === 'wikimedia'   ? 'Wikimedia Commons' :
                'Pexels'
            );

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

        // Re-query to keep only the verifier-survivors. Without this filter,
        // IndexNow / push notifications / social-repost enqueue all fan out
        // to posts that no longer exist (the verifier just deleted them).
        const survivors = await Post.find({
            _id: { $in: saved.map(p => p._id) },
            status: 'published',
        }).lean();
        return {
            success: true,
            count: verifyResult.verified,
            deleted: verifyResult.deleted,
            posts: survivors,
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

            const status = error.response?.status;
            // Auth / quota / spend-cap errors — no point retrying, bail out.
            if (status === 401 || status === 402 || status === 403) {
                console.error('[AI] Hard auth/quota error ' + status + ', giving up');
                throw error;
            }
            if (status === 429) {
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
