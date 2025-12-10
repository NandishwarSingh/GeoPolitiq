/**
 * Country to Topic Cluster Mapper
 * Maps user's detected country to the corresponding topicCluster
 */

const COUNTRY_TO_CLUSTER = {
    // India
    'India': 'India',

    // USA
    'United States': 'USA',
    'United States of America': 'USA',

    // UK
    'United Kingdom': 'UK',
    'England': 'UK',
    'Scotland': 'UK',
    'Wales': 'UK',
    'Northern Ireland': 'UK',

    // EU Countries
    'Germany': 'EU',
    'France': 'EU',
    'Italy': 'EU',
    'Spain': 'EU',
    'Netherlands': 'EU',
    'Belgium': 'EU',
    'Poland': 'EU',
    'Portugal': 'EU',
    'Austria': 'EU',
    'Sweden': 'EU',
    'Denmark': 'EU',
    'Finland': 'EU',
    'Ireland': 'EU',
    'Greece': 'EU',
    'Czech Republic': 'EU',
    'Romania': 'EU',
    'Hungary': 'EU',
    'Slovakia': 'EU',
    'Croatia': 'EU',
    'Slovenia': 'EU',
    'Estonia': 'EU',
    'Latvia': 'EU',
    'Lithuania': 'EU',
    'Bulgaria': 'EU',
    'Luxembourg': 'EU',
    'Malta': 'EU',
    'Cyprus': 'EU',

    // Also map Russia/Ukraine to EU for news purposes
    'Russia': 'EU',
    'Ukraine': 'EU',
    'Belarus': 'EU',
    'Norway': 'EU',
    'Switzerland': 'EU'
};

/**
 * Map a country name to its corresponding topicCluster
 * @param {string} country - Country name from IP geolocation
 * @returns {string} - topicCluster (USA, India, UK, EU, or Global)
 */
function mapCountryToCluster(country) {
    if (!country) return 'Global';
    return COUNTRY_TO_CLUSTER[country] || 'Global';
}

/**
 * Get country from IP using ip-api.com
 * @param {string} ip - IP address
 * @returns {Promise<string>} - Country name or null
 */
function getCountryFromIP(ip) {
    return new Promise((resolve) => {
        // Clean IP first (remove ::ffff: prefix)
        const cleanIP = (ip || '').replace('::ffff:', '');

        // Skip localhost/private IPs
        if (!cleanIP || cleanIP === '::1' || cleanIP === '127.0.0.1' ||
            cleanIP.startsWith('192.168.') || cleanIP.startsWith('10.') || cleanIP.startsWith('localhost')) {
            resolve('Local');
            return;
        }

        const http = require('http');
        const url = `http://ip-api.com/json/${cleanIP}?fields=status,country`;

        http.get(url, { timeout: 2000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success' && json.country) {
                        resolve(json.country);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null))
            .on('timeout', () => resolve(null));
    });
}

module.exports = {
    mapCountryToCluster,
    getCountryFromIP,
    COUNTRY_TO_CLUSTER
};
