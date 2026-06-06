// Lincoln Eats — App Logic
import {
    db, auth, functions, googleProvider,
    collection, addDoc, doc, updateDoc, serverTimestamp,
    query, where, orderBy, limit, onSnapshot, getDocs,
    signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
    httpsCallable, mapsApiKey
} from './firebase-config.js';

// Dynamically load Google Maps script with obfuscated API key
const mapsScript = document.createElement('script');
mapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&callback=initAutocomplete`;
mapsScript.async = true;
mapsScript.defer = true;
document.head.appendChild(mapsScript);

// ===== DOM Refs =====
const authScreen = document.getElementById('auth-screen');
const appContainer = document.getElementById('app-container');
const googleSignInBtn = document.getElementById('google-sign-in');
const userAvatar = document.getElementById('user-avatar');
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
const scanReceiptBtn = document.getElementById('scan-receipt-btn');
const receiptFileInput = document.getElementById('receipt-file-input');

const toast = document.getElementById('toast');

// ===== State =====
let currentUser = null;
let selectedPlace = null;
let tags = [];
let autocomplete = null;
let map = null;
let markers = [];
let allPlaces = [];
let currentView = 'feed';
let historyUnsubscribe = null;
let tasteRadarChart = null;
let aiChatHistoryData = [];
let currentCircle = null;
let circleUnsubscribe = null;
let circlePlaces = [];
let circlePlacesUnsubscribe = null;
let showCircleMap = false;

// ===== Auth =====
googleSignInBtn.addEventListener('click', async () => {
    const originalHtml = googleSignInBtn.innerHTML;
    googleSignInBtn.disabled = true;
    googleSignInBtn.textContent = 'Signing in...';

    try {
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
    currentUser = user;
    if (user) {
        authScreen.style.display = 'none';
        appContainer.classList.add('active');
        aiFab.style.display = 'flex';
        userAvatar.src = user.photoURL || '';
        userAvatar.alt = user.displayName || 'User';
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
    console.log('Places Autocomplete initialized.');
}

setupAutocomplete();


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
    saveBtn.disabled = !hasPlace;
    wishlistBtn.disabled = !hasPlace;
}

saveBtn.addEventListener('click', () => handleSave('visited'));
wishlistBtn.addEventListener('click', () => handleSave('wishlist'));

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
    showToast('Uploading image to Gemini...', 'info');

    try {
        const base64Data = await convertFileToBase64(file);
        
        // Strip out metadata prefix (e.g. data:image/png;base64,)
        const rawBase64 = base64Data.split(',')[1];
        const mimeType = file.type;

        // Call our scanReceipt Cloud Function
        const scanReceiptFn = httpsCallable(functions, 'scanReceipt');
        const result = await scanReceiptFn({ base64: rawBase64, mimeType });
        const data = result.data;

        if (data.error) {
            throw new Error(data.error);
        }

        // Auto-fill fields from scanned output
        if (data.restaurantName) {
            searchInput.value = data.restaurantName;
            
            // Try to trigger Places Autocomplete or mock a Place object
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
        if (data.notes) {
            notesInput.value = data.notes;
        }

        showToast('✨ Receipt scanned and populated successfully!', 'success');

    } catch (err) {
        console.error("Receipt Scanner Error:", err);
        showToast('Receipt scanning failed. Please try again.', 'error');
    } finally {
        scanReceiptBtn.disabled = false;
        scanReceiptBtn.textContent = originalText;
    }
});

function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function handleSave(status) {
    if (!selectedPlace || !currentUser) return;

    const btn = status === 'visited' ? saveBtn : wishlistBtn;
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'Saving...';

    const payload = {
        ...selectedPlace,
        user_rating: status === 'visited' ? getSelectedRating() : null,
        tags: [...tags],
        notes: notesInput.value.trim(),
        status: status,
        visited_at: serverTimestamp(),
        uid: currentUser.uid
    };

    try {
        await addDoc(collection(db, "saved_places"), payload);

        // Reset form
        searchInput.value = '';
        notesInput.value = '';
        selectedPlace = null;
        tags = [];
        renderTags();
        const checked = document.querySelector('.category-rating input:checked');
        if (checked) checked.checked = false;

        btn.textContent = originalText;
        updateSaveBtn();

        showToast(status === 'visited' ? 'Visit saved! 🎉' : 'Added to Wishlist! 🔖', 'success');
        
        // If we saved a wishlist item, maybe switch to wishlist view?
        // switchView('wishlist'); 
    } catch (e) {
        console.error("Error saving:", e);
        btn.disabled = false;
        btn.textContent = originalText;
        showToast('Failed to save. Please try again.', 'error');
    }
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

function updateViews() {
    const visited = allPlaces.filter(p => !p.status || p.status === 'visited');
    const wishlist = allPlaces.filter(p => p.status === 'wishlist');

    renderHistory(visited);
    renderWishlist(wishlist);
    renderProfile(allPlaces);
    
    if (map) {
        updateMarkers();
    }
}

function renderCardActions(name, lat, lng) {
    const encodedName = encodeURIComponent(name);
    let uberLink = '';
    if (lat && lng) {
        uberLink = `<a href="https://m.uber.com/ul/?action=setPickup&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}&dropoff[nickname]=${encodedName}" target="_blank" class="action-link" title="Uber to restaurant">🚗 Uber</a>`;
    }
    const resyLink = `<a href="https://resy.com/search?query=${encodedName}" target="_blank" class="action-link" title="Search on Resy">🍷 Resy</a>`;
    const otLink = `<a href="https://www.opentable.com/s?searchTerm=${encodedName}" target="_blank" class="action-link" title="Search on OpenTable">🍽️ OpenTable</a>`;
    
    return `
        <div class="visit-card-actions">
            ${resyLink}
            ${otLink}
            ${uberLink}
        </div>
    `;
}

function renderHistory(visits) {
    historySection.querySelectorAll('.visit-card').forEach(c => c.remove());

    if (visits.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    visits.forEach(visit => {
        const card = document.createElement('div');
        card.className = 'visit-card';

        const stars = renderCategoryBadge(visit.user_rating);
        const date = visit.visited_at?.toDate ? formatDate(visit.visited_at.toDate()) : '';
        const tagsHtml = (visit.tags || []).map(t => `<span class="visit-tag">${escapeHtml(t)}</span>`).join('');

        card.innerHTML = `
            <div class="visit-card-header">
                <span class="visit-card-name">${escapeHtml(visit.name)}</span>
                <span class="visit-card-date">${date}</span>
            </div>
            ${stars ? `<div class="visit-card-stars">${stars}</div>` : ''}
            ${visit.notes ? `<p class="visit-card-notes">${escapeHtml(visit.notes)}</p>` : ''}
            ${tagsHtml ? `<div class="visit-card-tags">${tagsHtml}</div>` : ''}
            ${renderCardActions(visit.name, visit.lat, visit.lng)}
        `;

        historySection.appendChild(card);
    });
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
                return dist < 10; // Within 10km
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
            ${renderCardActions(place.name, place.lat, place.lng)}
        `;

        card.querySelector('.log-this-btn').addEventListener('click', () => {
            searchInput.value = place.name;
            selectedPlace = { ...place };
            switchView('feed');
            searchInput.focus();
            updateSaveBtn();
        });

        wishlistSection.appendChild(card);
    });
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

    const mapCenter = { lat: 40.7128, lng: -74.0060 }; // Default to NYC, will center on user
    
    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: mapCenter,
        disableDefaultUI: true,
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
    try {
        const pos = await getUserLocation();
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
        console.warn("Could not get location for map center");
    }

    updateMarkers();
}

