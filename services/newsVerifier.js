/**
 * News Verification Service
 * Uses Perplexity Sonar model via OpenRouter to fact-check AI-generated posts
 */

const axios = require('axios');

// Perplexity Sonar model for web search verification
const VERIFICATION_MODEL = 'perplexity/sonar';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Get API key from environment
 */
function getApiKey() {
    const keys = (process.env.OPENROUTER_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }
    return keys[0]; // Use first key for verification
}

/**
 * Verify a news post using Perplexity Sonar's web search
 * @param {Object} post - Post object with title and tldr
 * @returns {Object} { isValid, confidence, sources, reason }
 */
async function verifyPost(post) {
    const apiKey = getApiKey();

    const prompt = `You are a fact-checker. Verify if this news claim is factually accurate by searching the web:

TITLE: ${post.title}
SUMMARY: ${post.tldr}

Search for corroborating sources and respond ONLY with valid JSON (no markdown):
{
  "isValid": true or false,
  "confidence": number from 0 to 100,
  "sources": ["source1 name/url", "source2 name/url"],
  "reason": "brief explanation"
}

Rules:
- Mark isValid=false if: no credible sources found, claim is fabricated, or contradicts verified news
- Mark isValid=true if: multiple credible sources confirm the claim
- confidence should reflect how well-sourced the claim is
- For breaking/recent news with limited sources, use 60-70% confidence if plausible
- For clearly fabricated or unsourced claims, use <50% confidence`;

    try {
        console.log(`[Verifier] Checking: "${post.title.substring(0, 50)}..."`);

        const response = await axios.post(OPENROUTER_URL, {
            model: VERIFICATION_MODEL,
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://geopolitiq.com',
                'X-Title': 'GeoPolitiq News Verifier'
            },
            timeout: 30000
        });

        const content = response.data.choices?.[0]?.message?.content || '';

        // Parse JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('[Verifier] Could not parse response:', content.substring(0, 200));
            return { isValid: true, confidence: 50, sources: [], reason: 'Verification inconclusive' };
        }

        const result = JSON.parse(jsonMatch[0]);

        console.log(`[Verifier] Result: valid=${result.isValid}, confidence=${result.confidence}%`);

        return {
            isValid: result.isValid === true,
            confidence: parseInt(result.confidence) || 0,
            sources: result.sources || [],
            reason: result.reason || 'No reason provided'
        };

    } catch (error) {
        console.error('[Verifier] Error:', error.message);
        // On error, allow the post (don't block on verification failures)
        return { isValid: true, confidence: 50, sources: [], reason: `Verification error: ${error.message}` };
    }
}

/**
 * Verify multiple posts, delete those below confidence threshold
 * @param {Array} posts - Array of saved post documents
 * @param {number} threshold - Minimum confidence to keep (default 70)
 * @returns {Object} { verified: count, deleted: count }
 */
async function verifyAndFilterPosts(posts, threshold = 70) {
    const Post = require('../models/Post');
    let verified = 0;
    let deleted = 0;

    for (const post of posts) {
        const result = await verifyPost(post);

        if (!result.isValid || result.confidence < threshold) {
            console.log(`[Verifier] ❌ DELETING: "${post.title}" (confidence: ${result.confidence}%, reason: ${result.reason})`);
            await Post.findByIdAndDelete(post._id);
            deleted++;
        } else {
            console.log(`[Verifier] ✓ VERIFIED: "${post.title}" (confidence: ${result.confidence}%)`);
            verified++;
        }

        // Small delay between verifications to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }

    return { verified, deleted };
}

module.exports = {
    verifyPost,
    verifyAndFilterPosts
};
