/* ============================================================
   BQB Listing Dashboard — Application Logic (PWA)
   v3: Listing-based count, Realtek/Realsil merged, 2yr quarterly,
       one-page responsive
   ============================================================ */

const API_URL = 'https://qualificationapi.bluetooth.com/api/Platform/Listings/Search';
const DATA_JSON_URL = './data/listings.json';

// Fetch companies (API query terms)
const FETCH_COMPANIES = ['Airoha', 'Nordic', 'Silicon Labs', 'Telink', 'Realtek', 'Realsil'];

// Display companies (Realtek + Realsil merged)
const DISPLAY_COMPANIES = ['Airoha', 'Nordic', 'Silicon Labs', 'Telink', 'Realtek/Realsil'];

const COMPANY_COLORS = {
    'Airoha':           { bg: 'rgba(0, 130, 252, 0.12)', border: '#0082FC', dot: '#0082FC', chart: '#0082FC' },
    'Nordic':           { bg: 'rgba(108, 92, 231, 0.12)', border: '#6C5CE7', dot: '#6C5CE7', chart: '#6C5CE7' },
    'Silicon Labs':     { bg: 'rgba(0, 201, 167, 0.12)', border: '#00C9A7', dot: '#00C9A7', chart: '#00C9A7' },
    'Telink':           { bg: 'rgba(247, 127, 0, 0.12)', border: '#F77F00', dot: '#F77F00', chart: '#F77F00' },
    'Realtek/Realsil':  { bg: 'rgba(239, 68, 68, 0.12)', border: '#EF4444', dot: '#EF4444', chart: '#EF4444' }
};

const PAGE_SIZE = 50;
const YEARS_TO_KEEP = 5;
const QUARTERLY_YEARS = 2;

let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
let currentSort = { key: 'displayCompany', order: 'asc' };
let chartInstances = {};
let activeTab = 'charts';
let dataFetchedAt = null;

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => { fetchAllData(); });

// ── Mapping: merge Realtek & Realsil ──
function toDisplayCompany(searchCompany) {
    if (searchCompany === 'Realtek' || searchCompany === 'Realsil') return 'Realtek/Realsil';
    return searchCompany;
}

// ── Tab Switching ──
function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(s => s.style.display = 'none');
    if (tab === 'charts') {
        $('chartsSection').style.display = 'flex';
        setTimeout(() => Object.values(chartInstances).forEach(c => c.resize()), 50);
    } else if (tab === 'customers') {
        $('customersSection').style.display = 'block';
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
    $('customersSection').style.display = 'none';
    $('exportBtn').disabled = true;

    allProducts = [];

    statusEl.textContent = 'Loading data...';
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
                statusEl.textContent = `Loaded ${allProducts.length} products`;
            }
        }
    } catch (e) { console.warn('JSON not available:', e.message); }

    if (!loaded) {
        statusEl.textContent = 'Fetching from API...';
        progressEl.style.width = '10%';
        await fetchFromAPI(statusEl, progressEl, detailEl);
        dataFetchedAt = new Date().toISOString();
    }

    // 5-year filter
    const cutoffYear = new Date().getFullYear() - YEARS_TO_KEEP + 1;
    allProducts = allProducts.filter(p => p.year !== 'Unknown' && parseInt(p.year) >= cutoffYear);

    // Ensure quarter + displayCompany
    allProducts.forEach(p => {
        if (!p.quarter && p.listingDate) p.quarter = extractQuarter(p.listingDate);
        p.displayCompany = toDisplayCompany(p.searchCompany);
    });

    progressEl.style.width = '100%';
    statusEl.textContent = `Ready!`;
    await sleep(300);

    renderSummaryCards();
    renderCharts();
    populateFilters();
    filterTable();
    updateDataFreshness();
    loadCustomerData();

    $('summarySection').style.display = 'block';
    $('tabNav').style.display = 'flex';
    switchTab(activeTab);
    $('exportBtn').disabled = false;
    overlay.classList.add('hidden');
}

