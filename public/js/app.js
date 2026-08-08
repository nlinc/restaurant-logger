// Lincoln Eats — App Logic
import {
    db, auth, functions, googleProvider,
    collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp,
    query, where, orderBy, limit, onSnapshot, getDocs,
    signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
    httpsCallable, mapsApiKey
} from './firebase-config.js?v=26';

// Dynamically load Google Maps script with obfuscated API key
const mapsScript = document.createElement('script');
mapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&callback=initAutocomplete`;
mapsScript.async = true;
mapsScript.defer = true;
document.head.appendChild(mapsScript);
const isLocalUiPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get('ui-preview') === '1';

// ===== DOM Refs =====
const authScreen = document.getElementById('auth-screen');
const appContainer = document.getElementById('app-container');
const googleSignInBtn = document.getElementById('google-sign-in');
const userAvatar = document.getElementById('user-avatar');
const userAvatarImage = document.getElementById('user-avatar-image');
const userAvatarFallback = document.getElementById('user-avatar-fallback');
const signOutDropdown = document.getElementById('sign-out-dropdown');
const signOutBtn = document.getElementById('sign-out-btn');

const searchInput = document.getElementById('restaurant-search');
const tagsInput = document.getElementById('tags-input');
const tagsContainer = document.getElementById('tags-container');
const notesInput = document.getElementById('visit-notes');
const saveBtn = document.getElementById('save-btn');

const historySection = document.getElementById('history-section');
const wishlistSection = document.getElementById('wishlist-section');
const profileDashboard = document.getElementById('profile-dashboard');
const wishlistBtn = document.getElementById('wishlist-btn');
const emptyState = document.getElementById('empty-state');
const decisionEyebrow = document.getElementById('decision-eyebrow');
const nextPickCopy = document.getElementById('next-pick-copy');
const getRecommendationBtn = document.getElementById('get-recommendation-btn');
const openQuickLogBtn = document.getElementById('open-quick-log-btn');
const openConciergeBtn = document.getElementById('open-concierge-btn');
const homeRecommendations = document.getElementById('home-recommendations');
const recommendationHistory = document.getElementById('recommendation-history');
const mealOptions = document.getElementById('meal-options');
const occasionOptions = document.getElementById('occasion-options');
const decisionLocationStatus = document.getElementById('decision-location-status');
const changeLocationBtn = document.getElementById('change-location-btn');
const togglePreferencesBtn = document.getElementById('toggle-preferences-btn');
const preferencePanel = document.getElementById('preference-panel');
const savePreferencesBtn = document.getElementById('save-preferences-btn');
const locationOverrideSearch = document.getElementById('location-override-search');
const useCurrentLocationBtn = document.getElementById('use-current-location-btn');
const locationPreferenceHelp = document.getElementById('location-preference-help');
const pendingCheckin = document.getElementById('pending-checkin');
const quickLogPanel = document.getElementById('quick-log-panel');

const navItems = document.querySelectorAll('.nav-item');
const appViews = document.querySelectorAll('.app-view');

const aiFab = document.getElementById('ai-fab');
const aiOverlay = document.getElementById('ai-overlay');
const aiModal = document.getElementById('ai-modal');
const aiLoading = document.getElementById('ai-loading');
const aiChatWelcome = document.getElementById('ai-chat-welcome');
const aiChatHistory = document.getElementById('ai-chat-history');
const aiChatForm = document.getElementById('ai-chat-form');
const aiChatInput = document.getElementById('ai-chat-input');
const aiMoodChips = document.getElementById('ai-mood-chips');
const closeAiModalBtn = document.getElementById('close-ai-modal');
const scanReceiptBtn = document.getElementById('scan-receipt-btn');
const receiptFileInput = document.getElementById('receipt-file-input');

const toast = document.getElementById('toast');
const appUpdateBanner = document.getElementById('app-update-banner');
const refreshAppBtn = document.getElementById('refresh-app-btn');

// ===== State =====
let currentUser = null;
let selectedPlace = null;
let tags = [];
let autocomplete = null;
let locationAutocomplete = null;
let map = null;
let markers = [];
let allPlaces = [];
let currentView = 'feed';
let historyUnsubscribe = null;
let currentFeedFilter = 'all';
let tasteRadarChart = null;
let aiChatHistoryData = [];
let currentCircle = null;
let circleUnsubscribe = null;
let circlePlaces = [];
let circlePlacesUnsubscribe = null;
let showCircleMap = false;
let scannedReceiptData = null;
let selectedMealPeriod = getDefaultMealPeriod();
let selectedVibe = 'anything';
let tastePreferences = getDefaultTastePreferences();
let manualLocationOverride = null;
let lastResolvedLocation = null;
let pendingChoiceSavePromise = null;
const recommendationCache = new Map();
const MAX_PRECISE_LOCATION_METERS = 805;

// ===== Auth =====
googleSignInBtn.addEventListener('click', async () => {
    const originalHtml = googleSignInBtn.innerHTML;
    googleSignInBtn.disabled = true;
    googleSignInBtn.textContent = 'Signing in...';

    try {
        if (shouldStartWithRedirectSignIn()) {
            showToast('Opening Google sign-in...', 'info');
            await signInWithRedirect(auth, googleProvider);
            return;
        }

        await signInWithPopup(auth, googleProvider);
    } catch (e) {
        console.error('Sign-in error:', e);
        if (shouldUseRedirectSignIn(e)) {
            showToast('Opening Google sign-in...', 'info');
            await signInWithRedirect(auth, googleProvider);
            return;
        }

        showToast(getAuthErrorMessage(e), 'error');
    } finally {
        googleSignInBtn.disabled = false;
        googleSignInBtn.innerHTML = originalHtml;
    }
});

getRedirectResult(auth).catch((e) => {
    console.error('Redirect sign-in error:', e);
    showToast(getAuthErrorMessage(e), 'error');
});

function shouldUseRedirectSignIn(error) {
    return [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment'
    ].includes(error?.code);
}

function shouldStartWithRedirectSignIn() {
    const isNarrowScreen = window.matchMedia('(max-width: 820px)').matches;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    return isNarrowScreen || isStandalone;
}

function getAuthErrorMessage(error) {
    if (error?.code === 'auth/unauthorized-domain') {
        return 'This domain is not authorized for Firebase Google sign-in.';
    }
    if (error?.code === 'auth/network-request-failed') {
        return 'Network error during Google sign-in. Please try again.';
    }
    if (error?.code === 'auth/popup-closed-by-user') {
        return 'Google sign-in was closed before it finished.';
    }
    return 'Google sign-in failed. Please try again.';
}

userAvatar.addEventListener('click', (e) => {
    e.stopPropagation();
    signOutDropdown.classList.toggle('active');
});

document.addEventListener('click', () => {
    signOutDropdown.classList.remove('active');
});

signOutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
    } catch (e) {
        console.error('Sign-out error:', e);
    }
});

onAuthStateChanged(auth, (user) => {
    if (isLocalUiPreview) return;
    if (currentUser?.uid !== user?.uid) resetUserScopedClientState();
    currentUser = user;
    if (user) {
        authScreen.style.display = 'none';
        appContainer.classList.add('active');
        aiFab.style.display = 'none';
        renderUserAvatar(user);
        loadTastePreferences();
        renderPreferenceControls();
        loadLocationPreference();
        renderLocationStatus();
        renderPendingCheckin();
        listenToHistory();
        listenToCircle();
    } else {
        authScreen.style.display = '';
        appContainer.classList.remove('active');
        aiFab.style.display = 'none';
        currentCircle = null;
        if (historyUnsubscribe) {
            historyUnsubscribe();
            historyUnsubscribe = null;
        }
        if (circleUnsubscribe) {
            circleUnsubscribe();
            circleUnsubscribe = null;
        }
        if (circlePlacesUnsubscribe) {
            circlePlacesUnsubscribe();
            circlePlacesUnsubscribe = null;
        }
    }
});

if (isLocalUiPreview) {
    currentUser = {
        uid: 'local-preview-user',
        displayName: 'Local Preview',
        photoURL: ''
    };
    authScreen.style.display = 'none';
    appContainer.classList.add('active');
    renderUserAvatar(currentUser);
    loadTastePreferences();
    renderPreferenceControls();
    loadLocationPreference();
    renderLocationStatus();
    renderPendingCheckin();
    updateViews();
    scanReceiptBtn.disabled = true;
    scanReceiptBtn.title = 'Receipt scanning is disabled in local UI preview.';
}

function renderUserAvatar(user) {
    const displayName = user?.displayName?.trim() || 'User';
    const initials = displayName
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('') || '?';

    userAvatar.setAttribute('aria-label', `Open account menu for ${displayName}`);
    userAvatar.title = displayName;
    userAvatarFallback.textContent = initials;

    if (user?.photoURL) {
        userAvatarImage.src = user.photoURL;
        userAvatarImage.hidden = false;
        userAvatarFallback.hidden = true;
    } else {
        userAvatarImage.removeAttribute('src');
        userAvatarImage.hidden = true;
        userAvatarFallback.hidden = false;
    }
}

userAvatarImage.addEventListener('error', () => {
    userAvatarImage.removeAttribute('src');
    userAvatarImage.hidden = true;
    userAvatarFallback.hidden = false;
});

function setupHorizontalScrollAffordance(container) {
    if (!container) return;
    container.classList.add('horizontal-scroll-affordance');

    const update = () => {
        const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        container.classList.toggle('can-scroll-left', container.scrollLeft > 2);
        container.classList.toggle('can-scroll-right', container.scrollLeft < maxScrollLeft - 2);
    };

    container.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(container);
    requestAnimationFrame(update);
}

function getDefaultMealPeriod(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 5 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 16) return 'lunch';
    return 'dinner';
}

function getMealLabel(meal = selectedMealPeriod) {
    return meal.charAt(0).toUpperCase() + meal.slice(1);
}

function renderDecisionControls() {
    mealOptions.querySelectorAll('[data-meal]').forEach(option => {
        const isSelected = option.dataset.meal === selectedMealPeriod;
        option.classList.toggle('active', isSelected);
        option.setAttribute('aria-pressed', String(isSelected));
    });
    occasionOptions.querySelectorAll('[data-vibe]').forEach(option => {
        const isSelected = option.dataset.vibe === selectedVibe;
        option.classList.toggle('active', isSelected);
        option.setAttribute('aria-pressed', String(isSelected));
    });

    const mealLabel = getMealLabel();
    decisionEyebrow.textContent = `${mealLabel}, decided`;
    getRecommendationBtn.textContent = `Find ${selectedMealPeriod} picks`;
    renderRecommendationPrompt(
        allPlaces.filter(place => !place.status || place.status === 'visited'),
        allPlaces.filter(place => place.status === 'wishlist')
    );
}

setupHorizontalScrollAffordance(occasionOptions);
setupHorizontalScrollAffordance(aiMoodChips);
renderDecisionControls();

// ===== Navigation =====
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const viewId = item.dataset.view;
        switchView(viewId);
    });
});

document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.dataset.filter;
        renderWishlist(allPlaces.filter(p => p.status === 'wishlist'), filter);
    });
});

// Bind Feed Filter Chips
document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-feed-filter]');
    if (!chip) return;

    const filterContainer = document.getElementById('feed-filters');
    if (filterContainer) {
        filterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    }
    chip.classList.add('active');
    currentFeedFilter = chip.dataset.feedFilter;
    renderHistoryFeed();
});

function switchView(viewId) {
    currentView = viewId;

    // Update Nav UI
    navItems.forEach(nav => {
        nav.classList.toggle('active', nav.dataset.view === viewId);
    });

    // Update View UI
    appViews.forEach(view => {
        view.classList.toggle('active', view.id === `view-${viewId}`);
    });

    // Special logic for Map view
    if (viewId === 'map' && !map) {
        initMap();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Google Places Autocomplete =====
async function setupAutocomplete() {
    // Wait for Google Maps API to load (bridged via _mapsReady promise in index.html)
    await window._mapsReady;

    autocomplete = new google.maps.places.Autocomplete(searchInput, {
        types: ['restaurant', 'cafe', 'bar', 'food'],
        fields: ['place_id', 'geometry', 'name', 'rating', 'types', 'formatted_address', 'price_level']
    });

    autocomplete.addListener('place_changed', onPlaceChanged);

    locationAutocomplete = new google.maps.places.Autocomplete(locationOverrideSearch, {
        types: ['geocode'],
        fields: ['geometry', 'name', 'formatted_address', 'address_components']
    });
    locationAutocomplete.addListener('place_changed', onLocationOverrideChanged);

    if (manualLocationOverride) setRestaurantAutocompleteBias(manualLocationOverride);
    console.log('Places Autocomplete initialized.');
}

setupAutocomplete();

searchInput.addEventListener('focus', async () => {
    if (selectedPlace || manualLocationOverride || lastResolvedLocation) return;
    try {
        const location = await resolveDiningLocation({ requirePrecise: true });
        updateResolvedLocation(location);
    } catch (error) {
        renderLocationError(error);
    }
});

function onLocationOverrideChanged() {
    const place = locationAutocomplete.getPlace();
    const lat = place.geometry?.location?.lat();
    const lng = place.geometry?.location?.lng();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        showToast('Choose a location from the suggestion list.', 'info');
        return;
    }

    manualLocationOverride = {
        lat,
        lng,
        label: getPlaceLocationLabel(place),
        source: 'manual',
        accuracy: null
    };
    saveLocationPreference();
    updateResolvedLocation(manualLocationOverride);
    locationOverrideSearch.value = manualLocationOverride.label;
    showToast(`Searching near ${manualLocationOverride.label}.`, 'success');
}


function onPlaceChanged() {
    const place = autocomplete.getPlace();

    if (!place.geometry) {
        selectedPlace = null;
        updateSaveBtn();
        return;
    }

    selectedPlace = {
        place_id: place.place_id,
        name: place.name,
        google_rating: place.rating || null,
        types: place.types || [],
        address: place.formatted_address || '',
        price_level: place.price_level ?? null,
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
    };

    updateSaveBtn();
}

// ===== Category Rating =====
function getSelectedRating() {
    const checked = document.querySelector('.category-rating input:checked');
    return checked ? parseInt(checked.value) : 0;
}

const categoryRating = document.getElementById('category-rating');
categoryRating.addEventListener('change', updateSaveBtn);

// ===== Tags =====
tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagsInput.value.replace(',', '').trim().toLowerCase();
        if (val && !tags.includes(val)) {
            tags.push(val);
            renderTags();
        }
        tagsInput.value = '';
    }
});

function renderTags() {
    tagsContainer.innerHTML = tags.map((tag, i) => `
        <span class="tag-chip">
            ${escapeHtml(tag)}
            <button data-index="${i}" aria-label="Remove tag">&times;</button>
        </span>
    `).join('');

    tagsContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            tags.splice(parseInt(btn.dataset.index), 1);
            renderTags();
        });
    });
}

// ===== Save Buttons =====
function updateSaveBtn() {
    const hasPlace = !!selectedPlace;
    saveBtn.disabled = !hasPlace || !getSelectedRating();
    wishlistBtn.disabled = !hasPlace;
}

saveBtn.addEventListener('click', () => handleSave('visited'));
wishlistBtn.addEventListener('click', () => handleSave('wishlist'));
getRecommendationBtn.addEventListener('click', handleHomeRecommendations);
openQuickLogBtn.addEventListener('click', () => {
    quickLogPanel.open = true;
    requestAnimationFrame(() => quickLogPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});
openConciergeBtn.addEventListener('click', openAiModal);

mealOptions.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-meal]');
    if (!chip) return;

    selectedMealPeriod = chip.dataset.meal;
    renderDecisionControls();
});

occasionOptions.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-vibe]');
    if (!chip) return;

    selectedVibe = chip.dataset.vibe;
    renderDecisionControls();
});

changeLocationBtn.addEventListener('click', () => {
    preferencePanel.hidden = false;
    togglePreferencesBtn.setAttribute('aria-expanded', 'true');
    togglePreferencesBtn.textContent = 'Hide taste settings';
    requestAnimationFrame(() => locationOverrideSearch.focus());
});

useCurrentLocationBtn.addEventListener('click', async () => {
    const originalText = useCurrentLocationBtn.textContent;
    useCurrentLocationBtn.disabled = true;
    useCurrentLocationBtn.textContent = 'Locating…';
    locationPreferenceHelp.textContent = 'Requesting a fresh, precise device location…';

    try {
        const location = await resolveDeviceLocation({ requirePrecise: true });
        manualLocationOverride = null;
        saveLocationPreference();
        locationOverrideSearch.value = '';
        updateResolvedLocation(location);
        showToast('Using your current precise location.', 'success');
    } catch (error) {
        renderLocationError(error);
        showToast(getLocationErrorMessage(error), 'error');
    } finally {
        useCurrentLocationBtn.disabled = false;
        useCurrentLocationBtn.textContent = originalText;
    }
});

togglePreferencesBtn.addEventListener('click', () => {
    const willOpen = preferencePanel.hidden;
    preferencePanel.hidden = !willOpen;
    togglePreferencesBtn.setAttribute('aria-expanded', String(willOpen));
    togglePreferencesBtn.textContent = willOpen ? 'Hide taste settings' : 'Tune my picks';
});

preferencePanel.addEventListener('click', (e) => {
    const option = e.target.closest('[data-preference-value]');
    if (!option) return;

    const group = option.closest('[data-preference-group]')?.dataset.preferenceGroup;
    const value = option.dataset.preferenceValue;
    if (group === 'cuisines') {
        const next = new Set(tastePreferences.cuisines);
        if (next.has(value)) next.delete(value);
        else if (next.size < 5) next.add(value);
        else return showToast('Choose up to five cuisines.', 'info');
        tastePreferences.cuisines = [...next];
    } else if (group === 'priceLevel') {
        tastePreferences.priceLevel = Number(value);
    } else if (group === 'maxDistanceMiles') {
        tastePreferences.maxDistanceMiles = Number(value);
        const activeLocation = manualLocationOverride || lastResolvedLocation;
        if (activeLocation) setRestaurantAutocompleteBias(activeLocation);
    }
    renderPreferenceControls();
});

savePreferencesBtn.addEventListener('click', () => {
    saveTastePreferences();
    preferencePanel.hidden = true;
    togglePreferencesBtn.setAttribute('aria-expanded', 'false');
    togglePreferencesBtn.textContent = 'Tune my picks';
    getRecommendationBtn.focus();
    showToast('Taste settings saved on this device.', 'success');
});

function getPreferenceStorageKey(version = 2) {
    return currentUser ? `lincolnEats:taste:v${version}:${currentUser.uid}` : null;
}

function loadTastePreferences() {
    tastePreferences = getDefaultTastePreferences();
    const key = getPreferenceStorageKey();
    if (!key) return;
    try {
        const current = JSON.parse(localStorage.getItem(key) || 'null');
        const legacy = JSON.parse(localStorage.getItem(getPreferenceStorageKey(1)) || 'null');
        const stored = current?.version === 2 ? current : legacy?.version === 1 ? legacy : null;
        if (!stored) return;
        const legacyDistanceKm = Number(stored.maxDistanceKm);
        const migratedDistanceMiles = Number.isFinite(legacyDistanceKm)
            ? legacyDistanceKm <= 3 ? 2 : legacyDistanceKm <= 8 ? 5 : 10
            : 5;
        tastePreferences = {
            cuisines: Array.isArray(stored.cuisines) ? stored.cuisines.slice(0, 5) : [],
            priceLevel: [1, 2, 3].includes(Number(stored.priceLevel)) ? Number(stored.priceLevel) : 2,
            maxDistanceMiles: [2, 5, 10].includes(Number(stored.maxDistanceMiles))
                ? Number(stored.maxDistanceMiles)
                : migratedDistanceMiles
        };
        if (!current) saveTastePreferences();
    } catch (e) {
        console.warn('Could not load taste settings:', e);
    }
}

function getDefaultTastePreferences() {
    return {
        cuisines: [],
        priceLevel: 2,
        maxDistanceMiles: 5
    };
}

function resetUserScopedClientState() {
    selectedPlace = null;
    scannedReceiptData = null;
    tags = [];
    allPlaces = [];
    circlePlaces = [];
    aiChatHistoryData = [];
    pendingChoiceSavePromise = null;
    selectedMealPeriod = getDefaultMealPeriod();
    selectedVibe = 'anything';
    tastePreferences = getDefaultTastePreferences();
    manualLocationOverride = null;
    lastResolvedLocation = null;
    recommendationCache.clear();
    homeRecommendations.innerHTML = '';
    recommendationHistory.innerHTML = '';
    pendingCheckin.hidden = true;
    pendingCheckin.innerHTML = '';
    searchInput.value = '';
    notesInput.value = '';
    document.querySelectorAll('.category-rating input').forEach(input => { input.checked = false; });
    renderTags();
    renderDecisionControls();
    renderLocationStatus();
    updateSaveBtn();
}

function saveTastePreferences() {
    const key = getPreferenceStorageKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({ version: 2, ...tastePreferences }));
    } catch (e) {
        console.warn('Could not save taste settings:', e);
    }
}

function renderPreferenceControls() {
    preferencePanel.querySelectorAll('[data-preference-value]').forEach(option => {
        const group = option.closest('[data-preference-group]')?.dataset.preferenceGroup;
        const value = option.dataset.preferenceValue;
        const active = group === 'cuisines'
            ? tastePreferences.cuisines.includes(value)
            : Number(tastePreferences[group]) === Number(value);
        option.classList.toggle('active', active);
        option.setAttribute('aria-pressed', String(active));
    });
}

function getLocationStorageKey() {
    return currentUser ? `lincolnEats:location:v1:${currentUser.uid}` : null;
}

function loadLocationPreference() {
    manualLocationOverride = null;
    const key = getLocationStorageKey();
    if (!key) return;

    try {
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        if (stored?.version !== 1 || !Number.isFinite(stored.lat) || !Number.isFinite(stored.lng)) return;
        manualLocationOverride = {
            lat: stored.lat,
            lng: stored.lng,
            label: String(stored.label || 'Saved location').slice(0, 160),
            source: 'manual',
            accuracy: null
        };
        locationOverrideSearch.value = manualLocationOverride.label;
        if (autocomplete) setRestaurantAutocompleteBias(manualLocationOverride);
    } catch (error) {
        console.warn('Could not load saved location:', error);
    }
}

function saveLocationPreference() {
    const key = getLocationStorageKey();
    if (!key) return;

    try {
        if (!manualLocationOverride) {
            localStorage.removeItem(key);
            return;
        }
        localStorage.setItem(key, JSON.stringify({
            version: 1,
            lat: manualLocationOverride.lat,
            lng: manualLocationOverride.lng,
            label: manualLocationOverride.label
        }));
    } catch (error) {
        console.warn('Could not save location preference:', error);
    }
}

function renderLocationStatus(location = manualLocationOverride || lastResolvedLocation) {
    if (!decisionLocationStatus || !locationPreferenceHelp) return;

    if (!location) {
        decisionLocationStatus.textContent = '📍 Location checked when you find picks';
        locationPreferenceHelp.textContent = 'Use precise device location, or choose a place manually when it looks wrong.';
        return;
    }

    if (location.source === 'manual') {
        decisionLocationStatus.textContent = `📍 Searching near ${location.label}`;
        locationPreferenceHelp.textContent = `Manual location saved on this device: ${location.label}`;
        return;
    }

    const accuracy = formatLocationAccuracy(location.accuracy);
    const label = location.label || 'current location';
    decisionLocationStatus.textContent = `📍 Current: ${label}${accuracy ? ` · ${accuracy}` : ''}`;
    locationPreferenceHelp.textContent = `Using fresh device location${accuracy ? ` (${accuracy})` : ''}.`;
}

function renderLocationError(error) {
    const message = getLocationErrorMessage(error);
    decisionLocationStatus.textContent = `⚠️ ${message}`;
    locationPreferenceHelp.textContent = `${message} Choose a city, neighborhood, or address above instead.`;
}

function getLocationErrorMessage(error) {
    if (error?.code === 'location-imprecise') {
        const accuracy = formatLocationAccuracy(error.accuracy);
        return `Device location is too broad${accuracy ? ` (${accuracy})` : ''}.`;
    }
    if (error?.code === 1) return 'Location permission is off.';
    if (error?.code === 3) return 'Precise location timed out.';
    return 'Could not determine your current location.';
}

function formatLocationAccuracy(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '';
    if (meters < 1609.344) {
        const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
        return `accurate to about ${feet.toLocaleString()} ft`;
    }
    return `accurate to about ${(meters / 1609.344).toFixed(1)} mi`;
}

function getPlaceLocationLabel(place) {
    return String(place.formatted_address || place.name || 'Selected location').slice(0, 160);
}

function setRestaurantAutocompleteBias(location) {
    if (!autocomplete || !window.google?.maps || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return;
    const radiusMeters = milesToKm(tastePreferences.maxDistanceMiles || 5) * 1000;
    const bounds = new google.maps.Circle({
        center: { lat: location.lat, lng: location.lng },
        radius: radiusMeters
    }).getBounds();
    autocomplete.setBounds(bounds);
    autocomplete.setOptions({ strictBounds: false });
}

async function resolveDiningLocation({ requirePrecise = true } = {}) {
    if (manualLocationOverride) return manualLocationOverride;
    return resolveDeviceLocation({ requirePrecise });
}

async function resolveDeviceLocation({ requirePrecise = false } = {}) {
    const position = await getUserLocation();
    const lat = position?.coords?.latitude;
    const lng = position?.coords?.longitude;
    const accuracy = position?.coords?.accuracy;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid device location');

    if (requirePrecise && (!Number.isFinite(accuracy) || accuracy > MAX_PRECISE_LOCATION_METERS)) {
        const error = new Error('Device location is too imprecise');
        error.code = 'location-imprecise';
        error.accuracy = accuracy;
        throw error;
    }

    return { lat, lng, accuracy, label: '', source: 'device' };
}

function updateResolvedLocation(location) {
    lastResolvedLocation = location;
    setRestaurantAutocompleteBias(location);
    renderLocationStatus(location);

    if (location.source === 'device' && !location.label) {
        reverseGeocodeLocation(location).then(label => {
            if (!label || lastResolvedLocation !== location) return;
            location.label = label;
            renderLocationStatus(location);
        });
    }
}

function reverseGeocodeLocation(location) {
    if (!window.google?.maps?.Geocoder) return Promise.resolve('');
    const geocoder = new google.maps.Geocoder();
    return new Promise(resolve => {
        geocoder.geocode({ location: { lat: location.lat, lng: location.lng } }, (results, status) => {
            if (status !== 'OK' || !results?.length) return resolve('');
            const components = results[0].address_components || [];
            const findComponent = type => components.find(component => component.types.includes(type));
            const neighborhood = findComponent('neighborhood')?.long_name || findComponent('sublocality')?.long_name;
            const city = findComponent('locality')?.long_name;
            const region = findComponent('administrative_area_level_1')?.short_name;
            resolve([neighborhood, city, region].filter((value, index, values) => value && values.indexOf(value) === index).join(', '));
        });
    });
}

document.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-rec-action]');
    if (!actionBtn) return;

    const key = decodeURIComponent(actionBtn.dataset.recKey || '');
    const rec = recommendationCache.get(key);
    if (!rec) return;

    await handleRecommendationAction(rec, actionBtn.dataset.recAction, actionBtn);
});

// ===== Receipt AI Scanner Event Handlers =====
scanReceiptBtn.addEventListener('click', () => {
    receiptFileInput.click();
});

receiptFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset file input so it can trigger change again on same file
    receiptFileInput.value = '';

    const originalText = scanReceiptBtn.textContent;
    scanReceiptBtn.disabled = true;
    scanReceiptBtn.textContent = '⏳ Scanning with AI...';
    showToast('Preparing receipt for scanning...', 'info');

    try {
        const { base64: rawBase64, mimeType } = await prepareReceiptFile(file);

        // Call our scanReceipt Cloud Function
        const scanReceiptFn = httpsCallable(functions, 'scanReceipt');
        const result = await scanReceiptFn({ base64: rawBase64, mimeType });
        const data = result.data;

        if (data.error) {
            throw new Error(data.error);
        }

        scannedReceiptData = normalizeReceiptData(data);

        // Auto-fill fields from scanned output. If a restaurant is already selected,
        // keep that place and only add meal details to the current log.
        if (data.restaurantName && !selectedPlace) {
            searchInput.value = data.restaurantName;
            selectedPlace = {
                place_id: "scanned_" + Date.now(),
                name: data.restaurantName,
                google_rating: null,
                types: data.suggestedCuisines || [],
                address: data.address || '',
                price_level: data.priceLevel || null,
                lat: null,
                lng: null
            };
            updateSaveBtn();
        }

        // Auto-fill Rating
        if (data.rating) {
            const ratingRadio = document.querySelector(`.category-rating input[value="${data.rating}"]`);
            if (ratingRadio) ratingRadio.checked = true;
        }

        // Auto-fill tags
        if (data.tags && data.tags.length > 0) {
            tags = [...new Set([...tags, ...data.tags.map(t => t.toLowerCase())])];
            renderTags();
        }

        // Auto-fill notes
        applyReceiptDetailsToForm(scannedReceiptData);
        updateSaveBtn();

        showToast('Receipt details added to this log.', 'success');

    } catch (err) {
        console.error("Receipt Scanner Error:", err);
        const message = err instanceof Error && err.message
            ? err.message
            : 'Receipt scanning failed. Please try again.';
        showToast(message, 'error');
    } finally {
        scanReceiptBtn.disabled = false;
        scanReceiptBtn.textContent = originalText;
    }
});

function normalizeReceiptData(data) {
    const orderItems = Array.isArray(data.orderItems) ? data.orderItems.filter(Boolean) : [];
    return {
        restaurant_name: data.restaurantName || '',
        order_items: orderItems,
        total_amount: data.totalAmount ?? null,
        notes: data.notes || '',
        tags: Array.isArray(data.tags) ? data.tags : []
    };
}

function applyReceiptDetailsToForm(receipt) {
    if (!receipt) return;
    if (receipt.notes) {
        notesInput.value = [notesInput.value.trim(), receipt.notes].filter(Boolean).join('\n');
    }
}

async function prepareReceiptImage(file) {
    let image;
    let objectUrl;

    try {
        if ('createImageBitmap' in window) {
            try {
                image = await createImageBitmap(file);
            } catch (error) {
                console.warn('createImageBitmap could not decode the receipt; trying the browser image decoder.', error);
            }
        }
        if (!image) {
            objectUrl = URL.createObjectURL(file);
            image = await loadReceiptImage(objectUrl);
        }

        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) {
            throw new Error('That image could not be read. Try a JPG, PNG, or WebP photo.');
        }

        const maxDimension = 1800;
        const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('This browser could not prepare the receipt photo.');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1];
        if (!base64) {
            throw new Error('This browser could not prepare the receipt photo.');
        }

        return { base64, mimeType: 'image/jpeg' };
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('That image')) throw error;
        if (error instanceof Error && error.message.startsWith('This browser')) throw error;
        throw new Error('That image could not be read. Try a JPG, PNG, or WebP photo.');
    } finally {
        if (typeof image?.close === 'function') image.close();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}

async function prepareReceiptFile(file) {
    const fileName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
    const isImage = file.type.startsWith('image/')
        || /\.(jpe?g|png|webp|heic|heif)$/.test(fileName);

    if (isPdf) {
        const maxPdfBytes = 8 * 1024 * 1024;
        if (file.size > maxPdfBytes) {
            throw new Error('That PDF is too large. Choose one under 8 MB.');
        }
        return {
            base64: await readFileAsBase64(file),
            mimeType: 'application/pdf'
        };
    }

    if (isImage) return prepareReceiptImage(file);
    throw new Error('Choose a receipt photo or PDF.');
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
            if (base64) resolve(base64);
            else reject(new Error('That PDF could not be read.'));
        };
        reader.onerror = () => reject(new Error('That PDF could not be read.'));
        reader.readAsDataURL(file);
    });
}

function loadReceiptImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image decode failed.'));
        image.src = src;
    });
}

async function handleSave(status) {
    if (!selectedPlace || !currentUser) return false;
    if (isLocalUiPreview) {
        showToast('Preview only—no Firebase data was written.', 'info');
        return false;
    }

    const btn = status === 'visited' ? saveBtn : wishlistBtn;
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'Saving...';

    const { id, ...placeData } = selectedPlace;
    const payload = {
        ...placeData,
        user_rating: status === 'visited' ? getSelectedRating() : null,
        tags: [...tags],
        notes: notesInput.value.trim(),
        order_items: status === 'visited' ? [...(scannedReceiptData?.order_items || [])] : [],
        total_amount: status === 'visited' ? (scannedReceiptData?.total_amount || null) : null,
        receipt: status === 'visited' && scannedReceiptData ? scannedReceiptData : null,
        status: status,
        visited_at: serverTimestamp(),
        uid: currentUser.uid,
        circle_id: currentCircle ? currentCircle.id : null
    };

    try {
        const existing = selectedPlace.id ? selectedPlace : findExistingPlace(payload);
        let savedPlaceId = existing?.id || null;
        if (existing) {
            if (status === 'visited' && ['wishlist', 'recommended', 'dismissed'].includes(existing.status)) {
                await updateDoc(doc(db, "saved_places", existing.id), payload);
                showToast(existing.status === 'wishlist' ? 'Wishlist item converted to visit.' : 'Recommendation converted to visit.', 'success');
            } else if (status === 'visited') {
                const docRef = await addDoc(collection(db, "saved_places"), payload);
                savedPlaceId = docRef.id;
                showToast('Visit saved!', 'success');
            } else if (status === 'wishlist' && (!existing.status || existing.status === 'visited')) {
                showToast('You already logged this place.', 'info');
                btn.disabled = false;
                btn.textContent = originalText;
                return false;
            } else if (status === 'wishlist' && existing.status === 'wishlist') {
                showToast('That place is already on your wishlist.', 'info');
                btn.disabled = false;
                btn.textContent = originalText;
                return false;
            } else if (status === 'wishlist' && ['recommended', 'dismissed'].includes(existing.status)) {
                await updateDoc(doc(db, "saved_places", existing.id), payload);
                showToast('Added to Wishlist!', 'success');
            } else if (existing.status === 'dismissed') {
                await deleteDoc(doc(db, "saved_places", existing.id));
                const docRef = await addDoc(collection(db, "saved_places"), payload);
                savedPlaceId = docRef.id;
                showToast(status === 'visited' ? 'Visit saved!' : 'Added to Wishlist!', 'success');
            } else {
                showToast('That place is already saved.', 'info');
                btn.disabled = false;
                btn.textContent = originalText;
                return false;
            }
        } else {
            const docRef = await addDoc(collection(db, "saved_places"), payload);
            savedPlaceId = docRef.id;
            showToast(status === 'visited' ? 'Visit saved!' : 'Added to Wishlist!', 'success');
        }

        applySavedPlaceLocally(savedPlaceId, payload);

        // Reset form
        searchInput.value = '';
        notesInput.value = '';
        selectedPlace = null;
        scannedReceiptData = null;
        tags = [];
        renderTags();
        const checked = document.querySelector('.category-rating input:checked');
        if (checked) checked.checked = false;

        btn.textContent = originalText;
        updateSaveBtn();
        return true;

    } catch (e) {
        console.error("Error saving:", e);
        btn.disabled = false;
        btn.textContent = originalText;
        showToast('Failed to save. Please try again.', 'error');
        return false;
    }
}

function applySavedPlaceLocally(id, payload) {
    if (!id) return;

    const existingIndex = allPlaces.findIndex(place => place.id === id);
    const savedPlace = {
        ...(existingIndex >= 0 ? allPlaces[existingIndex] : {}),
        id,
        ...payload,
        _localSavedAt: Date.now()
    };

    if (existingIndex >= 0) allPlaces.splice(existingIndex, 1, savedPlace);
    else allPlaces.unshift(savedPlace);

    updateViews();
}

// ===== Visit History =====
function listenToHistory() {
    if (historyUnsubscribe) historyUnsubscribe();

    const q = query(
        collection(db, "saved_places"),
        where("uid", "==", currentUser.uid),
        orderBy("visited_at", "desc"),
        limit(100)
    );

    historyUnsubscribe = onSnapshot(q, (snapshot) => {
        allPlaces = [];
        snapshot.forEach(doc => {
            allPlaces.push({ id: doc.id, ...doc.data() });
        });

        updateViews();
    }, (error) => {
        console.error("History listener error:", error);
        showToast(`Failed to load history: ${error.message}`, 'error');
    });
}

function findExistingPlace(place, statuses = ['visited', 'wishlist', 'dismissed', undefined, null]) {
    return allPlaces.find(saved => {
        if (!statuses.includes(saved.status)) return false;
        return isSamePlace(saved, place);
    }) || null;
}

function isSamePlace(a, b) {
    if (!a || !b) return false;
    if (a.place_id && b.place_id && a.place_id === b.place_id) return true;
    return normalizePlaceName(a.name) === normalizePlaceName(b.name)
        && normalizePlaceName(a.address || '') === normalizePlaceName(b.address || '');
}

function normalizePlaceName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function updateViews() {
    const visiblePlaces = allPlaces.filter(p => !['dismissed', 'recommended'].includes(p.status));
    const visited = visiblePlaces.filter(p => !p.status || p.status === 'visited');
    const wishlist = allPlaces.filter(p => p.status === 'wishlist');

    // Toggle feed filters visibility based on circle membership
    const filterContainer = document.getElementById('feed-filters');
    if (filterContainer) {
        filterContainer.style.display = currentCircle ? 'flex' : 'none';
    }

    renderHistoryFeed();
    renderWishlist(wishlist);
    renderProfile(allPlaces);
    renderRecommendationPrompt(visited, wishlist);
    renderRecommendationHistory();
    
    if (map) {
        updateMarkers();
    }
}

function renderCardActions(name, lat, lng, placeId = '', address = '', decisionMode = false) {
    const queryText = [name, address].filter(Boolean).join(' ');
    const encodedQuery = encodeURIComponent(queryText || name);
    const encodedName = encodeURIComponent(name);
    const encodedPlaceId = placeId ? encodeURIComponent(placeId) : '';
    const directionsDestination = lat && lng ? `${lat},${lng}` : encodedQuery;
    const directionsPlaceParam = encodedPlaceId ? `&destination_place_id=${encodedPlaceId}` : '';
    const placeIdParam = encodedPlaceId ? `&query_place_id=${encodedPlaceId}` : '';
    const mapsLink = decisionMode ? '' : `<a href="https://www.google.com/maps/dir/?api=1&destination=${directionsDestination}${directionsPlaceParam}" target="_blank" class="action-link primary-action" title="Open directions in Maps">Get me there</a>`;
    const bookingLink = `<a href="https://www.google.com/maps/search/?api=1&query=${encodedQuery}${placeIdParam}" target="_blank" class="action-link booking-action" title="Open booking options in Maps">Reserve</a>`;
    let lyftLink = '';
    if (lat && lng) {
        lyftLink = `<a href="https://www.lyft.com/rider/routes?destination=${lat}%2C${lng}&destination_name=${encodedName}" target="_blank" class="action-link" title="Open Lyft to restaurant">🚗 Lyft</a>`;
    }
    
    return `
        <div class="visit-card-actions">
            ${mapsLink}
            ${bookingLink}
            ${lyftLink}
        </div>
    `;
}

function cleanVisitNotes(notes) {
    if (!notes) return '';
    const trimmed = notes.trim();
    if (trimmed.startsWith('Ate:') && trimmed.includes(' | ')) {
        const parts = trimmed.split(' | ');
        const cleanParts = parts.filter(part => {
            const p = part.trim();
            return !p.startsWith('Ate:') && !p.startsWith('Total:');
        });
        if (cleanParts.length > 0) {
            return cleanParts.join(' | ').trim();
        }
    }
    return notes;
}

function formatOrderItems(items) {
    if (!Array.isArray(items)) return '';
    
    // Filter out common receipt clutter (taxes, tips, service charges, card fees, etc.)
    const junkKeywords = [
        'service charge', 'service chg', 'tax', 'tip', 'gratuity', 
        'subtotal', 'total', 'discount', 'surcharge', 'convenience fee',
        'round up', 'charge (', 'chg ('
    ];
    
    const cleanItems = items
        .map(item => item.trim())
        .filter(item => {
            if (!item) return false;
            const lower = item.toLowerCase();
            return !junkKeywords.some(keyword => lower.includes(keyword));
        })
        .map(item => {
            if (item.length === 0) return '';
            return item.charAt(0).toUpperCase() + item.slice(1);
        });

    if (cleanItems.length === 0) return '';

    // Join into a clean natural language list
    if (cleanItems.length === 1) {
        return `Ate ${cleanItems[0]}`;
    } else if (cleanItems.length === 2) {
        return `Ate ${cleanItems[0]} and ${cleanItems[1]}`;
    } else {
        const last = cleanItems.pop();
        return `Ate ${cleanItems.join(', ')}, and ${last}`;
    }
}


function renderHistoryFeed() {
    historySection.querySelectorAll('.visit-card').forEach(c => c.remove());

    const myVisits = allPlaces.filter(p => (!p.status || p.status === 'visited') && p.uid === currentUser.uid);
    const circleVisits = circlePlaces.filter(p => (!p.status || p.status === 'visited') && p.uid);

    const mergedMap = new Map();
    
    // Add all circle visits
    circleVisits.forEach(p => {
        mergedMap.set(p.id, p);
    });
    
    // Add all personal visits (overriding so it's marked as mine)
    myVisits.forEach(p => {
        mergedMap.set(p.id, p);
    });
    
    let visits = Array.from(mergedMap.values());

    // Filter based on active pill
    if (currentCircle) {
        if (currentFeedFilter === 'me') {
            visits = visits.filter(p => p.uid === currentUser.uid);
        } else if (currentFeedFilter === 'circle') {
            visits = visits.filter(p => p.uid !== currentUser.uid);
        }
    }

    // Sort by date
    visits.sort((a, b) => getPlaceTime(b) - getPlaceTime(a));

    if (visits.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    visits.forEach(visit => {
        const card = document.createElement('div');
        card.className = 'visit-card';

        const isMine = visit.uid === currentUser.uid;
        const memberName = isMine ? 'You' : (currentCircle?.membersInfo?.[visit.uid]?.displayName || 'Friend');
        const memberPhoto = isMine ? (currentUser.photoURL || '') : (currentCircle?.membersInfo?.[visit.uid]?.photoURL || '');
        
        let memberHeaderHtml = '';
        if (currentCircle) {
            memberHeaderHtml = `
                <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 0.35rem;">
                    ${memberPhoto ? `<img src="${memberPhoto}" alt="${escapeHtml(memberName)}" style="width: 16px; height: 16px; border-radius: 50%;">` : '<span style="font-size: 0.7rem;">👤</span>'}
                    <strong style="color: var(--text-primary);">${escapeHtml(memberName)}</strong>
                    <span>visited</span>
                </div>
            `;
        }

        const stars = renderCategoryBadge(visit.user_rating);
        const date = visit.visited_at?.toDate ? formatDate(visit.visited_at.toDate()) : '';
        const tagsHtml = (visit.tags || []).map(t => `<span class="visit-tag">${escapeHtml(t)}</span>`).join('');
        const orderItems = Array.isArray(visit.order_items) ? visit.order_items.filter(Boolean) : [];
        const totalAmount = visit.total_amount || visit.receipt?.total_amount || null;
        let orderHtmlString = '';
        const formattedOrderText = formatOrderItems(orderItems);
        if (formattedOrderText) {
            orderHtmlString = `<p class="visit-card-order">🍽️ ${escapeHtml(formattedOrderText)}</p>`;
        }
        if (totalAmount) {
            orderHtmlString += `<p class="visit-card-total">💰 <strong>Total:</strong> ${escapeHtml(totalAmount)}</p>`;
        }
        const cleanNotes = cleanVisitNotes(visit.notes || '');
        const notesHtml = cleanNotes ? `<p class="visit-card-notes">${escapeHtml(cleanNotes)}</p>` : '';
        const shouldCollapseMealDetails = Boolean(orderHtmlString)
            && (Boolean(visit.receipt) || formattedOrderText.length > 140 || cleanNotes.length > 180);
        const mealDetailsHtml = shouldCollapseMealDetails
            ? `
                <details class="visit-meal-details">
                    <summary>Meal details${orderItems.length ? ` · ${orderItems.length} items` : ''}</summary>
                    <div class="visit-meal-details-content">
                        ${orderHtmlString}
                        ${notesHtml}
                    </div>
                </details>
            `
            : `${orderHtmlString}${notesHtml}`;
        
        // Stats are only relevant for personal visits
        let repeatHtml = '';
        if (isMine) {
            const visitStats = getRestaurantVisitStats(visit);
            repeatHtml = visitStats.count > 1 ? `<span class="visit-count-pill">${visitStats.count} visits</span>` : '';
        }

        card.innerHTML = `
            ${memberHeaderHtml}
            <div class="visit-card-header">
                <span class="visit-card-name">${escapeHtml(visit.name)}</span>
                <div class="visit-card-meta">
                    ${repeatHtml}
                    <span class="visit-card-date">${date}</span>
                </div>
            </div>
            ${stars ? `<div class="visit-card-stars">${stars}</div>` : ''}
            ${mealDetailsHtml}
            ${tagsHtml ? `<div class="visit-card-tags">${tagsHtml}</div>` : ''}
            ${renderCardActions(visit.name, visit.lat, visit.lng, visit.place_id, visit.address)}
        `;

        historySection.appendChild(card);
    });
}

function getRestaurantVisitStats(place) {
    const visits = allPlaces.filter(saved => (!saved.status || saved.status === 'visited') && isSamePlace(saved, place));
    return { count: visits.length };
}

function renderWishlist(places, filter = 'all') {
    wishlistSection.querySelectorAll('.visit-card').forEach(c => c.remove());
    const empty = wishlistSection.querySelector('.empty-state');

    let filtered = [...places];

    if (filter === 'nearby') {
        getUserLocation().then(pos => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            
            filtered = places.filter(p => {
                if (!p.lat || !p.lng) return false;
                const dist = calculateDistance(userLat, userLng, p.lat, p.lng);
                return dist < milesToKm(10);
            });

            renderWishlistCards(filtered);
        }).catch(() => {
            showToast('Could not get location for filtering', 'error');
            renderWishlistCards(places);
        });
        return;
    }

    renderWishlistCards(filtered);
}

function renderRecommendationPrompt(visited, wishlist) {
    if (!nextPickCopy || !getRecommendationBtn) return;

    const signalCount = visited.length + wishlist.length;
    if (signalCount === 0) {
        nextPickCopy.textContent = `Choose the vibe. Lincoln will find up to three verified nearby ${selectedMealPeriod} options in under 30 seconds.`;
    } else if (visited.length < 3) {
        nextPickCopy.textContent = `Three nearby ${selectedMealPeriod} options, using your early taste signals and the vibe you chose.`;
    } else {
        nextPickCopy.textContent = `A reliable ${selectedMealPeriod} match, something new, and one smart wildcard—personalized to you.`;
    }
}

function renderRecommendationHistory() {
    if (!recommendationHistory) return;

    const wasOpen = recommendationHistory.querySelector('details')?.open || false;
    const recs = allPlaces
        .filter(place => place.source === 'ai_recommendation')
        .sort((a, b) => getPlaceTime(b) - getPlaceTime(a))
        .slice(0, 5);

    if (recs.length === 0) {
        recommendationHistory.innerHTML = '';
        return;
    }

    recommendationHistory.innerHTML = `
        <details class="recommendation-history-details"${wasOpen ? ' open' : ''}>
            <summary>
                <span>Recent suggestions</span>
                <span class="recommendation-history-count">${recs.length}</span>
            </summary>
            <div class="recommendation-history-list">
                ${recs.map(place => `
                    <div class="recommendation-history-item">
                        <span>${escapeHtml(place.name)}</span>
                        <strong>${escapeHtml(getRecommendationStatusLabel(place.status))}</strong>
                    </div>
                `).join('')}
            </div>
        </details>
    `;
}

function getRecommendationStatusLabel(status) {
    if (status === 'wishlist') return 'Want to go';
    if (status === 'visited') return 'Tried';
    if (status === 'dismissed') return 'Not for me';
    return 'Suggested';
}

function getPlaceTime(place) {
    const ts = place.acted_at || place.recommended_at || place.visited_at;
    if (ts?.toMillis) return ts.toMillis();
    if (ts?.toDate) return ts.toDate().getTime();
    return place._localSavedAt || 0;
}

function renderWishlistCards(places) {
    const empty = wishlistSection.querySelector('.empty-state');
    if (places.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }

    if (empty) empty.style.display = 'none';

    places.forEach(place => {
        const card = document.createElement('div');
        card.className = 'visit-card wishlist-item';

        const tagsHtml = (place.tags || []).map(t => `<span class="visit-tag">${escapeHtml(t)}</span>`).join('');
        const meta = [
            place.google_rating ? `⭐ ${place.google_rating}` : '',
            place.price_level ? '💰'.repeat(place.price_level) : ''
        ].filter(Boolean).join(' • ');

        card.innerHTML = `
            <div class="visit-card-header">
                <span class="visit-card-name">${escapeHtml(place.name)}</span>
                <button class="log-this-btn" data-id="${place.id}">Log Visit</button>
            </div>
            ${meta ? `<div class="visit-card-stars" style="color: var(--text-muted); font-size: 0.75rem;">${meta}</div>` : ''}
            ${place.notes ? `<p class="visit-card-notes">${escapeHtml(place.notes)}</p>` : ''}
            ${tagsHtml ? `<div class="visit-card-tags">${tagsHtml}</div>` : ''}
            ${renderCardActions(place.name, place.lat, place.lng, place.place_id, place.address)}
        `;

        card.querySelector('.log-this-btn').addEventListener('click', () => {
            searchInput.value = place.name;
            selectedPlace = { ...place };
            switchView('feed');
            quickLogPanel.open = true;
            searchInput.focus();
            updateSaveBtn();
        });

        wishlistSection.appendChild(card);
    });
}

async function handleHomeRecommendations() {
    if (!currentUser || !homeRecommendations) return;

    const originalText = getRecommendationBtn.textContent;
    getRecommendationBtn.disabled = true;
    getRecommendationBtn.textContent = 'Thinking...';
    preferencePanel.hidden = true;
    togglePreferencesBtn.setAttribute('aria-expanded', 'false');
    togglePreferencesBtn.textContent = 'Tune my picks';
    homeRecommendations.innerHTML = '<div class="inline-loading">Finding a place that fits your taste...</div>';

    if (isLocalUiPreview) {
        const previewRecommendations = [
            { lane: 'reliable', name: 'Neighborhood Favorite', cuisine: 'Italian', price_range: '$$', reasoning: 'A dependable nearby match for your usual comfort-food mood.', google_rating: 4.7, is_open_now: true, verified: true, address: '12 Market Street' },
            { lane: 'new', name: 'Fresh Find Kitchen', cuisine: 'Thai', price_range: '$$', reasoning: 'Close to what you enjoy, with enough novelty to make this meal interesting.', google_rating: 4.6, is_open_now: true, verified: true, address: '48 Pine Avenue' },
            { lane: 'wildcard', name: 'The Clever Detour', cuisine: 'Mediterranean', price_range: '$$', reasoning: 'A smart change of pace that still fits your budget and distance.', google_rating: 4.5, is_open_now: null, verified: true, address: '7 River Road' }
        ];
        homeRecommendations.innerHTML = renderRecommendationCardsHtml(previewRecommendations, 'home');
        getRecommendationBtn.disabled = false;
        getRecommendationBtn.textContent = originalText;
        return;
    }

    try {
        let location;
        try {
            location = await resolveDiningLocation({ requirePrecise: true });
            updateResolvedLocation(location);
        } catch (locationError) {
            renderLocationError(locationError);
            homeRecommendations.innerHTML = `<div class="inline-empty">${escapeHtml(getLocationErrorMessage(locationError))} Use Change to choose where to search.</div>`;
            return;
        }
        const result = await requestRecommendations({
            mode: 'three_lanes',
            message: `Help me choose where to eat now. I want ${selectedMealPeriod} with a ${selectedVibe} vibe.`,
            lat: location.lat,
            lng: location.lng,
            mealPeriod: selectedMealPeriod,
            vibe: selectedVibe,
            preferences: tastePreferences
        });

        if (!result.recommendations || result.recommendations.length === 0) {
            homeRecommendations.innerHTML = `<div class="inline-empty">${escapeHtml(result.reply || 'No recommendations yet. Add a few more places and try again.')}</div>`;
            return;
        }

        await recordRecommendations(result.recommendations, 'home');
        homeRecommendations.innerHTML = renderRecommendationCardsHtml(result.recommendations, 'home');
    } catch (e) {
        console.error("Home recommendation error:", e);
        homeRecommendations.innerHTML = '<div class="inline-empty error">Could not load recommendations. Try again in a bit.</div>';
    } finally {
        getRecommendationBtn.disabled = false;
        getRecommendationBtn.textContent = originalText;
    }
}

async function requestRecommendations({ message, lat = null, lng = null, mode = 'chat', mealPeriod = null, vibe = null, preferences = null }) {
    const recommend = httpsCallable(functions, 'recommend');
    const result = await recommend({
        lat,
        lng,
        message,
        history: aiChatHistoryData,
        mode,
        mealPeriod,
        vibe,
        preferences
    });
    return result.data || {};
}

function renderRecommendationCardsHtml(recommendations, surface) {
    const laneLabels = {
        reliable: 'Reliable match',
        new: 'Something new',
        wildcard: 'Smart wildcard'
    };

    return recommendations.map((rec, index) => {
        const key = storeRecommendation(rec);
        const encodedKey = encodeURIComponent(key);
        const fallbackLane = ['reliable', 'new', 'wildcard'][index];
        const lane = rec.lane || (surface === 'home' ? fallbackLane : null);
        const stars = rec.google_rating ? `⭐ ${rec.google_rating}` : '';
        const openStatus = rec.is_open_now === true ? '🟢 Open now' : rec.is_open_now === false ? '🟡 Closed now' : '';
        const verified = rec.verified ? '✓ Verified' : '';
        const bookLinks = renderCardActions(rec.name, rec.lat, rec.lng, rec.place_id, rec.address, surface === 'home');

        return `
            <div class="ai-rec-card ${surface === 'home' ? 'home-rec-card' : ''}" data-rec-card="${encodedKey}">
                ${lane ? `<span class="recommendation-lane">${escapeHtml(laneLabels[lane] || lane)}</span>` : ''}
                <h4>
                    ${escapeHtml(rec.name)}
                    ${verified ? `<span class="verified-badge">${verified}</span>` : ''}
                </h4>
                <p class="reasoning">${escapeHtml(rec.reasoning || 'Recommended based on your taste profile.')}</p>
                ${rec.address ? `<p class="rec-address">📍 ${escapeHtml(rec.address)}</p>` : ''}
                <div class="rec-meta">
                    ${rec.cuisine ? `<span>🍽 ${escapeHtml(rec.cuisine)}</span>` : ''}
                    ${rec.price_range ? `<span>💰 ${escapeHtml(rec.price_range)}</span>` : ''}
                    ${stars ? `<span>${stars}</span>` : ''}
                    ${openStatus ? `<span>${openStatus}</span>` : ''}
                </div>
                <div class="rec-actions">
                    ${surface === 'home'
                        ? `<button class="rec-feedback-btn primary" data-rec-action="go" data-rec-key="${encodedKey}">Let's go</button>
                           <button class="rec-feedback-btn" data-rec-action="wishlist" data-rec-key="${encodedKey}">Save</button>
                           <button class="rec-feedback-btn quiet" data-rec-action="dismissed" data-rec-key="${encodedKey}">Not now</button>`
                        : `<button class="rec-feedback-btn primary" data-rec-action="wishlist" data-rec-key="${encodedKey}">Want to go</button>
                           <button class="rec-feedback-btn" data-rec-action="visited" data-rec-key="${encodedKey}">Tried it</button>
                           <button class="rec-feedback-btn quiet" data-rec-action="dismissed" data-rec-key="${encodedKey}">Not for me</button>`}
                </div>
                ${bookLinks}
            </div>
        `;
    }).join('');
}

async function recordRecommendations(recommendations, surface) {
    if (!currentUser) return;

    const writes = recommendations.map(async rec => {
        const place = recommendationToPlace(rec);
        const existing = findExistingPlace(place, ['visited', 'wishlist', 'dismissed', 'recommended', undefined, null]);
        if (existing) {
            rec.saved_place_id = existing.id;
            return;
        }

        const docRef = await addDoc(collection(db, "saved_places"), {
            ...place,
            user_rating: null,
            tags: place.types || [],
            notes: rec.reasoning || '',
            status: 'recommended',
            source: 'ai_recommendation',
            recommendation_surface: surface,
            recommended_at: serverTimestamp(),
            visited_at: serverTimestamp(),
            uid: currentUser.uid
        });
        rec.saved_place_id = docRef.id;
    });

    await Promise.all(writes);
}

function storeRecommendation(rec) {
    const key = rec.place_id || `${rec.name || 'unknown'}|${rec.address || ''}`;
    recommendationCache.set(key, rec);
    return key;
}

async function handleRecommendationAction(rec, action, btn) {
    if (!currentUser) return;

    if (isLocalUiPreview) {
        if (action === 'go') {
            storePendingCheckin(rec);
            renderPendingCheckin();
            btn.textContent = 'Preview choice saved';
        } else {
            btn.textContent = action === 'wishlist' ? 'Preview saved' : 'Preview noted';
        }
        btn.disabled = true;
        showToast('Preview only—no Firebase data was written.', 'info');
        return;
    }

    if (action === 'go') {
        window.open(getGooglePlaceUrl(rec), '_blank', 'noopener');
        storePendingCheckin(rec);
        renderPendingCheckin();
        btn.textContent = 'Place opened';
        btn.disabled = true;
        pendingChoiceSavePromise = saveRecommendation(rec, 'wishlist').catch(e => {
            console.error('Could not save chosen recommendation:', e);
            return 'error';
        });
        showToast('Opened restaurant details. I’ll ask how it was next time.', 'success');
        return;
    }

    if (action === 'visited') {
        selectedPlace = {
            ...recommendationToPlace(rec),
            id: rec.saved_place_id || null,
            status: rec.saved_place_id ? 'recommended' : null
        };
        searchInput.value = rec.name || '';
        switchView('feed');
        quickLogPanel.open = true;
        closeAiModal();
        updateSaveBtn();
        showToast('Ready to log. Pick a rating and save.', 'info');
        return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = action === 'wishlist' ? 'Saving...' : 'Noted';

    try {
        const saveResult = await saveRecommendation(rec, action);
        const card = btn.closest('[data-rec-card]');
        if (card) card.classList.add('rec-card-saved');
        const feedbackMessage = saveResult === 'already_visited'
            ? 'Already in your visit history.'
            : saveResult === 'kept_visit'
                ? 'Noted. Your visit history is unchanged.'
                : action === 'wishlist' ? 'Added to Saved.' : 'Noted for future picks.';
        showToast(feedbackMessage, 'success');
    } catch (e) {
        console.error("Recommendation action error:", e);
        btn.disabled = false;
        btn.textContent = originalText;
        showToast('Could not save that feedback.', 'error');
    }
}

function getGooglePlaceUrl(place) {
    const query = [place.name, place.address].filter(Boolean).join(' ');
    const params = new URLSearchParams({
        api: '1',
        query: query || place.name || 'restaurant'
    });
    if (place.place_id) params.set('query_place_id', place.place_id);
    return `https://www.google.com/maps/search/?${params}`;
}

