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
        // Clean IP first (remove ::ffff: prefix for IPv4-mapped IPv6 addresses)
        let cleanIP = (ip || '').replace('::ffff:', '').trim();

        // Also handle cases where IP might have port (shouldn't happen, but just in case)
        if (cleanIP.includes(':') && !cleanIP.includes('::')) {
            cleanIP = cleanIP.split(':')[0];
        }

        // Log for debugging
        console.log(`[GeoIP] Processing IP: ${ip} → cleaned: ${cleanIP}`);

        // Skip localhost/private IPs - these can't be geolocated
        if (!cleanIP ||
            cleanIP === '::1' ||
            cleanIP === '127.0.0.1' ||
            cleanIP === 'localhost' ||
            cleanIP.startsWith('192.168.') ||
            cleanIP.startsWith('10.') ||
            cleanIP.startsWith('172.16.') ||
            cleanIP.startsWith('172.17.') ||
            cleanIP.startsWith('172.18.') ||
            cleanIP.startsWith('172.19.') ||
            cleanIP.startsWith('172.2') ||  // 172.20-29
            cleanIP.startsWith('172.30.') ||
            cleanIP.startsWith('172.31.') ||
            cleanIP === '0.0.0.0' ||
            cleanIP.startsWith('169.254.')) {  // Link-local addresses
            console.log(`[GeoIP] IP ${cleanIP} is local/private, returning 'Local'`);
            resolve('Local');
            return;
        }

        const http = require('http');
        const url = `http://ip-api.com/json/${cleanIP}?fields=status,country,message`;

        const request = http.get(url, { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success' && json.country) {
                        console.log(`[GeoIP] IP ${cleanIP} → Country: ${json.country}`);
                        resolve(json.country);
                    } else {
                        console.log(`[GeoIP] IP ${cleanIP} lookup failed: ${json.message || 'unknown error'}`);
                        resolve(null);
                    }
                } catch (e) {
                    console.log(`[GeoIP] Failed to parse response for ${cleanIP}: ${e.message}`);
                    resolve(null);
                }
            });
        });

        request.on('error', (e) => {
            console.log(`[GeoIP] Request error for ${cleanIP}: ${e.message}`);
            resolve(null);
        });

        request.on('timeout', () => {
            console.log(`[GeoIP] Request timeout for ${cleanIP}`);
            request.destroy();
            resolve(null);
        });
    });
}

module.exports = {
    mapCountryToCluster,
    getCountryFromIP,
    COUNTRY_TO_CLUSTER
};
