/**
 * Adapter Base / Interface
 *
 * Every platform adapter exports a single async function:
 *
 *   async post(payload, ctx) → { remoteId, remoteUrl }
 *
 * Inputs:
 *   payload — produced by contentBuilder.buildPayload(). One of:
 *     - { kind: 'microblog', text, url, image, imageAlt, tags }
 *     - { kind: 'article',   title, subtitle, bodyHtml, bodyMarkdown,
 *                            canonicalUrl, tags, image, imageAlt }
 *
 *   ctx     — { subPlatform } — the instance URL for multi-instance platforms.
 *
 * Outputs:
 *   { remoteId, remoteUrl } on success.
 *   throw on failure — the queue's executeTask() handles categorization.
 *
 * Errors should preserve the upstream HTTP shape when possible:
 *   throw err; where err.response.status is set — the queue maps that to
 *   auth/rate/transient/content categories automatically.
 */

class NotImplementedAdapter {
    constructor(platform) {
        this.platform = platform;
    }
    async post() {
        const err = new Error(`Adapter for "${this.platform}" not implemented yet`);
        err.code = 'ADAPTER_NOT_IMPLEMENTED';
        // Categorize as 'config' so the queue doesn't retry forever
        err.response = { status: 501 };
        throw err;
    }
}

module.exports = { NotImplementedAdapter };