function getPendingCheckinStorageKey() {
    return currentUser ? `lincolnEats:pendingCheckin:v1:${currentUser.uid}` : null;
}

function storePendingCheckin(rec) {
    const key = getPendingCheckinStorageKey();
    if (!key) return;
    const safeRecord = {
        place_id: rec.place_id || null,
        saved_place_id: rec.saved_place_id || null,
        name: rec.name || 'your pick',
        address: rec.address || '',
        google_rating: rec.google_rating || null,
        types: Array.isArray(rec.types) ? rec.types.slice(0, 10) : [],
        price_level: rec.price_level || null,
        lat: rec.lat || null,
        lng: rec.lng || null,
        chosen_at: Date.now()
    };
    try {
        localStorage.setItem(key, JSON.stringify(safeRecord));
    } catch (e) {
        console.warn('Could not remember pending check-in:', e);
    }
}

function readPendingCheckin() {
    const key = getPendingCheckinStorageKey();
    if (!key) return null;
    try {
        const pending = JSON.parse(localStorage.getItem(key) || 'null');
        if (!pending || !pending.name) return null;
        if (Date.now() - Number(pending.chosen_at || 0) > 14 * 86400000) {
            localStorage.removeItem(key);
            return null;
        }
        return pending;
    } catch (e) {
        return null;
    }
}

