/* ============================================================
   BQB Listing Dashboard — Application Logic (PWA)
   v2: Pre-fetched JSON, 5-year filter, quarterly analysis
   ============================================================ */

// ── Configuration ──
const API_URL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';
const DATA_JSON_URL = './data/listings.json';
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
const YEARS_TO_KEEP = 5;

// ── State ──
let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
let currentSort = { key: 'company', order: 'asc' };
let chartInstances = {};
let activeTab = 'charts';
let dataFetchedAt = null;

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
        // Resize charts so they render correctly when tab becomes visible
        Object.values(chartInstances).forEach(c => c.resize());
    } else {
        $('tableSection').style.display = 'block';
    }
}

// ── Data Fetching ──
// Strategy: try pre-fetched JSON first, fall back to live API
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

    // Try loading pre-fetched JSON
    statusEl.textContent = 'Loading cached data...';
    progressEl.style.width = '20%';

    let loaded = false;
    try {
        const resp = await fetch(DATA_JSON_URL + '?t=' + Date.now());
        if (resp.ok) {
            const json = await resp.json();
            if (json.products && json.products.length > 0) {
                allProducts = json.products;
                dataFetchedAt = json.fetchedAt || null;
                loaded = true;
                progressEl.style.width = '90%';
                statusEl.textContent = `Loaded ${allProducts.length} products from cache`;
                detailEl.textContent = dataFetchedAt
                    ? `Data fetched: ${new Date(dataFetchedAt).toLocaleDateString('zh-TW')}`
                    : '';
            }
        }
    } catch (e) {
        console.warn('Pre-fetched JSON not available, falling back to API:', e.message);
    }

    // Fallback: fetch from API live
    if (!loaded) {
        statusEl.textContent = 'Fetching from BQB API...';
        progressEl.style.width = '10%';
        await fetchFromAPI(statusEl, progressEl, detailEl);
        dataFetchedAt = new Date().toISOString();
    }

    // Apply 5-year filter (in case data includes older entries)
    const cutoffYear = new Date().getFullYear() - YEARS_TO_KEEP + 1;
    allProducts = allProducts.filter(p => {
        if (p.year === 'Unknown') return false;
        return parseInt(p.year) >= cutoffYear;
    });

    // Ensure quarter field exists
    allProducts.forEach(p => {
        if (!p.quarter && p.listingDate) {
            p.quarter = extractQuarter(p.listingDate);
        }
    });

    progressEl.style.width = '100%';
    statusEl.textContent = `Ready! ${allProducts.length} products (last ${YEARS_TO_KEEP} years)`;
    await sleep(400);

    // Render UI
    renderSummaryCards();
    renderCharts();
    populateFilters();
    filterTable();
    updateDataFreshness();

    $('summarySection').style.display = 'block';
    $('tabNav').style.display = 'flex';
    switchTab(activeTab);
    $('exportBtn').disabled = false;

    overlay.classList.add('hidden');
}