async function fetchFromAPI(statusEl, progressEl, detailEl) {
    const total = FETCH_COMPANIES.length;
    const fiveYearsAgo = getDateFiveYearsAgo();

    for (let i = 0; i < total; i++) {
        const company = FETCH_COMPANIES[i];
        progressEl.style.width = Math.round(10 + (i / total) * 80) + '%';
        statusEl.textContent = `Fetching "${company}" (${i + 1}/${total})`;

        try {
            const listings = await fetchCompanyListings(company, fiveYearsAgo);
            for (const listing of listings) {
                if (listing.Products?.length > 0) {
                    for (const prod of listing.Products) {
                        const dateStr = listing.ListingDate || prod.PublishDate || '';
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
                    }
                }
            }
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
    const body = {
        MemberId: null, IcsItem: null, SearchString: companyName,
        SearchQualificationsAndDesigns: true, SearchDeclarationOnly: true,
        SearchPRDProductList: true, SearchMyCompany: false,
        ProductTypeId: 0, SpecName: 0, SpecNameText: '',
        BQAApprovalStatusId: -1, BQALockStatusId: -1,
        ListingDateEarliest: dateFrom, ListingDateLatest: null,
        Layers: [], SearchEndProductList: false, MaxResults: 5000
    };
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
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
    const d = new Date(); d.setFullYear(d.getFullYear() - YEARS_TO_KEEP);
    return d.toISOString().slice(0, 10);
}
function extractYear(s) {
    if (!s) return 'Unknown'; const d = new Date(s);
    return isNaN(d.getTime()) ? 'Unknown' : d.getFullYear().toString();
}
function extractQuarter(s) {
    if (!s) return null; const d = new Date(s);
    return isNaN(d.getTime()) ? null : `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
function updateDataFreshness() {
    const el = $('dataFreshness');
    if (!el) return;
    if (dataFetchedAt) {
        el.textContent = `🔄 Updated: ${new Date(dataFetchedAt).toLocaleDateString('zh-TW')} · Auto-updates monthly`;
    } else { el.textContent = '🔄 Live data'; }
}

// ── Listing-based counting helpers ──
// Count unique listing IDs for a set of products
function countUniqueListings(products) {
    return new Set(products.map(p => p.listingId).filter(Boolean)).size;
}

// ── Summary Cards ──
function renderSummaryCards() {
    const grid = $('summaryGrid');
    grid.innerHTML = '';

    const totalListings = countUniqueListings(allProducts);
    grid.appendChild(createSummaryCard('Total Listings', totalListings, 'Unique listings', '#0082FC'));

    const uniqueModels = new Set(allProducts.map(p => p.modelNumber).filter(Boolean));
    grid.appendChild(createSummaryCard('Unique Models', uniqueModels.size, 'Model numbers', '#6C5CE7'));

    for (const dc of DISPLAY_COMPANIES) {
        const companyProducts = allProducts.filter(p => p.displayCompany === dc);
        const listingCount = countUniqueListings(companyProducts);
        const color = COMPANY_COLORS[dc]?.chart || '#888';
        grid.appendChild(createSummaryCard(dc, listingCount, 'listings', color));
    }
}

function createSummaryCard(label, value, sub, color) {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.innerHTML = `
        <div class="card-label">${label}</div>
        <div class="card-value" style="color:${color}">${value}</div>
        <div class="card-sub">${sub}</div>`;
    card.style.borderTop = `3px solid ${color}`;
    return card;
}

// ── Charts ──
function renderCharts() {
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};

    const ycData = buildYearCompanyData();
    const qData = buildQuarterlyData();

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const tt = { backgroundColor: '#1a1f35', titleColor: '#f0f2f5', bodyColor: '#94a3b8', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10, cornerRadius: 6 };
    const lg = { position: 'top', labels: { padding: 8, usePointStyle: true, pointStyle: 'rectRounded', font: { size: 9, weight: '600' } } };

    const mkDS = (labels, dataMap, alpha) => DISPLAY_COMPANIES.map(c => ({
        label: c,
        data: labels.map(l => dataMap[c]?.[l] || 0),
        backgroundColor: COMPANY_COLORS[c].chart + alpha,
        borderColor: COMPANY_COLORS[c].chart,
        borderWidth: 1, borderRadius: 2,
        hoverBackgroundColor: COMPANY_COLORS[c].chart
    }));

    const opts = (stacked) => ({
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: lg, tooltip: tt },
        scales: {
            x: { stacked, grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45 } },
            y: { stacked, beginAtZero: true, ticks: { precision: 0, font: { size: 9 } } }
        }
    });

    // 1. Listing Count by Year & Company
    chartInstances.product = new Chart($('productChart'), {
        type: 'bar',
        data: { labels: ycData.years, datasets: mkDS(ycData.years, ycData.listingCounts, '99') },
        options: opts(false)
    });

    // 2. Model Number Count by Year & Company
    chartInstances.model = new Chart($('modelChart'), {
        type: 'bar',
        data: { labels: ycData.years, datasets: mkDS(ycData.years, ycData.modelCounts, '99') },
        options: opts(false)
    });

    // 3. Quarterly Listing Count (last 2 years)
    chartInstances.quarterly = new Chart($('quarterlyChart'), {
        type: 'bar',
        data: { labels: qData.quarters, datasets: mkDS(qData.quarters, qData.counts, '99') },
        options: opts(false)
    });

    // 4. Stacked — Total Listings Per Year
    chartInstances.stacked = new Chart($('stackedChart'), {
        type: 'bar',
        data: { labels: ycData.years, datasets: mkDS(ycData.years, ycData.listingCounts, 'CC') },
        options: opts(true)
    });
}

function buildYearCompanyData() {
    const yearSet = new Set();
    // company -> year -> Set of listingIds
    const listingSets = {};
    const modelSets = {};
    const listingCounts = {};
    const modelCounts = {};

    for (const c of DISPLAY_COMPANIES) { listingSets[c] = {}; modelSets[c] = {}; listingCounts[c] = {}; modelCounts[c] = {}; }

    for (const p of allProducts) {
        const dc = p.displayCompany;
        const y = p.year;
        if (y === 'Unknown') continue;
        yearSet.add(y);
        if (!listingSets[dc][y]) listingSets[dc][y] = new Set();
        if (!modelSets[dc][y]) modelSets[dc][y] = new Set();
        if (p.listingId) listingSets[dc][y].add(p.listingId);
        if (p.modelNumber) modelSets[dc][y].add(p.modelNumber);
    }

    for (const c of DISPLAY_COMPANIES)
        for (const y of yearSet) {
            listingCounts[c][y] = listingSets[c][y]?.size || 0;
            modelCounts[c][y] = modelSets[c][y]?.size || 0;
        }

    return { years: Array.from(yearSet).sort(), listingCounts, modelCounts };
}

function buildQuarterlyData() {
    const cutoffYear = new Date().getFullYear() - QUARTERLY_YEARS + 1;
    const quarterSet = new Set();
    // company -> quarter -> Set of listingIds
    const listingSets = {};
    const counts = {};

    for (const c of DISPLAY_COMPANIES) { listingSets[c] = {}; counts[c] = {}; }

    for (const p of allProducts) {
        const q = p.quarter;
        if (!q) continue;
        const qYear = parseInt(q.split('-Q')[0]);
        if (qYear < cutoffYear) continue; // Only last 2 years

        const dc = p.displayCompany;
        quarterSet.add(q);
        if (!listingSets[dc][q]) listingSets[dc][q] = new Set();
        if (p.listingId) listingSets[dc][q].add(p.listingId);
    }

    for (const c of DISPLAY_COMPANIES)
        for (const q of quarterSet)
            counts[c][q] = listingSets[c][q]?.size || 0;

    const quarters = Array.from(quarterSet).sort((a, b) => {
        const [aY, aQ] = a.split('-Q').map(Number);
        const [bY, bQ] = b.split('-Q').map(Number);
        return aY !== bY ? aY - bY : aQ - bQ;
    });

    return { quarters, counts };
}

// ── Filters ──
function populateFilters() {
    const cs = $('companyFilter'), ys = $('yearFilter');
    cs.innerHTML = '<option value="">All Companies</option>';
    ys.innerHTML = '<option value="">All Years</option>';
    const cSet = new Set(allProducts.map(p => p.displayCompany));
    const ySet = new Set(allProducts.map(p => p.year).filter(y => y !== 'Unknown'));
    Array.from(cSet).sort().forEach(c => { cs.innerHTML += `<option value="${c}">${c}</option>`; });
    Array.from(ySet).sort().forEach(y => { ys.innerHTML += `<option value="${y}">${y}</option>`; });
}

// ── Table ──
function filterTable() {
    const search = ($('tableSearch')?.value || '').toLowerCase();
    const cf = $('companyFilter')?.value || '';
    const yf = $('yearFilter')?.value || '';

    filteredProducts = allProducts.filter(p => {
        if (cf && p.displayCompany !== cf) return false;
        if (yf && p.year !== yf) return false;
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
    sortData(); renderTable();
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
    const tp = Math.ceil(filteredProducts.length / PAGE_SIZE);
    const s = (currentPage - 1) * PAGE_SIZE;
    const e = Math.min(s + PAGE_SIZE, filteredProducts.length);
    const items = filteredProducts.slice(s, e);

    $('tableCount').textContent = filteredProducts.length > 0 ? `${s + 1}–${e} / ${filteredProducts.length}` : '0';

    tbody.innerHTML = items.map((p, i) => {
        const cl = COMPANY_COLORS[p.displayCompany] || COMPANY_COLORS['Airoha'];
        return `<tr>
            <td>${s + i + 1}</td>
            <td><span class="company-badge" style="background:${cl.bg};border:1px solid ${cl.border}33;color:${cl.chart}">
                <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${cl.dot}"></span>
                ${esc(p.displayCompany)}</span></td>
            <td title="${esc(p.productName)}">${esc(p.productName) || '—'}</td>
            <td title="${esc(p.description)}">${esc(p.description) || '—'}</td>
            <td>${esc(p.modelNumber) || '—'}</td>
            <td><a href="https://qualification.bluetooth.com/ListingDetails/${p.listingId}" target="_blank" rel="noopener">${p.listingId || '—'}</a></td>
        </tr>`;
    }).join('');
    renderPagination(tp);
}

function renderPagination(tp) {
    const c = $('pagination');
    if (tp <= 1) { c.innerHTML = ''; return; }
    let h = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">‹</button>`;
    for (const p of pagPages(currentPage, tp))
        h += p === '...' ? '<span class="page-info">…</span>' : `<button class="${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    h += `<button ${currentPage === tp ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">›</button>`;
    c.innerHTML = h;
}

function pagPages(c, t) {
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
    const p = [1]; if (c > 3) p.push('...');
    for (let i = Math.max(2, c - 1); i <= Math.min(t - 1, c + 1); i++) p.push(i);
    if (c < t - 2) p.push('...'); p.push(t); return p;
}

function goToPage(p) {
    const t = Math.ceil(filteredProducts.length / PAGE_SIZE);
    if (p < 1 || p > t) return;
    currentPage = p; renderTable();
    $('tableSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Export ──
function exportCSV() {
    if (!allProducts.length) return;
    const hd = ['Company', 'Product Name', 'Product Description', 'Model Number', 'Listing ID', 'Year', 'Quarter'];
    const rows = allProducts.map(p => [ce(p.displayCompany), ce(p.productName), ce(p.description), ce(p.modelNumber), ce(p.listingId), p.year, p.quarter || '']);
    const csv = '\uFEFF' + [hd.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `BQB_Listings_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function ce(s) { if (!s) return ''; s = s.replace(/"/g, '""'); return /[,"\n]/.test(s) ? `"${s}"` : s; }
function esc(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ══════════════════════════════════════════════
// CUSTOMER TAB
// ══════════════════════════════════════════════
const CUST_JSON_URL = './data/customers.json';
const CUST_PAGE_SIZE = 30;
let allCustomers = [];
let filteredCustomers = [];
let custPage = 1;
let custSort = { key: 'company', order: 'asc' };

// Load customer data (called after main data loads)
async function loadCustomerData() {
    try {
        const resp = await fetch(CUST_JSON_URL + '?t=' + Date.now());
        if (!resp.ok) return;
        const json = await resp.json();
        if (json.customers) {
            allCustomers = json.customers;
            populateCustFilters();
            filterCustomers();
        }
    } catch (e) {
        console.warn('Customer data not available:', e.message);
    }
}

function populateCustFilters() {
    const vf = $('custVendorFilter');
    if (!vf) return;
    vf.innerHTML = '<option value="">All IC Vendors</option>';
    const vendors = new Set(allCustomers.flatMap(c => c.icVendors));
    [...vendors].sort().forEach(v => { vf.innerHTML += `<option value="${v}">${v}</option>`; });
}

function filterCustomers() {
    const search = ($('custSearch')?.value || '').toLowerCase();
    const vendorFilter = $('custVendorFilter')?.value || '';

    filteredCustomers = allCustomers.filter(c => {
        if (vendorFilter && !c.icVendors.includes(vendorFilter)) return false;
        if (search) {
            const s = `${c.company} ${c.icVendors.join(' ')} ${c.products.join(' ')} ${c.applications.join(' ')}`.toLowerCase();
            if (!s.includes(search)) return false;
        }
        return true;
    });
    sortCustData();
    custPage = 1;
    renderCustomers();
}

function sortCustomers(key) {
    if (custSort.key === key) custSort.order = custSort.order === 'asc' ? 'desc' : 'asc';
    else { custSort.key = key; custSort.order = 'asc'; }
    sortCustData();
    renderCustomers();
}

function sortCustData() {
    const { key, order } = custSort;
    filteredCustomers.sort((a, b) => {
        let aVal, bVal;
        if (key === 'icVendors') { aVal = a.icVendors.join(','); bVal = b.icVendors.join(','); }
        else { aVal = a[key] || ''; bVal = b[key] || ''; }
        const cmp = aVal.toString().toLowerCase().localeCompare(bVal.toString().toLowerCase());
        return order === 'asc' ? cmp : -cmp;
    });
}

function renderCustomers() {
    const tbody = $('custBody');
    if (!tbody) return;
    const tp = Math.ceil(filteredCustomers.length / CUST_PAGE_SIZE);
    const s = (custPage - 1) * CUST_PAGE_SIZE;
    const e = Math.min(s + CUST_PAGE_SIZE, filteredCustomers.length);
    const items = filteredCustomers.slice(s, e);

    $('custCount').textContent = filteredCustomers.length > 0 ? `${s + 1}–${e} / ${filteredCustomers.length} companies` : '0';

    tbody.innerHTML = items.map((c, i) => {
        const vendorBadges = c.icVendors.map(v => {
            const cl = COMPANY_COLORS[v] || { bg: 'rgba(100,100,100,0.12)', border: '#888', chart: '#888' };
            return `<span class="company-badge" style="background:${cl.bg};border:1px solid ${cl.border}33;color:${cl.chart}">
                <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${cl.chart}"></span>
                ${esc(v)}</span>`;
        }).join(' ');

        const prodList = c.products.slice(0, 3).map(p => esc(p)).join('<br>');
        const appList = c.applications.slice(0, 2).map(a => `<span style="color:var(--muted);font-size:10px">${esc(a)}</span>`).join('<br>');
        const designList = c.designs.slice(0, 3).map(d => esc(d)).join(', ');

        return `<tr>
            <td>${s + i + 1}</td>
            <td title="${esc(c.company)}">${esc(c.company)}</td>
            <td>${vendorBadges}</td>
            <td style="white-space:normal;max-width:200px;">${prodList}${appList ? '<br>' + appList : ''}</td>
            <td title="${esc(c.designs.join(', '))}" style="font-size:10px;color:var(--muted)">${designList || '—'}</td>
        </tr>`;
    }).join('');

    renderCustPagination(tp);
}

function renderCustPagination(tp) {
    const c = $('custPagination');
    if (!c) return;
    if (tp <= 1) { c.innerHTML = ''; return; }
    let h = `<button ${custPage === 1 ? 'disabled' : ''} onclick="goToCustPage(${custPage - 1})">‹</button>`;
    for (const p of pagPages(custPage, tp))
        h += p === '...' ? '<span class="page-info">…</span>' : `<button class="${p === custPage ? 'active' : ''}" onclick="goToCustPage(${p})">${p}</button>`;
    h += `<button ${custPage === tp ? 'disabled' : ''} onclick="goToCustPage(${custPage + 1})">›</button>`;
    c.innerHTML = h;
}

function goToCustPage(p) {
    const t = Math.ceil(filteredCustomers.length / CUST_PAGE_SIZE);
    if (p < 1 || p > t) return;
    custPage = p; renderCustomers();
    $('customersSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