function clearPendingCheckin() {
    const key = getPendingCheckinStorageKey();
    if (key) localStorage.removeItem(key);
}

function renderPendingCheckin() {
    if (!pendingCheckin || !currentUser) return;
    const pending = readPendingCheckin();
    if (!pending) {
        pendingCheckin.hidden = true;
        pendingCheckin.innerHTML = '';
        return;
    }

    pendingCheckin.hidden = false;
    pendingCheckin.innerHTML = `
        <h3>Did you make it to ${escapeHtml(pending.name)}?</h3>
        <p>One tap helps Lincoln make the next set of picks better.</p>
        <div class="checkin-actions">
            <button data-checkin-rating="3">❤️ Loved it</button>
            <button data-checkin-rating="2">👍 Go back</button>
            <button data-checkin-rating="1">👎 Skip it</button>
        </div>
        <button class="checkin-later" data-checkin-later>Not yet—keep it saved</button>
    `;
}

pendingCheckin.addEventListener('click', async (e) => {
    if (e.target.closest('[data-checkin-later]')) {
        clearPendingCheckin();
        renderPendingCheckin();
        showToast('Kept in Saved for later.', 'info');
        return;
    }

    const ratingButton = e.target.closest('[data-checkin-rating]');
    if (!ratingButton) return;
    if (isLocalUiPreview) {
        clearPendingCheckin();
        renderPendingCheckin();
        showToast('Preview check-in complete—no Firebase data was written.', 'info');
        return;
    }
    const pending = readPendingCheckin();
    if (!pending) return renderPendingCheckin();

    const rating = Number(ratingButton.dataset.checkinRating);
    ratingButton.disabled = true;
    ratingButton.textContent = 'Saving...';

    if (pendingChoiceSavePromise) {
        await pendingChoiceSavePromise;
        pendingChoiceSavePromise = null;
    }
    const saved = await savePendingCheckin(pending, rating);
    if (saved) {
        clearPendingCheckin();
        renderPendingCheckin();
    } else {
        ratingButton.disabled = false;
        renderPendingCheckin();
    }
});

