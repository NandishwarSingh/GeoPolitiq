/**
 * Table Sanitizer
 * Fixes common markdown table formatting issues from AI-generated content
 */

/**
 * Sanitize markdown tables before parsing
 * @param {string} markdown - Raw markdown content
 * @returns {string} - Sanitized markdown
 */
function sanitizeTables(markdown) {
    if (!markdown) return '';

    // Process line by line
    const lines = markdown.split('\n');
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this line looks like a table (contains multiple pipes)
        if (line.includes('|') && (line.match(/\|/g) || []).length > 2) {
            // This might be multiple table rows concatenated
            const fixedLines = splitTableRows(line);
            result.push(...fixedLines);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

/**
 * Split a line that may contain multiple table rows concatenated
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRows(line) {
    let text = line.trim();

    // Fix double/triple pipes
    text = text.replace(/\|{2,}/g, '|');

    // Split by | and get all cells
    const allParts = text.split('|');

    // Filter empty parts at start/end
    const cells = allParts.map(p => p.trim());

    // Find separator cells (--- or :---:) to detect column count
    let separatorIndices = [];
    for (let i = 0; i < cells.length; i++) {
        if (/^[-:]+$/.test(cells[i]) && cells[i].length >= 2) {
            separatorIndices.push(i);
        }
    }

    // If we found consecutive separator cells, that's our column count
    if (separatorIndices.length >= 2) {
        // Find consecutive run of separators
        let runStart = separatorIndices[0];
        let runEnd = runStart;
        for (let i = 1; i < separatorIndices.length; i++) {
            if (separatorIndices[i] === separatorIndices[i - 1] + 1) {
                runEnd = separatorIndices[i];
            } else {
                break;
            }
        }

        const colCount = runEnd - runStart + 1;

        // Now rebuild table with proper rows
        const nonEmptyCells = cells.filter(c => c !== '');

        if (nonEmptyCells.length >= colCount * 2) { // At least header + separator
            const rows = [];

            // Build header
            const headerCells = nonEmptyCells.slice(0, colCount);
            rows.push('| ' + headerCells.join(' | ') + ' |');

            // Build separator
            const sepCells = nonEmptyCells.slice(colCount, colCount * 2);
            rows.push('| ' + sepCells.join(' | ') + ' |');

            // Build data rows
            let idx = colCount * 2;
            while (idx + colCount <= nonEmptyCells.length) {
                const rowCells = nonEmptyCells.slice(idx, idx + colCount);
                rows.push('| ' + rowCells.join(' | ') + ' |');
                idx += colCount;
            }

            return rows;
        }
    }

    // Fallback: if line already looks like a proper single table row, return as-is
    const pipeCount = (text.match(/\|/g) || []).length;
    if (pipeCount <= 5) {
        // Ensure it starts and ends with |
        if (!text.startsWith('|')) text = '| ' + text;
        if (!text.endsWith('|')) text = text + ' |';
        return [text];
    }

    // Return original if we can't parse it
    return [text];
}

module.exports = {
    sanitizeTables
};
