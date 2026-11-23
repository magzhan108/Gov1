/* ========================================
   Қала мәселелері — Бір беттік қосымша (SPA)
   Барлық логика бір файлда
   ======================================== */

// ==================== ДЕРЕКТЕР ====================
const STORAGE_KEY = 'city_reports';
const USERS_KEY = 'city_users';
const CURRENT_USER_KEY = 'city_current_user';

function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch { return []; } }
function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

// Ескі тесттік аккаунттарды толық тазарту
try {
    let oldUsers = getUsers();
    if (oldUsers.some(x => x.username === 'admin' && x.password === 'admin123')) {
        saveUsers(oldUsers.filter(x => !(x.username === 'admin' && x.password === 'admin123')));
    }
} catch (e) { }
function getCurrentUser() { try { return JSON.parse(localStorage.getItem(CURRENT_USER_KEY)); } catch { return null; } }
function setCurrentUser(u) {
    if (u) localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(CURRENT_USER_KEY);
    updateAuthUI();
}

const CATEGORIES = {
    'pothole': { label: 'Жол ойығы', emoji: '🕳️' },
    'trash': { label: 'Жиналмаған қоқыс', emoji: '🗑️' },
    'lighting': { label: 'Жарықтандыру мәселесі', emoji: '💡' },
    'water': { label: 'Су құбыры мәселесі', emoji: '💧' },
    'road-sign': { label: 'Жол белгісі', emoji: '🚧' },
    'greenery': { label: 'Көгалдандыру', emoji: '🌳' },
    'playground': { label: 'Ойын алаңы', emoji: '🛝' },
    'other': { label: 'Басқа', emoji: '📋' }
};

const STATUSES = {
    'new': { label: 'Жаңа', css: 'status-new', icon: 'fas fa-bell' },
    'in-progress': { label: 'Қаралуда', css: 'status-in-progress', icon: 'fas fa-spinner' },
    'resolved': { label: 'Шешілді', css: 'status-resolved', icon: 'fas fa-check-circle' },
    'rejected': { label: 'Қабылданбады', css: 'status-rejected', icon: 'fas fa-times-circle' }
};

function getReports() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function saveReports(r) { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); }

function addReport(data) {
    const cur = getCurrentUser();
    data.id = data.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
    data.date = new Date().toISOString();
    data.status = 'new';
    data.userId = cur ? cur.id : null;
    data.comments = []; // комментарийлер массиві

    // 1. Firebase бұлтты базасына сақтау
    if (typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured && db) {
        db.collection('reports').doc(data.id).set(data).catch(err => {
            console.error('Firebase save error:', err);
        });
    }

    // 2. Жергілікті кэшке сақтау
    const reports = getReports();
    reports.unshift(data);
    saveReports(reports);
    return data;
}

function updateReportStatus(id, status) {
    const cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') {
        showToast('Қате: Мәселе статусын тек әкімшілік өзгерте алады!', 'error');
        return null;
    }

    const updatedAt = new Date().toISOString();

    // Firebase бұлтты базасында жаңарту
    if (typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured && db) {
        db.collection('reports').doc(id).update({ status, updatedAt }).catch(err => {
            console.error('Firebase update error:', err);
        });
    }

    // Жергілікті жаңарту
    const reports = getReports();
    const r = reports.find(x => x.id === id);
    if (r) { r.status = status; r.updatedAt = updatedAt; saveReports(reports); }
    return r;
}

function addComment(reportId, comment) {
    const reports = getReports();
    const r = reports.find(x => x.id === reportId);
    if (r) {
        if (!r.comments) r.comments = [];
        comment.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
        comment.date = new Date().toISOString();
        r.comments.push(comment);
        saveReports(reports);

        // Firebase-те жаңарту
        if (typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured && db) {
            db.collection('reports').doc(reportId).update({
                comments: firebase.firestore.FieldValue.arrayUnion(comment)
            }).catch(err => console.error('Firebase comment error:', err));
        }
    }
    return r;
}

function getReportById(id) { return getReports().find(x => x.id === id); }

function deleteReport(id) {
    const cur = getCurrentUser();
    const reports = getReports();
    const r = reports.find(x => x.id === id);
    // Тек әкімші немесе мәселенің өз авторы өшіре алады
    if (!cur || (cur.role !== 'admin' && r && r.userId !== cur.id)) {
        showToast('Өшіруге құқығыңыз жоқ!', 'error');
        return;
    }

    // Firebase-тен жою
    if (typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured && db) {
        db.collection('reports').doc(id).delete().catch(err => console.error('Firebase delete error:', err));
    }

    const filtered = reports.filter(x => x.id !== id);
    saveReports(filtered);
    showToast('Хабарлама жойылды', 'info');
}