async function savePendingCheckin(pending, rating) {
    if (!currentUser || ![1, 2, 3].includes(rating)) return false;
    const place = recommendationToPlace(pending);
    const existing = findExistingPlace(place, ['visited', 'wishlist', 'recommended', undefined, null]);
    const payload = {
        ...place,
        user_rating: rating,
        tags: place.types || [],
        notes: '',
        order_items: [],
        total_amount: null,
        receipt: null,
        status: 'visited',
        source: 'ai_recommendation',
        acted_at: serverTimestamp(),
        visited_at: serverTimestamp(),
        uid: currentUser.uid,
        circle_id: currentCircle ? currentCircle.id : null
    };

    try {
        if (existing && (!existing.status || existing.status === 'visited')) {
            await addDoc(collection(db, 'saved_places'), payload);
        } else {
            const targetId = existing?.id || pending.saved_place_id;
            if (targetId) await updateDoc(doc(db, 'saved_places', targetId), payload);
            else await addDoc(collection(db, 'saved_places'), payload);
        }
        showToast('Visit saved. Your next picks just got smarter.', 'success');
        return true;
    } catch (error) {
        console.error('Pending check-in save failed:', error);
        showToast('Could not save that check-in. Try again.', 'error');
        return false;
    }
}

async function saveRecommendation(rec, status) {
    const place = recommendationToPlace(rec);
    const duplicate = findExistingPlace(place, ['visited', 'wishlist', 'dismissed', 'recommended', undefined, null]);
    const targetId = rec.saved_place_id || duplicate?.id;

    if (duplicate && status === 'wishlist' && (!duplicate.status || duplicate.status === 'visited')) {
        return 'already_visited';
    }

    if (duplicate && status === 'dismissed' && (!duplicate.status || duplicate.status === 'visited')) {
        return 'kept_visit';
    }

    const payload = {
        ...place,
        user_rating: null,
        tags: place.types || [],
        notes: rec.reasoning || '',
        status,
        source: 'ai_recommendation',
        acted_at: serverTimestamp(),
        visited_at: serverTimestamp(),
        uid: currentUser.uid,
        circle_id: currentCircle ? currentCircle.id : null
    };

    if (targetId) {
        await updateDoc(doc(db, "saved_places", targetId), payload);
    } else {
        await addDoc(collection(db, "saved_places"), {
            ...payload,
            recommended_at: serverTimestamp()
        });
    }
    return 'saved';
}

