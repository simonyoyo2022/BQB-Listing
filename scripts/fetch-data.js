/**
 * BQB Listing Data Fetcher
 * Runs via GitHub Actions monthly to pre-fetch data from Bluetooth SIG API.
 * Saves results to data/listings.json for the PWA to consume.
 */

const COMPANIES = ['Airoha', 'Nordic', 'Silicon Labs', 'Telink', 'Realtek', 'Realsil'];
const API_URL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';

function getDateFiveYearsAgo() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function fetchCompanyListings(companyName) {
    const searchCriteria = {
        MemberId: null,
        IcsItem: null,
        SearchString: companyName,
        SearchQualificationsAndDesigns: true,
        SearchDeclarationOnly: true,
        SearchPRDProductList: true,
        SearchMyCompany: false,
        ProductTypeId: 0,
        SpecName: 0,
        SpecNameText: '',
        BQAApprovalStatusId: -1,
        BQALockStatusId: -1,
        ListingDateEarliest: getDateFiveYearsAgo(),
        ListingDateLatest: null,
        Layers: [],
        SearchEndProductList: false,
        MaxResults: 5000,
        IncludeTestData: undefined
    };

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(searchCriteria)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Filter by company name
    return data.filter(item => {
        const cn = (item.CompanyName || '').toLowerCase();
        if (companyName === 'Silicon Labs') return cn.includes('silicon lab');
        if (companyName === 'Realsil') return cn.includes('realsil');
        if (companyName === 'Realtek') return cn.includes('realtek');
        if (companyName === 'Nordic') return cn.includes('nordic');
        return cn.includes(companyName.toLowerCase());
    });
}

function extractYear(dateStr) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.getFullYear().toString();
}

function extractQuarter(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const month = d.getMonth(); // 0-based
    const q = Math.floor(month / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
}

async function main() {
    console.log(`[${new Date().toISOString()}] Starting BQB data fetch...`);
    console.log(`Fetching data from ${getDateFiveYearsAgo()} to now`);

    const allProducts = [];
    const seen = new Set();

    for (const company of COMPANIES) {
        console.log(`  Fetching: ${company}...`);
        try {
            const listings = await fetchCompanyListings(company);
            let count = 0;

            for (const listing of listings) {
                if (listing.Products && listing.Products.length > 0) {
                    for (const prod of listing.Products) {
                        const dateStr = listing.ListingDate || prod.PublishDate || '';
                        const key = `${listing.ListingId}|${prod.MarketingName || ''}|${prod.Model || ''}|${company}`;

                        if (!seen.has(key)) {
                            seen.add(key);
                            allProducts.push({
                                company: listing.CompanyName || company,
                                searchCompany: company,
                                productName: prod.MarketingName || '',
                                description: prod.Description || '',
                                modelNumber: prod.Model || '',
                                listingId: listing.ListingId || '',
                                listingDate: dateStr,
                                year: extractYear(dateStr),
                                quarter: extractQuarter(dateStr)
                            });
                            count++;
                        }
                    }
                }
            }

            console.log(`    → ${count} products`);
        } catch (err) {
            console.error(`    ✗ Error: ${err.message}`);
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 800));
    }

    console.log(`\nTotal: ${allProducts.length} products`);

    // Write output
    const fs = await import('fs');
    const path = await import('path');
    const outDir = path.default.join(process.cwd(), 'data');
    fs.default.mkdirSync(outDir, { recursive: true });

    const output = {
        fetchedAt: new Date().toISOString(),
        dateRange: { from: getDateFiveYearsAgo(), to: new Date().toISOString().slice(0, 10) },
        totalProducts: allProducts.length,
        products: allProducts
    };

    const outFile = path.default.join(outDir, 'listings.json');
    fs.default.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\nData saved to ${outFile}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
