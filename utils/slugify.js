const slugify = require('slugify');

/**
 * Generate URL-friendly slug from text
 * @param {string} text - Text to slugify
 * @returns {string} URL-friendly slug
 */
const generateSlug = (text) => {
    return slugify(text, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g
    });
};

/**
 * Generate unique slug by appending number if needed
 * @param {string} baseSlug - Base slug to make unique
 * @param {Model} Model - Mongoose model to check against
 * @param {string} excludeId - ID to exclude from check (for updates)
 * @returns {Promise<string>} Unique slug
 */
const generateUniqueSlug = async (baseSlug, Model, excludeId = null) => {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
        const query = { slug };
        if (excludeId) {
            query._id = { $ne: excludeId };
        }

        const existing = await Model.findOne(query);
        if (!existing) {
            return slug;
        }

        slug = `${baseSlug}-${counter}`;
        counter++;
    }
};

module.exports = {
    generateSlug,
    generateUniqueSlug
};