function recommendationToPlace(rec) {
    return {
        place_id: rec.place_id || null,
        name: rec.name || 'Recommended place',
        google_rating: rec.google_rating || null,
        types: rec.types || (rec.cuisine ? [rec.cuisine.toLowerCase().replace(/\s+/g, '_')] : []),
        address: rec.address || '',
        price_level: rec.price_level || priceRangeToLevel(rec.price_range),
        lat: rec.lat || null,
        lng: rec.lng || null
    };
}

function priceRangeToLevel(priceRange) {
    if (!priceRange) return null;
    const dollarCount = (String(priceRange).match(/\$/g) || []).length;
    return dollarCount || null;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function milesToKm(miles) {
    return miles * 1.609344;
}

function renderCategoryBadge(rating) {
    if (!rating) return '';
    if (rating === 3) return '❤️ Love';
    if (rating === 2) return '👍 Will go back';
    if (rating === 1) return '👎 Skip it';
    return '';
}

function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ===== Maps Logic =====
async function initMap() {
    await window._mapsReady;

    const mapCenter = { lat: 39.8283, lng: -98.5795 };
    
    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: mapCenter,
        disableDefaultUI: true,
        gestureHandling: "greedy",
        styles: [
            { "elementType": "geometry", "stylers": [{ "color": "#212121" }] },
            { "elementType": "labels.text.stroke", "stylers": [{ "color": "#212121" }] },
            { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
            { "featureType": "administrative.country", "elementType": "geometry.stroke", "stylers": [{ "color": "#4b4b4b" }] },
            { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
            { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#181818" }] },
            { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#2c2c2c" }] },
            { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
        ]
    });

    // Try to get user location to center map
    let centeredOnUser = false;
    try {
        const pos = await getUserLocation();
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        centeredOnUser = true;
    } catch (e) {
        console.warn("Could not get location; centering on recent saved places");
    }

    updateMarkers({ fitToRecentArea: !centeredOnUser });
}

function updateMarkers({ fitToRecentArea = false } = {}) {
    if (!map) return;

    // Clear existing
    markers.forEach(m => m.setMap(null));
    markers = [];

    // Toggle legend items for friends if in circle
    const friendVisitedEl = document.getElementById('legend-friend-visited');
    const friendWishlistEl = document.getElementById('legend-friend-wishlist');
    if (friendVisitedEl && friendWishlistEl) {
        const hasCircle = !!currentCircle;
        friendVisitedEl.style.display = hasCircle ? 'inline-flex' : 'none';
        friendWishlistEl.style.display = hasCircle ? 'inline-flex' : 'none';
    }

    const uniquePlaces = new Map();

    // 1. Add all personal places (which overrides circle places, so they show as "Mine")
    allPlaces.forEach(place => {
        const key = place.place_id || `${place.name}|${place.address}`;
        uniquePlaces.set(key, { ...place, isMine: true });
    });

    // 2. Add all circle places (if they aren't already added)
    circlePlaces.forEach(place => {
        const key = place.place_id || `${place.name}|${place.address}`;
        if (!uniquePlaces.has(key)) {
            uniquePlaces.set(key, { ...place, isMine: place.uid === currentUser.uid });
        }
    });

    const placesToPlot = Array.from(uniquePlaces.values()).filter(place => !['dismissed', 'recommended'].includes(place.status));

    placesToPlot.forEach(place => {
        if (!place.lat || !place.lng) return;

        const isMine = place.isMine;
        const isVisited = !place.status || place.status === 'visited';

        let color = '#d8a54a'; // Gold (Default: Mine, Tried)
        if (isMine) {
            color = isVisited ? '#d8a54a' : '#91b7c7'; // Gold vs Sky Blue
        } else {
            color = isVisited ? '#5f8f7a' : '#a78bfa'; // Pine Green vs Purple
        }

        const marker = new google.maps.Marker({
            position: { lat: place.lat, lng: place.lng },
            map: map,
            title: place.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: color,
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#fff',
                scale: 8
            }
        });

        const savedBy = isMine ? 'You' : (currentCircle?.membersInfo?.[place.uid]?.displayName || 'Friend');
        const statusText = isVisited ? '✅ Visited' : '📍 Wishlist';
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px; color: #fff;">
                    <strong style="display:block; margin-bottom: 5px;">${escapeHtml(place.name)}</strong>
                    <span style="font-size: 0.75rem; color: #aaa;">${statusText}</span>
                    <span style="display:block; font-size: 0.7rem; color: var(--accent); margin-top: 3px;">Saved by: ${escapeHtml(savedBy)}</span>
                </div>
            `
        });

        marker.addListener("click", () => {
            infoWindow.open(map, marker);
        });

        markers.push(marker);
    });

    if (fitToRecentArea) fitMapToRecentArea(placesToPlot);
}

function fitMapToRecentArea(places) {
    const withCoordinates = places
        .filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng));
    if (withCoordinates.length === 0) return;

    const ownPlaces = withCoordinates.filter(place => place.isMine);
    const candidates = (ownPlaces.length ? ownPlaces : withCoordinates)
        .sort((a, b) => getPlaceTime(b) - getPlaceTime(a));
    const anchor = candidates[0];
    const localPlaces = candidates.filter(place => (
        calculateDistance(anchor.lat, anchor.lng, place.lat, place.lng) <= 80
    ));

    if (localPlaces.length === 1) {
        map.setCenter({ lat: anchor.lat, lng: anchor.lng });
        map.setZoom(13);
        return;
    }

    const bounds = new google.maps.LatLngBounds();
    localPlaces.forEach(place => bounds.extend({ lat: place.lat, lng: place.lng }));
    map.fitBounds(bounds, 48);
}

// ===== Profile Logic =====
function renderProfile(places) {
    const visited = places.filter(p => !p.status || p.status === 'visited');
    const wishlist = places.filter(p => p.status === 'wishlist');

    // Calculate Identity
    let identityEmoji = '🍴';
    let identityTitle = 'The Casual Diner';
    let identityDesc = 'You\'re just getting started on your culinary journey!';

    if (visited.length >= 5) {
        identityEmoji = '🍱';
        identityTitle = 'The Local Foodie';
        identityDesc = 'You know the best spots in town and aren\'t afraid to log them.';
    }
    
    if (visited.length >= 15) {
        identityEmoji = '🎩';
        identityTitle = 'Elite Critic';
        identityDesc = 'A seasoned palate with a wide range of experiences. Lincoln trusts your taste.';
    }

    // Top Cuisines
    const counts = {};
    visited.forEach(visit => {
        const cuisines = new Set(
            [...(visit.types || []), ...(visit.tags || [])]
                .map(getCuisineLabel)
                .filter(Boolean)
        );
        cuisines.forEach(cuisine => counts[cuisine] = (counts[cuisine] || 0) + 1);
    });
    const topCuisine = Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'Mixed';

    profileDashboard.innerHTML = `
        <div class="profile-identity">
            <span class="identity-badge">${identityEmoji}</span>
            <h2 class="identity-title">${identityTitle}</h2>
            <p class="identity-desc">${identityDesc}</p>
        </div>

        <div class="profile-stats">
            <div class="stat-card">
                <span class="stat-value">${visited.length}</span>
                <span class="stat-label">Visits</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${wishlist.length}</span>
                <span class="stat-label">Wishlist</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${topCuisine}</span>
                <span class="stat-label">Top Cuisine</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${visited.filter(v => v.user_rating === 3).length}</span>
                <span class="stat-label">Loved Places</span>
            </div>
        </div>

        <div class="profile-chart-card">
            <h3>Your Taste Footprint</h3>
            <div class="chart-container" style="position: relative; height: 260px; width: 100%; margin-top: 1rem;">
                <canvas id="taste-radar-chart"></canvas>
            </div>
        </div>
    `;

    // Wait a brief tick for DOM to render the canvas before initializing Chart.js
    setTimeout(() => {
        const scores = calculateTasteScores(visited);
        initTasteRadar(scores);
    }, 50);
}

function getCuisineLabel(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const aliases = {
        american: 'American', new_american: 'American', southern: 'Southern',
        mexican: 'Mexican', latin_american: 'Latin American',
        indian: 'Indian', thai: 'Thai',
        japanese: 'Japanese', sushi: 'Japanese',
        italian: 'Italian', pizza: 'Italian',
        mediterranean: 'Mediterranean', middle_eastern: 'Middle Eastern',
        chinese: 'Chinese', korean: 'Korean', vietnamese: 'Vietnamese',
        french: 'French', greek: 'Greek', spanish: 'Spanish',
        ethiopian: 'Ethiopian', caribbean: 'Caribbean',
        barbecue: 'Barbecue', bbq: 'Barbecue', seafood: 'Seafood',
        vegan: 'Vegan', vegetarian: 'Vegetarian'
    };
    return aliases[key] || null;
}

function calculateTasteScores(visited) {
    if (visited.length === 0) return [0, 0, 0, 0, 0];

    const patterns = [
        /spicy|hot|curry|bold|mexican|indian|thai|szechuan|chili|jalapeno/i,
        /cozy|intimate|date|trendy|vibes|bar|drinks|cocktails|social|wine/i,
        /burger|street|pizza|casual|quick|cheap|diner|sandwich|taco|fast/i,
        /vegan|salad|vegetarian|clean|sushi|seafood|healthy|fresh|poke|bowl/i,
        /bakery|dessert|sweet|chocolate|indulgent|pasta|cheese|cake|ice|pastry/i
    ];
    const matchedWeights = [0, 0, 0, 0, 0];
    let totalWeight = 0;

    visited.forEach(v => {
        const text = ((v.notes || '') + ' ' + (v.tags || []).join(' ') + ' ' + (v.types || []).join(' ')).toLowerCase();
        const weight = v.user_rating === 3 ? 1.25 : v.user_rating === 2 ? 0.85 : v.user_rating === 1 ? 0.25 : 0.6;
        totalWeight += weight;
        patterns.forEach((pattern, index) => {
            if (pattern.test(text)) matchedWeights[index] += weight;
        });
    });

    return matchedWeights.map(weight => Math.round(10 + (weight / totalWeight) * 90));
}

function initTasteRadar(scores) {
    const ctx = document.getElementById('taste-radar-chart');
    if (!ctx) return;

    if (tasteRadarChart) {
        tasteRadarChart.destroy();
    }

    // Ensure Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js is not loaded yet.');
        return;
    }

    tasteRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['🌶️ Spicy & Bold', '🕯️ Cozy & Social', '🍔 Casual & Fast', '🥗 Healthy & Fresh', '🍰 Indulgent & Sweet'],
            datasets: [{
                label: 'Taste Score',
                data: scores,
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                borderColor: '#f59e0b',
                pointBackgroundColor: '#f59e0b',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#f59e0b',
                borderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
                    grid: { color: 'rgba(255, 255, 255, 0.08)' },
                    pointLabels: {
                        color: '#8a8a8a',
                        font: { family: 'Inter', size: 10, weight: '500' }
                    },
                    ticks: {
                        display: false,
                        stepSize: 20
                    },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            }
        }
    });
}

// ===== AI Conversational Concierge =====
aiFab.addEventListener('click', openAiModal);

let aiModalTrigger = null;

function openAiModal(event) {
    aiModalTrigger = event?.currentTarget || document.activeElement;
    aiOverlay.classList.add('active');
    aiModal.classList.add('active');
    closeAiModalBtn.focus();
}

aiOverlay.addEventListener('click', closeAiModal);
closeAiModalBtn.addEventListener('click', closeAiModal);

function closeAiModal() {
    aiOverlay.classList.remove('active');
    aiModal.classList.remove('active');
    if (aiModalTrigger?.focus) aiModalTrigger.focus();
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && aiModal.classList.contains('active')) {
        closeAiModal();
    }
});

// Bind chat form submission
aiChatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = aiChatInput.value.trim();
    if (!query) return;

    aiChatInput.value = '';
    await handleConciergeChat(query);
});

// Bind mood chips clicks
aiMoodChips.querySelectorAll('.mood-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
        // Toggle active visual state
        aiMoodChips.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const moodName = chip.textContent.trim();
        const moodVal = chip.dataset.mood;
        
        await handleConciergeChat(`Curate recommendations for a "${moodName}" mood.`);
    });
});

async function handleConciergeChat(userText) {
    if (!currentUser) return;

    // Append user bubble
    appendChatBubble('user', userText);
    
    // Hide welcome message after first prompt
    if (aiChatWelcome) {
        aiChatWelcome.style.display = 'none';
    }

    aiLoading.classList.add('active');
    
    // Disable inputs during inference
    aiChatForm.querySelector('input').disabled = true;
    aiChatForm.querySelector('button').disabled = true;
    aiMoodChips.querySelectorAll('.mood-chip').forEach(c => c.disabled = true);

    try {
        const pos = await getUserLocation().catch(() => null);
        const lat = pos?.coords?.latitude || null;
        const lng = pos?.coords?.longitude || null;

        const data = await requestRecommendations({ message: userText, lat, lng });
        const replyText = data.reply || "Here is what I found for you:";

        // Build HTML for the AI recommendations if returned
        let recsHtml = '';
        if (data.recommendations && data.recommendations.length > 0) {
            await recordRecommendations(data.recommendations, 'chat');
            recsHtml = `<div class="recs-wrapper">${renderRecommendationCardsHtml(data.recommendations, 'chat')}</div>`;
        }

        // Render bot bubble with text + dynamic card recommendations
        const botHtml = `<p>${escapeHtml(replyText)}</p>${recsHtml}`;
        appendChatBubble('bot', botHtml, true);

        // Keep local conversation history data updated (standard Gemini message schema)
        aiChatHistoryData.push({ role: 'user', parts: [{ text: userText }] });
        aiChatHistoryData.push({ role: 'model', parts: [{ text: replyText }] });

        // Maintain size limit (last 10 messages)
        if (aiChatHistoryData.length > 20) {
            aiChatHistoryData.splice(0, 2);
        }

    } catch (e) {
        console.error("Concierge Chat Error:", e);
        appendChatBubble('bot', `<p style="color: var(--error);">Apologies, something went wrong on my end. Please try again!</p>`, true);
    } finally {
        aiLoading.classList.remove('active');
        aiChatForm.querySelector('input').disabled = false;
        aiChatForm.querySelector('button').disabled = false;
        aiMoodChips.querySelectorAll('.mood-chip').forEach(c => {
            c.disabled = false;
            c.classList.remove('active'); // reset active visual chip state
        });
        
        // Auto scroll to bottom
        setTimeout(() => {
            aiChatHistory.parentElement.scrollTo({
                top: aiChatHistory.parentElement.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);
    }
}

function appendChatBubble(role, content, isHtml = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    if (isHtml) {
        bubble.innerHTML = content;
    } else {
        bubble.textContent = content;
    }
    aiChatHistory.appendChild(bubble);
    
    // Auto scroll chat list
    aiChatHistory.parentElement.scrollTo({
        top: aiChatHistory.parentElement.scrollHeight,
        behavior: 'smooth'
    });
}

// ===== Collaborative Circles Logic =====
const circlesCard = document.getElementById('circles-card');

function listenToCircle() {
    if (circleUnsubscribe) circleUnsubscribe();

    const q = query(
        collection(db, "circles"),
        where(`members.${currentUser.uid}`, "==", true),
        limit(1)
    );

    circleUnsubscribe = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            currentCircle = null;
            renderCirclesUI();
            renderHistoryFeed();
            if (circlePlacesUnsubscribe) {
                circlePlacesUnsubscribe();
                circlePlacesUnsubscribe = null;
            }
            updateMarkers();
            return;
        }

        const docSnap = snapshot.docs[0];
        currentCircle = { id: docSnap.id, ...docSnap.data() };
        
        renderCirclesUI();
        listenToCirclePlaces();
    }, (error) => {
        console.error("Circle listener error:", error);
    });
}

function listenToCirclePlaces() {
    if (circlePlacesUnsubscribe) circlePlacesUnsubscribe();
    if (!currentCircle) return;

    const q = query(
        collection(db, "saved_places"),
        where("circle_id", "==", currentCircle.id)
    );

    circlePlacesUnsubscribe = onSnapshot(q, (snapshot) => {
        circlePlaces = [];
        snapshot.forEach(doc => {
            circlePlaces.push({ id: doc.id, ...doc.data() });
        });

        updateMarkers();
        renderCirclesUI();
        renderHistoryFeed();
    }, (error) => {
        console.error("Circle places listener error:", error);
    });
}

async function associatePlacesWithCircle(circleId) {
    if (!currentUser) return;
    try {
        const q = query(
            collection(db, "saved_places"),
            where("uid", "==", currentUser.uid)
        );
        const snap = await getDocs(q);
        const promises = [];
        snap.forEach(docSnap => {
            promises.push(updateDoc(doc(db, "saved_places", docSnap.id), { circle_id: circleId }));
        });
        await Promise.all(promises);
        console.log(`Associated ${promises.length} places with circle ${circleId}`);
    } catch (e) {
        console.error("Error associating places with circle:", e);
    }
}

async function disassociatePlacesFromCircle() {
    if (!currentUser) return;
    try {
        const q = query(
            collection(db, "saved_places"),
            where("uid", "==", currentUser.uid)
        );
        const snap = await getDocs(q);
        const promises = [];
        snap.forEach(docSnap => {
            promises.push(updateDoc(doc(db, "saved_places", docSnap.id), { circle_id: null }));
        });
        await Promise.all(promises);
        console.log(`Disassociated ${promises.length} places from circle`);
    } catch (e) {
        console.error("Error disassociating places from circle:", e);
    }
}

function renderCirclesUI() {
    if (!circlesCard) return;

    if (!currentCircle) {
        circlesCard.innerHTML = `
            <div class="circles-dashboard">
                <p class="circles-empty-state">You are not in a Dining Circle yet. Create a circle and invite friends, or join an existing circle with a code!</p>
                <div class="circles-actions">
                    <div class="circle-form-group">
                        <input type="text" id="create-circle-name" placeholder="E.g., Friday Foodies" maxlength="25">
                        <button class="circle-btn primary" id="create-circle-btn">Create</button>
                    </div>
                    <div style="text-align: center; font-size: 0.8rem; color: var(--text-muted); margin: 0.25rem 0;">— OR —</div>
                    <div class="circle-form-group">
                        <input type="text" id="join-circle-code" placeholder="Enter 6-character code" maxlength="6" style="text-transform: uppercase;">
                        <button class="circle-btn" id="join-circle-btn">Join</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('create-circle-btn').addEventListener('click', handleCreateCircle);
        document.getElementById('join-circle-btn').addEventListener('click', handleJoinCircle);
    } else {
        const membersHtml = Object.entries(currentCircle.membersInfo || {}).map(([uid, info]) => `
            <div class="circle-member-item">
                <img src="${info.photoURL || 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg'}" alt="${escapeHtml(info.displayName)}">
                <span>${escapeHtml(info.displayName)} ${uid === currentCircle.owner ? '👑' : ''}</span>
            </div>
        `).join('');

        circlesCard.innerHTML = `
            <div class="circles-dashboard active-circle-view">
                <div class="circle-header-title">
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600;">${escapeHtml(currentCircle.name)}</h4>
                    <button class="circle-btn" id="leave-circle-btn" style="color: var(--error); border-color: rgba(239, 68, 68, 0.3); font-size: 0.72rem; padding: 0.3rem 0.6rem;">Leave</button>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Share this code with friends to join:</div>
                <div class="circle-code-display" id="circle-code-display" title="Click to copy code">${escapeHtml(currentCircle.code)}</div>
                
                <p style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; margin-bottom: 0.25rem;">Members</p>
                <div class="circle-members-list">
                    ${membersHtml}
                </div>
            </div>
        `;

        document.getElementById('circle-code-display').addEventListener('click', () => {
            navigator.clipboard.writeText(currentCircle.code);
            showToast('Code copied to clipboard! 📋', 'success');
        });

        document.getElementById('leave-circle-btn').addEventListener('click', handleLeaveCircle);
    }
}

// renderCircleActivity removed - combined into renderHistoryFeed

async function handleCreateCircle() {
    const nameInput = document.getElementById('create-circle-name');
    const name = nameInput.value.trim();
    if (!name) return showToast('Please enter a circle name.', 'error');

    const btn = document.getElementById('create-circle-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
        const payload = {
            name: name,
            code: code,
            owner: currentUser.uid,
            members: {
                [currentUser.uid]: true
            },
            membersInfo: {
                [currentUser.uid]: {
                    displayName: currentUser.displayName || 'Anonymous',
                    photoURL: currentUser.photoURL || ''
                }
            },
            created_at: serverTimestamp()
        };

        const circleRef = await addDoc(collection(db, "circles"), payload);
        await associatePlacesWithCircle(circleRef.id);
        showToast('🎉 Dining Circle created!', 'success');
    } catch (e) {
        console.error("Create circle error:", e);
        showToast('Failed to create circle. Try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Create';
    }
}

async function handleJoinCircle() {
    const codeInput = document.getElementById('join-circle-code');
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) return showToast('Please enter a 6-character code.', 'error');

    const btn = document.getElementById('join-circle-btn');
    btn.disabled = true;
    btn.textContent = 'Joining...';

    try {
        const q = query(collection(db, "circles"), where("code", "==", code), limit(1));
        const snap = await getDocs(q);

        if (snap.empty) {
            btn.disabled = false;
            btn.textContent = 'Join';
            return showToast('Circle code not found.', 'error');
        }

        const circleDoc = snap.docs[0];
        const circleData = circleDoc.data();

        const updatedMembers = { ...circleData.members, [currentUser.uid]: true };
        const updatedMembersInfo = {
            ...circleData.membersInfo,
            [currentUser.uid]: {
                displayName: currentUser.displayName || 'Anonymous',
                photoURL: currentUser.photoURL || ''
            }
        };

        await updateDoc(doc(db, "circles", circleDoc.id), {
            members: updatedMembers,
            membersInfo: updatedMembersInfo
        });

        await associatePlacesWithCircle(circleDoc.id);
        showToast('🎉 Joined circle successfully!', 'success');
    } catch (e) {
        console.error("Join circle error:", e);
        showToast('Failed to join circle.', 'error');
        btn.disabled = false;
        btn.textContent = 'Join';
    }
}

async function handleLeaveCircle() {
    if (!currentCircle || !currentUser) return;
    
    if (!confirm('Are you sure you want to leave this dining circle?')) return;

    const btn = document.getElementById('leave-circle-btn');
    btn.disabled = true;
    btn.textContent = 'Leaving...';

    try {
        const updatedMembers = { ...currentCircle.members };
        delete updatedMembers[currentUser.uid];

        const updatedMembersInfo = { ...currentCircle.membersInfo };
        delete updatedMembersInfo[currentUser.uid];

        const updates = {
            members: updatedMembers,
            membersInfo: updatedMembersInfo
        };

        if (currentCircle.owner === currentUser.uid && Object.keys(updatedMembers).length > 0) {
            updates.owner = Object.keys(updatedMembers)[0];
        }

        await disassociatePlacesFromCircle();
        await updateDoc(doc(db, "circles", currentCircle.id), updates);
        showToast('Left the circle.', 'info');
    } catch (e) {
        console.error("Leave circle error:", e);
        showToast('Failed to leave circle.', 'error');
        btn.disabled = false;
        btn.textContent = 'Leave';
    }
}

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No geolocation'));
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        });
    });
}

