/* ============================================================
   BQB Listing Dashboard — Application Logic (PWA)
   ============================================================ */

// ── Configuration ──
const API_URL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';
const COMPANIES = ['Airoha', 'Nordic', 'Silicon Labs', 'Telink', 'Realtek', 'Realsil'];
const COMPANY_COLORS = {
    'Airoha':        { bg: 'rgba(0, 130, 252, 0.12)', border: '#0082FC', dot: '#0082FC', chart: '#0082FC' },
    'Nordic':        { bg: 'rgba(108, 92, 231, 0.12)', border: '#6C5CE7', dot: '#6C5CE7', chart: '#6C5CE7' },
    'Silicon Labs':  { bg: 'rgba(0, 201, 167, 0.12)', border: '#00C9A7', dot: '#00C9A7', chart: '#00C9A7' },
    'Telink':        { bg: 'rgba(247, 127, 0, 0.12)', border: '#F77F00', dot: '#F77F00', chart: '#F77F00' },
    'Realtek':       { bg: 'rgba(239, 68, 68, 0.12)', border: '#EF4444', dot: '#EF4444', chart: '#EF4444' },
    'Realsil':       { bg: 'rgba(168, 85, 247, 0.12)', border: '#A855F7', dot: '#A855F7', chart: '#A855F7' }
};

const PAGE_SIZE = 50;

// ── State ──
let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
let currentSort = { key: 'company', order: 'asc' };
let chartInstances = {};
let activeTab = 'charts';

// ── DOM refs ──
const $ = id => document.getElementById(id);

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    fetchAllData();
});

// ── Tab Switching ──
function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(section => {
        section.style.display = 'none';
    });
    if (tab === 'charts') {
        $('chartsSection').style.display = 'block';
    } else {
        $('tableSection').style.display = 'block';
    }
}