async function fetchFromAPI(statusEl, progressEl, detailEl) {
    const total = COMPANIES.length;
    const fiveYearsAgo = getDateFiveYearsAgo();

    for (let i = 0; i < total; i++) {
        const company = COMPANIES[i];
        const pct = Math.round(10 + ((i) / total) * 80);
        progressEl.style.width = pct + '%';
        statusEl.textContent = `Fetching "${company}" ...  (${i + 1}/${total})`;

        try {
            const listings = await fetchCompanyListings(company, fiveYearsAgo);
            let count = 0;

            for (const listing of listings) {
                if (listing.Products && listing.Products.length > 0) {
                    for (const prod of listing.Products) {
                        const dateStr = listing.ListingDate || prod.PublishDate || '';
                        const key = `${listing.ListingId}|${prod.MarketingName || ''}|${prod.Model || ''}|${company}`;

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
            detailEl.textContent = `Found ${count} product(s) for ${company}`;
        } catch (err) {
            console.error(`Error fetching ${company}:`, err);
            detailEl.textContent = `Error: ${err.message}`;
        }

        if (i < total - 1) await sleep(600);
    }

    // De-duplicate
    const seen = new Set();
    allProducts = allProducts.filter(p => {
        const key = `${p.listingId}|${p.productName}|${p.modelNumber}|${p.searchCompany}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function fetchCompanyListings(companyName, dateFrom) {
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
        ListingDateEarliest: dateFrom,
        ListingDateLatest: null,
        Layers: [],
        SearchEndProductList: false,
        MaxResults: 5000,
        IncludeTestData: undefined
    };

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(searchCriteria)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();

    return data.filter(item => {
        const cn = (item.CompanyName || '').toLowerCase();
        if (companyName === 'Silicon Labs') return cn.includes('silicon lab');
        if (companyName === 'Realsil') return cn.includes('realsil');
        if (companyName === 'Realtek') return cn.includes('realtek');
        if (companyName === 'Nordic') return cn.includes('nordic');
        return cn.includes(companyName.toLowerCase());
    });
}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getDateFiveYearsAgo() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - YEARS_TO_KEEP);
    return d.toISOString().slice(0, 10);
}

function extractYear(dateStr) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 'Unknown' : d.getFullYear().toString();
}

function extractQuarter(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function updateDataFreshness() {
    const el = $('dataFreshness');
    if (!el) return;
    if (dataFetchedAt) {
        const d = new Date(dataFetchedAt);
        el.textContent = `🔄 Data updated: ${d.toLocaleDateString('zh-TW')} • Auto-updates monthly`;
    } else {
        el.textContent = '🔄 Live data from BQB API';
    }
}

// ── Summary Cards ──
function renderSummaryCards() {
    const grid = $('summaryGrid');
    grid.innerHTML = '';

    grid.appendChild(createSummaryCard('Total Products', allProducts.length, 'All combined', '#0082FC'));

    const uniqueModels = new Set(allProducts.map(p => p.modelNumber).filter(Boolean));
    grid.appendChild(createSummaryCard('Unique Models', uniqueModels.size, 'Distinct models', '#6C5CE7'));

    const years = allProducts.map(p => p.year).filter(y => y !== 'Unknown').sort();
    const yearSpan = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'N/A';
    const yearsCard = createSummaryCard('Year Range', yearSpan, `${new Set(years).size} years`, '#00C9A7');
    yearsCard.querySelector('.card-value').style.fontSize = '18px';
    grid.appendChild(yearsCard);

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
    const quarterData = buildQuarterlyData();

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const tooltipStyle = {
        backgroundColor: '#1a1f35', titleColor: '#f0f2f5', bodyColor: '#94a3b8',
        borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8
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
            datasets: COMPANIES.map(c => ({
                label: c,
                data: years.map(y => yearCompanyData.productCounts[c]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[c].chart + '99',
                borderColor: COMPANY_COLORS[c].chart,
                borderWidth: 1, borderRadius: 3,
                hoverBackgroundColor: COMPANY_COLORS[c].chart
            }))
        },
        options: chartOptions(tooltipStyle, legendStyle)
    });

    // 2. Model Number Count by Year & Company
    chartInstances.model = new Chart($('modelChart'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: COMPANIES.map(c => ({
                label: c,
                data: years.map(y => yearCompanyData.modelCounts[c]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[c].chart + '99',
                borderColor: COMPANY_COLORS[c].chart,
                borderWidth: 1, borderRadius: 3,
                hoverBackgroundColor: COMPANY_COLORS[c].chart
            }))
        },
        options: chartOptions(tooltipStyle, legendStyle)
    });

    // 3. Quarterly Product Count by Company
    chartInstances.quarterly = new Chart($('quarterlyChart'), {
        type: 'bar',
        data: {
            labels: quarterData.quarters,
            datasets: COMPANIES.map(c => ({
                label: c,
                data: quarterData.quarters.map(q => quarterData.counts[c]?.[q] || 0),
                backgroundColor: COMPANY_COLORS[c].chart + '99',
                borderColor: COMPANY_COLORS[c].chart,
                borderWidth: 1, borderRadius: 3,
                hoverBackgroundColor: COMPANY_COLORS[c].chart
            }))
        },
        options: chartOptions(tooltipStyle, legendStyle)
    });

    // 4. Stacked bar — Total Per Year
    chartInstances.stacked = new Chart($('stackedChart'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: COMPANIES.map(c => ({
                label: c,
                data: years.map(y => yearCompanyData.productCounts[c]?.[y] || 0),
                backgroundColor: COMPANY_COLORS[c].chart + 'CC',
                borderColor: COMPANY_COLORS[c].chart,
                borderWidth: 1,
                hoverBackgroundColor: COMPANY_COLORS[c].chart
            }))
        },
        options: {
            ...chartOptions(tooltipStyle, legendStyle),
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
            }
        }
    });
}

function chartOptions(tooltip, legend) {
    return {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend, tooltip },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
        }
    };
}

function buildYearCompanyData() {
    const yearSet = new Set();
    const productCounts = {};
    const modelCounts = {};
    const modelSets = {};

    for (const c of COMPANIES) { productCounts[c] = {}; modelCounts[c] = {}; modelSets[c] = {}; }

    for (const p of allProducts) {
        const { searchCompany: c, year, modelNumber } = p;
        if (year === 'Unknown') continue;
        yearSet.add(year);
        productCounts[c][year] = (productCounts[c][year] || 0) + 1;
        if (!modelSets[c][year]) modelSets[c][year] = new Set();
        if (modelNumber) modelSets[c][year].add(modelNumber);
    }

    for (const c of COMPANIES)
        for (const y of yearSet)
            modelCounts[c][y] = modelSets[c][y]?.size || 0;

    return { years: Array.from(yearSet).sort(), productCounts, modelCounts };
}

function buildQuarterlyData() {
    const quarterSet = new Set();
    const counts = {};

    for (const c of COMPANIES) counts[c] = {};

    for (const p of allProducts) {
        const q = p.quarter;
        if (!q) continue;
        quarterSet.add(q);
        counts[p.searchCompany][q] = (counts[p.searchCompany][q] || 0) + 1;
    }

    // Sort quarters: "2022-Q1", "2022-Q2", ...
    const quarters = Array.from(quarterSet).sort((a, b) => {
        const [aY, aQ] = a.split('-Q').map(Number);
        const [bY, bQ] = b.split('-Q').map(Number);
        return aY !== bY ? aY - bY : aQ - bQ;
    });

    return { quarters, counts };
}

// ── Filters ──
function populateFilters() {
    const companySelect = $('companyFilter');
    const yearSelect = $('yearFilter');
    companySelect.innerHTML = '<option value="">All Companies</option>';
    yearSelect.innerHTML = '<option value="">All Years</option>';

    const companySet = new Set(allProducts.map(p => p.searchCompany));
    const yearSet = new Set(allProducts.map(p => p.year).filter(y => y !== 'Unknown'));

    Array.from(companySet).sort().forEach(c => { companySelect.innerHTML += `<option value="${c}">${c}</option>`; });
    Array.from(yearSet).sort().forEach(y => { yearSelect.innerHTML += `<option value="${y}">${y}</option>`; });
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
            const s = `${p.company} ${p.productName} ${p.description} ${p.modelNumber} ${p.listingId}`.toLowerCase();
            if (!s.includes(search)) return false;
        }
        return true;
    });

    sortData();
    currentPage = 1;
    renderTable();
}

function sortTable(key) {
    if (currentSort.key === key) currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    else { currentSort.key = key; currentSort.order = 'asc'; }
    sortData();
    renderTable();
}

function sortData() {
    const { key, order } = currentSort;
    filteredProducts.sort((a, b) => {
        const cmp = (a[key] || '').toString().toLowerCase().localeCompare((b[key] || '').toString().toLowerCase());
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
        ? `${start + 1}–${end} of ${filteredProducts.length}` : '0 results';

    tbody.innerHTML = pageItems.map((p, i) => {
        const colors = COMPANY_COLORS[p.searchCompany] || COMPANY_COLORS['Airoha'];
        return `<tr>
            <td>${start + i + 1}</td>
            <td><span class="company-badge" style="background:${colors.bg};border:1px solid ${colors.border}33;color:${colors.chart}">
                <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${colors.dot}"></span>
                ${esc(p.company)}</span></td>
            <td title="${esc(p.productName)}">${esc(p.productName) || '—'}</td>
            <td title="${esc(p.description)}">${esc(p.description) || '—'}</td>
            <td>${esc(p.modelNumber) || '—'}</td>
            <td><a href="https://qualification.bluetooth.com/ListingDetails/${p.listingId}" target="_blank" rel="noopener">${p.listingId || '—'}</a></td>
        </tr>`;
    }).join('');

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const c = $('pagination');
    if (totalPages <= 1) { c.innerHTML = ''; return; }
    let h = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">‹</button>`;
    for (const p of getPagPages(currentPage, totalPages)) {
        h += p === '...' ? `<span class="page-info">…</span>` : `<button class="${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }
    h += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">›</button>`;
    c.innerHTML = h;
}

function getPagPages(cur, tot) {
    if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1);
    const p = [1];
    if (cur > 3) p.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(tot - 1, cur + 1); i++) p.push(i);
    if (cur < tot - 2) p.push('...');
    p.push(tot);
    return p;
}

function goToPage(page) {
    const tot = Math.ceil(filteredProducts.length / PAGE_SIZE);
    if (page < 1 || page > tot) return;
    currentPage = page;
    renderTable();
    $('tableSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Export CSV ──
function exportCSV() {
    if (allProducts.length === 0) return;
    const headers = ['Company', 'Product Name', 'Product Description', 'Model Number', 'Listing ID', 'Year', 'Quarter'];
    const rows = allProducts.map(p => [
        csvEsc(p.company), csvEsc(p.productName), csvEsc(p.description),
        csvEsc(p.modelNumber), csvEsc(p.listingId), p.year, p.quarter || ''
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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

function csvEsc(s) {
    if (!s) return '';
    s = s.replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
}

function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