function getStats() {
    const r = getReports();
    return {
        total: r.length,
        new: r.filter(x => x.status === 'new').length,
        inProgress: r.filter(x => x.status === 'in-progress').length,
        resolved: r.filter(x => x.status === 'resolved').length,
        rejected: r.filter(x => x.status === 'rejected').length
    };
}

// ==================== КАРТА ҚАБАТЫ (TILE LAYER) ====================
// Esri World Street Map — API кілтті талап етпейтін, шектеусіз, анық халықаралық карта
const MAP_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const MAP_ATTRIBUTION = '&copy; Esri &mdash; OpenStreetMap, Garmin, USGS, NPS';

function createTileLayer() {
    return L.tileLayer(MAP_TILE_URL, {
        attribution: MAP_ATTRIBUTION,
        maxZoom: 19
    });
}
function esc(text) { const d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML; }

function formatDate(d) {
    const dt = new Date(d);
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function catLabel(key) { return CATEGORIES[key] ? `${CATEGORIES[key].emoji} ${CATEGORIES[key].label}` : key; }
function statusBadge(st) { const s = STATUSES[st] || STATUSES['new']; return `<span class="status-badge ${s.css}"><i class="${s.icon}"></i> ${s.label}</span>`; }

function showToast(msg, type = 'info') {
    let c = document.querySelector('.toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
    const icons = { success: 'fas fa-check-circle', error: 'fas fa-exclamation-circle', info: 'fas fa-info-circle' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="${icons[type] || icons.info}"></i> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

function resizeImage(dataUrl, maxW, cb) {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
}

// ==================== SPA НАВИГАЦИЯ ====================
let currentPage = 'home';
let previousPage = 'home';
let currentDetailId = null;
let reportMap = null;
let reportMarker = null;
let selectedLat = null, selectedLng = null;
let uploadedPhotos = [];
let adminMap = null;
let adminMarkers = [];
let detailMapInstance = null;
let commentPhotos = [];

function navigate(page, data) {
    const user = getCurrentUser();

    // Әкімшілік панелін қорғау: тек әкімшілер кіре алады
    if (page === 'admin') {
        if (!user || user.role !== 'admin') {
            showToast('Әкімшілік панеліне кіру үшін әкімшілік аккаунтымен жүйеге кіріңіз!', 'error');
            openAuthModal('login');
            return;
        }
    }

    // Менің өтініштерім: жүйеге кірген азаматтар үшін
    if (page === 'my-reports') {
        if (!user) {
            showToast('Өз өтініштеріңізді көру үшін жүйеге кіріңіз!', 'info');
            openAuthModal('login');
            return;
        }
    }

    previousPage = currentPage;
    currentPage = page;

    // Барлық беттерді жасыру
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) targetPage.style.display = 'block';

    // Навигация белсенділігі
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const navA = document.querySelector(`.nav-links a[data-page="${page}"]`);
    if (navA) navA.classList.add('active');

    // Navbar стилі
    const navbar = document.getElementById('navbar');
    navbar.classList.toggle('navbar-admin', page === 'admin');

    // Мобильді менюді жабу
    document.getElementById('navLinks').classList.remove('show');

    // Бетті іске қосу
    window.scrollTo(0, 0);
    if (page === 'home') initHome();
    if (page === 'report') initReport();
    if (page === 'my-reports') initMyReports();
    if (page === 'admin') initAdmin();
    if (page === 'detail') openDetail(data);
}

// ==================== МЕНІҢ ӨТІНІШТЕРІМ ====================
function initMyReports() {
    const user = getCurrentUser();
    if (!user) return;

    const reports = getReports().filter(r => r.userId === user.id || (user.name && r.author === user.name));
    const grid = document.getElementById('myReportsGrid');
    const noEl = document.getElementById('noMyReports');

    if (reports.length === 0) {
        grid.style.display = 'none';
        noEl.style.display = 'block';
        return;
    }

    noEl.style.display = 'none';
    grid.style.display = 'grid';

    grid.innerHTML = reports.map(r => {
        const img = r.photos && r.photos.length ? `<img src="${r.photos[0]}" alt="" class="report-card-image">`
            : `<div class="report-card-image" style="display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:3rem;"><i class="fas fa-image"></i></div>`;
        const commentCount = (r.comments || []).length;
        return `
        <div class="report-card" onclick="navigate('detail','${r.id}')">
            ${img}
            <div class="report-card-body">
                <span class="report-card-category">${catLabel(r.category)}</span>
                <div class="report-card-title">${esc(r.description)}</div>
                <div class="report-card-meta">
                    <span><i class="fas fa-clock"></i> ${formatDate(r.date)}</span>
                    <span><i class="fas fa-comments"></i> ${commentCount}</span>
                    ${statusBadge(r.status)}
                </div>
            </div>
        </div>`;
    }).join('');
}

function goBack() {
    navigate(previousPage === 'detail' ? 'home' : previousPage);
}

// ==================== БАСТЫ БЕТ ====================
function initHome() {
    const reports = getReports();
    const grid = document.getElementById('recentReports');
    const noEl = document.getElementById('noReports');
    const stats = getStats();

    document.getElementById('totalReports').textContent = stats.total;
    document.getElementById('pendingReports').textContent = stats.new + stats.inProgress;
    document.getElementById('resolvedReports').textContent = stats.resolved;

    if (reports.length === 0) {
        grid.style.display = 'none'; noEl.style.display = 'block'; return;
    }
    noEl.style.display = 'none'; grid.style.display = 'grid';
    grid.innerHTML = reports.slice(0, 6).map(r => {
        const img = r.photos && r.photos.length ? `<img src="${r.photos[0]}" alt="" class="report-card-image">`
            : `<div class="report-card-image" style="display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:3rem;"><i class="fas fa-image"></i></div>`;
        const commentCount = (r.comments || []).length;
        return `
        <div class="report-card" onclick="navigate('detail','${r.id}')">
            ${img}
            <div class="report-card-body">
                <span class="report-card-category">${catLabel(r.category)}</span>
                <div class="report-card-title">${esc(r.description)}</div>
                <div class="report-card-meta">
                    <span><i class="fas fa-clock"></i> ${formatDate(r.date)}</span>
                    <span><i class="fas fa-comments"></i> ${commentCount}</span>
                    ${statusBadge(r.status)}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==================== МӘСЕЛЕ ЖІБЕРУ ====================
function initReport() {
    updateAuthUI();
    // Карта бір рет инициализацияланады
    setTimeout(() => {
        if (!reportMap) {
            reportMap = L.map('reportMap').setView([51.1694, 71.4491], 13);
            createTileLayer().addTo(reportMap);
            reportMap.on('click', e => setReportMarker(e.latlng.lat, e.latlng.lng));

            document.getElementById('geolocateBtn').addEventListener('click', () => {
                if (!navigator.geolocation) {
                    return showToast('Браузеріңіз геолокацияны қолдамайды. Картадан өзіңіз басып белгілеңіз.', 'error');
                }
                showToast('Орныңыз анықталуда...', 'info');
                navigator.geolocation.getCurrentPosition(
                    p => {
                        reportMap.setView([p.coords.latitude, p.coords.longitude], 16);
                        setReportMarker(p.coords.latitude, p.coords.longitude);
                        showToast('Орныңыз анықталды!', 'success');
                    },
                    err => {
                        console.warn('Geolocation қатесі:', err);
                        let msg = 'Геолокацияға рұқсат берілмеген немесе бұғатталған. Картаны қолмен басып белгілеңіз!';
                        if (err.code === 1) {
                            msg = 'Геолокацияға рұқсат бұғатталған (Access Blocked). Браузер параметрлерінен рұқсат беріңіз немесе орынды картадан қолмен таңдаңыз!';
                        } else if (err.code === 2) {
                            msg = 'Құрылғы орны анықталмады. Картадан қолмен нүкте қойыңыз.';
                        }
                        showToast(msg, 'error');
                    },
                    { enableHighAccuracy: true, timeout: 8000 }
                );
            });
        } else {
            reportMap.invalidateSize();
        }
    }, 100);

    initPhotoUpload();
    initReportForm();
}

function setReportMarker(lat, lng) {
    selectedLat = lat; selectedLng = lng;
    if (reportMarker) reportMarker.setLatLng([lat, lng]);
    else {
        reportMarker = L.marker([lat, lng], { draggable: true }).addTo(reportMap);
        reportMarker.on('dragend', e => { selectedLat = e.target.getLatLng().lat; selectedLng = e.target.getLatLng().lng; updateCoords(); });
    }
    updateCoords();
}

function flyToCity(lat, lng) {
    if (reportMap) {
        reportMap.setView([lat, lng], 13);
        setReportMarker(lat, lng);
        showToast('Карта таңдалған қалаға ауыстырылды', 'info');
    }
}

function updateCoords() {
    document.getElementById('coordinates').innerHTML = `<i class="fas fa-map-pin" style="color:var(--primary)"></i> <strong>Координаталар:</strong> ${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`;
}

function initPhotoUpload() {
    const area = document.getElementById('uploadArea');
    const input = document.getElementById('photoInput');
    const wrap = document.getElementById('photoUpload');
    if (area._bound) return; area._bound = true;

    area.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragover'); });
    area.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
    area.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('dragover'); handlePhotos(e.dataTransfer.files); });
    input.addEventListener('change', e => handlePhotos(e.target.files));
}

function handlePhotos(files) {
    for (const f of files) {
        if (!f.type.startsWith('image/')) { showToast('Тек сурет рұқсат', 'error'); continue; }
        if (f.size > 5 * 1024 * 1024) { showToast('5МБ-тан аспауы керек', 'error'); continue; }
        if (uploadedPhotos.length >= 5) { showToast('Ең көбі 5 сурет', 'error'); break; }
        const reader = new FileReader();
        reader.onload = e => resizeImage(e.target.result, 800, r => { uploadedPhotos.push(r); renderPreviews(); });
        reader.readAsDataURL(f);
    }
}

function renderPreviews() {
    document.getElementById('photoPreview').innerHTML = uploadedPhotos.map((p, i) => `
        <div class="preview-item">
            <img src="${p}" alt="Сурет ${i + 1}">
            <button type="button" class="remove-photo" onclick="uploadedPhotos.splice(${i},1);renderPreviews();"><i class="fas fa-times"></i></button>
        </div>`).join('');
}

function initReportForm() {
    const form = document.getElementById('reportForm');
    if (form._bound) return; form._bound = true;

    form.addEventListener('submit', e => {
        e.preventDefault();
        const cat = document.getElementById('category').value;
        const desc = document.getElementById('description').value.trim();
        const addr = document.getElementById('address').value.trim();
        const author = document.getElementById('authorName').value.trim();
        const contact = document.getElementById('contact').value.trim();

        if (!cat) return showToast('Мәселе түрін таңдаңыз', 'error');
        if (!desc) return showToast('Сипаттама жазыңыз', 'error');
        if (selectedLat === null) return showToast('Картадан орынды белгілеңіз', 'error');

        addReport({ category: cat, description: desc, address: addr, author: author, contact: contact, lat: selectedLat, lng: selectedLng, photos: uploadedPhotos });
        document.getElementById('successModal').classList.add('active');
    });

    document.getElementById('newReportBtn').addEventListener('click', () => {
        document.getElementById('successModal').classList.remove('active');
        resetReportForm();
    });

    document.getElementById('successModal').addEventListener('click', e => {
        if (e.target.id === 'successModal') { e.target.classList.remove('active'); }
    });
}

function resetReportForm() {
    document.getElementById('reportForm').reset();
    uploadedPhotos = []; renderPreviews();
    if (reportMarker) { reportMap.removeLayer(reportMarker); reportMarker = null; }
    selectedLat = null; selectedLng = null;
    document.getElementById('coordinates').innerHTML = '<span class="coord-placeholder">Картадан нүктені басыңыз</span>';
}

// ==================== ӘКІМШІЛІК ====================
function initAdmin() {
    setTimeout(() => {
        if (!adminMap) {
            adminMap = L.map('adminMap').setView([51.1694, 71.4491], 12);
            createTileLayer().addTo(adminMap);

            document.getElementById('filterStatus').addEventListener('change', loadAdminReports);
            document.getElementById('filterCategory').addEventListener('change', loadAdminReports);
            document.getElementById('refreshBtn').addEventListener('click', () => { loadAdminStats(); loadAdminReports(); showToast('Жаңартылды', 'info'); });
        } else {
            adminMap.invalidateSize();
        }
        loadAdminStats();
        loadAdminReports();
    }, 100);
}

function loadAdminStats() {
    const s = getStats();
    document.getElementById('adminTotal').textContent = s.total;
    document.getElementById('adminNew').textContent = s.new;
    document.getElementById('adminInProgress').textContent = s.inProgress;
    document.getElementById('adminResolved').textContent = s.resolved;
}

function loadAdminReports() {
    const sf = document.getElementById('filterStatus').value;
    const cf = document.getElementById('filterCategory').value;
    let reports = getReports();
    if (sf !== 'all') reports = reports.filter(r => r.status === sf);
    if (cf !== 'all') reports = reports.filter(r => r.category === cf);

    const container = document.getElementById('adminReports');
    const noEl = document.getElementById('adminNoReports');

    // Карта маркерлері
    adminMarkers.forEach(m => adminMap.removeLayer(m)); adminMarkers = [];
    const colors = { 'new': '#0891b2', 'in-progress': '#f59e0b', 'resolved': '#16a34a', 'rejected': '#dc2626' };
    reports.forEach(r => {
        if (r.lat && r.lng) {
            const icon = L.divIcon({ className: 'custom-marker', html: `<div style="width:28px;height:28px;background:${colors[r.status] || '#0891b2'};border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;"></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
            const m = L.marker([r.lat, r.lng], { icon }).addTo(adminMap).bindPopup(`<strong>${catLabel(r.category)}</strong><br>${r.description.substring(0, 80)}...`);
            m.on('click', () => navigate('detail', r.id));
            adminMarkers.push(m);
        }
    });
    if (adminMarkers.length) adminMap.fitBounds(L.featureGroup(adminMarkers).getBounds().pad(0.1));

    if (!reports.length) { container.innerHTML = ''; noEl.style.display = 'block'; return; }
    noEl.style.display = 'none';

    container.innerHTML = reports.map(r => {
        const thumb = r.photos && r.photos.length ? `<img src="${r.photos[0]}" alt="" class="admin-report-thumb">`
            : `<div class="admin-report-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--text-light);"><i class="fas fa-image" style="font-size:1.5rem;"></i></div>`;
        const commentCount = (r.comments || []).length;
        return `
        <div class="admin-report-item" onclick="navigate('detail','${r.id}')">
            ${thumb}
            <div class="admin-report-info">
                <h4>${catLabel(r.category)}</h4>
                <p>${esc(r.description)}</p>
                <div class="meta">
                    <span><i class="fas fa-clock"></i> ${formatDate(r.date)}</span>
                    ${r.address ? `<span><i class="fas fa-map-pin"></i> ${esc(r.address)}</span>` : ''}
                    <span><i class="fas fa-comments"></i> ${commentCount} пікір</span>
                </div>
            </div>
            <div class="admin-report-actions" onclick="event.stopPropagation()">
                ${statusBadge(r.status)}
                ${adminButtons(r)}
            </div>
        </div>`;
    }).join('');
}

function adminButtons(r) {
    let b = [];
    if (r.status === 'new') b.push(`<button class="btn btn-sm btn-warning" onclick="changeStatus('${r.id}','in-progress')"><i class="fas fa-spinner"></i> Қарау</button>`);
    if (r.status === 'in-progress') b.push(`<button class="btn btn-sm btn-success" onclick="changeStatus('${r.id}','resolved')"><i class="fas fa-check"></i> Шешілді</button>`);
    if (r.status !== 'rejected' && r.status !== 'resolved') b.push(`<button class="btn btn-sm btn-danger" onclick="changeStatus('${r.id}','rejected')"><i class="fas fa-times"></i></button>`);
    if (r.status === 'resolved' || r.status === 'rejected') b.push(`<button class="btn btn-sm btn-secondary" onclick="changeStatus('${r.id}','new')"><i class="fas fa-undo"></i></button>`);
    return b.join('');
}

function changeStatus(id, st) {
    const cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') {
        showToast('Статусты тек әкімшілік өкілі өзгерте алады!', 'error');
        return;
    }
    updateReportStatus(id, st);
    showToast(`Статус: ${STATUSES[st].label}`, 'success');
    loadAdminStats();
    loadAdminReports();
}

// ==================== ДЕТАЛЬДЫ КӨРУ + КОММЕНТАРИЙЛЕР ====================
function openDetail(id) {
    currentDetailId = id;
    const r = getReportById(id);
    if (!r) { navigate('home'); return; }

    const content = document.getElementById('detailContent');
    const photos = r.photos && r.photos.length ? `<div class="detail-images">${r.photos.map(p => `<img src="${p}" alt="Мәселе суреті">`).join('')}</div>` : '';

    const user = getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const isAuthor = user && r.userId && user.id === r.userId;

    let actionButtonsHtml = '';
    if (isAdmin) {
        actionButtonsHtml = `
        <div class="admin-control-box">
            <h4><i class="fas fa-user-shield"></i> Әкімшілік басқару (статусты өзгерту):</h4>
            <div class="detail-actions">
                <button class="btn btn-warning" onclick="changeStatusDetail('in-progress')"><i class="fas fa-spinner"></i> Қарауға алу</button>
                <button class="btn btn-success" onclick="changeStatusDetail('resolved')"><i class="fas fa-check"></i> Шешілді деп белгілеу</button>
                <button class="btn btn-danger" onclick="changeStatusDetail('rejected')"><i class="fas fa-times"></i> Қабылданбады</button>
                <button class="btn btn-secondary" onclick="if(confirm('Жоюға сенімдісіз бе?')){deleteReport('${r.id}');navigate('admin');}"><i class="fas fa-trash"></i> Жою</button>
            </div>
        </div>
        `;
    } else if (isAuthor) {
        actionButtonsHtml = `
        <div class="author-control-box" style="margin-bottom: 24px;">
            <button class="btn btn-sm btn-secondary" onclick="if(confirm('Өз өтінішіңізді жойғыңыз келе ме?')){deleteReport('${r.id}');navigate('my-reports');}">
                <i class="fas fa-trash"></i> Өтінішімді жою
            </button>
        </div>
        `;
    }

    content.innerHTML = `
        <div class="detail-header">
            <h2>${catLabel(r.category)}</h2>
            ${statusBadge(r.status)}
        </div>
        ${photos}
        <p class="detail-description">${esc(r.description)}</p>
        <div id="detailMapContainer" class="detail-map"></div>
        <div class="detail-info-grid">
            <div class="detail-info-item"><label>Күні</label><span>${formatDate(r.date)}</span></div>
            <div class="detail-info-item"><label>Координаталар</label><span>${r.lat ? r.lat.toFixed(6) + ', ' + r.lng.toFixed(6) : '—'}</span></div>
            ${r.address ? `<div class="detail-info-item"><label>Мекенжай</label><span>${esc(r.address)}</span></div>` : ''}
            ${r.author ? `<div class="detail-info-item"><label>Автор</label><span>${esc(r.author)}</span></div>` : ''}
            ${r.contact ? `<div class="detail-info-item"><label>Байланыс</label><span>${esc(r.contact)}</span></div>` : ''}
        </div>
        ${actionButtonsHtml}
    `;

    // Карта
    setTimeout(() => {
        if (detailMapInstance) { detailMapInstance.remove(); detailMapInstance = null; }
        if (r.lat && r.lng) {
            detailMapInstance = L.map('detailMapContainer').setView([r.lat, r.lng], 16);
            createTileLayer().addTo(detailMapInstance);
            L.marker([r.lat, r.lng]).addTo(detailMapInstance);
        }
    }, 150);

    // Комментарийлерді жүктеу
    renderComments(r);
    initCommentForm();
}

function changeStatusDetail(st) {
    const cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') {
        showToast('Статусты тек әкімшілік өкілі өзгерте алады!', 'error');
        return;
    }
    updateReportStatus(currentDetailId, st);
    showToast(`Статус: ${STATUSES[st].label}`, 'success');
    openDetail(currentDetailId);
}

// ==================== КОММЕНТАРИЙ ЖҮЙЕСІ ====================
function renderComments(report) {
    const timeline = document.getElementById('commentsTimeline');
    const comments = report.comments || [];

    if (!comments.length) {
        timeline.innerHTML = '<p class="no-comments"><i class="fas fa-comment-slash"></i> Әзірге пікір жоқ. Біріншісін қалдырыңыз!</p>';
        return;
    }

    timeline.innerHTML = comments.map(c => {
        const photos = c.photos && c.photos.length
            ? `<div class="comment-photos">${c.photos.map(p => `<img src="${p}" alt="Сурет" onclick="openImageFull(this.src)">`).join('')}</div>` : '';

        const isOfficial = c.isAdmin;
        const officialBadge = isOfficial ? `<span class="official-badge"><i class="fas fa-check-double"></i> Ресми жауап</span>` : '';
        const avatarIcon = isOfficial ? `fas fa-university` : `fas fa-user-circle`;

        return `
        <div class="comment-item ${isOfficial ? 'official-comment' : ''}">
            <div class="comment-avatar">
                <i class="${avatarIcon}"></i>
            </div>
            <div class="comment-body">
                <div class="comment-header">
                    <div>
                        <strong>${esc(c.author)}</strong>
                        ${officialBadge}
                    </div>
                    <span class="comment-date">${formatDate(c.date)}</span>
                </div>
                <p class="comment-text">${esc(c.text)}</p>
                ${photos}
            </div>
        </div>`;
    }).join('');
}

function initCommentForm() {
    const cur = getCurrentUser();
    const formWrapper = document.getElementById('commentFormWrapper');
    const authPrompt = document.getElementById('commentAuthPrompt');

    if (!cur) {
        // Тіркелмеген қолданушылар үшін форма жасырылып, тіркелу блогы шығады
        if (formWrapper) formWrapper.style.display = 'none';
        if (authPrompt) authPrompt.style.display = 'block';
        return;
    }

    // Жүйеге кірген қолданушылар үшін форма көрінеді
    if (formWrapper) formWrapper.style.display = 'block';
    if (authPrompt) authPrompt.style.display = 'none';

    const authorInput = document.getElementById('commentAuthor');
    if (authorInput) {
        authorInput.value = cur.name || cur.email;
        authorInput.readOnly = true;
    }

    const form = document.getElementById('commentForm');
    if (!form) return;
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    commentPhotos = [];
    document.getElementById('commentPhotoPreview').innerHTML = '';

    const photoInput = document.getElementById('commentPhoto');
    if (photoInput) {
        photoInput.addEventListener('change', e => {
            for (const f of e.target.files) {
                if (!f.type.startsWith('image/') || f.size > 5 * 1024 * 1024 || commentPhotos.length >= 3) continue;
                const reader = new FileReader();
                reader.onload = ev => resizeImage(ev.target.result, 600, r => {
                    commentPhotos.push(r);
                    renderCommentPreviews();
                });
                reader.readAsDataURL(f);
            }
        });
    }

    // Форманы жіберу
    newForm.addEventListener('submit', e => {
        e.preventDefault();
        const user = getCurrentUser();
        if (!user) {
            showToast('Пікір жазу үшін жүйеге кіріңіз!', 'error');
            openAuthModal('login');
            return;
        }

        const author = user.name || user.email;
        const text = document.getElementById('commentText').value.trim();
        if (!text) return showToast('Пікір мәтінін жазыңыз', 'error');

        const isAdmin = user.role === 'admin';
        addComment(currentDetailId, { author, text, photos: commentPhotos, isAdmin });
        showToast('Пікіріңіз қосылды!', 'success');
        commentPhotos = [];
        document.getElementById('commentText').value = '';
        document.getElementById('commentPhotoPreview').innerHTML = '';

        // Комментарийлерді қайта жүктеу
        const report = getReportById(currentDetailId);
        renderComments(report);
    });
}

function renderCommentPreviews() {
    document.getElementById('commentPhotoPreview').innerHTML = commentPhotos.map((p, i) => `
        <div class="preview-item preview-sm">
            <img src="${p}" alt="">
            <button type="button" class="remove-photo" onclick="commentPhotos.splice(${i},1);renderCommentPreviews();"><i class="fas fa-times"></i></button>
        </div>`).join('');
}

// Суретті толық ашу
function openImageFull(src) {
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    overlay.innerHTML = `<img src="${src}" alt=""><button class="image-overlay-close">&times;</button>`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
}

// ==================== АУТЕНТИФИКАЦИЯ (АККАУНТТАР) ====================
function updateAuthUI() {
    const user = getCurrentUser();
    const loggedOutDiv = document.getElementById('navAuthLoggedOut');
    const loggedInDiv = document.getElementById('navAuthLoggedIn');
    const myReportsNav = document.getElementById('myReportsNavLink');
    const userBadge = document.getElementById('userBadge');
    const userNameText = document.getElementById('userNameText');

    if (user) {
        if (loggedOutDiv) loggedOutDiv.style.display = 'none';
        if (loggedInDiv) loggedInDiv.style.display = 'flex';
        if (myReportsNav) myReportsNav.style.display = user.role === 'admin' ? 'none' : 'block';

        if (userNameText) {
            userNameText.textContent = user.name || user.username;
        }

        if (userBadge) {
            if (user.role === 'admin') {
                userBadge.classList.add('admin-badge');
                userBadge.innerHTML = `<i class="fas fa-user-shield"></i> <span id="userNameText">${esc(user.name)}</span>`;
            } else {
                userBadge.classList.remove('admin-badge');
                userBadge.innerHTML = `<i class="fas fa-user-circle"></i> <span id="userNameText">${esc(user.name)}</span>`;
            }
        }

        // Формалардағы есімдерді автоматты толтыру
        const authorField = document.getElementById('authorName');
        if (authorField && !authorField.value) authorField.value = user.name;
        const commentAuthorField = document.getElementById('commentAuthor');
        if (commentAuthorField && !commentAuthorField.value) commentAuthorField.value = user.name;
    } else {
        if (loggedOutDiv) loggedOutDiv.style.display = 'flex';
        if (loggedInDiv) loggedInDiv.style.display = 'none';
        if (myReportsNav) myReportsNav.style.display = 'none';
    }

    // Детальды қарау бетінде тұрса, пікір жазу формасын қайта тексеру
    if (currentPage === 'detail') {
        initCommentForm();
    }
}

function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.add('active');
        modal.onclick = function (e) {
            if (e.target === modal) closeAuthModal();
        };
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('active');
}