// ── Data Fetching ──
async function fetchAllData() {
    const overlay = $('loadingOverlay');
    const statusEl = $('loadingStatus');
    const progressEl = $('loadingProgress');
    const detailEl = $('loadingDetail');

    overlay.classList.remove('hidden');
    $('summarySection').style.display = 'none';
    $('tabNav').style.display = 'none';
    $('chartsSection').style.display = 'none';
    $('tableSection').style.display = 'none';
    $('exportBtn').disabled = true;

    allProducts = [];
    let companyResults = {};
    const total = COMPANIES.length;

    for (let i = 0; i < total; i++) {
        const company = COMPANIES[i];
        const pct = Math.round(((i) / total) * 100);
        progressEl.style.width = pct + '%';
        statusEl.textContent = `Fetching "${company}" ...  (${i + 1}/${total})`;
        detailEl.textContent = '';

        try {
            const data = await fetchCompanyListings(company);
            companyResults[company] = data;
            const count = data.length;
            detailEl.textContent = `Found ${count} listing(s) for ${company}`;
        } catch (err) {
            console.error(`Error fetching ${company}:`, err);
            detailEl.textContent = `Error fetching ${company}: ${err.message}`;
            companyResults[company] = [];
        }

        // Small delay to avoid rate limiting
        if (i < total - 1) {
            await sleep(600);
        }
    }

    progressEl.style.width = '100%';
    statusEl.textContent = 'Processing data...';

    // Process all results
    for (const company of COMPANIES) {
        const listings = companyResults[company] || [];
        for (const listing of listings) {
            if (listing.Products && listing.Products.length > 0) {
                for (const prod of listing.Products) {
                    allProducts.push({
                        company: listing.CompanyName || company,
                        searchCompany: company,
                        productName: prod.MarketingName || '',
                        description: prod.Description || '',
                        modelNumber: prod.Model || '',
                        listingId: listing.ListingId || '',
                        listingDate: listing.ListingDate || prod.PublishDate || '',
                        year: extractYear(listing.ListingDate || prod.PublishDate || '')
                    });
                }
            }
        }
    }

    // De-duplicate by listingId + productName + modelNumber
    const seen = new Set();
    const deduped = [];
    for (const p of allProducts) {
        const key = `${p.listingId}|${p.productName}|${p.modelNumber}|${p.searchCompany}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(p);
        }
    }
    allProducts = deduped;

    statusEl.textContent = `Done! Loaded ${allProducts.length} products.`;
    await sleep(500);

    // Render UI
    renderSummaryCards();
    renderCharts();
    populateFilters();
    filterTable();

    $('summarySection').style.display = 'block';
    $('tabNav').style.display = 'flex';
    switchTab(activeTab);
    $('exportBtn').disabled = false;

    overlay.classList.add('hidden');

    // Save to localStorage for offline quick view
    try {
        localStorage.setItem('bqb_cache_time', new Date().toISOString());
        localStorage.setItem('bqb_data', JSON.stringify(allProducts));
    } catch (e) { /* ignore quota errors */ }
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
        ListingDateEarliest: null,
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

    // Filter results to only include items matching the company name
    return data.filter(item => {
        const cn = (item.CompanyName || '').toLowerCase();
        const searchTerm = companyName.toLowerCase();
        if (companyName === 'Silicon Labs') {
            return cn.includes('silicon lab');
        }
        if (companyName === 'Realsil') {
            return cn.includes('realsil');
        }
        if (companyName === 'Realtek') {
            return cn.includes('realtek');
        }
        if (companyName === 'Nordic') {
            return cn.includes('nordic');
        }
        return cn.includes(searchTerm);
    });
}

// ── Helpers ──
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractYear(dateStr) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.getFullYear().toString();
}

// ── Summary Cards ──
function renderSummaryCards() {
    const grid = $('summaryGrid');
    grid.innerHTML = '';

    // Total products card
    grid.appendChild(createSummaryCard('Total Products', allProducts.length, 'All combined', '#0082FC'));

    // Total unique models
    const uniqueModels = new Set(allProducts.map(p => p.modelNumber).filter(Boolean));
    grid.appendChild(createSummaryCard('Unique Models', uniqueModels.size, 'Distinct models', '#6C5CE7'));

    // Year span
    const years = allProducts.map(p => p.year).filter(y => y !== 'Unknown').sort();
    const yearSpan = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'N/A';
    const yearsCard = createSummaryCard('Year Range', yearSpan, `${new Set(years).size} years`, '#00C9A7');
    yearsCard.querySelector('.card-value').style.fontSize = '18px';
    grid.appendChild(yearsCard);

    // Per-company cards
    for (const company of COMPANIES) {
        const companyProducts = allProducts.filter(p => p.searchCompany === company);
        const color = COMPANY_COLORS[company]?.chart || '#888';
        grid.appendChild(createSummaryCard(company, companyProducts.length, 'products', color));
    }
}

function createSummaryCard(label, value, sub, color) {
    const card = document.createElement('div');
    card.className = 'summary-card fade-in-up';
    card.innerHTML = `
        <div class="card-label">${label}</div>
        <div class="card-value" style="color: ${color}; text-shadow: 0 0 20px ${color}44;">${value}</div>
        <div class="card-sub">${sub}</div>
    `;
    card.style.borderTop = `3px solid ${color}`;
    return card;
}

// ── Charts ──
function renderCharts() {
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};

    const yearCompanyData = buildYearCompanyData();
    const years = yearCompanyData.years;

    // Chart.js dark theme
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const tooltipStyle = {
        backgroundColor: '#1a1f35',
        titleColor: '#f0f2f5',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8
    };

    const legendStyle = {
        position: 'top',
        labels: { padding: 12, usePointStyle: true, pointStyle: 'rectRounded', font: { size: 10, weight: '600' } }
    };

    // 1. Product Count by Year & Company
    chartInstances.product = new Chart($('productChart'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: COMPANIES.map(company => ({
                label: company,
                data: years.map(y => yearCompanyData.productCounts[company]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[company]?.chart + '99',
                borderColor: COMPANY_COLORS[company]?.chart,
                borderWidth: 1,
                borderRadius: 3,
                hoverBackgroundColor: COMPANY_COLORS[company]?.chart
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: legendStyle, tooltip: tooltipStyle },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
            }
        }
    });

    // 2. Model Number Count by Year & Company
    chartInstances.model = new Chart($('modelChart'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: COMPANIES.map(company => ({
                label: company,
                data: years.map(y => yearCompanyData.modelCounts[company]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[company]?.chart + '99',
                borderColor: COMPANY_COLORS[company]?.chart,
                borderWidth: 1,
                borderRadius: 3,
                hoverBackgroundColor: COMPANY_COLORS[company]?.chart
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: legendStyle, tooltip: tooltipStyle },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
            }
        }
    });

    // 3. Stacked bar — Total Products Per Year
    chartInstances.stacked = new Chart($('stackedChart'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: COMPANIES.map(company => ({
                label: company,
                data: years.map(y => yearCompanyData.productCounts[company]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[company]?.chart + 'CC',
                borderColor: COMPANY_COLORS[company]?.chart,
                borderWidth: 1,
                hoverBackgroundColor: COMPANY_COLORS[company]?.chart
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: legendStyle, tooltip: tooltipStyle },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
            }
        }
    });
}

function buildYearCompanyData() {
    const yearSet = new Set();
    const productCounts = {};
    const modelCounts = {};
    const modelSets = {};

    for (const company of COMPANIES) {
        productCounts[company] = {};
        modelCounts[company] = {};
        modelSets[company] = {};
    }

    for (const p of allProducts) {
        const company = p.searchCompany;
        const year = p.year;
        if (year === 'Unknown') continue;
        yearSet.add(year);

        productCounts[company][year] = (productCounts[company][year] || 0) + 1;

        if (!modelSets[company][year]) modelSets[company][year] = new Set();
        if (p.modelNumber) modelSets[company][year].add(p.modelNumber);
    }

    for (const company of COMPANIES) {
        for (const year of yearSet) {
            modelCounts[company][year] = modelSets[company][year]?.size || 0;
        }
    }

    return { years: Array.from(yearSet).sort(), productCounts, modelCounts };
}

// ── Filters ──
function populateFilters() {
    const companySelect = $('companyFilter');
    const yearSelect = $('yearFilter');

    companySelect.innerHTML = '<option value="">All Companies</option>';
    yearSelect.innerHTML = '<option value="">All Years</option>';

    const companySet = new Set(allProducts.map(p => p.searchCompany));
    const yearSet = new Set(allProducts.map(p => p.year).filter(y => y !== 'Unknown'));

    Array.from(companySet).sort().forEach(c => {
        companySelect.innerHTML += `<option value="${c}">${c}</option>`;
    });

    Array.from(yearSet).sort().forEach(y => {
        yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
    });
}

// ── Table ──
function filterTable() {
    const search = ($('tableSearch')?.value || '').toLowerCase();
    const companyFilter = $('companyFilter')?.value || '';
    const yearFilter = $('yearFilter')?.value || '';

    filteredProducts = allProducts.filter(p => {
        if (companyFilter && p.searchCompany !== companyFilter) return false;
        if (yearFilter && p.year !== yearFilter) return false;
        if (search) {
            const searchStr = `${p.company} ${p.productName} ${p.description} ${p.modelNumber} ${p.listingId}`.toLowerCase();
            if (!searchStr.includes(search)) return false;
        }
        return true;
    });

    sortData();
    currentPage = 1;
    renderTable();
}

function sortTable(key) {
    if (currentSort.key === key) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.order = 'asc';
    }
    sortData();
    renderTable();
}

function sortData() {
    const { key, order } = currentSort;
    filteredProducts.sort((a, b) => {
        const aVal = (a[key] || '').toString().toLowerCase();
        const bVal = (b[key] || '').toString().toLowerCase();
        const cmp = aVal.localeCompare(bVal);
        return order === 'asc' ? cmp : -cmp;
    });
}

function renderTable() {
    const tbody = $('tableBody');
    const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredProducts.length);
    const pageItems = filteredProducts.slice(start, end);

    $('tableCount').textContent = filteredProducts.length > 0
        ? `${start + 1}–${end} of ${filteredProducts.length}`
        : '0 results';

    tbody.innerHTML = pageItems.map((p, i) => {
        const colors = COMPANY_COLORS[p.searchCompany] || COMPANY_COLORS['Airoha'];
        return `
        <tr>
            <td>${start + i + 1}</td>
            <td>
                <span class="company-badge" style="background:${colors.bg};border:1px solid ${colors.border}33;color:${colors.chart}">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${colors.dot}"></span>
                    ${escapeHtml(p.company)}
                </span>
            </td>
            <td title="${escapeHtml(p.productName)}">${escapeHtml(p.productName) || '—'}</td>
            <td title="${escapeHtml(p.description)}">${escapeHtml(p.description) || '—'}</td>
            <td>${escapeHtml(p.modelNumber) || '—'}</td>
            <td><a href="https://qualification.bluetooth.com/ListingDetails/${p.listingId}" target="_blank" rel="noopener">${p.listingId || '—'}</a></td>
        </tr>`;
    }).join('');

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const container = $('pagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">‹</button>`;

    const pages = getPaginationPages(currentPage, totalPages);
    for (const p of pages) {
        if (p === '...') {
            html += `<span class="page-info">…</span>`;
        } else {
            html += `<button class="${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
        }
    }

    html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">›</button>`;
    container.innerHTML = html;
}

function getPaginationPages(current, total) {
    const pages = [];
    if (total <= 7) {
        for (let i = 1; i <= total; i++) pages.push(i);
    } else {
        pages.push(1);
        if (current > 3) pages.push('...');
        const s = Math.max(2, current - 1);
        const e = Math.min(total - 1, current + 1);
        for (let i = s; i <= e; i++) pages.push(i);
        if (current < total - 2) pages.push('...');
        pages.push(total);
    }
    return pages;
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTable();
    $('tableSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Export CSV ──
function exportCSV() {
    if (allProducts.length === 0) return;

    const headers = ['Company', 'Product Name', 'Product Description', 'Model Number', 'Listing ID', 'Year'];
    const rows = allProducts.map(p => [
        csvEscape(p.company),
        csvEscape(p.productName),
        csvEscape(p.description),
        csvEscape(p.modelNumber),
        csvEscape(p.listingId),
        p.year
    ]);

    const bom = '\uFEFF';
    const csv = bom + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `BQB_Listings_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function csvEscape(str) {
    if (!str) return '';
    str = str.replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str}"`;
    return str;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