// ===== Toast =====
let toastTimeout = null;

function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = 'toast' + (type ? ` ${type}` : '');
    clearTimeout(toastTimeout);

    requestAnimationFrame(() => {
        toast.classList.add('active');
    });

    toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
    }, 2500);
}

// ===== Utilities =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Register Service Worker for PWA installation
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        let waitingWorker = null;
        let refreshing = false;
        const hadController = !!navigator.serviceWorker.controller;

        const showUpdateBanner = worker => {
            waitingWorker = worker;
            appUpdateBanner.hidden = false;
        };

        refreshAppBtn.addEventListener('click', () => {
            if (!waitingWorker) return;
            refreshAppBtn.disabled = true;
            refreshAppBtn.textContent = 'Refreshing…';
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController && !waitingWorker) return;
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('/sw.js?v=26')
            .then(reg => {
                console.log('Service Worker registered successfully.', reg.scope);

                if (reg.waiting && navigator.serviceWorker.controller) {
                    showUpdateBanner(reg.waiting);
                }

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateBanner(newWorker);
                        }
                    });
                });

                reg.update().catch(err => console.warn('Service Worker update check failed:', err));
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        reg.update().catch(err => console.warn('Service Worker update check failed:', err));
                    }
                });
            })
            .catch(err => console.warn('Service Worker registration failed:', err));
    });
}
