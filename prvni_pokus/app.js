// --- JSONBin.io Config ---
const JSONBIN_API_KEY = '$2a$10$rpU7scUXWCXKkafuGsrL8uTPptjdR3k8WjJ1f/Hnj6YOa7VyvWEDm';
const JSONBIN_BIN_ID  = 'Y698ee44943b1c97be97b8895';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// --- Offline Queue ---
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
function saveQueueToStorage() {
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
}

window.addEventListener('online', () => {
    showToast('Připojení obnoveno, ukládám data...', 'info');
    flushOfflineQueue();
});
window.addEventListener('offline', () => {
    showToast('Offline – skeny se ukládají lokálně', 'warning');
});

// --- Toast Notifications ---
function showToast(message, type = 'success') {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// --- JSONBin Helpers ---
async function readDB() {
    const res = await fetch(JSONBIN_URL + '/latest', {
        headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!res.ok) throw new Error('Chyba cteni DB: ' + res.status);
    const json = await res.json();
    return json.record;
}

async function writeDB(data) {
    const res = await fetch(JSONBIN_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': JSONBIN_API_KEY
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Chyba zapisu DB: ' + res.status);
}

// --- Safe Write with Retry ---
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 300;

async function safeWriteScan(scanEntry) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const db = await readDB();
            const isDuplicate = db.scans.some(s =>
                s.user === scanEntry.user &&
                s.data === scanEntry.data &&
                Math.abs(Date.now() - new Date(s.savedAt || 0).getTime()) < 5000
            );
            if (isDuplicate) return true;

            db.scans.push({ ...scanEntry, savedAt: new Date().toISOString() });
            await writeDB(db);
            return true;
        } catch (err) {
            console.warn(`Pokus ${attempt + 1} selhal:`, err);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS + Math.random() * 300));
            }
        }
    }
    return false;
}

// --- Offline Flush ---
async function flushOfflineQueue() {
    if (offlineQueue.length === 0 || !navigator.onLine) return;

    const toRetry = [...offlineQueue];
    offlineQueue = [];
    saveQueueToStorage();

    let failed = [];
    for (const entry of toRetry) {
        const ok = await safeWriteScan(entry);
        if (!ok) failed.push(entry);
    }

    if (failed.length > 0) {
        offlineQueue = [...offlineQueue, ...failed];
        saveQueueToStorage();
        showToast(`${failed.length} skenu se nepodarilo ulozit`, 'error');
    } else {
        showToast(`${toRetry.length} offline skenu uspesne ulozeno!`, 'success');
    }
}

// --- Sidebar & Navigation ---
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('nav ul li');

menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const viewId = item.dataset.view;
        views.forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        sidebar.classList.remove('open');
        if (viewId === 'history') loadHistory();
        if (viewId === 'teacher') loadTeacherDashboard();
    });
});

// --- Login ---
let currentUser = null;
const loginForm = document.getElementById('loginForm');
const loginOutput = document.getElementById('loginOutput');

loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    if (username && password) {
        currentUser = username;
        loginOutput.textContent = '';
        views.forEach(v => v.classList.remove('active'));
        document.getElementById('home').classList.add('active');
        showToast(`Prihlaseno jako ${currentUser}`, 'success');
        flushOfflineQueue();
    } else {
        loginOutput.textContent = 'Vyplnte jmeno a heslo!';
    }
});

// --- QR Scanner ---
let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let ctxCanvas = canvas.getContext('2d');
let scanOutput = document.getElementById('scanOutput');
let scanning = false;

document.getElementById('startScan').addEventListener('click', () => {
    if (scanning) return;
    scanning = true;
    startCamera();
});

function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(stream => {
            video.srcObject = stream;
            requestAnimationFrame(scanFrame);
        })
        .catch(err => {
            scanOutput.textContent = "Nelze spustit kameru: " + err;
            scanning = false;
        });
}