function updateMarkers() {
    if (!map) return;

    // Clear existing
    markers.forEach(m => m.setMap(null));
    markers = [];

    const placesToPlot = showCircleMap ? circlePlaces : allPlaces;

    placesToPlot.forEach(place => {
        if (!place.lat || !place.lng) return;

        const isVisited = !place.status || place.status === 'visited';
        const color = isVisited ? '#f59e0b' : '#3b82f6'; // Gold vs Blue

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

        const savedBy = showCircleMap ? (currentCircle?.membersInfo?.[place.uid]?.displayName || 'Friend') : 'You';
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 10px; color: #fff;">
                    <strong style="display:block; margin-bottom: 5px;">${escapeHtml(place.name)}</strong>
                    <span style="font-size: 0.75rem; color: #aaa;">${isVisited ? '✅ Visited' : '📍 Wishlist'}</span>
                    <span style="display:block; font-size: 0.7rem; color: var(--accent); margin-top: 3px;">Saved by: ${escapeHtml(savedBy)}</span>
                </div>
            `
        });

        marker.addListener("click", () => {
            infoWindow.open(map, marker);
        });

        markers.push(marker);
    });
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
    const cuisines = visited.flatMap(v => v.types || []).filter(t => !['restaurant', 'food', 'point_of_interest', 'establishment'].includes(t));
    const counts = {};
    cuisines.forEach(c => counts[c] = (counts[c] || 0) + 1);
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
                <span class="stat-value">${topCuisine.replace(/_/g, ' ')}</span>
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

function calculateTasteScores(visited) {
    let spicy = 0, cozy = 0, casual = 0, healthy = 0, indulgent = 0;
    
    visited.forEach(v => {
        const text = ((v.notes || '') + ' ' + (v.tags || []).join(' ') + ' ' + (v.types || []).join(' ')).toLowerCase();
        
        if (/spicy|hot|curry|bold|mexican|indian|thai|szechuan|chili|jalapeno/i.test(text)) spicy += 20;
        if (/cozy|intimate|date|trendy|vibes|bar|drinks|cocktails|social|wine/i.test(text)) cozy += 20;
        if (/burger|street|pizza|casual|quick|cheap|diner|sandwich|taco|fast/i.test(text)) casual += 20;
        if (/vegan|salad|vegetarian|clean|sushi|seafood|healthy|fresh|poke|bowl/i.test(text)) healthy += 20;
        if (/bakery|dessert|sweet|chocolate|indulgent|pasta|cheese|cake|ice|pastry/i.test(text)) indulgent += 20;
        
        if (v.user_rating === 3) {
            if (/spicy|hot|curry|bold|mexican|indian|thai|szechuan/i.test(text)) spicy += 10;
            if (/cozy|intimate|date|trendy|vibes|bar|drinks|cocktails/i.test(text)) cozy += 10;
            if (/burger|street|pizza|casual|quick|cheap/i.test(text)) casual += 10;
            if (/vegan|salad|vegetarian|clean|sushi|healthy/i.test(text)) healthy += 10;
            if (/bakery|dessert|sweet|pasta|cheese/i.test(text)) indulgent += 10;
        }
    });

    const baseline = visited.length > 0 ? 15 : 0;
    return [
        Math.min(100, Math.max(baseline, spicy)),
        Math.min(100, Math.max(baseline, cozy)),
        Math.min(100, Math.max(baseline, casual)),
        Math.min(100, Math.max(baseline, healthy)),
        Math.min(100, Math.max(baseline, indulgent))
    ];
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
aiFab.addEventListener('click', () => {
    aiOverlay.classList.add('active');
    aiModal.classList.add('active');
});

aiOverlay.addEventListener('click', closeAiModal);

function closeAiModal() {
    aiOverlay.classList.remove('active');
    aiModal.classList.remove('active');
}

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

        // Package up history for the Cloud Function
        const recommend = httpsCallable(functions, 'recommend');
        const result = await recommend({
            lat,
            lng,
            message: userText,
            history: aiChatHistoryData
        });

        const data = result.data;
        const replyText = data.reply || "Here is what I found for you:";

        // Build HTML for the AI recommendations if returned
        let recsHtml = '';
        if (data.recommendations && data.recommendations.length > 0) {
            recsHtml += `<div class="recs-wrapper" style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.5rem;">`;
            data.recommendations.forEach(rec => {
                const stars = rec.google_rating ? `⭐ ${rec.google_rating}` : '';
                const openStatus = rec.is_open_now === true ? '🟢 Open now' : rec.is_open_now === false ? '🟡 Closed now' : '';
                const verified = rec.verified ? '✓ Verified' : '';
                const bookLinks = renderCardActions(rec.name, lat, lng);

                recsHtml += `
                    <div class="ai-rec-card" style="margin: 0; background: var(--bg-surface); border: 1px solid var(--border);">
                        <h4 style="font-size:0.9rem; font-weight:600; margin-bottom:0.25rem;">
                            ${escapeHtml(rec.name)} 
                            ${verified ? `<span style="font-size: 0.7rem; color: var(--success); font-weight: 500;">${verified}</span>` : ''}
                        </h4>
                        <p class="reasoning" style="font-size:0.78rem; line-height:1.4;">${escapeHtml(rec.reasoning)}</p>
                        ${rec.address ? `<p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">📍 ${escapeHtml(rec.address)}</p>` : ''}
                        <div class="rec-meta" style="font-size:0.7rem; margin-top:0.35rem;">
                            ${rec.cuisine ? `<span>🍽 ${escapeHtml(rec.cuisine)}</span>` : ''}
                            ${rec.price_range ? `<span>💰 ${escapeHtml(rec.price_range)}</span>` : ''}
                            ${stars ? `<span>${stars}</span>` : ''}
                            ${openStatus ? `<span>${openStatus}</span>` : ''}
                        </div>
                        ${bookLinks}
                    </div>
                `;
            });
            recsHtml += `</div>`;
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
const mapTogglePersonal = document.getElementById('map-toggle-personal');
const mapToggleCircle = document.getElementById('map-toggle-circle');

// Toggle map views
if (mapTogglePersonal && mapToggleCircle) {
    mapTogglePersonal.addEventListener('click', () => {
        if (!showCircleMap) return;
        showCircleMap = false;
        mapTogglePersonal.classList.add('active');
        mapToggleCircle.classList.remove('active');
        updateMarkers();
    });

    mapToggleCircle.addEventListener('click', () => {
        if (showCircleMap || mapToggleCircle.disabled) return;
        showCircleMap = true;
        mapToggleCircle.classList.add('active');
        mapTogglePersonal.classList.remove('active');
        updateMarkers();
    });
}

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
            if (mapToggleCircle) {
                mapToggleCircle.disabled = true;
                mapToggleCircle.classList.remove('active');
                mapToggleCircle.style.color = 'var(--text-muted)';
                mapToggleCircle.style.cursor = 'not-allowed';
            }
            if (showCircleMap) {
                showCircleMap = false;
                if (mapTogglePersonal) mapTogglePersonal.classList.add('active');
                updateMarkers();
            }
            renderCirclesUI();
            if (circlePlacesUnsubscribe) {
                circlePlacesUnsubscribe();
                circlePlacesUnsubscribe = null;
            }
            return;
        }

        const docSnap = snapshot.docs[0];
        currentCircle = { id: docSnap.id, ...docSnap.data() };
        
        // Enable map toggle
        if (mapToggleCircle) {
            mapToggleCircle.disabled = false;
            mapToggleCircle.style.color = 'var(--text-primary)';
            mapToggleCircle.style.cursor = 'pointer';
        }

        renderCirclesUI();
        listenToCirclePlaces();
    }, (error) => {
        console.error("Circle listener error:", error);
    });
}

function listenToCirclePlaces() {
    if (circlePlacesUnsubscribe) circlePlacesUnsubscribe();
    if (!currentCircle) return;

    const memberUids = Object.keys(currentCircle.members);
    
    if (memberUids.length === 0) return;

    const q = query(
        collection(db, "saved_places"),
        where("uid", "in", memberUids)
    );

    circlePlacesUnsubscribe = onSnapshot(q, (snapshot) => {
        circlePlaces = [];
        snapshot.forEach(doc => {
            circlePlaces.push({ id: doc.id, ...doc.data() });
        });

        if (showCircleMap) {
            updateMarkers();
        }
    }, (error) => {
        console.error("Circle places listener error:", error);
    });
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

        await addDoc(collection(db, "circles"), payload);
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
            enableHighAccuracy: false,
            timeout: 8000
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
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered successfully.', reg.scope))
            .catch(err => console.warn('Service Worker registration failed:', err));
    });
}