function handleLogin(e) {
    e.preventDefault();
    const loginEl = document.getElementById('loginUsername') || document.getElementById('loginEmail');
    const passEl = document.getElementById('loginPassword');
    const loginVal = (loginEl?.value || '').trim().toLowerCase();
    const passVal = (passEl?.value || '').trim();

    // Дайын әкімшілік аккаунты: admin / admin (немесе admin123)
    const isLoginAdmin = (loginVal === 'admin' || loginVal === 'admin@qala.kz' || loginVal === 'admin@gov.kz');
    const isPassAdmin = (passVal === 'admin' || passVal === 'admin123' || passVal === 'admin12345' || passVal === 'Admin123!');

    if (isLoginAdmin && isPassAdmin) {
        const adminUser = {
            id: 'admin_master',
            name: 'Қала Әкімдігі',
            username: 'admin',
            email: 'admin@qala.kz',
            role: 'admin'
        };
        setCurrentUser(adminUser);
        closeAuthModal();
        showToast('Қош келдіңіз, Қала Әкімдігі!', 'success');
        navigate('admin');
        return;
    }

    showToast('Логин немесе құпиясөз қате!', 'error');
}

function logout() {
    setCurrentUser(null);
    showToast('Жүйеден шықтыңыз', 'info');
    navigate('home');
}
document.addEventListener('DOMContentLoaded', () => {
    // Мобильді меню
    document.getElementById('navToggle').addEventListener('click', () => {
        document.getElementById('navLinks').classList.toggle('show');
    });

    // Аутентификация күйін жаңарту
    updateAuthUI();

    // Firebase Auth тыңдаушысы (Қауіпсіз сессияны автоматты сақтау)
    if (typeof isFirebaseConfigured !== 'undefined' && isFirebaseConfigured && auth) {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const userDoc = await db.collection('users').doc(user.uid).get();
                    const data = userDoc.data() || {};
                    setCurrentUser({
                        id: user.uid,
                        email: user.email,
                        name: data.name || user.email.split('@')[0],
                        role: data.role || 'citizen'
                    });
                } catch (e) {
                    console.error('User sync error:', e);
                }
            }
        });

        // Firebase Firestore Realtime синхрондау (Барлық қолданушыларға жаңа хабарламаларды лезде жеткізу)
        db.collection('reports').onSnapshot((snapshot) => {
            const list = [];
            snapshot.forEach((doc) => {
                const item = doc.data();
                item.id = doc.id;
                list.push(item);
            });
            if (list.length > 0) {
                list.sort((a, b) => new Date(b.date) - new Date(a.date));
                saveReports(list);
                if (currentPage === 'home') initHome();
                else if (currentPage === 'admin') { loadAdminStats(); loadAdminReports(); }
                else if (currentPage === 'my-reports') initMyReports();
                else if (currentPage === 'detail' && currentDetailId) {
                    const updated = list.find(x => x.id === currentDetailId);
                    if (updated) renderComments(updated);
                }
            }
        }, (err) => {
            console.warn('Firestore snapshot error:', err);
        });
    }

    // Басты бетті жүктеу
    initHome();
});

