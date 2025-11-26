// --- PWA INSTALLATION LOGIC ---
const manifest = {
    "name": "PocketGuard Pro",
    "short_name": "PocketGuard",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#2563eb",
    "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/2382/2382533.png", "sizes": "512x512", "type": "image/png" }]
};

let deferredPrompt;
const installBtn = document.getElementById('installBtn');

if (installBtn) {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt = null;
            installBtn.classList.add('hidden');
        }
    });
}

// FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyBSU62EbaZWvRQzhf9nc5hY7-MYhm4Kqyo",
    authDomain: "budgetmaster-d0cbd.firebaseapp.com",
    projectId: "budgetmaster-d0cbd",
    storageBucket: "budgetmaster-d0cbd.firebasestorage.app",
    messagingSenderId: "540237476220",
    appId: "1:540237476220:web:c4026abb2d1e06e360f4f9",
    measurementId: "G-YPK4ZWQLMT"
};

const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Global State
let currentUser = null;
let currentHouseholdId = null;
let transactions = [];
let goals = [];
let debts = [];
let recurringItems = [];
let familyMembers = [];
let wallets = [];
let categories = { expense: [], income: [], investment: [] };
let categoryMap = {};
let walletMap = {};
let monthlyBudget = 0;
let expenseChart = null;
let trendChart = null;
let comparisonChart = null;
let currentCalendarDate = new Date();
let userPin = null;
let pinInput = "";
let currentCurrency = 'INR';
let isPrivacyMode = false;

// Defaults
const defaultCategoriesList = [
    { id: 'food', type: 'expense', name: 'Food & Dining', icon: 'fa-utensils', color: '#f87171' },
    { id: 'transport', type: 'expense', name: 'Transportation', icon: 'fa-car', color: '#60a5fa' },
    { id: 'shopping', type: 'expense', name: 'Shopping', icon: 'fa-bag-shopping', color: '#c084fc' },
    { id: 'bills', type: 'expense', name: 'Bills & Utilities', icon: 'fa-bolt', color: '#fbbf24' },
    { id: 'entertainment', type: 'expense', name: 'Entertainment', icon: 'fa-film', color: '#f472b6' },
    { id: 'health', type: 'expense', name: 'Health', icon: 'fa-heart-pulse', color: '#34d399' },
    { id: 'salary', type: 'income', name: 'Salary', icon: 'fa-money-bill-wave', color: '#10b981' },
    { id: 'investments', type: 'income', name: 'Investments', icon: 'fa-chart-line', color: '#8b5cf6' },
    { id: 'sip', type: 'investment', name: 'SIP', icon: 'fa-chart-simple', color: '#8b5cf6' }
];

const defaultWallets = [
    { id: 'cash', name: 'Cash', type: 'personal' },
    { id: 'bank', name: 'Bank Account', type: 'personal' },
    { id: 'card', name: 'Credit Card', type: 'personal' }
];

// --- HELPER FUNCTIONS ---
function getDbRef(collectionName) {
    if (!currentHouseholdId) return null;
    return db.collection('artifacts').doc(appId).collection('households').doc(currentHouseholdId).collection(collectionName);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${icon} toast-icon"></i><span class="toast-content">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

function checkOnboarding(user) {
    if (!user) return;
    const docRef = db.collection('artifacts').doc(appId).collection('users').doc(user.uid).collection('settings').doc('general');
    docRef.get().then(doc => {
        if (!doc.exists || !doc.data().onboarded) {
            document.getElementById('onboardingModal').classList.remove('hidden');
        }
    });
}

// --- INITIALIZATION ---
async function initApp() {
    // Theme Check
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        const dot = document.getElementById('themeToggleDot');
        if (dot) dot.style.transform = 'translateX(100%)';
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            updateUserProfile(user);
            document.getElementById('view-landing').classList.add('hidden');
            document.getElementById('app-layout').classList.remove('hidden');

            checkOnboarding(user);
            await handleHouseholdJoin(user);
            setupRealtimeListeners();
            loadBudget();
        } else {
            document.getElementById('view-landing').classList.remove('hidden');
            document.getElementById('app-layout').classList.add('hidden');
        }
    });

    const dateEl = document.getElementById('date');
    if (dateEl) dateEl.valueAsDate = new Date();

    // Reset Views
    document.querySelectorAll('#mainScroll > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const dash = document.getElementById('view-dashboard');
    if (dash) dash.classList.remove('hidden');
}

