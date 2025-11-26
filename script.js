{
    const manifest = { "name": "ExpenseFlow Pro", "short_name": "ExpenseFlow", "start_url": ".", "display": "standalone", "background_color": "#ffffff", "theme_color": "#2563eb", "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/2382/2382533.png", "sizes": "512x512", "type": "image/png" }] };
    document.getElementById('manifest-placeholder').href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.getElementById('installBtn').classList.remove('hidden'); });
    document.getElementById('installBtn').addEventListener('click', async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; document.getElementById('installBtn').classList.add('hidden'); } });

    // FIREBASE SETUP
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

    let currentUser = null;
    let currentHouseholdId = null;

    let transactions = [];
    let goals = [];
    let debts = [];
    let recurringItems = [];
    let shoppingItems = [];
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

    // Feature Flags
    let isPrivacyMode = false;

    const defaultCategoriesList = [
        { id: 'food', type: 'expense', name: 'Food & Dining', icon: 'fa-utensils', color: '#f87171' },
        { id: 'transport', type: 'expense', name: 'Transportation', icon: 'fa-car', color: '#60a5fa' },
        { id: 'shopping', type: 'expense', name: 'Shopping', icon: 'fa-bag-shopping', color: '#c084fc' },
        { id: 'bills', type: 'expense', name: 'Bills & Utilities', icon: 'fa-bolt', color: '#fbbf24' },
        { id: 'entertainment', type: 'expense', name: 'Entertainment', icon: 'fa-film', color: '#f472b6' },
        { id: 'health', type: 'expense', name: 'Health', icon: 'fa-heart-pulse', color: '#34d399' },
        { id: 'other', type: 'expense', name: 'Others', icon: 'fa-circle-question', color: '#94a3b8' },
        { id: 'salary', type: 'income', name: 'Salary', icon: 'fa-money-bill-wave', color: '#10b981' },
        { id: 'freelance', type: 'income', name: 'Freelance', icon: 'fa-laptop-code', color: '#3b82f6' },
        { id: 'investments', type: 'income', name: 'Investments', icon: 'fa-chart-line', color: '#8b5cf6' },
        { id: 'gift', type: 'income', name: 'Gifts', icon: 'fa-gift', color: '#ec4899' },
        { id: 'other_income', type: 'income', name: 'Other Income', icon: 'fa-plus-circle', color: '#64748b' },
        { id: 'sip', type: 'investment', name: 'SIP', icon: 'fa-chart-simple', color: '#8b5cf6' },
        { id: 'mutual_fund', type: 'investment', name: 'Mutual Funds', icon: 'fa-money-bill-trend-up', color: '#6366f1' },
        { id: 'stocks', type: 'investment', name: 'Stocks', icon: 'fa-arrow-trend-up', color: '#a855f7' },
        { id: 'gold', type: 'investment', name: 'Gold', icon: 'fa-coins', color: '#eab308' },
        { id: 'ppf', type: 'investment', name: 'PPF/EPF', icon: 'fa-piggy-bank', color: '#ec4899' }
    ];

    const defaultWallets = [
        { id: 'cash', name: 'Cash' },
        { id: 'bank', name: 'Bank Account' },
        { id: 'card', name: 'Credit Card' }
    ];

    // HELPER: Get DB Path for Current Household
    function getDbRef(collectionName) {
        if (!currentHouseholdId) {
            console.error("No household ID found!");
            return null;
        }
        return db.collection('artifacts').doc(appId).collection('households').doc(currentHouseholdId).collection(collectionName);
    }

    function signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch((error) => {
            if (error.code === 'auth/unauthorized-domain') {
                showToast(`⚠️ DOMAIN NOT AUTHORIZED ⚠️\nAdd this to Firebase Console > Auth > Settings > Authorized Domains:\n${window.location.hostname}`, 'error');
            } else { showToast("Login failed: " + error.message, 'error'); }
        });
    }
    function logout() { auth.signOut().then(() => window.location.reload()); }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'fa-circle-info';
        if (type === 'success') icon = 'fa-circle-check';
        if (type === 'error') icon = 'fa-circle-exclamation';

        toast.innerHTML = `
            <i class="fa-solid ${icon} toast-icon"></i>
            <span class="toast-content">${message}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    function startVoiceInput(inputId) {
        if (!('webkitSpeechRecognition' in window)) {
            showToast("Voice input not supported in this browser", "error");
            return;
        }
        const recognition = new webkitSpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => { showToast("Listening... Speak now", "info"); };
        recognition.onresult = (event) => {
            const text = event.results[0][0].transcript;
            const input = document.getElementById(inputId);
            input.value = text;
            showToast("Note added via voice", "success");
        };
        recognition.onerror = (event) => { console.error(event.error); showToast("Voice error: " + event.error, "error"); };
        recognition.start();
    }

    async function initApp() {
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
            document.getElementById('themeToggleDot').style.transform = 'translateX(100%)';
        } else {
            document.documentElement.classList.remove('dark');
            document.getElementById('themeToggleDot').style.transform = 'translateX(0)';
        }

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                document.getElementById('userName').textContent = user.displayName || 'User';
                document.getElementById('userEmail').textContent = user.email || 'Guest';
                document.getElementById('userAvatar').src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=374151&color=fff`;
                document.getElementById('view-landing').classList.add('hidden');
                document.getElementById('app-layout').classList.remove('hidden');

                injectPrivacyButton();

                // Check Security
                db.collection('artifacts').doc(appId).collection('users').doc(user.uid).collection('settings').doc('security')
                    .onSnapshot(doc => {
                        if (doc.exists) {
                            userPin = doc.data().pin;
                            if (userPin && !sessionStorage.getItem('unlocked')) {
                                document.getElementById('view-lock').classList.remove('hidden');
                            } else {
                                updatePinUI();
                            }
                        }
                    });

                // --- HOUSEHOLD JOINING & CREATION LOGIC ---
                const urlParams = new URLSearchParams(window.location.search);
                const inviteCode = urlParams.get('invite');

                const userRef = db.collection('artifacts').doc(appId).collection('users').doc(user.uid);
                const userDoc = await userRef.get();

                // 1. Join via Invite Link
                if (inviteCode) {
                    currentHouseholdId = inviteCode;
                    await userRef.set({
                        email: user.email,
                        householdId: currentHouseholdId,
                        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    showToast("✅ Joined Household Successfully!", "success");
                    // Clean URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
                // 2. Existing User or New Household
                else if (userDoc.exists && userDoc.data().householdId) {
                    currentHouseholdId = userDoc.data().householdId;
                    showToast("Synced with Household", "success");
                } else {
                    currentHouseholdId = user.uid;
                    await userRef.set({
                        email: user.email,
                        householdId: currentHouseholdId,
                        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    await db.collection('artifacts').doc(appId).collection('households').doc(currentHouseholdId).set({
                        owner: user.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    showToast("New Household Created", "success");
                }

                getDbRef('settings').doc('general')
                    .onSnapshot(doc => {
                        if (doc.exists && doc.data().currency) {
                            currentCurrency = doc.data().currency;
                            document.getElementById('currencySelect').value = currentCurrency;
                            updateUI();
                        }
                    });

                setupWalletsListener();
                setupCategoriesListener();
                setupRealtimeListener();
                setupGoalsListener();
                setupRecurringListener();
                setupDebtsListener();
                setupShoppingListener();
                setupFamilyListener();
                loadBudget();
            } else {
                document.getElementById('view-landing').classList.remove('hidden');
                document.getElementById('app-layout').classList.add('hidden');
            }
        });

        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token && !auth.currentUser) {
            try { await auth.signInWithCustomToken(__initial_auth_token); } catch (e) { }
        }
        document.getElementById('date').valueAsDate = new Date();
    }

    // --- FEATURE 6: Privacy Mode ---
    function injectPrivacyButton() {
        if (document.getElementById('privacyBtn')) return;
        const headerActions = document.querySelector('header .flex.items-center.gap-2');
        if (headerActions) {
            const btn = document.createElement('button');
            btn.id = 'privacyBtn';
            btn.className = "bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300 w-10 h-9 rounded-lg transition-colors flex items-center justify-center shadow-sm";
            btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
            btn.title = "Toggle Privacy Mode";
            btn.onclick = togglePrivacyMode;
            headerActions.insertBefore(btn, headerActions.firstChild);
        }
    }

    function togglePrivacyMode() {
        isPrivacyMode = !isPrivacyMode;
        const btn = document.getElementById('privacyBtn');
        const body = document.body;

        if (isPrivacyMode) {
            btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
            btn.classList.add('text-indigo-500', 'bg-indigo-50');
            body.classList.add('privacy-active');
            showToast("Privacy Mode On", "info");
        } else {
            btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
            btn.classList.remove('text-indigo-500', 'bg-indigo-50');
            body.classList.remove('privacy-active');
            showToast("Privacy Mode Off", "info");
        }
    }

    // --- FEATURE 7: Smart Bill Reminders ---
    function checkBillReminders() {
        if (!recurringItems.length) return;
        const today = new Date().getDate();
        const dueToday = recurringItems.filter(item => item.day === today);

        if (dueToday.length > 0) {
            if ("Notification" in window && Notification.permission !== "granted") {
                Notification.requestPermission();
            }
            dueToday.forEach(bill => {
                showToast(`Bill Due Today: ${bill.name} (${formatCurrency(bill.amount)})`, 'warning');
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("Bill Reminder 📅", {
                        body: `${bill.name} is due today! Amount: ${formatCurrency(bill.amount)}`,
                        icon: "https://cdn-icons-png.flaticon.com/512/2382/2382533.png"
                    });
                }
            });
        }
    }

    // --- FEATURE 8: Spending Heatmap ---
    function renderHeatmap() {
        let heatmapContainer = document.getElementById('heatmapSection');
        if (!heatmapContainer) {
            const dashboardView = document.getElementById('view-dashboard');
            if (!dashboardView) return;

            heatmapContainer = document.createElement('div');
            heatmapContainer.id = 'heatmapSection';
            heatmapContainer.className = "bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 mb-6 hidden md:block";

            heatmapContainer.innerHTML = `
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4">Spending Habits (Last 365 Days)</h3>
                <div class="heatmap-container">
                    <div id="heatmapGrid" class="heatmap-grid"></div>
                </div>
                <div class="flex justify-end items-center gap-2 mt-2 text-xs text-gray-400">
                    <span>Less</span>
                    <div class="w-3 h-3 rounded bg-gray-200 dark:bg-slate-800"></div>
                    <div class="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900"></div>
                    <div class="w-3 h-3 rounded bg-emerald-400 dark:bg-emerald-700"></div>
                    <div class="w-3 h-3 rounded bg-emerald-600 dark:bg-emerald-500"></div>
                    <span>More</span>
                </div>
            `;
            dashboardView.appendChild(heatmapContainer);
        }

        const grid = document.getElementById('heatmapGrid');
        grid.innerHTML = '';

        const dateMap = {};
        const today = new Date();

        for (let i = 0; i < 365; i++) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            dateMap[dateStr] = 0;
        }

        let maxSpend = 0;
        transactions.filter(t => t.type === 'expense').forEach(t => {
            if (dateMap.hasOwnProperty(t.date)) {
                dateMap[t.date] += t.amount;
                if (dateMap[t.date] > maxSpend) maxSpend = dateMap[t.date];
            }
        });

        const startDate = new Date();
        startDate.setDate(today.getDate() - 365);
        while (startDate.getDay() !== 0) {
            startDate.setDate(startDate.getDate() - 1);
        }

        let currentDate = new Date(startDate);
        while (currentDate <= today) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const amount = dateMap[dateStr] || 0;

            let intensity = 0;
            if (amount > 0) {
                const ratio = amount / (maxSpend || 1);
                if (ratio > 0.75) intensity = 4;
                else if (ratio > 0.5) intensity = 3;
                else if (ratio > 0.25) intensity = 2;
                else intensity = 1;
            }

            const cell = document.createElement('div');
            cell.className = `heatmap-cell heat-${intensity}`;
            cell.title = `${dateStr}: ${formatCurrency(amount)}`;

            grid.appendChild(cell);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    // --- PIN LOCK ---
    function enterPin(num) {
        if (pinInput.length < 4) {
            pinInput += num;
            updatePinDots();
            if (pinInput.length === 4) verifyPin();
        }
    }
    function clearPin() {
        pinInput = pinInput.slice(0, -1);
        updatePinDots();
    }
    function updatePinDots() {
        for (let i = 1; i <= 4; i++) {
            const dot = document.getElementById(`pin-${i}`);
            if (i <= pinInput.length) dot.classList.add('filled');
            else dot.classList.remove('filled');
        }
    }
    function verifyPin() {
        if (pinInput === userPin) {
            sessionStorage.setItem('unlocked', 'true');
            document.getElementById('view-lock').classList.add('hidden');
            pinInput = "";
            updatePinDots();
        } else {
            showToast("Incorrect PIN", "error");
            pinInput = "";
            updatePinDots();
        }
    }

    function togglePinSetup() {
        const area = document.getElementById('pinSetupArea');
        const dot = document.getElementById('pinToggleDot');
        if (area.classList.contains('hidden')) {
            area.classList.remove('hidden');
            dot.classList.add('translate-x-5');
            dot.parentElement.classList.add('bg-blue-600');
            dot.parentElement.classList.remove('bg-gray-200', 'dark:bg-slate-700');
        } else {
            if (confirm("Disable App Lock?")) {
                db.collection('artifacts').doc(appId).collection('users').doc(currentUser.uid).collection('settings').doc('security').set({ pin: null });
                area.classList.add('hidden');
                dot.classList.remove('translate-x-5');
                dot.parentElement.classList.remove('bg-blue-600');
                dot.parentElement.classList.remove('bg-gray-200', 'dark:bg-slate-700');
                dot.parentElement.classList.add('bg-gray-200', 'dark:bg-slate-700');
                userPin = null;
            }
        }
    }

    async function savePin() {
        const val = document.getElementById('settingPin').value;
        if (val.length === 4 && !isNaN(val)) {
            await db.collection('artifacts').doc(appId).collection('users').doc(currentUser.uid).collection('settings').doc('security').set({ pin: val });
            showToast("PIN Set Successfully!", "success");
            document.getElementById('settingPin').value = "";
            userPin = val;
        } else {
            showToast("PIN must be 4 digits", "error");
        }
    }

    function updatePinUI() {
        const area = document.getElementById('pinSetupArea');
        const dot = document.getElementById('pinToggleDot');
        if (userPin) {
            area.classList.remove('hidden');
            dot.classList.add('translate-x-5');
            dot.parentElement.classList.add('bg-blue-600');
            dot.parentElement.classList.remove('bg-gray-200', 'dark:bg-slate-700');
        }
    }

    function toggleTheme() {
        const html = document.documentElement;
        if (html.classList.contains('dark')) { html.classList.remove('dark'); localStorage.theme = 'light'; document.getElementById('themeToggleDot').style.transform = 'translateX(0)'; }
        else { html.classList.add('dark'); localStorage.theme = 'dark'; document.getElementById('themeToggleDot').style.transform = 'translateX(100%)'; }
        updateUI();
    }

    // --- CURRENCY & DATA MGMT ---
    function formatCurrency(num) {
        if (isPrivacyMode) return '****';
        const symbolMap = { 'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
        const symbol = symbolMap[currentCurrency] || '₹';
        const locale = currentCurrency === 'INR' ? 'en-IN' : 'en-US';
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currentCurrency }).format(num).replace(/[A-Z]{3}/, symbol).trim();
    }

    async function saveCurrency() {
        const val = document.getElementById('currencySelect').value;
        currentCurrency = val;
        await getDbRef('settings').doc('general').set({ currency: val }, { merge: true });
        updateUI();
        document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = { 'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' }[val]);
    }

    async function exportDataJSON() {
        const data = {
            expenses: transactions,
            categories: Object.values(categoryMap),
            wallets: wallets,
            goals: goals,
            debts: debts,
            recurring: recurringItems,
            shopping: shoppingItems,
            family: familyMembers
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `expenseflow_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    }

    function importDataJSON(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (confirm("This will import data into your account. Continue?")) {
                    const importColl = async (collName, items) => {
                        if (!items) return;
                        const batch = db.batch();
                        let count = 0;
                        const collRef = getDbRef(collName);
                        if (!collRef) return;

                        for (const item of items) {
                            const docRef = collRef.doc(item.id || db.collection('temp').doc().id);
                            const { id, ...docData } = item;
                            batch.set(docRef, docData, { merge: true });
                            count++;
                            if (count >= 400) { await batch.commit(); count = 0; }
                        }
                        if (count > 0) await batch.commit();
                    };

                    await Promise.all([
                        importColl('expenses', data.expenses),
                        importColl('categories', data.categories),
                        importColl('wallets', data.wallets),
                        importColl('goals', data.goals),
                        importColl('debts', data.debts),
                        importColl('recurring', data.recurring),
                        importColl('shopping', data.shopping),
                        importColl('family', data.family)
                    ]);

                    showToast("Import Complete! Reloading...", "success");
                    setTimeout(() => window.location.reload(), 1500);
                }
            } catch (err) { console.error(err); showToast("Invalid JSON file", "error"); }
        };
        reader.readAsText(file);
    }

    // --- WALLETS ---
    function setupWalletsListener() {
        const ref = getDbRef('wallets');
        if (!ref) return;

        ref.onSnapshot(async (snap) => {
            if (snap.empty) { await seedDefaultWallets(ref); return; }
            wallets = []; walletMap = {};
            snap.forEach(doc => { const d = { id: doc.id, ...doc.data() }; wallets.push(d); walletMap[d.id] = d; });
            updateWalletOptions();
            renderJointAccounts();
        });
    }
    async function seedDefaultWallets(ref) {
        const batch = db.batch();
        defaultWallets.forEach(w => batch.set(ref.doc(w.id), w));
        await batch.commit();
    }
    function updateWalletOptions() {
        const sel = document.getElementById('txnWallet'); if (sel) sel.innerHTML = '';
        const filter = document.getElementById('filterWallet'); if (filter) filter.innerHTML = '<option value="all">All Wallets</option>';
        wallets.forEach(w => {
            if (sel) sel.appendChild(new Option(w.name, w.id));
            if (filter) filter.appendChild(new Option(w.name, w.id));
        });
    }

    // --- FAMILY & JOINT ---
    function setupFamilyListener() {
        const ref = getDbRef('family');
        if (!ref) return;

        ref.onSnapshot(snap => {
            familyMembers = [];
            snap.forEach(doc => familyMembers.push({ id: doc.id, ...doc.data() }));
            renderFamilyMembers();
        });
    }

    function renderFamilyMembers() {
        const grid = document.getElementById('familyMembersGrid');
        if (!grid) return;
        grid.innerHTML = '';
        if (familyMembers.length === 0) {
            document.getElementById('emptyFamily').classList.remove('hidden');
            return;
        }
        document.getElementById('emptyFamily').classList.add('hidden');

        familyMembers.forEach(m => {
            grid.innerHTML += `
                    <div class="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-between group relative">
                        <button onclick="deleteFamilyMember('${m.id}')" class="absolute top-2 right-2 text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fa-solid fa-trash"></i></button>
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center font-bold text-lg border-2 border-white dark:border-slate-700 shadow-sm">
                                ${m.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h4 class="font-bold text-gray-800 dark:text-white privacy-sensitive">${m.name}</h4>
                                <p class="text-xs text-gray-500 dark:text-gray-400 capitalize">${m.role}</p>
                            </div>
                        </div>
                        <div class="text-right">
                             <span class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${m.access === 'Full Access' ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'}">${m.access}</span>
                        </div>
                    </div>
                `;
        });
    }

    function renderJointAccounts() {
        const grid = document.getElementById('jointAccountsGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const jointWallets = wallets.filter(w => w.type === 'joint');

        if (jointWallets.length === 0) {
            document.getElementById('emptyJoint').classList.remove('hidden');
            return;
        }
        document.getElementById('emptyJoint').classList.add('hidden');

        jointWallets.forEach(w => {
            const balance = transactions.filter(t => t.walletId === w.id).reduce((sum, t) => {
                if (t.type === 'income') return sum + t.amount;
                if (t.type === 'expense' || t.type === 'investment') return sum - t.amount;
                return sum;
            }, 0);

            grid.innerHTML += `
                    <div class="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-2xl shadow-lg text-white relative overflow-hidden group">
                        <div class="absolute right-0 top-0 p-4 opacity-10"><i class="fa-solid fa-users text-8xl"></i></div>
                        <div class="relative z-10 flex justify-between items-start mb-6">
                            <div>
                                <p class="text-xs text-indigo-200 font-medium uppercase tracking-wider mb-1">Joint Account</p>
                                <h3 class="text-xl font-bold privacy-sensitive">${w.name}</h3>
                            </div>
                            <i class="fa-solid fa-building-columns text-indigo-300 text-xl"></i>
                        </div>
                        <div class="relative z-10">
                            <p class="text-sm text-indigo-200 mb-1">Current Balance</p>
                            <h2 class="text-3xl font-bold tracking-tight privacy-sensitive">${formatCurrency(balance)}</h2>
                        </div>
                        <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl"></div>
                        <button onclick="deleteWallet('${w.id}')" class="absolute top-4 right-4 text-indigo-200 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
        });
    }

    const familyModal = document.getElementById('familyModal');
    function openFamilyModal() { document.getElementById('familyForm').reset(); familyModal.classList.remove('hidden'); }
    function closeFamilyModal() { familyModal.classList.add('hidden'); }

    // --- INVITE MEMBER (WRITES TO FIRESTORE FOR CLOUD FUNCTION) ---
    document.getElementById('familyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('famName').value;
        const email = document.getElementById('famEmail').value;
        const role = document.getElementById('famRole').value;
        const access = document.getElementById('famAccess').value;

        const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${currentHouseholdId}`;

        const data = {
            name: name,
            role: role,
            access: access,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            // 1. Add member locally
            await getDbRef('family').add(data);

            // 2. Queue Email for Backend (Nodemailer)
            // Note: This writes to a root-level collection 'mail_queue' so the backend can see it easily
            await db.collection('mail_queue').add({
                to_email: email,
                to_name: name,
                from_name: currentUser.displayName || "ExpenseFlow User",
                invite_link: inviteLink,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 3. Fallback Copy
            if (navigator.clipboard) {
                navigator.clipboard.writeText(inviteLink).then(() => {
                    showToast("Link copied to clipboard!", "info");
                });
            }

            closeFamilyModal();
            showToast("Invite queued. Sending email...", "success");
        } catch (err) {
            console.error(err);
            showToast("Error queuing invite", "error");
        }
    });

    window.deleteFamilyMember = async (id) => {
        if (confirm("Remove this family member?")) {
            await getDbRef('family').doc(id).delete();
            showToast("Member removed", "info");
        }
    };

    window.createJointAccount = async () => {
        const name = prompt("Enter Name for Joint Account (e.g., Family Savings):");
        if (name) {
            await getDbRef('wallets').add({
                name: name,
                type: 'joint'
            });
            showToast("Joint account created", "success");
        }
    };

    window.deleteWallet = async (id) => {
        if (confirm("Delete this wallet? Transactions linked to it will remain but wallet reference will be lost.")) {
            await getDbRef('wallets').doc(id).delete();
        }
    };


    // --- CATEGORIES ---
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
            updateCategoryOptions(); updateRecCategoryOptions(); updateUI();
        });
    }
    async function seedDefaultCategories(ref) {
        const batch = db.batch();
        defaultCategoriesList.forEach(cat => batch.set(ref.doc(cat.id), cat));
        await batch.commit();
    }
    function updateCategoryOptions() {
        const type = document.getElementById('type').value, sel = document.getElementById('category');
        if (!sel) return;
        sel.innerHTML = '';
        const list = categories[type] || [];
        if (!list.length) { sel.innerHTML = '<option>Loading...</option>'; return; }
        const parents = list.filter(c => !c.parentId);
        const children = list.filter(c => c.parentId);
        parents.forEach(p => {
            sel.appendChild(new Option(p.name, p.id));
            children.filter(c => c.parentId === p.id).forEach(c => {
                const opt = new Option(c.name, c.id); opt.innerHTML = `&nbsp;&nbsp;&nbsp;› ${c.name}`; sel.appendChild(opt);
            });
        });
    }
    function openCategoryModal() {
        document.getElementById('categoryForm').reset(); document.getElementById('catIcon').value = 'fa-tag';
        const type = document.getElementById('type').value;
        const parentSel = document.getElementById('catParent'); parentSel.innerHTML = '<option value="">None (Top Level)</option>';
        (categories[type] || []).filter(c => !c.parentId).forEach(c => parentSel.appendChild(new Option(c.name, c.id)));
        document.getElementById('categoryModal').classList.remove('hidden');
    }
    function closeCategoryModal() { document.getElementById('categoryModal').classList.add('hidden'); }
    document.getElementById('categoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newCat = {
            name: document.getElementById('catName').value,
            type: document.getElementById('type').value,
            parentId: document.getElementById('catParent').value || null,
            color: document.getElementById('catColor').value,
            icon: document.getElementById('catIcon').value || 'fa-tag',
            budget: parseFloat(document.getElementById('catBudget').value) || 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await getDbRef('categories').add(newCat);
            closeCategoryModal();
            showToast("Category saved", "success");
        } catch (err) { showToast("Error saving category", "error"); }
    });

    // --- DEBTS ---
    function setupDebtsListener() {
        const ref = getDbRef('debts');
        if (!ref) return;

        ref.onSnapshot(snap => {
            debts = [];
            snap.forEach(doc => debts.push({ id: doc.id, ...doc.data() }));
            renderDebts();
            calculateNetWorth();
        });
    }
    function renderDebts() {
        const grid = document.getElementById('debtsGrid'); if (!grid) return;
        grid.innerHTML = '';
        if (debts.length === 0) { document.getElementById('emptyDebts').classList.remove('hidden'); return; }
        document.getElementById('emptyDebts').classList.add('hidden');

        debts.forEach(d => {
            const isLent = d.type === 'lent';
            const color = isLent ? 'text-emerald-600' : 'text-orange-600';
            const bg = isLent ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-orange-100 dark:bg-orange-900/30';
            const icon = isLent ? 'fa-hand-holding-dollar' : 'fa-hand-holding';

            grid.innerHTML += `
                    <div class="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 relative">
                        <button onclick="deleteDebt('${d.id}')" class="absolute top-3 right-3 text-gray-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-full ${bg} flex items-center justify-center ${color} text-xl">
                                <i class="fa-solid ${icon}"></i>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">${isLent ? 'You Lent' : 'You Borrowed'}</p>
                                <h4 class="text-lg font-bold text-gray-800 dark:text-white privacy-sensitive">${d.person}</h4>
                                <p class="text-sm font-mono font-medium ${color} privacy-sensitive">${formatCurrency(d.amount)}</p>
                            </div>
                        </div>
                        <div class="mt-4 flex justify-between items-center">
                            <p class="text-xs text-gray-400">${d.dueDate ? 'Due: ' + formatDate(d.dueDate) : 'No due date'}</p>
                            <button onclick="settleDebt('${d.id}')" class="text-xs bg-gray-100 dark:bg-slate-700 hover:bg-blue-100 text-gray-600 dark:text-gray-300 hover:text-blue-600 px-3 py-1.5 rounded-lg transition-colors">Mark Settled</button>
                        </div>
                    </div>
                `;
        });
    }
    const debtModal = document.getElementById('debtModal');
    function openDebtModal() { document.getElementById('debtForm').reset(); setDebtType('lent'); debtModal.classList.remove('hidden'); }
    function closeDebtModal() { debtModal.classList.add('hidden'); }
    function setDebtType(t) {
        document.getElementById('debtType').value = t;
        const btnL = document.getElementById('btn-lent');
        const btnB = document.getElementById('btn-borrowed');
        if (t === 'lent') {
            btnL.className = "py-2 rounded-lg text-sm font-medium shadow-sm bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400";
            btnB.className = "py-2 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700";
        } else {
            btnL.className = "py-2 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700";
            btnB.className = "py-2 rounded-lg text-sm font-medium shadow-sm bg-white dark:bg-slate-600 text-orange-600 dark:text-orange-400";
        }
    }
    document.getElementById('debtForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            type: document.getElementById('debtType').value,
            person: document.getElementById('debtPerson').value,
            amount: parseFloat(document.getElementById('debtAmount').value),
            dueDate: document.getElementById('debtDate').value || null,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await getDbRef('debts').add(data);
            closeDebtModal();
            showToast("Debt record added", "success");
        } catch (e) { showToast("Error adding debt", "error"); }
    });
    window.deleteDebt = async (id) => { if (confirm("Delete record?")) await getDbRef('debts').doc(id).delete(); };
    window.settleDebt = async (id) => { if (confirm("Mark as settled?")) await getDbRef('debts').doc(id).delete(); };

    // --- SHOPPING ---
    function setupShoppingListener() {
        const ref = getDbRef('shopping');
        if (!ref) return;

        ref.onSnapshot(snap => {
            shoppingItems = [];
            snap.forEach(doc => shoppingItems.push({ id: doc.id, ...doc.data() }));
            renderShoppingList();
        });
    }

    function renderShoppingList() {
        const list = document.getElementById('shoppingList');
        if (!list) return;
        list.innerHTML = '';

        let total = 0;
        let checkedTotal = 0;

        if (shoppingItems.length === 0) {
            document.getElementById('emptyShopping').classList.remove('hidden');
        } else {
            document.getElementById('emptyShopping').classList.add('hidden');

            shoppingItems.forEach(item => {
                total += item.cost;
                if (item.checked) checkedTotal += item.cost;

                const checkState = item.checked ? 'checked' : '';
                const strikeClass = item.checked ? 'line-through text-gray-400' : 'text-gray-800 dark:text-white';

                list.innerHTML += `
                        <div class="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors group">
                            <div class="flex items-center gap-3">
                                <input type="checkbox" ${checkState} onchange="toggleShoppingItem('${item.id}', this.checked)" class="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer">
                                <span class="${strikeClass}">${item.name}</span>
                            </div>
                            <div class="flex items-center gap-4">
                                <span class="font-mono text-sm text-gray-600 dark:text-gray-300 privacy-sensitive">${formatCurrency(item.cost)}</span>
                                <button onclick="deleteShoppingItem('${item.id}')" class="text-gray-300 hover:text-rose-500 transition-colors"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                    `;
            });
        }
        document.getElementById('shoppingTotal').textContent = formatCurrency(checkedTotal);
    }

    document.getElementById('shoppingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            name: document.getElementById('shopItem').value,
            cost: parseFloat(document.getElementById('shopCost').value) || 0,
            checked: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await getDbRef('shopping').add(data);
            document.getElementById('shopItem').value = '';
            document.getElementById('shopCost').value = '';
            showToast("Item added to list", "success");
        } catch (e) { showToast("Error adding item", "error"); }
    });

    window.toggleShoppingItem = async (id, checked) => {
        await getDbRef('shopping').doc(id).update({ checked });
    };

    window.deleteShoppingItem = async (id) => {
        await getDbRef('shopping').doc(id).delete();
    };

    window.checkoutShoppingList = async () => {
        const checkedItems = shoppingItems.filter(i => i.checked);
        if (checkedItems.length === 0) return showToast("No items selected!", "info");

        const totalCost = checkedItems.reduce((sum, i) => sum + i.cost, 0);
        const itemsDesc = "Shopping: " + checkedItems.map(i => i.name).join(", ");

        openModal();
        setType('expense');
        document.getElementById('amount').value = totalCost;
        document.getElementById('note').value = itemsDesc;

        if (confirm("Create transaction for " + formatCurrency(totalCost) + " and remove items from list?")) {
            checkedItems.forEach(item => deleteShoppingItem(item.id));
        }
    };


    // --- RECURRING ---
    function setupRecurringListener() {
        const ref = getDbRef('recurring');
        if (!ref) return;

        ref.onSnapshot(snap => {
            recurringItems = [];
            snap.forEach(doc => recurringItems.push({ id: doc.id, ...doc.data() }));
            renderRecurring();
            checkBillReminders();
        });
    }
    function renderRecurring() {
        const grid = document.getElementById('recurringGrid'); if (!grid) return;
        grid.innerHTML = '';
        if (recurringItems.length === 0) { document.getElementById('emptyRecurring').classList.remove('hidden'); return; }
        document.getElementById('emptyRecurring').classList.add('hidden');

        const today = new Date().getDate();

        recurringItems.forEach(item => {
            const cat = categoryMap[item.category] || { name: 'Unknown', icon: 'fa-rotate', color: '#ccc' };

            grid.innerHTML += `
                    <div class="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 relative">
                        <button onclick="deleteRecurring('${item.id}')" class="absolute top-3 right-3 text-gray-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
                        <div class="flex items-center gap-3 mb-3">
                            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white" style="background-color:${cat.color}"><i class="fa-solid ${cat.icon}"></i></div>
                            <div>
                                <h4 class="font-bold text-gray-800 dark:text-white privacy-sensitive">${item.name}</h4>
                                <p class="text-xs text-gray-500 dark:text-gray-400">${cat.name}</p>
                            </div>
                        </div>
                        <div class="flex justify-between items-end">
                            <div>
                                <p class="text-xs text-gray-400 uppercase">Amount</p>
                                <p class="text-lg font-bold text-gray-800 dark:text-white privacy-sensitive">${formatCurrency(item.amount)}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-xs text-gray-400">Due Day: ${item.day}</p>
                                <button onclick="payRecurring('${item.id}')" class="mt-1 text-xs font-bold bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg hover:bg-indigo-200">Pay Now</button>
                            </div>
                        </div>
                    </div>
                `;
        });
    }
    function updateRecCategoryOptions() {
        const sel = document.getElementById('recCategory'); if (sel) sel.innerHTML = '';
        categories['expense'].forEach(c => { if (sel) sel.appendChild(new Option(c.name, c.id)) });
    }
    const recModal = document.getElementById('recurringModal');
    function openRecurringModal() { document.getElementById('recurringForm').reset(); updateRecCategoryOptions(); recModal.classList.remove('hidden'); }
    function closeRecurringModal() { recModal.classList.add('hidden'); }

    document.getElementById('recurringForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            name: document.getElementById('recName').value,
            amount: parseFloat(document.getElementById('recAmount').value),
            day: parseInt(document.getElementById('recDay').value),
            category: document.getElementById('recCategory').value
        };
        try {
            await getDbRef('recurring').add(data);
            closeRecurringModal();
            showToast("Subscription added", "success");
        } catch (e) { showToast("Error adding subscription", "error"); }
    });

    window.deleteRecurring = async (id) => { if (confirm("Delete?")) await getDbRef('recurring').doc(id).delete(); };

    window.payRecurring = (id) => {
        const item = recurringItems.find(i => i.id === id);
        if (!item) return;
        openModal();
        setType('expense');
        document.getElementById('amount').value = item.amount;
        document.getElementById('note').value = "Payment for " + item.name;
        setTimeout(() => document.getElementById('category').value = item.category, 100);
    };

    // --- CALENDAR ---
    function changeMonth(delta) {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
        renderCalendar();
    }

    function renderCalendar() {
        const grid = document.getElementById('calendarGrid'); if (!grid) return;
        grid.innerHTML = '';
        const year = currentCalendarDate.getFullYear();
        const month = currentCalendarDate.getMonth();
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);

        document.getElementById('calendarTitle').textContent = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < firstDay; i++) { grid.innerHTML += `<div></div>`; }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayTxns = transactions.filter(t => t.date === dateStr && t.type === 'expense');
            const total = dayTxns.reduce((sum, t) => sum + Number(t.amount), 0);

            let projectedTotal = 0;
            let recurringNames = [];
            const dateObj = new Date(year, month, day);
            if (dateObj > todayDate) {
                recurringItems.forEach(item => {
                    if (item.day === day) {
                        projectedTotal += item.amount;
                        recurringNames.push(item.name);
                    }
                });
            }

            let content = '';
            if (total > 0) {
                const colorClass = total > (monthlyBudget / 30) ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600';
                content += `<div class="mt-1 text-[10px] font-bold px-1 rounded ${colorClass} privacy-sensitive">${formatCurrency(total)}</div>`;
            }
            if (projectedTotal > 0) {
                content += `
                    <div class="mt-1 text-[10px] font-bold px-1 rounded bg-indigo-50 text-indigo-400 border border-dashed border-indigo-200 privacy-sensitive" title="Expected: ${recurringNames.join(', ')}">
                        <i class="fa-solid fa-clock-rotate-left mr-1"></i>${formatCurrency(projectedTotal)}
                    </div>
                `;
            }

            grid.innerHTML += `
                    <div class="calendar-day border border-gray-100 dark:border-slate-700 p-1 hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded transition-colors">
                        <span class="text-xs text-gray-400">${day}</span>
                        ${content}
                    </div>
                `;
        }
    }

    // --- TRANSACTIONS & FILTERS ---
    function toggleCustomDate() {
        const val = document.getElementById('filterDate').value;
        const customDiv = document.getElementById('customDateRange');
        if (val === 'custom') customDiv.classList.remove('hidden');
        else { customDiv.classList.add('hidden'); renderFullList(); }
    }

    function setupRealtimeListener() {
        const collectionRef = getDbRef('expenses');
        if (!collectionRef) return;

        collectionRef.onSnapshot((snapshot) => {
            transactions = [];
            snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
            transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
            updateTagFilter();
            updateUI();
            renderJointAccounts();
        });
    }

    function updateTagFilter() {
        const tags = new Set();
        transactions.forEach(t => {
            const note = t.note || "";
            const matches = note.match(/#\w+/g);
            if (matches) matches.forEach(tag => tags.add(tag));
        });

        const select = document.getElementById('filterTag');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="all">All Tags</option>';

        tags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = tag;
            select.appendChild(opt);
        });

        select.value = current;
    }

    function setupGoalsListener() {
        const goalsRef = getDbRef('goals');
        if (!goalsRef) return;

        goalsRef.onSnapshot((snapshot) => {
            goals = [];
            snapshot.forEach(doc => goals.push({ id: doc.id, ...doc.data() }));
            renderGoals();
            calculateNetWorth();
        });
    }

    function loadBudget() {
        getDbRef('settings').doc('general')
            .onSnapshot(doc => { if (doc.exists) { monthlyBudget = doc.data().monthlyBudget || 0; } updateBudgetUI(); });
    }
    function openBudgetModal() { document.getElementById('budgetInput').value = monthlyBudget || ''; document.getElementById('budgetModal').classList.remove('hidden'); }
    function closeBudgetModal() { document.getElementById('budgetModal').classList.add('hidden'); }
    async function saveBudget() {
        const val = parseFloat(document.getElementById('budgetInput').value);
        if (isNaN(val) || val < 0) return showToast("Invalid budget", "error");
        await getDbRef('settings').doc('general').set({ monthlyBudget: val }, { merge: true });
        closeBudgetModal();
        showToast("Budget updated", "success");
    }
    function updateBudgetUI() {
        const now = new Date();
        const spent = transactions.filter(t => t.type === 'expense' && new Date(t.date).getMonth() === now.getMonth() && new Date(t.date).getFullYear() === now.getFullYear()).reduce((sum, t) => sum + Number(t.amount), 0);
        document.getElementById('budgetDisplay').textContent = formatCurrency(monthlyBudget);
        document.getElementById('spentThisMonth').textContent = formatCurrency(spent);
        const bar = document.getElementById('budgetProgressBar'), msg = document.getElementById('budgetMessage');
        if (monthlyBudget > 0) {
            const pct = (spent / monthlyBudget) * 100;
            bar.style.width = `${Math.min(pct, 100)}%`;
            if (pct > 100) { bar.className = "bg-rose-500 h-3 rounded-full transition-all"; msg.textContent = `Over budget by ${formatCurrency(spent - monthlyBudget)}!`; msg.className = "text-xs text-rose-500 mt-2 font-bold"; }
            else if (pct > 80) { bar.className = "bg-orange-400 h-3 rounded-full transition-all"; msg.textContent = "Approaching limit."; msg.className = "text-xs text-orange-500 mt-2"; }
            else { bar.className = "bg-emerald-500 h-3 rounded-full transition-all"; msg.textContent = "Within budget."; msg.className = "text-xs text-gray-400 dark:text-gray-500 mt-2"; }
        } else { bar.style.width = "0%"; msg.textContent = "No budget set."; }
    }

    // FEATURE 4: Predictive Financial Health
    function calculateFinancialHealth() {
        let income = 0;
        let expenses = 0;
        let totalDebt = 0;
        let savings = 0;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        transactions.forEach(t => {
            const d = new Date(t.date);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                if (t.type === 'income') income += Number(t.amount);
                if (t.type === 'expense') expenses += Number(t.amount);
            }
        });

        debts.forEach(d => {
            if (d.type === 'borrowed') totalDebt += Number(d.amount);
        });

        goals.forEach(g => savings += Number(g.saved));

        const today = now.getDate();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const daysRemaining = daysInMonth - today;

        // Calculate Average Daily Spend (ADS)
        const dailyAverage = today > 0 ? expenses / today : expenses;

        // Forecast
        const projectedSpend = expenses + (dailyAverage * daysRemaining);
        const budget = monthlyBudget || 0;

        let predictionMsg = "On track.";
        let isDanger = false;

        if (budget > 0) {
            if (projectedSpend > budget) {
                const overage = projectedSpend - budget;
                predictionMsg = `⚠️ Forecast: Over by ${formatCurrency(overage)}`;
                isDanger = true;
            } else {
                const buffer = budget - projectedSpend;
                predictionMsg = `Safe! Est. buffer: ${formatCurrency(buffer)}`;
            }
        } else {
            predictionMsg = "Set a budget to see forecasts.";
        }

        // SCORING
        let savingsScore = 0;
        if (income > 0) {
            const savingsRate = (income - expenses) / income;
            savingsScore = Math.min((savingsRate / 0.20) * 100, 100);
            if (savingsScore < 0) savingsScore = 0;
        }

        let budgetScore = 100;
        if (monthlyBudget > 0) {
            if (expenses > monthlyBudget) budgetScore = Math.max(0, 100 - ((expenses - monthlyBudget) / monthlyBudget * 100));
        } else {
            budgetScore = 50;
        }

        let debtScore = 100;
        if (income > 0) {
            const debtRatio = totalDebt / (income * 12);
            if (debtRatio > 0.3) debtScore = Math.max(0, 100 - ((debtRatio - 0.3) * 100));
        }

        const totalScore = Math.round((savingsScore * 0.4) + (budgetScore * 0.3) + (debtScore * 0.3));

        // Update UI
        const circle = document.getElementById('healthCircle');
        const scoreText = document.getElementById('healthScore');
        const statusText = document.getElementById('healthStatus');
        const actionText = document.getElementById('healthAction');

        if (circle && scoreText) {
            const offset = 251.2 - (251.2 * totalScore) / 100;
            circle.style.strokeDashoffset = offset;

            if (totalScore >= 80) circle.classList.replace('text-emerald-500', 'text-emerald-500') || circle.classList.add('text-emerald-500');
            else if (totalScore >= 50) { circle.classList.remove('text-emerald-500'); circle.classList.add('text-yellow-500'); }
            else { circle.classList.remove('text-emerald-500'); circle.classList.add('text-rose-500'); }

            scoreText.textContent = totalScore;

            if (isDanger) {
                statusText.textContent = "Risk Alert";
                statusText.className = "font-bold text-rose-400 blink-animation";
                actionText.innerHTML = predictionMsg;
            } else {
                if (totalScore >= 80) { statusText.textContent = "Excellent"; actionText.textContent = predictionMsg; }
                else if (totalScore >= 50) { statusText.textContent = "Good"; actionText.textContent = predictionMsg; }
                else { statusText.textContent = "Needs Work"; actionText.textContent = predictionMsg; }

                statusText.className = `font-bold ${totalScore >= 50 ? 'text-emerald-400' : 'text-yellow-400'}`;
            }
        }
    }

    function calculateInsights() {
        const now = new Date();
        const catTotals = {}; let topId = null, topAmt = 0;
        transactions.filter(t => t.type === 'expense').forEach(t => {
            if (!catTotals[t.category]) catTotals[t.category] = 0; catTotals[t.category] += Number(t.amount);
            if (catTotals[t.category] > topAmt) { topAmt = catTotals[t.category]; topId = t.category; }
        });
        document.getElementById('insightTopCat').textContent = topId ? (categoryMap[topId]?.name || 'Unknown') : '-';
        document.getElementById('insightTopCatAmount').textContent = formatCurrency(topAmt);

        const spent = transactions.filter(t => t.type === 'expense' && new Date(t.date).getMonth() === now.getMonth() && new Date(t.date).getFullYear() === now.getFullYear()).reduce((a, b) => a + Number(b.amount), 0);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const proj = now.getDate() > 0 ? (spent / now.getDate()) * daysInMonth : 0;
        document.getElementById('insightProjection').textContent = formatCurrency(proj);

        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        const recentSpent = transactions.filter(t => t.type === 'expense' && new Date(t.date) >= cutoff).reduce((a, b) => a + Number(b.amount), 0);
        document.getElementById('insightDailyAvg').textContent = formatCurrency(recentSpent / 30);
    }

    function calculateNetWorth() {
        let cash = 0;
        let invested = 0;
        let savings = 0;
        let debt = 0;

        transactions.forEach(t => {
            const amt = Number(t.amount);
            if (t.type === 'income') cash += amt;
            else if (t.type === 'expense') cash -= amt;
            else if (t.type === 'investment') {
                cash -= amt;
                invested += amt;
            }
        });

        goals.forEach(g => savings += Number(g.saved));

        debts.forEach(d => {
            if (d.type === 'borrowed') debt += Number(d.amount);
        });

        const assets = cash + invested + savings;
        const netWorth = assets - debt;

        document.getElementById('nwTotal').textContent = formatCurrency(netWorth);
        document.getElementById('nwAssets').textContent = formatCurrency(assets);
        document.getElementById('nwLiabilities').textContent = formatCurrency(debt);

        document.getElementById('nwCash').textContent = formatCurrency(cash);
        document.getElementById('nwInvest').textContent = formatCurrency(invested);
        document.getElementById('nwSavings').textContent = formatCurrency(savings);
        document.getElementById('nwDebt').textContent = formatCurrency(debt);

        if (isPrivacyMode) {
            document.querySelectorAll('.privacy-sensitive').forEach(el => el.classList.add('privacy-sensitive'));
        }
    }

    function renderCategoryBudgets() {
        const section = document.getElementById('categoryBudgetsSection');
        const grid = document.getElementById('categoryBudgetsGrid');
        grid.innerHTML = '';

        const now = new Date();
        const budgetedCats = categories['expense'].filter(c => c.budget && c.budget > 0);

        if (budgetedCats.length === 0) {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');

        budgetedCats.forEach(cat => {
            const spent = transactions
                .filter(t => t.category === cat.id && new Date(t.date).getMonth() === now.getMonth() && new Date(t.date).getFullYear() === now.getFullYear())
                .reduce((sum, t) => sum + Number(t.amount), 0);

            const pct = Math.min((spent / cat.budget) * 100, 100);
            let color = 'bg-emerald-500';
            if (pct > 90) color = 'bg-rose-500';
            else if (pct > 75) color = 'bg-orange-500';

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

    // FEATURE 5: Gamification (Badges)
    function renderGamification() {
        let badgeContainer = document.getElementById('gamificationSection');

        if (!badgeContainer) {
            const dashboardView = document.getElementById('view-dashboard');
            if (!dashboardView) return;

            badgeContainer = document.createElement('div');
            badgeContainer.id = 'gamificationSection';
            badgeContainer.className = "mb-6 grid grid-cols-2 md:grid-cols-4 gap-4";

            dashboardView.insertBefore(badgeContainer, dashboardView.children[1]);
        }

        badgeContainer.innerHTML = '';

        const badges = [
            {
                id: 'debt_free',
                name: 'Debt Destroyer',
                icon: 'fa-shield-halved',
                color: 'text-emerald-500',
                bg: 'bg-emerald-100 dark:bg-emerald-900/30',
                unlocked: debts.length === 0 && transactions.length > 0,
                desc: 'Zero active debts'
            },
            {
                id: 'saver',
                name: 'Super Saver',
                icon: 'fa-piggy-bank',
                color: 'text-blue-500',
                bg: 'bg-blue-100 dark:bg-blue-900/30',
                unlocked: goals.some(g => g.saved >= g.target && g.target > 0),
                desc: 'Hit a savings goal'
            },
            {
                id: 'planner',
                name: 'Future Planner',
                icon: 'fa-calendar-check',
                color: 'text-purple-500',
                bg: 'bg-purple-100 dark:bg-purple-900/30',
                unlocked: recurringItems.length >= 3,
                desc: '3+ recurring items'
            },
            {
                id: 'investor',
                name: 'Wealth Builder',
                icon: 'fa-arrow-trend-up',
                color: 'text-amber-500',
                bg: 'bg-amber-100 dark:bg-amber-900/30',
                unlocked: transactions.some(t => t.type === 'investment'),
                desc: 'Made an investment'
            }
        ];

        badges.forEach(b => {
            const opacity = b.unlocked ? 'opacity-100 badge-enter' : 'opacity-40 grayscale';
            const statusIcon = b.unlocked ? '<i class="fa-solid fa-check-circle text-emerald-500 absolute top-2 right-2 text-xs"></i>' : '<i class="fa-solid fa-lock text-gray-400 absolute top-2 right-2 text-xs"></i>';

            badgeContainer.innerHTML += `
                <div class="relative p-3 rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center gap-3 ${opacity} transition-all">
                    ${statusIcon}
                    <div class="w-10 h-10 rounded-full ${b.bg} flex items-center justify-center ${b.color}">
                        <i class="fa-solid ${b.icon}"></i>
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-gray-800 dark:text-gray-200">${b.name}</h4>
                        <p class="text-[10px] text-gray-400">${b.desc}</p>
                    </div>
                </div>
            `;
        });
    }

    // FEATURE 8: Heatmap
    function renderHeatmap() {
        let heatmapContainer = document.getElementById('heatmapSection');

        if (!heatmapContainer) {
            const dashboardView = document.getElementById('view-dashboard');
            if (!dashboardView) return;

            heatmapContainer = document.createElement('div');
            heatmapContainer.id = 'heatmapSection';
            heatmapContainer.className = "bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 mb-6 hidden md:block";

            heatmapContainer.innerHTML = `
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4">Spending Habits (Last 365 Days)</h3>
                <div class="heatmap-container">
                    <div id="heatmapGrid" class="heatmap-grid"></div>
                </div>
                <div class="flex justify-end items-center gap-2 mt-2 text-xs text-gray-400">
                    <span>Less</span>
                    <div class="w-3 h-3 rounded bg-gray-200 dark:bg-slate-800"></div>
                    <div class="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900"></div>
                    <div class="w-3 h-3 rounded bg-emerald-400 dark:bg-emerald-700"></div>
                    <div class="w-3 h-3 rounded bg-emerald-600 dark:bg-emerald-500"></div>
                    <span>More</span>
                </div>
            `;

            dashboardView.appendChild(heatmapContainer);
        }

        const grid = document.getElementById('heatmapGrid');
        grid.innerHTML = '';

        const dateMap = {};
        const today = new Date();

        for (let i = 0; i < 365; i++) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            dateMap[dateStr] = 0;
        }

        let maxSpend = 0;
        transactions.filter(t => t.type === 'expense').forEach(t => {
            if (dateMap.hasOwnProperty(t.date)) {
                dateMap[t.date] += t.amount;
                if (dateMap[t.date] > maxSpend) maxSpend = dateMap[t.date];
            }
        });

        const startDate = new Date();
        startDate.setDate(today.getDate() - 365);

        while (startDate.getDay() !== 0) {
            startDate.setDate(startDate.getDate() - 1);
        }

        let currentDate = new Date(startDate);

        while (currentDate <= today) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const amount = dateMap[dateStr] || 0;

            let intensity = 0;
            if (amount > 0) {
                const ratio = amount / (maxSpend || 1);
                if (ratio > 0.75) intensity = 4;
                else if (ratio > 0.5) intensity = 3;
                else if (ratio > 0.25) intensity = 2;
                else intensity = 1;
            }

            const cell = document.createElement('div');
            cell.className = `heatmap-cell heat-${intensity}`;
            cell.title = `${dateStr}: ${formatCurrency(amount)}`;

            grid.appendChild(cell);

            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    function calculateSplit() {
        const total = parseFloat(document.getElementById('splitTotal').value) || 0;
        const people = parseInt(document.getElementById('splitPeople').value) || 1;
        const tip = parseFloat(document.getElementById('splitTip').value) || 0;

        if (total <= 0 || people < 1) return;

        const totalWithTip = total + (total * (tip / 100));
        const share = totalWithTip / people;

        document.getElementById('splitPerPerson').textContent = formatCurrency(share);
        document.getElementById('splitResult').classList.remove('hidden');

        window.currentShare = share;
    }

    function logSplitShare() {
        if (!window.currentShare) return;
        openModal();
        setType('expense');
        document.getElementById('amount').value = window.currentShare.toFixed(2);
        document.getElementById('note').value = "My share of split bill";
    }

    function updateUI() {
        renderSummary(); renderRecentList(); renderFullList(); renderChart(); renderTrendChart(); renderComparisonChart(); updateBudgetUI(); calculateInsights(); renderCalendar(); renderCategoryBudgets(); calculateNetWorth(); renderJointAccounts();
        calculateFinancialHealth();
        renderGamification();
        renderHeatmap();
        if (isPrivacyMode) document.body.classList.add('privacy-active');
    }
    function renderSummary() {
        let inc = 0, exp = 0, inv = 0;
        transactions.forEach(t => {
            const amt = Number(t.amount);
            if (t.type === 'income') inc += amt;
            else if (t.type === 'expense') exp += amt;
            else if (t.type === 'investment') inv += amt;
        });
        document.getElementById('totalIncome').textContent = formatCurrency(inc);
        document.getElementById('totalExpense').textContent = formatCurrency(exp);
        document.getElementById('totalInvestment').textContent = formatCurrency(inv);
        document.getElementById('totalBalance').textContent = formatCurrency(inc - exp - inv);

        document.getElementById('totalIncome').classList.add('privacy-sensitive');
        document.getElementById('totalExpense').classList.add('privacy-sensitive');
        document.getElementById('totalInvestment').classList.add('privacy-sensitive');
        document.getElementById('totalBalance').classList.add('privacy-sensitive');
    }
    function renderFullList() {
        const list = document.getElementById('fullTransactionList'); list.innerHTML = '';
        const type = document.getElementById('filterType').value;
        const wallet = document.getElementById('filterWallet').value;
        const dateFilter = document.getElementById('filterDate').value;
        const tagFilter = document.getElementById('filterTag').value;
        const search = document.getElementById('searchInput').value.toLowerCase();

        let start = null, end = null;
        if (dateFilter === 'custom') {
            const s = document.getElementById('startDate').value;
            const e = document.getElementById('endDate').value;
            if (s) start = new Date(s);
            if (e) end = new Date(e);
        }

        const filtered = transactions.filter(t => {
            const matchType = type === 'all' || t.type === type;
            const matchWallet = wallet === 'all' || t.walletId === wallet;

            let matchDate = true; const d = new Date(t.date), now = new Date();
            if (dateFilter === 'this_year') matchDate = d.getFullYear() === now.getFullYear();
            if (dateFilter === 'this_month') matchDate = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            if (dateFilter === 'last_month') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); matchDate = d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); }
            if (dateFilter === 'custom') {
                if (start && d < start) matchDate = false;
                if (end && d > end) matchDate = false;
            }

            const catName = categoryMap[t.category]?.name || '';
            const matchSearch = t.note.toLowerCase().includes(search) || catName.toLowerCase().includes(search);

            const matchTag = tagFilter === 'all' || (t.note && t.note.includes(tagFilter));

            return matchType && matchWallet && matchDate && matchSearch && matchTag;
        });

        if (filtered.length === 0) document.getElementById('emptyState').classList.remove('hidden');
        else { document.getElementById('emptyState').classList.add('hidden'); filtered.forEach(t => list.innerHTML += createTransactionRowHTML(t, false)); }
    }
    function renderRecentList() {
        const list = document.getElementById('recentList'); list.innerHTML = '';
        const recent = transactions.slice(0, 5);
        if (recent.length === 0) { list.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 py-4 text-sm">No transactions yet.</div>`; return; }
        recent.forEach(t => list.innerHTML += createTransactionRowHTML(t, true));
    }

    function renderGoals() {
        const grid = document.getElementById('goalsGrid'); grid.innerHTML = '';
        if (goals.length === 0) { document.getElementById('emptyGoals').classList.remove('hidden'); return; }
        document.getElementById('emptyGoals').classList.add('hidden');
        goals.forEach(g => {
            const pct = Math.min((g.saved / g.target) * 100, 100);
            grid.innerHTML += `
                    <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 relative group">
                        <div class="flex justify-between items-start mb-4">
                            <div class="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center"><i class="fa-solid fa-bullseye"></i></div>
                            <button onclick="editGoal('${g.id}')" class="text-gray-400 hover:text-blue-500"><i class="fa-solid fa-pen"></i></button>
                        </div>
                        <h4 class="font-bold text-gray-800 dark:text-white text-lg mb-1 privacy-sensitive">${g.name}</h4>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 privacy-sensitive">Target: ${formatCurrency(g.target)}</p>
                        <div class="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2 mb-2"><div class="bg-indigo-500 h-2 rounded-full transition-all" style="width: ${pct}%"></div></div>
                        <div class="flex justify-between items-center text-sm">
                            <span class="font-bold text-indigo-600 dark:text-indigo-400 privacy-sensitive">${formatCurrency(g.saved)}</span>
                            <span class="text-gray-400">${pct.toFixed(0)}%</span>
                        </div>
                        <button onclick="deleteGoal('${g.id}')" class="absolute top-6 right-10 opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition-opacity"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
        });
    }
    const goalModal = document.getElementById('goalModal');
    function openGoalModal() { document.getElementById('goalForm').reset(); document.getElementById('goalId').value = ''; document.getElementById('goalModalTitle').textContent = 'Add Goal'; goalModal.classList.remove('hidden'); }
    function closeGoalModal() { goalModal.classList.add('hidden'); }
    function editGoal(id) {
        const g = goals.find(x => x.id === id); if (!g) return;
        document.getElementById('goalId').value = g.id;
        document.getElementById('goalName').value = g.name;
        document.getElementById('goalTarget').value = g.target;
        document.getElementById('goalSaved').value = g.saved;
        document.getElementById('goalModalTitle').textContent = 'Edit Goal';
        goalModal.classList.remove('hidden');
    }
    document.getElementById('goalForm').addEventListener('submit', async (e) => {
        e.preventDefault(); if (!currentUser) return;
        const id = document.getElementById('goalId').value;
        const data = {
            name: document.getElementById('goalName').value,
            target: parseFloat(document.getElementById('goalTarget').value),
            saved: parseFloat(document.getElementById('goalSaved').value),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            const ref = getDbRef('goals');
            if (id) await ref.doc(id).update(data); else await ref.add(data);
            closeGoalModal();
        } catch (err) { alert("Error saving goal"); }
    });
    window.deleteGoal = async (id) => {
        if (!confirm("Delete this goal?")) return;
        try { await getDbRef('goals').doc(id).delete(); } catch (e) { alert("Error"); }
    }

    function renderChart() {
        const ctx = document.getElementById('expenseChart').getContext('2d');
        const catTotals = {}; transactions.filter(t => t.type === 'expense').forEach(t => { if (!catTotals[t.category]) catTotals[t.category] = 0; catTotals[t.category] += Number(t.amount); });
        const labels = Object.keys(catTotals).map(k => categoryMap[k]?.name || 'Unknown');
        const data = Object.values(catTotals);
        const bgColors = Object.keys(catTotals).map(k => categoryMap[k]?.color || '#ccc');
        const isDark = document.documentElement.classList.contains('dark');
        if (expenseChart) expenseChart.destroy();
        expenseChart = new Chart(ctx, { type: 'doughnut', data: { labels: labels.length ? labels : ['No Data'], datasets: [{ data: data.length ? data : [1], backgroundColor: data.length ? bgColors : [isDark ? '#334155' : '#f1f5f9'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: true, cutout: '75%', plugins: { legend: { display: false } } } });
        const legendEl = document.getElementById('chartLegend'); legendEl.innerHTML = '';
        const total = data.reduce((a, b) => a + b, 0);
        Object.keys(catTotals).forEach(catId => {
            const amt = catTotals[catId], pct = total ? ((amt / total) * 100).toFixed(1) : 0;
            const cat = categoryMap[catId] || { name: 'Unknown', color: '#ccc' };
            legendEl.innerHTML += `<div class="flex justify-between items-center p-2 rounded hover:bg-gray-50 dark:hover:bg-slate-700"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full" style="background-color: ${cat.color}"></div><span class="text-gray-600 dark:text-gray-300">${cat.name}</span></div><span class="font-bold text-gray-700 dark:text-gray-200 privacy-sensitive">${pct}% <span class="text-xs font-normal text-gray-400">(${formatCurrency(amt)})</span></span></div>`;
        });
    }
    function renderTrendChart() {
        const ctx = document.getElementById('trendChart').getContext('2d');
        const isDark = document.documentElement.classList.contains('dark');
        const labels = [], dataPoints = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            labels.push(d.toLocaleDateString('en-IN', { weekday: 'short' }));
            const dateStr = d.toISOString().split('T')[0];
            dataPoints.push(transactions.filter(t => t.type === 'expense' && t.date === dateStr).reduce((a, b) => a + Number(b.amount), 0));
        }
        if (trendChart) trendChart.destroy();
        trendChart = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: [{ label: 'Spending', data: dataPoints, borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.1)', fill: true, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: isDark ? '#334155' : '#e2e8f0', borderDash: [2, 4] }, ticks: { color: isDark ? '#94a3b8' : '#64748b' } }, x: { grid: { display: false }, ticks: { color: isDark ? '#94a3b8' : '#64748b' } } } }
        });
    }

    function renderComparisonChart() {
        const ctx = document.getElementById('comparisonChart').getContext('2d');
        const isDark = document.documentElement.classList.contains('dark');
        const now = new Date();
        const currentMonth = now.getMonth();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const currentYear = now.getFullYear();
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        const currentMonthTotal = transactions
            .filter(t => t.type === 'expense' && new Date(t.date).getMonth() === currentMonth && new Date(t.date).getFullYear() === currentYear)
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const lastMonthTotal = transactions
            .filter(t => t.type === 'expense' && new Date(t.date).getMonth() === lastMonth && new Date(t.date).getFullYear() === lastMonthYear)
            .reduce((sum, t) => sum + Number(t.amount), 0);

        if (comparisonChart) comparisonChart.destroy();

        comparisonChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Last Month', 'This Month'],
                datasets: [{
                    label: 'Spending',
                    data: [lastMonthTotal, currentMonthTotal],
                    backgroundColor: ['#94a3b8', '#3b82f6'],
                    borderRadius: 6,
                    barThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: isDark ? '#334155' : '#e2e8f0', borderDash: [2, 4] },
                        ticks: { color: isDark ? '#94a3b8' : '#64748b' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: isDark ? '#94a3b8' : '#64748b' }
                    }
                }
            }
        });
    }

    function createTransactionRowHTML(t, isCompact) {
        const cat = categoryMap[t.category] || { name: 'Unknown', icon: 'fa-question', color: '#ccc' };
        const wallet = walletMap[t.walletId] || { name: '-' };
        const isInc = t.type === 'income';
        const isInv = t.type === 'investment';

        let color, bg, sign;
        if (isInc) {
            color = 'text-emerald-600';
            bg = 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400';
            sign = '+';
        } else if (isInv) {
            color = 'text-purple-600 dark:text-purple-400';
            bg = 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400';
            sign = '-';
        } else {
            color = 'text-gray-800 dark:text-white';
            bg = 'bg-rose-50 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400';
            sign = '-';
        }

        const dateDisplay = formatDate(t.date);
        const noteText = t.note || 'No note';
        const noteDisplay = noteText.replace(/(#\w+)/g, '<span class="text-blue-500 dark:text-blue-400 font-medium">$1</span>');

        if (isCompact) {
            return `<div class="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl cursor-pointer group" onclick="editTransaction('${t.id}')"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0"><i class="fa-solid ${cat.icon}"></i></div><div class="min-w-0"><p class="text-sm font-bold text-gray-800 dark:text-gray-200 truncate privacy-sensitive">${cat.name}</p><p class="text-xs text-gray-400 truncate privacy-sensitive">${noteDisplay}</p></div></div><div class="text-right flex-shrink-0"><p class="text-sm font-bold ${color} privacy-sensitive">${sign}${formatCurrency(t.amount)}</p><p class="text-xs text-gray-400">${dateDisplay}</p></div></div>`;
        } else {
            return `<tr class="hover:bg-blue-50/50 dark:hover:bg-slate-700 group border-b border-gray-50 dark:border-slate-800 last:border-0">
                    <td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full ${bg} flex items-center justify-center text-xs"><i class="fa-solid ${cat.icon}"></i></div><span class="font-medium text-gray-700 dark:text-gray-300 privacy-sensitive">${cat.name}</span></div></td>
                    <td class="px-6 py-4 text-gray-500 dark:text-gray-400 text-xs">${dateDisplay}</td>
                    <td class="px-6 py-4 text-gray-500 dark:text-gray-400 text-xs font-medium privacy-sensitive">${wallet.name}</td>
                    <td class="px-6 py-4 text-gray-600 dark:text-gray-400 max-w-xs truncate privacy-sensitive" title="${t.note}">${noteDisplay}</td>
                    <td class="px-6 py-4 text-right font-mono font-medium ${color} privacy-sensitive">${sign}${formatCurrency(t.amount)}</td>
                    <td class="px-6 py-4 text-center"><div class="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onclick="editTransaction('${t.id}')" class="p-2 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg"><i class="fa-solid fa-pen"></i></button><button onclick="deleteTransaction('${t.id}')" class="p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg"><i class="fa-solid fa-trash"></i></button></div></td>
                </tr>`;
        }
    }
    function formatCurrency(num) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num); }
    function formatDate(d) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

    function exportCSV() {
        if (!transactions.length) return alert("No data");
        let csv = "data:text/csv;charset=utf-8,Date,Type,Category,Wallet,Note,Amount\n";
        transactions.forEach(t => {
            const w = walletMap[t.walletId]?.name || '-';
            const c = categoryMap[t.category]?.name || 'Unknown';
            csv += `${t.date},${t.type},${c},${w},"${(t.note || '').replace(/"/g, '""')}",${t.amount}\n`
        });
        const link = document.createElement("a"); link.href = encodeURI(csv); link.download = "expenses.csv"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }

    function exportPDF() {
        if (!transactions.length) return alert("No data to export");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text("ExpenseFlow Report", 14, 20);
        doc.setFontSize(10);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28);

        const tableData = transactions.map(t => [
            t.date,
            t.type.toUpperCase(),
            categoryMap[t.category]?.name || 'Unknown',
            walletMap[t.walletId]?.name || '-',
            t.note || '-',
            formatCurrency(t.amount)
        ]);

        doc.autoTable({
            head: [['Date', 'Type', 'Category', 'Wallet', 'Note', 'Amount']],
            body: tableData,
            startY: 35,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [37, 99, 235] }
        });

        doc.save("expense_report.pdf");
    }

    function showPage(id) {
        document.querySelectorAll('main > div > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
        document.getElementById(`view-${id}`).classList.remove('hidden');
        document.getElementById('pageTitle').textContent = id.charAt(0).toUpperCase() + id.slice(1);
        document.querySelectorAll('.nav-item').forEach(el => { el.classList.remove('bg-blue-600', 'text-white'); el.classList.add('text-slate-400'); });
        const active = document.getElementById(`nav-${id}`); if (active) { active.classList.remove('text-slate-400'); active.classList.add('bg-blue-600', 'text-white'); }

        const goalsBtn = document.getElementById('addGoalBtn');
        const recBtn = document.getElementById('addRecBtn');
        const txnBtn = document.getElementById('addTxnBtn');
        const debtBtn = document.getElementById('addDebtBtn');
        const familyBtn = document.getElementById('addFamilyBtn');

        goalsBtn.classList.add('hidden');
        recBtn.classList.add('hidden');
        txnBtn.classList.add('hidden');
        debtBtn.classList.add('hidden');
        familyBtn.classList.add('hidden');

        if (id === 'goals') goalsBtn.classList.remove('hidden');
        else if (id === 'recurring') recBtn.classList.remove('hidden');
        else if (id === 'debts') debtBtn.classList.remove('hidden');
        else if (id === 'family') familyBtn.classList.remove('hidden');
        else if (id === 'dashboard' || id === 'transactions' || id === 'calendar') txnBtn.classList.remove('hidden');

        if (document.getElementById('sidebar').classList.contains('open')) toggleSidebar();
    }
    function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobileOverlay').classList.toggle('active'); }

    const modal = document.getElementById('transactionModal');
    const form = document.getElementById('transactionForm');
    function openModal() { form.reset(); document.getElementById('editId').value = ''; document.getElementById('date').valueAsDate = new Date(); setType('expense'); updateWalletOptions(); modal.classList.remove('hidden'); }
    function closeModal() { modal.classList.add('hidden'); }

    function setType(type) {
        document.getElementById('type').value = type;
        const bE = document.getElementById('btn-expense');
        const bI = document.getElementById('btn-income');
        const bInv = document.getElementById('btn-investment');

        const inactiveClass = "py-2 rounded-lg text-sm font-medium transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700";
        bE.className = inactiveClass;
        bI.className = inactiveClass;
        bInv.className = inactiveClass;

        if (type === 'expense') {
            bE.className = "py-2 rounded-lg text-sm font-medium shadow-sm bg-white dark:bg-slate-600 text-rose-600 dark:text-rose-400 border border-gray-100 dark:border-slate-500";
        } else if (type === 'income') {
            bI.className = "py-2 rounded-lg text-sm font-medium shadow-sm bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400 border border-gray-100 dark:border-slate-500";
        } else if (type === 'investment') {
            bInv.className = "py-2 rounded-lg text-sm font-medium shadow-sm bg-white dark:bg-slate-600 text-purple-600 dark:text-purple-400 border border-gray-100 dark:border-slate-500";
        }
        updateCategoryOptions();
    }
    function editTransaction(id) {
        const t = transactions.find(x => x.id === id); if (!t) return;
        document.getElementById('editId').value = t.id; setType(t.type);
        document.getElementById('amount').value = t.amount; document.getElementById('date').value = t.date; document.getElementById('note').value = t.note || '';
        updateWalletOptions(); setTimeout(() => { document.getElementById('txnWallet').value = t.walletId || 'cash'; }, 50);
        setTimeout(() => document.getElementById('category').value = t.category, 0);
        document.getElementById('modalTitle').textContent = 'Edit Transaction'; modal.classList.remove('hidden');
    }
    form.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!currentUser) return;
        const editId = document.getElementById('editId').value;
        const data = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            date: document.getElementById('date').value,
            note: document.getElementById('note').value,
            walletId: document.getElementById('txnWallet').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
        try {
            const ref = getDbRef('expenses');
            if (editId) await ref.doc(editId).update(data); else { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); await ref.add(data); }
            closeModal();
        } catch (e) { console.error(e); alert("Error saving"); } finally { btn.disabled = false; }
    });
    window.deleteTransaction = async (id) => { if (!confirm("Delete?")) return; try { await getDbRef('expenses').doc(id).delete(); } catch (e) { alert("Failed"); } };

    function addListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
        else console.warn('Element not found:', id);
    }

    addListener('searchInput', 'input', renderFullList);
    addListener('filterType', 'change', renderFullList);
    addListener('filterDate', 'change', renderFullList);
    addListener('filterWallet', 'change', renderFullList);
    addListener('filterTag', 'change', renderFullList);
    addListener('startDate', 'change', renderFullList);
    addListener('endDate', 'change', renderFullList);

    initApp();
}