function scanFrame() {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctxCanvas.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctxCanvas.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
            const timestamp = new Date().toLocaleTimeString();
            scanOutput.textContent = `Naskenovano: ${code.data}`;
            handleScan({ user: currentUser, data: code.data, time: timestamp });
            scanning = false;
            setTimeout(() => scanning = true, 2000);
        }
    }
    requestAnimationFrame(scanFrame);
}

// --- Handle Scan ---
async function handleScan(scanEntry) {
    showToast('Ukladam sken...', 'info');

    if (!navigator.onLine) {
        offlineQueue.push(scanEntry);
        saveQueueToStorage();
        showToast(`Offline: sken ulozen lokalne (${offlineQueue.length} ceka)`, 'warning');
        return;
    }

    const ok = await safeWriteScan(scanEntry);
    if (ok) {
        showToast(`✓ Sken ulozen: ${scanEntry.data}`, 'success');
    } else {
        offlineQueue.push(scanEntry);
        saveQueueToStorage();
        showToast('Chyba ukladani – uloženo lokalne', 'warning');
    }
}

// --- History ---
async function loadHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<li>Nacitam...</li>';
    try {
        const db = await readDB();
        list.innerHTML = '';
        const userScans = db.scans.filter(d => d.user === currentUser);
        const pending = offlineQueue.filter(d => d.user === currentUser);

        if (userScans.length === 0 && pending.length === 0) {
            list.innerHTML = '<li>Zadne skeny zatim.</li>';
            return;
        }

        userScans.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.time} – ${item.data}`;
            list.appendChild(li);
        });

        pending.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.time} – ${item.data} ⏳ (ceka na odeslani)`;
            li.style.opacity = '0.6';
            list.appendChild(li);
        });
    } catch (err) {
        list.innerHTML = '<li>Chyba pri nacitani.</li>';
    }
}

// --- Map & Location Panel ---
const mapCanvas = document.getElementById('mapCanvas');
const ctxMap = mapCanvas.getContext('2d');
const mapImage = new Image();
mapImage.src = 'mapa.png';
let lastDot = null;

mapImage.onload = () => ctxMap.drawImage(mapImage, 0, 0, mapCanvas.width, mapCanvas.height);

// klikání pro nastavení polohy
mapCanvas.addEventListener('click', e => {
    if (!currentUser) return;
    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    lastDot = { x, y, time: new Date().toLocaleTimeString() };
    drawMapDot(x, y);
    safeWriteLocation(currentUser, { x, y, time: lastDot.time });
});

function drawMapDot(x, y) {
    ctxMap.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    ctxMap.drawImage(mapImage, 0, 0, mapCanvas.width, mapCanvas.height);
    ctxMap.fillStyle = 'red';
    ctxMap.beginPath();
    ctxMap.arc(x, y, 6, 0, 2 * Math.PI);
    ctxMap.fill();
}

// --- Teacher Dashboard ---
async function loadTeacherDashboard() {
    const list = document.getElementById('teacherList');
    list.innerHTML = '<li>Nacitam...</li>';
    try {
        const db = await readDB();
        list.innerHTML = '';
        const entries = Object.entries(db.users);
        if (entries.length === 0) {
            list.innerHTML = '<li>Zadni uzivatele zatim.</li>';
            return;
        }
        entries.forEach(([user, coords]) => {
            const scans = db.scans.filter(d => d.user === user);
            const li = document.createElement('li');
            li.innerHTML = `<strong>${user}</strong><br>
                Poloha: ${coords.x}, ${coords.y}<br>
                Cas: ${coords.time}<br>
                QR naskenovano: ${scans.length}`;
            list.appendChild(li);
        });
    } catch (err) {
        list.innerHTML = '<li>Chyba pri nacitani dashboardu.</li>';
    }
}

// --- On load: flush any queued scans ---
window.addEventListener('load', () => {
    if (navigator.onLine && offlineQueue.length > 0) {
        showToast(`Nalezeno ${offlineQueue.length} offline skenu, odesilam...`, 'info');
        flushOfflineQueue();
    }
});