function updateUserProfile(user) {
    const nameEl = document.getElementById('userName');
    const emailEl = document.getElementById('userEmail');
    const avatarEl = document.getElementById('userAvatar');
    if (nameEl) nameEl.textContent = user.displayName || 'User';
    if (emailEl) emailEl.textContent = user.email || 'Guest';
    if (avatarEl) avatarEl.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=374151&color=fff`;
}

async function handleHouseholdJoin(user) {
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    const userRef = db.collection('artifacts').doc(appId).collection('users').doc(user.uid);
    const userDoc = await userRef.get();

    if (inviteCode) {
        currentHouseholdId = inviteCode;
        await userRef.set({ email: user.email, householdId: currentHouseholdId, joinedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        showToast("✅ Joined Family Account!", "success");
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (userDoc.exists && userDoc.data().householdId) {
        currentHouseholdId = userDoc.data().householdId;
    } else {
        currentHouseholdId = user.uid; // Default to own ID
        await userRef.set({ email: user.email, householdId: currentHouseholdId }, { merge: true });
        await db.collection('artifacts').doc(appId).collection('households').doc(currentHouseholdId).set({ owner: user.uid }, { merge: true });
    }
}

function setupRealtimeListeners() {
    setupWalletsListener();
    setupCategoriesListener();
    setupRealtimeListener(); // Expenses
    setupGoalsListener();
    setupRecurringListener();
    setupDebtsListener();
    setupFamilyListener();
}

// --- UI NAVIGATION & LOGIC ---
function showPage(id) {
    const views = document.querySelectorAll('#mainScroll > div[id^="view-"]');
    views.forEach(el => el.classList.add('hidden'));

    const target = document.getElementById(`view-${id}`);
    if (target) target.classList.remove('hidden');

    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = id.charAt(0).toUpperCase() + id.slice(1);

    // Update Nav
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('bg-blue-600', 'text-white');
        el.classList.add('text-slate-400');
    });
    const activeNav = document.getElementById(`nav-${id}`);
    if (activeNav) {
        activeNav.classList.remove('text-slate-400');
        activeNav.classList.add('bg-blue-600', 'text-white');
    }

    // Toggle Action Buttons Safely
    const buttons = ['addGoalBtn', 'addRecBtn', 'addTxnBtn', 'addDebtBtn', 'addFamilyBtn'];
    buttons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.add('hidden');
    });

    if (id === 'goals') safeShow('addGoalBtn');
    if (id === 'recurring') safeShow('addRecBtn');
    if (id === 'debts') safeShow('addDebtBtn');
    if (id === 'family') safeShow('addFamilyBtn');
    if (id === 'dashboard' || id === 'transactions') safeShow('addTxnBtn');

    // Render Charts/Reports
    if (id === 'reports') {
        setTimeout(() => {
            if (typeof renderChart === 'function') renderChart();
            if (typeof renderTrendChart === 'function') renderTrendChart();
            if (typeof renderHeatmap === 'function') renderHeatmap();
            if (typeof renderCategoryBudgets === 'function') renderCategoryBudgets();
        }, 100);
    }

    // Mobile Sidebar Close
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobileOverlay').classList.remove('active');
    }
}

function safeShow(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

// --- CORE FUNCTIONS (Heatmap & Budgets) ---

// 1. Render Heatmap (Fixed missing function)
function renderHeatmap() {
    const container = document.querySelector('.heatmap-grid');
    if (!container) return;
    container.innerHTML = '';

    // Last 49 days (7x7 grid)
    const today = new Date();
    for (let i = 0; i < 49; i++) {
        const d = new Date();
        d.setDate(today.getDate() - (48 - i));
        const dateStr = d.toISOString().split('T')[0];

        const count = transactions.filter(t => t.date === dateStr).length;
        let heatClass = 'heat-0';
        if (count > 0) heatClass = 'heat-1';
        if (count > 2) heatClass = 'heat-2';
        if (count > 5) heatClass = 'heat-3';

        const cell = document.createElement('div');
        cell.className = `heatmap-cell ${heatClass}`;
        cell.title = `${dateStr}: ${count} txns`;
        container.appendChild(cell);
    }
}

// 2. Render Category Budgets
function renderCategoryBudgets() {
    const grid = document.getElementById('categoryBudgetsGrid');
    const section = document.getElementById('categoryBudgetsSection');
    if (!grid || !section) return;

    const budgetedCats = categories['expense'].filter(c => c.budget > 0);
    if (budgetedCats.length === 0) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    grid.innerHTML = '';

    const now = new Date();
    budgetedCats.forEach(cat => {
        const spent = transactions
            .filter(t => t.category === cat.id && new Date(t.date).getMonth() === now.getMonth())
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const pct = Math.min((spent / cat.budget) * 100, 100);
        let color = 'bg-emerald-500';
        if (pct > 80) color = 'bg-orange-500';
        if (pct >= 100) color = 'bg-rose-500';

        grid.innerHTML += `
            <div class="border border-gray-100 dark:border-slate-700 rounded-xl p-3">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <i class="fa-solid ${cat.icon} text-xs"></i> ${cat.name}
                    </span>
                    <span class="text-xs text-gray-500">${formatCurrency(spent)} / ${formatCurrency(cat.budget)}</span>
                </div>
                <div class="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5">
                    <div class="${color} h-1.5 rounded-full transition-all" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    });
}

