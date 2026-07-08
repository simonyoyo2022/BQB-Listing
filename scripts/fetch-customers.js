/**
 * BQB Customer Discovery Script
 * Finds companies that use IC vendor QDs (Airoha, Nordic, Silicon Labs, Telink, Realtek/Realsil)
 * by scanning listing details for referenced QDID company names.
 */

const API_SEARCH = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';
const API_DETAIL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings';

const IC_VENDORS = ['airoha', 'nordic', 'silicon lab', 'telink', 'realtek', 'realsil'];

// Broad search terms that cover many end-product categories
const SEARCH_TERMS = [
    'headset', 'earbuds', 'earphone', 'headphone', 'TWS',
    'speaker', 'soundbar', 'audio',
    'mouse', 'keyboard', 'gamepad', 'controller', 'remote',
    'watch', 'band', 'tracker', 'fitness', 'wearable',
    'dongle', 'adapter', 'receiver', 'transmitter',
    'sensor', 'beacon', 'tag', 'lock', 'light', 'bulb',
    'thermostat', 'gateway', 'hub', 'module',
    'phone', 'tablet', 'laptop', 'TV', 'camera',
    'printer', 'scanner', 'medical', 'hearing aid',
    'car', 'automotive', 'vehicle', 'OBD',
    'toy', 'robot', 'drone', 'pet',
    'pen', 'stylus', 'meter', 'scale'
];

const DATE_FROM = '2022-01-01';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchListings(term) {
    const r = await fetch(API_SEARCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            SearchString: term,
            SearchQualificationsAndDesigns: true,
            SearchDeclarationOnly: true,
            SearchPRDProductList: true,
            MaxResults: 2000,
            ListingDateEarliest: DATE_FROM
        })
    });
    if (!r.ok) return [];
    return await r.json();
}

async function getListingDetail(listingId) {
    const r = await fetch(API_DETAIL + '/' + listingId, {
        headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    return await r.json();
}

function normalizeVendor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('airoha')) return 'Airoha';
    if (n.includes('nordic')) return 'Nordic';
    if (n.includes('silicon lab')) return 'Silicon Labs';
    if (n.includes('telink')) return 'Telink';
    if (n.includes('realtek') || n.includes('realsil')) return 'Realtek/Realsil';
    return null;
}

function isICVendorCompany(companyName) {
    const n = (companyName || '').toLowerCase();
    return IC_VENDORS.some(v => n.includes(v));
}

async function main() {
    console.log(`[${new Date().toISOString()}] Starting BQB Customer Discovery...`);
    console.log(`Scanning listings from ${DATE_FROM} to now\n`);

    // Step 1: Collect all unique listing IDs from search
    const allListingIds = new Set();
    const listingMeta = new Map(); // listingId -> { companyName, products }

    for (let i = 0; i < SEARCH_TERMS.length; i++) {
        const term = SEARCH_TERMS[i];
        process.stdout.write(`[${i + 1}/${SEARCH_TERMS.length}] Searching "${term}"...`);
        try {
            const results = await searchListings(term);
            let newCount = 0;
            for (const l of results) {
                if (!allListingIds.has(l.ListingId)) {
                    allListingIds.add(l.ListingId);
                    listingMeta.set(l.ListingId, {
                        companyName: l.CompanyName,
                        products: (l.Products || []).map(p => ({
                            name: p.MarketingName || '',
                            desc: p.Description || '',
                            model: p.Model || ''
                        }))
                    });
                    newCount++;
                }
            }
            console.log(` ${results.length} results, ${newCount} new (total: ${allListingIds.size})`);
        } catch (e) {
            console.log(` Error: ${e.message}`);
        }
        await sleep(400);
    }

    console.log(`\nTotal unique listings to scan: ${allListingIds.size}`);

    // Filter out IC vendor's own listings
    const candidateIds = [...allListingIds].filter(id => {
        const meta = listingMeta.get(id);
        return meta && !isICVendorCompany(meta.companyName);
    });
    console.log(`Non-IC-vendor listings to check: ${candidateIds.length}\n`);

    // Step 2: Fetch details to find IC vendor references
    const customers = new Map(); // companyName -> { vendors: Set, products: [], designs: [] }
    let checked = 0;
    let found = 0;
    const batchSize = 5;

    for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        const details = await Promise.all(batch.map(id => getListingDetail(id).catch(() => null)));

        for (let j = 0; j < details.length; j++) {
            checked++;
            const det = details[j];
            if (!det) continue;

            const refs = (det.Listing2QDID || []).filter(q => q.isReferenceOnly);
            for (const ref of refs) {
                const vendor = normalizeVendor(ref.ReferencedQDIDCompanyName);
                if (!vendor) continue;

                const companyName = det.Member?.CompanyName || listingMeta.get(batch[j])?.companyName || 'Unknown';
                if (isICVendorCompany(companyName)) continue;

                if (!customers.has(companyName)) {
                    customers.set(companyName, { vendors: new Set(), products: new Set(), designs: new Set(), applications: new Set(), country: '' });
                }
                // Capture country from listing detail (first seen wins)
                if (!customers.get(companyName).country && det.ContactCountry) {
                    customers.get(companyName).country = det.ContactCountry.trim();
                }
                const entry = customers.get(companyName);
                entry.vendors.add(vendor);
                entry.designs.add(ref.ReferencedDesignName || 'Unknown');

                const prods = det.ProductListings || [];
                for (const p of prods) {
                    if (p.MarketingName) entry.products.add(p.MarketingName);
                    if (p.Description) entry.applications.add(p.Description);
                }
            }
        }

        if (checked % 50 === 0 || i + batchSize >= candidateIds.length) {
            process.stdout.write(`\r  Checked ${checked}/${candidateIds.length} listings, found ${customers.size} customer companies`);
        }
        await sleep(200);
    }

    console.log(`\n\nDone! Found ${customers.size} customer companies.\n`);

    // Step 3: Build output
    const output = {
        fetchedAt: new Date().toISOString(),
        dateRange: { from: DATE_FROM, to: new Date().toISOString().slice(0, 10) },
        totalCustomers: customers.size,
        customers: []
    };

    for (const [company, data] of customers) {
        const country = data.country || 'Unknown';
        const region = mapCountryToRegion(country);
        output.customers.push({
            company,
            icVendors: [...data.vendors].sort(),
            products: [...data.products].slice(0, 20),
            applications: [...data.applications].slice(0, 10),
            designs: [...data.designs].slice(0, 20),
            country,
            continent: region.continent,
            subRegion: region.subRegion
        });
    }

    // Sort by number of vendors used (desc), then by name
    output.customers.sort((a, b) => b.icVendors.length - a.icVendors.length || a.company.localeCompare(b.company));

    // Save
    const fs = await import('fs');
    const path = await import('path');
    const outDir = path.default.join(process.cwd(), 'data');
    fs.default.mkdirSync(outDir, { recursive: true });
    const outFile = path.default.join(outDir, 'customers.json');
    fs.default.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`Saved to ${outFile}`);

    // Summary
    console.log('\n=== TOP CUSTOMERS ===');
    output.customers.slice(0, 30).forEach(c => {
        console.log(`${c.company} | IC Vendors: ${c.icVendors.join(', ')} | Products: ${c.products.slice(0, 3).join(', ')}`);
    });
}

