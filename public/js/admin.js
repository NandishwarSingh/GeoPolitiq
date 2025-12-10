/**
 * GeoPolitiq - Admin JavaScript
 */

document.addEventListener('DOMContentLoaded', function () {
    // TL;DR character counter
    const tldrTextarea = document.getElementById('tldr');
    const tldrCount = document.getElementById('tldr-count');

    if (tldrTextarea && tldrCount) {
        function updateCount() {
            tldrCount.textContent = tldrTextarea.value.length;
        }

        tldrTextarea.addEventListener('input', updateCount);
        updateCount(); // Initial count
    }

    // Auto-generate slug from title (for new posts only)
    const titleInput = document.getElementById('title');
    const slugInput = document.getElementById('slug');

    if (titleInput && !slugInput) {
        // Only for new posts (no slug input)
        // The slug will be auto-generated on the server
    }

    // Confirm delete
    const deleteForms = document.querySelectorAll('.delete-form');
    deleteForms.forEach(function (form) {
        form.addEventListener('submit', function (e) {
            if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
                e.preventDefault();
            }
        });
    });

    // Tab support in textarea
    const bodyTextarea = document.getElementById('body');
    if (bodyTextarea) {
        bodyTextarea.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {
                e.preventDefault();

                const start = this.selectionStart;
                const end = this.selectionEnd;

                this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 2;
            }
        });
    }

    // Auto-save draft (localStorage)
    const editorForm = document.querySelector('.editor-form');
    if (editorForm && !document.querySelector('input[name="_method"]')) {
        // Only for new posts
        const STORAGE_KEY = 'geopolitiq_draft';

        // Load saved draft
        const savedDraft = localStorage.getItem(STORAGE_KEY);
        if (savedDraft) {
            try {
                const draft = JSON.parse(savedDraft);
                const now = new Date();
                const savedTime = new Date(draft.timestamp);
                const hoursSinceSave = (now - savedTime) / (1000 * 60 * 60);

                // Only offer to restore if draft is less than 24 hours old
                if (hoursSinceSave < 24) {
                    const restore = confirm('A draft was saved ' +
                        Math.floor(hoursSinceSave) + ' hours ago. Would you like to restore it?');

                    if (restore) {
                        if (titleInput) titleInput.value = draft.title || '';
                        if (tldrTextarea) tldrTextarea.value = draft.tldr || '';
                        if (bodyTextarea) bodyTextarea.value = draft.body || '';
                        const tagsInput = document.getElementById('tags');
                        if (tagsInput) tagsInput.value = draft.tags || '';
                    }
                }
            } catch (e) {
                console.error('Error restoring draft:', e);
            }
        }

        // Save draft periodically
        function saveDraft() {
            const draft = {
                title: titleInput ? titleInput.value : '',
                tldr: tldrTextarea ? tldrTextarea.value : '',
                body: bodyTextarea ? bodyTextarea.value : '',
                tags: document.getElementById('tags') ? document.getElementById('tags').value : '',
                timestamp: new Date().toISOString()
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        }

        // Save every 30 seconds
        setInterval(saveDraft, 30000);

        // Clear draft on successful submit
        editorForm.addEventListener('submit', function () {
            localStorage.removeItem(STORAGE_KEY);
        });
    }
});