// --- ALL LISTENERS (Fully Expanded) ---

function setupWalletsListener() {
    const ref = getDbRef('wallets');
    if (!ref) return;
    ref.onSnapshot(async (snap) => {
        if (snap.empty) { await seedDefaultWallets(ref); return; }
        wallets = []; walletMap = {};
        snap.forEach(doc => { const d = { id: doc.id, ...doc.data() }; wallets.push(d); walletMap[d.id] = d; });
        updateWalletOptions();
    });
}

async function seedDefaultWallets(ref) {
    const batch = db.batch();
    defaultWallets.forEach(w => batch.set(ref.doc(w.id), w));
    await batch.commit();
}

function updateWalletOptions() {
    const sel = document.getElementById('txnWallet');
    if (sel) {
        sel.innerHTML = '';
        wallets.forEach(w => sel.appendChild(new Option(w.name, w.id)));
    }
}

function setupCategoriesListener() {
    const catsRef = getDbRef('categories');
    if (!catsRef) return;
    catsRef.onSnapshot(async (snapshot) => {
        if (snapshot.empty) { await seedDefaultCategories(catsRef); return; }
        categories = { expense: [], income: [], investment: [] }; categoryMap = {};
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (categories[data.type]) categories[data.type].push(data);
            categoryMap[data.id] = data;
        });
        updateCategoryOptions();
    });
}

async function seedDefaultCategories(ref) {
    const batch = db.batch();
    defaultCategoriesList.forEach(cat => batch.set(ref.doc(cat.id), cat));
    await batch.commit();
}

function updateCategoryOptions() {
    const type = document.getElementById('type')?.value || 'expense';
    const sel = document.getElementById('category');
    if (!sel) return;
    sel.innerHTML = '';
    const list = categories[type] || [];
    list.forEach(c => sel.appendChild(new Option(c.name, c.id)));
}

function setupRealtimeListener() {
    const ref = getDbRef('expenses');
    if (!ref) return;
    ref.onSnapshot((snapshot) => {
        transactions = [];
        snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        updateUI();
    });
}

function setupGoalsListener() {
    const ref = getDbRef('goals');
    if (!ref) return;
    ref.onSnapshot(snap => {
        goals = [];
        snap.forEach(doc => goals.push({ id: doc.id, ...doc.data() }));
        renderGoals();
    });
}

function setupRecurringListener() {
    const ref = getDbRef('recurring');
    if (!ref) return;
    ref.onSnapshot(snap => {
        recurringItems = [];
        snap.forEach(doc => recurringItems.push({ id: doc.id, ...doc.data() }));
        renderRecurring();
    });
}