// ── Continent / Region Mapping ──
function mapCountryToRegion(country) {
    const c = (country || '').toLowerCase().trim();

    // Asia — specific countries
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

    // Other Asia
    const otherAsia = ['bangladesh', 'pakistan', 'sri lanka', 'myanmar', 'cambodia', 'laos', 'nepal', 'brunei', 'mongolia', 'uzbekistan', 'kazakhstan', 'israel', 'united arab emirates', 'uae', 'saudi arabia', 'qatar', 'bahrain', 'kuwait', 'oman', 'jordan', 'lebanon', 'iraq', 'iran', 'turkey', 'turkiye', 'armenia', 'georgia', 'azerbaijan'];
    if (otherAsia.some(a => c.includes(a))) return { continent: 'Asia', subRegion: 'Other Asia' };

    // Europe
    const europe = ['germany', 'france', 'united kingdom', 'uk', 'england', 'italy', 'spain', 'netherlands', 'belgium', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'czech', 'portugal', 'ireland', 'hungary', 'romania', 'greece', 'croatia', 'slovakia', 'slovenia', 'bulgaria', 'serbia', 'estonia', 'latvia', 'lithuania', 'luxembourg', 'malta', 'iceland', 'cyprus', 'ukraine', 'russia', 'belarus', 'moldova', 'albania', 'bosnia', 'montenegro', 'north macedonia', 'kosovo', 'scotland', 'wales', 'great britain', 'liechtenstein', 'monaco', 'andorra', 'san marino'];
    if (europe.some(e => c.includes(e))) return { continent: 'Europe', subRegion: 'Europe' };

    // North America
    const northAm = ['united states', 'usa', 'us', 'canada', 'mexico', 'costa rica', 'panama', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'belize', 'jamaica', 'cuba', 'dominican', 'puerto rico', 'trinidad', 'bahamas', 'barbados', 'haiti'];
    if (northAm.some(n => c.includes(n)) || c === 'us') return { continent: 'North America', subRegion: 'North America' };

    // South America
    const southAm = ['brazil', 'argentina', 'chile', 'colombia', 'peru', 'venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay', 'guyana', 'suriname'];
    if (southAm.some(s => c.includes(s))) return { continent: 'South America', subRegion: 'South America' };

    // Oceania
    const oceania = ['australia', 'new zealand', 'fiji', 'papua new guinea', 'samoa', 'tonga'];
    if (oceania.some(o => c.includes(o))) return { continent: 'Oceania', subRegion: 'Oceania' };

    // Africa
    const africa = ['south africa', 'nigeria', 'kenya', 'egypt', 'morocco', 'ghana', 'ethiopia', 'tanzania', 'uganda', 'algeria', 'tunisia', 'senegal', 'cameroon', 'ivory coast', 'zimbabwe', 'mozambique', 'madagascar', 'rwanda', 'mauritius'];
    if (africa.some(a => c.includes(a))) return { continent: 'Africa', subRegion: 'Africa' };

    return { continent: 'Unknown', subRegion: 'Unknown' };
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
