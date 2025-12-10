/**
 * Tag Matcher Service
 * Uses Aho-Corasick algorithm for fast multi-pattern matching
 * Scalable to millions of tags with O(n+m) complexity
 */

const AhoCorasick = require('ahocorasick');

// Common words to exclude from linking
const EXCLUDED_WORDS = new Set([
    'news', 'report', 'update', 'latest', 'breaking',
    'the', 'and', 'for', 'with', 'from', 'that', 'this',
    'have', 'has', 'had', 'will', 'would', 'could', 'should',
    'says', 'said', 'new', 'now', 'today', 'year', 'years',
    'more', 'also', 'been', 'being', 'about', 'after', 'before',
    'between', 'into', 'over', 'under', 'most', 'other', 'some',
    'what', 'when', 'where', 'which', 'who', 'why', 'how'
]);

// Minimum tag length to avoid matching very short words
const MIN_TAG_LENGTH = 3;

class TagMatcher {
    constructor() {
        this.ac = null;
        this.tagMap = new Map(); // lowercase → original tag
        this.lastUpdate = 0;
        this.tagCount = 0;
    }

    /**
     * Build the Aho-Corasick trie from tags
     * @param {string[]} tags - Array of tag names
     */
    async buildIndex(tags) {
        const startTime = Date.now();
        const patterns = [];
        this.tagMap.clear();

        for (const tag of tags) {
            const lower = tag.toLowerCase().trim();

            // Skip excluded words and short tags
            if (EXCLUDED_WORDS.has(lower)) continue;
            if (lower.length < MIN_TAG_LENGTH) continue;

            this.tagMap.set(lower, tag);
            patterns.push(lower);
        }

        if (patterns.length > 0) {
            this.ac = new AhoCorasick(patterns);
        } else {
            this.ac = null;
        }

        this.tagCount = patterns.length;
        this.lastUpdate = Date.now();

        console.log(`[TagMatcher] Built index with ${this.tagCount} tags in ${Date.now() - startTime}ms`);
    }

    /**
     * Check if position is inside an HTML tag or already linked
     */
    isInsideHtmlTag(html, position) {
        // Find the last < before position
        let lastOpen = html.lastIndexOf('<', position);
        if (lastOpen === -1) return false;

        // Find the next > after lastOpen
        let nextClose = html.indexOf('>', lastOpen);

        // If position is between < and >, we're inside a tag
        return nextClose > position;
    }

    /**
     * Check if position is inside an anchor tag
     */
    isInsideAnchor(html, position) {
        const before = html.substring(0, position);
        const lastAnchorOpen = before.lastIndexOf('<a ');
        const lastAnchorClose = before.lastIndexOf('</a>');

        // If last <a is after last </a>, we're inside an anchor
        return lastAnchorOpen > lastAnchorClose;
    }

    /**
     * Check if position is inside a table
     */
    isInsideTable(html, position) {
        const before = html.substring(0, position);
        const lastTableOpen = before.lastIndexOf('<table');
        const lastTableClose = before.lastIndexOf('</table>');
        return lastTableOpen > lastTableClose;
    }

    /**
     * Apply tag links to HTML content
     * @param {string} html - HTML content to linkify
     * @returns {string} - HTML with tag links added
     */
    linkify(html) {
        if (!this.ac || !html) return html;

        const startTime = Date.now();
        const lowerHtml = html.toLowerCase();
        const matches = this.ac.search(lowerHtml);

        if (matches.length === 0) return html;

        // Sort by position ascending (process from start to track first occurrences)
        matches.sort((a, b) => a[0] - b[0]);

        // Track which tags have been linked (first occurrence only)
        const linkedTags = new Set();
        const replacements = [];
        let result = html;

        for (const match of matches) {
            const endPos = match[0];
            const patterns = match[1];
            const pattern = patterns[0];
            const startPos = endPos - pattern.length + 1;

            // Skip if this tag was already linked
            if (linkedTags.has(pattern)) continue;

            // Skip if inside HTML tag, anchor, or table
            if (this.isInsideHtmlTag(result, startPos)) continue;
            if (this.isInsideAnchor(result, startPos)) continue;
            if (this.isInsideTable(result, startPos)) continue;

            // Check word boundaries (not part of larger word)
            const charBefore = startPos > 0 ? result[startPos - 1] : ' ';
            const charAfter = endPos < result.length - 1 ? result[endPos + 1] : ' ';

            if (/[a-zA-Z0-9]/.test(charBefore) || /[a-zA-Z0-9]/.test(charAfter)) {
                continue; // Skip partial word matches
            }

            // Get original case from text
            const originalText = result.substring(startPos, endPos + 1);

            // Create subtle link (class for styling)
            const link = `<a href="/tag/${encodeURIComponent(pattern)}" class="inline-tag-link">${originalText}</a>`;

            // Store replacement for later (we'll apply from end to preserve positions)
            replacements.push({ startPos, endPos, link });
            linkedTags.add(pattern);
        }

        // Apply replacements from end to start to preserve positions
        replacements.sort((a, b) => b.startPos - a.startPos);
        for (const { startPos, endPos, link } of replacements) {
            result = result.substring(0, startPos) + link + result.substring(endPos + 1);
        }

        const elapsed = Date.now() - startTime;
        if (elapsed > 10) {
            console.log(`[TagMatcher] Linkified in ${elapsed}ms (${matches.length} potential matches)`);
        }

        return result;
    }

    /**
     * Get current stats
     */
    getStats() {
        return {
            tagCount: this.tagCount,
            lastUpdate: this.lastUpdate,
            isReady: this.ac !== null
        };
    }
}

// Export singleton instance
module.exports = new TagMatcher();