function setupDebtsListener() {
    const ref = getDbRef('debts');
    if (!ref) return;
    ref.onSnapshot(snap => {
        debts = [];
        snap.forEach(doc => debts.push({ id: doc.id, ...doc.data() }));
        renderDebts();
    });
}

function setupFamilyListener() {
    const ref = getDbRef('family');
    if (!ref) return;
    ref.onSnapshot(snap => {
        familyMembers = [];
        snap.forEach(doc => familyMembers.push({ id: doc.id, ...doc.data() }));
        renderFamilyMembers();
    });
}

function loadBudget() {
    const ref = getDbRef('settings');
    if (!ref) return;
    ref.doc('general').onSnapshot(doc => {
        if (doc.exists) {
            monthlyBudget = doc.data().monthlyBudget || 0;
            currentCurrency = doc.data().currency || 'INR';
            const display = document.getElementById('budgetDisplay');
            if (display) display.textContent = formatCurrency(monthlyBudget);
        }
        updateBudgetUI();
    });
}

// --- RENDER FUNCTIONS ---

function updateUI() {
    renderSummary();
    renderRecentList();
    if (document.getElementById('view-transactions') && !document.getElementById('view-transactions').classList.contains('hidden')) renderFullList();
    updateBudgetUI();
}

function renderSummary() {
    let inc = 0, exp = 0, inv = 0;
    transactions.forEach(t => {
        const amt = Number(t.amount);
        if (t.type === 'income') inc += amt;
        else if (t.type === 'expense') exp += amt;
        else if (t.type === 'investment') inv += amt;
    });
    const balEl = document.getElementById('totalBalance');
    if (balEl) balEl.textContent = formatCurrency(inc - exp - inv);

    if (document.getElementById('totalIncome')) document.getElementById('totalIncome').textContent = formatCurrency(inc);
    if (document.getElementById('totalExpense')) document.getElementById('totalExpense').textContent = formatCurrency(exp);
    if (document.getElementById('totalInvestment')) document.getElementById('totalInvestment').textContent = formatCurrency(inv);
}

function renderRecentList() {
    const list = document.getElementById('recentList');
    if (!list) return;
    list.innerHTML = '';
    transactions.slice(0, 5).forEach(t => {
        const cat = categoryMap[t.category] || { name: 'Unknown', icon: 'fa-question' };
        list.innerHTML += `
        <div class="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-lg shadow-sm mb-2">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-slate-700 flex items-center justify-center text-blue-500">
                    <i class="fa-solid ${cat.icon}"></i>
                </div>
                <div>
                    <p class="font-bold text-sm dark:text-white">${cat.name}</p>
                    <p class="text-xs text-gray-400">${t.note || ''}</p>
                </div>
            </div>
            <p class="font-bold text-sm ${t.type === 'income' ? 'text-emerald-500' : 'text-rose-500'}">
                ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
            </p>
        </div>`;
    });
}

function renderFullList() {
    const list = document.getElementById('fullTransactionList');
    if (!list) return;
    list.innerHTML = '';
    transactions.forEach(t => {
        const cat = categoryMap[t.category] || { name: 'Unknown', icon: 'fa-question' };
        list.innerHTML += `
            <tr class="border-b dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700">
                <td class="p-3 dark:text-white">${cat.name}</td>
                <td class="p-3 text-sm text-gray-500">${t.date}</td>
                <td class="p-3 text-right font-bold ${t.type === 'income' ? 'text-emerald-500' : 'text-rose-500'}">${formatCurrency(t.amount)}</td>
            </tr>
        `;
    });
}

function renderGoals() {
    const grid = document.getElementById('goalsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    goals.forEach(g => {
        const pct = Math.min((g.saved / g.target) * 100, 100);
        grid.innerHTML += `
            <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm">
                <h4 class="font-bold dark:text-white">${g.name}</h4>
                <p class="text-sm text-gray-500">Target: ${formatCurrency(g.target)}</p>
                <div class="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2 mt-2">
                    <div class="bg-blue-600 h-2 rounded-full" style="width: ${pct}%"></div>
                </div>
                <p class="text-right text-xs mt-1 dark:text-gray-400">${formatCurrency(g.saved)} saved</p>
            </div>
        `;
    });
}

