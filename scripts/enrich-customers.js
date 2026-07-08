/**
 * Enrich existing customers.json with country/continent data.
 * Only fetches ONE listing detail per customer to get ContactCountry.
 * Much faster than full re-scan.
 */
const fs = require('fs');
const path = require('path');

const API_SEARCH = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';
const API_DETAIL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings';

// ── Continent / Region Mapping ──
function mapCountryToRegion(country) {
    const c = (country || '').toLowerCase().trim();
    const asiaMap = {
        'china': 'China', 'cn': 'China', 'prc': 'China', 'hong kong': 'China', 'macau': 'China', 'macao': 'China', 'taiwan': 'China',
        'india': 'India', 'in': 'India',
        'japan': 'Japan', 'jp': 'Japan',
        'korea': 'South Korea', 'south korea': 'South Korea', 'republic of korea': 'South Korea', 'kr': 'South Korea',
        'vietnam': 'Vietnam', 'viet nam': 'Vietnam', 'vn': 'Vietnam',
        'thailand': 'Thailand', 'th': 'Thailand',
        'malaysia': 'Malaysia', 'my': 'Malaysia',
        'singapore': 'Singapore', 'sg': 'Singapore',
        'indonesia': 'Indonesia', 'id': 'Indonesia',
        'philippines': 'Philippines', 'ph': 'Philippines',
    };
    for (const [key, label] of Object.entries(asiaMap)) {
        if (c.includes(key)) return { continent: 'Asia', subRegion: label };
    }
    const otherAsia = ['bangladesh', 'pakistan', 'sri lanka', 'myanmar', 'cambodia', 'laos', 'nepal', 'brunei', 'mongolia', 'uzbekistan', 'kazakhstan', 'israel', 'united arab emirates', 'uae', 'saudi arabia', 'qatar', 'bahrain', 'kuwait', 'oman', 'jordan', 'lebanon', 'iraq', 'iran', 'turkey', 'turkiye', 'armenia', 'georgia', 'azerbaijan'];
    if (otherAsia.some(a => c.includes(a))) return { continent: 'Asia', subRegion: 'Other Asia' };
    const europe = ['germany', 'france', 'united kingdom', 'uk', 'england', 'italy', 'spain', 'netherlands', 'belgium', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'czech', 'portugal', 'ireland', 'hungary', 'romania', 'greece', 'croatia', 'slovakia', 'slovenia', 'bulgaria', 'serbia', 'estonia', 'latvia', 'lithuania', 'luxembourg', 'malta', 'iceland', 'cyprus', 'ukraine', 'russia', 'belarus', 'moldova', 'albania', 'bosnia', 'montenegro', 'north macedonia', 'kosovo', 'scotland', 'wales', 'great britain', 'liechtenstein', 'monaco', 'andorra', 'san marino'];
    if (europe.some(e => c.includes(e))) return { continent: 'Europe', subRegion: 'Europe' };
    const northAm = ['united states', 'usa', 'canada', 'mexico', 'costa rica', 'panama', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'belize', 'jamaica', 'cuba', 'dominican', 'puerto rico', 'trinidad', 'bahamas', 'barbados', 'haiti'];
    if (northAm.some(n => c.includes(n)) || c === 'us') return { continent: 'North America', subRegion: 'North America' };
    const southAm = ['brazil', 'argentina', 'chile', 'colombia', 'peru', 'venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay', 'guyana', 'suriname'];
    if (southAm.some(s => c.includes(s))) return { continent: 'South America', subRegion: 'South America' };
    const oceania = ['australia', 'new zealand', 'fiji', 'papua new guinea', 'samoa', 'tonga'];
    if (oceania.some(o => c.includes(o))) return { continent: 'Oceania', subRegion: 'Oceania' };
    const africa = ['south africa', 'nigeria', 'kenya', 'egypt', 'morocco', 'ghana', 'ethiopia', 'tanzania', 'uganda', 'algeria', 'tunisia', 'senegal', 'cameroon', 'ivory coast', 'zimbabwe', 'mozambique', 'madagascar', 'rwanda', 'mauritius'];
    if (africa.some(a => c.includes(a))) return { continent: 'Africa', subRegion: 'Africa' };
    return { continent: 'Unknown', subRegion: 'Unknown' };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const dataFile = path.join(__dirname, '..', 'data', 'customers.json');
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    console.log(`Loaded ${data.customers.length} customers. Enriching with country data...`);

    let enriched = 0, failed = 0;
    const batchSize = 5;

    for (let i = 0; i < data.customers.length; i += batchSize) {
        const batch = data.customers.slice(i, i + batchSize);
        const promises = batch.map(async (cust) => {
            try {
                // Search for one listing from this company
                const r = await fetch(API_SEARCH, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        SearchString: cust.company,
                        SearchQualificationsAndDesigns: true,
                        SearchDeclarationOnly: true,
                        SearchPRDProductList: true,
                        MaxResults: 1
                    })
                });
                if (!r.ok) { failed++; return; }
                const listings = await r.json();
                if (!listings.length) { failed++; return; }

                // Get detail for country
                const dr = await fetch(API_DETAIL + '/' + listings[0].ListingId, {
                    headers: { 'Accept': 'application/json' }
                });
                if (!dr.ok) { failed++; return; }
                const det = await dr.json();
                const country = (det.ContactCountry || '').trim();
                if (country) {
                    const region = mapCountryToRegion(country);
                    cust.country = country;
                    cust.continent = region.continent;
                    cust.subRegion = region.subRegion;
                    enriched++;
                } else { failed++; }
            } catch (e) { failed++; }
        });
        await Promise.all(promises);
        if ((i + batchSize) % 50 < batchSize || i + batchSize >= data.customers.length) {
            process.stdout.write(`\r  ${Math.min(i + batchSize, data.customers.length)}/${data.customers.length} processed (${enriched} enriched, ${failed} failed)`);
        }
        await sleep(300);
    }

    // Fill in missing
    for (const c of data.customers) {
        if (!c.continent) {
            c.country = c.country || 'Unknown';
            c.continent = 'Unknown';
            c.subRegion = 'Unknown';
        }
    }

    data.fetchedAt = new Date().toISOString();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n\nDone! Enriched ${enriched}/${data.customers.length} customers.`);

    // Summary
    const continentCounts = {};
    for (const c of data.customers) {
        continentCounts[c.continent] = (continentCounts[c.continent] || 0) + 1;
    }
    console.log('By continent:', continentCounts);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