function renderRecurring() {
    const grid = document.getElementById('recurringGrid');
    if (!grid) return;
    grid.innerHTML = '';
    recurringItems.forEach(i => {
        grid.innerHTML += `
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border dark:border-slate-700">
                <div class="flex justify-between">
                    <h4 class="font-bold dark:text-white">${i.name}</h4>
                    <span class="font-bold dark:text-gray-200">${formatCurrency(i.amount)}</span>
                </div>
                <p class="text-xs text-gray-500">Due day: ${i.day}</p>
            </div>
        `;
    });
}

function renderDebts() {
    const grid = document.getElementById('debtsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    debts.forEach(d => {
        grid.innerHTML += `
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border dark:border-slate-700">
                 <h4 class="font-bold dark:text-white">${d.person}</h4>
                 <p class="text-sm ${d.type === 'lent' ? 'text-emerald-500' : 'text-orange-500'} font-bold">
                    ${d.type === 'lent' ? 'Owes you' : 'You owe'} ${formatCurrency(d.amount)}
                 </p>
            </div>
        `;
    });
}

function renderFamilyMembers() {
    const grid = document.getElementById('familyMembersGrid');
    if (!grid) return;
    grid.innerHTML = '';
    familyMembers.forEach(m => {
        grid.innerHTML += `<div class="p-4 bg-white dark:bg-slate-800 rounded shadow-sm dark:text-white">${m.email}</div>`;
    });
}

function updateBudgetUI() {
    const bar = document.getElementById('budgetProgressBar');
    if (bar && monthlyBudget > 0) {
        let spent = 0;
        const now = new Date();
        transactions.filter(t => t.type === 'expense' && new Date(t.date).getMonth() === now.getMonth()).forEach(t => spent += t.amount);
        document.getElementById('spentThisMonth').textContent = formatCurrency(spent);

        const pct = Math.min((spent / monthlyBudget) * 100, 100);
        bar.style.width = `${pct}%`;
        if (pct > 100) bar.className = 'h-3 rounded-full bg-rose-500 transition-all';
        else bar.className = 'h-3 rounded-full bg-emerald-500 transition-all';
    }
}

// --- DOM READY & EVENTS ---

document.addEventListener("DOMContentLoaded", function () {

    // Onboarding Form
    const onboardingForm = document.getElementById('onboardingForm');
    if (onboardingForm) {
        onboardingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currency = document.getElementById('setupCurrency').value;
            const budget = parseFloat(document.getElementById('setupBudget').value);

            await getDbRef('settings').doc('general').set({
                currency: currency,
                monthlyBudget: budget,
                onboarded: true
            }, { merge: true });

            document.getElementById('onboardingModal').classList.add('hidden');
            loadBudget();
        });
    }

    // Invite Form Logic (Fixed)
    const familyForm = document.getElementById('familyForm');
    if (familyForm) {
        familyForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const inviteeEmail = document.getElementById('inviteEmail').value;
            const linkContainer = document.getElementById('inviteLinkContainer');
            const linkInput = document.getElementById('generatedLink');

            const inviterEmail = currentUser ? currentUser.email : "Admin";
            const BASE_URL = window.location.origin;
            const hId = currentHouseholdId || "pending";

            // Pass the householdId in the URL
            const link = `${BASE_URL}/accept-invite.html?inviter=${encodeURIComponent(inviterEmail)}&invitee=${encodeURIComponent(inviteeEmail)}&invite=${encodeURIComponent(hId)}`;

            linkInput.value = link;
            linkContainer.classList.remove('hidden');
            showToast("Invite Link Generated!", "success");
        });
    }

    // Transaction Form Submit
    const txnForm = document.getElementById('transactionForm');
    if (txnForm) {
        txnForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                type: document.getElementById('type').value,
                amount: parseFloat(document.getElementById('amount').value),
                category: document.getElementById('category').value,
                walletId: document.getElementById('txnWallet').value,
                date: document.getElementById('date').value,
                note: document.getElementById('note').value,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            try {
                await getDbRef('expenses').add(data);
                showToast('Transaction Added', 'success');
                window.closeModal();
                txnForm.reset();
                document.getElementById('date').valueAsDate = new Date();
            } catch (err) {
                showToast('Error saving', 'error');
            }
        });
    }

    // Rec Form
    const recForm = document.getElementById('recurringForm');
    if (recForm) {
        recForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                name: document.getElementById('recName').value,
                amount: parseFloat(document.getElementById('recAmount').value),
                day: parseInt(document.getElementById('recDay').value),
                category: document.getElementById('recCategory').value
            };
            await getDbRef('recurring').add(data);
            showToast('Subscription Added', 'success');
            closeRecurringModal();
            recForm.reset();
        });
    }

    // Goal Form
    const goalForm = document.getElementById('goalForm');
    if (goalForm) {
        goalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await getDbRef('goals').add({
                name: document.getElementById('goalName').value,
                target: parseFloat(document.getElementById('goalTarget').value),
                saved: parseFloat(document.getElementById('goalSaved').value)
            });
            showToast('Goal Added', 'success');
            closeGoalModal();
            goalForm.reset();
        });
    }

    // Debt Form
    const debtForm = document.getElementById('debtForm');
    if (debtForm) {
        debtForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await getDbRef('debts').add({
                type: document.getElementById('debtType').value,
                person: document.getElementById('debtPerson').value,
                amount: parseFloat(document.getElementById('debtAmount').value)
            });
            showToast('Debt Added', 'success');
            closeDebtModal();
            debtForm.reset();
        });
    }

    // EXPOSE FUNCTIONS GLOBALLY
    window.renderHeatmap = renderHeatmap;
    window.renderCategoryBudgets = renderCategoryBudgets;
    window.showPage = showPage;
    window.toggleSidebar = toggleSidebar;
    window.toggleTheme = toggleTheme;
    window.signInWithGoogle = signInWithGoogle;
    window.logout = () => auth.signOut().then(() => window.location.reload());
    window.saveBudget = async () => {
        const val = parseFloat(document.getElementById('budgetInput').value);
        await getDbRef('settings').doc('general').set({ monthlyBudget: val }, { merge: true });
        closeBudgetModal();
        showToast('Budget Saved', 'success');
    };

    // Modals
    window.openModal = () => document.getElementById('transactionModal').classList.remove('hidden');
    window.closeModal = () => document.getElementById('transactionModal').classList.add('hidden');
    window.openGoalModal = () => document.getElementById('goalModal').classList.remove('hidden');
    window.closeGoalModal = () => document.getElementById('goalModal').classList.add('hidden');
    window.openRecurringModal = () => {
        document.getElementById('recurringModal').classList.remove('hidden');
        updateRecCategoryOptions();
    };
    window.closeRecurringModal = () => document.getElementById('recurringModal').classList.add('hidden');
    window.openDebtModal = () => document.getElementById('debtModal').classList.remove('hidden');
    window.closeDebtModal = () => document.getElementById('debtModal').classList.add('hidden');
    window.openFamilyModal = () => document.getElementById('familyModal').classList.remove('hidden');
    window.closeFamilyModal = () => document.getElementById('familyModal').classList.add('hidden');
    window.openBudgetModal = () => document.getElementById('budgetModal').classList.remove('hidden');
    window.closeBudgetModal = () => document.getElementById('budgetModal').classList.add('hidden');
    window.closeCategoryModal = () => document.getElementById('categoryModal').classList.add('hidden');

    window.copyInviteLink = () => {
        const copyText = document.getElementById("generatedLink");
        copyText.select();
        navigator.clipboard.writeText(copyText.value);
        showToast("Copied!", "success");
    };

    initApp();
});

function updateRecCategoryOptions() {
    const sel = document.getElementById('recCategory');
    if (!sel) return;
    sel.innerHTML = '';
    categories['expense'].forEach(c => sel.appendChild(new Option(c.name, c.id)));
}

// Utility
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ol = document.getElementById('mobileOverlay');
    if (sb) sb.classList.toggle('open');
    if (ol) ol.classList.toggle('active');
}
function formatCurrency(num) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num || 0);
}
function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}