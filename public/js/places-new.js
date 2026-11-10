const PRICE_LEVEL_NUMBERS = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4
};

export function normalizeAutocompletePriceLevel(value) {
    return Number.isFinite(value) ? value : PRICE_LEVEL_NUMBERS[value] ?? null;
}

function coordinates(place) {
    const lat = typeof place.location?.lat === 'function' ? place.location.lat() : place.location?.lat;
    const lng = typeof place.location?.lng === 'function' ? place.location.lng() : place.location?.lng;
    return { lat, lng };
}

export function autocompletePlaceToSavedPlace(place) {
    const { lat, lng } = coordinates(place);
    if (!place?.id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Choose a restaurant from the suggestion list.');
    }
    return {
        place_id: place.id,
        name: place.displayName || 'Selected restaurant',
        google_rating: Number.isFinite(place.rating) ? place.rating : null,
        types: Array.isArray(place.types) ? place.types : [],
        address: place.formattedAddress || '',
        price_level: normalizeAutocompletePriceLevel(place.priceLevel),
        lat,
        lng
    };
}

export function autocompletePlaceToLocation(place) {
    const { lat, lng } = coordinates(place);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Choose a location from the suggestion list.');
    }
    return {
        lat,
        lng,
        label: String(place.formattedAddress || place.displayName || 'Selected location').slice(0, 160),
        source: 'manual',
        accuracy: null
    };
}

export function createAutocompleteSelectionHandler({ fields, normalize, onSelect, onError }) {
    let latestSelection = 0;
    const handleSelection = async event => {
        const selection = ++latestSelection;
        try {
            const place = event?.placePrediction?.toPlace?.();
            if (!place) throw new Error('Choose a suggestion from the list.');
            await place.fetchFields({ fields });
            if (selection !== latestSelection) return;
            await onSelect(normalize(place));
        } catch (error) {
            if (selection === latestSelection) onError(error);
        }
    };
    handleSelection.invalidate = () => { latestSelection += 1; };
    return handleSelection;
}

export function configureAutocompleteElement(element, { includedPrimaryTypes, onSelection }) {
    if (includedPrimaryTypes?.length) element.includedPrimaryTypes = includedPrimaryTypes;
    element.addEventListener('gmp-select', onSelection);
    return element;
}

export function setAutocompleteLocationBias(element, location, radiusMeters) {
    if (!element || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return;
    element.locationBias = {
        center: { lat: location.lat, lng: location.lng },
        radius: Math.min(50000, Math.max(1, radiusMeters))
    };
}

export function installLocalPlacesPreviewProvider(windowObject = window) {
    if (!['localhost', '127.0.0.1'].includes(windowObject.location.hostname)) {
        throw new Error('Synthetic Places provider is restricted to localhost.');
    }
    if (!windowObject.customElements.get('gmp-place-autocomplete')) {
        class SyntheticPlaceAutocompleteElement extends windowObject.HTMLElement {
            constructor() {
                super();
                const root = this.attachShadow({ mode: 'open' });
                root.innerHTML = `
                    <style>
                        :host { display: block; min-width: 0; position: relative; width: 100%; }
                        input { background: transparent; border: 0; box-sizing: border-box; color: inherit; font: inherit; min-height: 42px; outline: 0; padding: 0 0.8rem; width: 100%; }
                        [role="listbox"] { background: #172019; border: 1px solid #59685d; border-radius: 8px; box-shadow: 0 12px 24px #0008; display: none; left: 0; padding: 0.25rem; position: absolute; right: 0; top: calc(100% + 4px); z-index: 500; }
                        :host([data-open]) [role="listbox"] { display: grid; }
                        button { background: transparent; border: 0; border-radius: 6px; color: #f4f6f4; font: inherit; padding: 0.65rem; text-align: left; }
                        button:focus, button:hover { background: #2b382e; outline: 0; }
                    </style>
                    <input autocomplete="off">
                    <div role="listbox"></div>
                `;
                this.input = root.querySelector('input');
                this.listbox = root.querySelector('[role="listbox"]');
                this.input.addEventListener('input', () => this.renderSuggestions());
                this.input.addEventListener('keydown', event => {
                    const options = [...this.listbox.querySelectorAll('button')];
                    if (event.key === 'ArrowDown' && options.length) {
                        event.preventDefault();
                        options[0].focus();
                    }
                });
                this.listbox.addEventListener('keydown', event => {
                    const options = [...this.listbox.querySelectorAll('button')];
                    const index = options.indexOf(root.activeElement);
                    if (event.key === 'ArrowDown' && index < options.length - 1) {
                        event.preventDefault();
                        options[index + 1].focus();
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        (options[index - 1] || this.input).focus();
                    } else if (event.key === 'Escape') {
                        this.removeAttribute('data-open');
                        this.input.focus();
                    }
                });
            }

            connectedCallback() {
                this.input.placeholder = this.getAttribute('placeholder') || '';
                this.input.setAttribute('aria-label', this.getAttribute('aria-label') || 'Place search');
            }

            get value() { return this.input?.value || ''; }
            set value(next) { if (this.input) this.input.value = next || ''; }
            focus() { this.input?.focus(); }

            suggestions() {
                return this.id === 'location-override-search'
                    ? [
                        { id: 'synthetic-location', name: 'Mountain View, CA', address: 'Mountain View, CA', lat: 37.3861, lng: -122.0839 },
                        { id: 'synthetic-slow-location', name: 'Slow Location', address: 'Slow Location, CA', lat: 37.4, lng: -122.1, delay: 100 }
                    ]
                    : [
                        { id: 'synthetic-restaurant', name: 'Juniper Table', address: '1 Castro St, Mountain View, CA', lat: 37.389, lng: -122.081, rating: 4.7, priceLevel: 'PRICE_LEVEL_MODERATE', types: ['restaurant'] },
                        { id: 'synthetic-slow-restaurant', name: 'Slow Restaurant', address: '2 Castro St, Mountain View, CA', lat: 37.39, lng: -122.082, rating: 4.4, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', types: ['restaurant'], delay: 100 },
                        { id: 'synthetic-failure', name: 'Provider Failure', failure: true }
                    ];
            }

            renderSuggestions() {
                this.listbox.replaceChildren();
                if (!this.input.value.trim()) {
                    this.removeAttribute('data-open');
                    return;
                }
                this.suggestions().forEach(suggestion => {
                    const option = document.createElement('button');
                    option.type = 'button';
                    option.setAttribute('role', 'option');
                    option.textContent = suggestion.name;
                    option.addEventListener('click', () => this.selectSuggestion(suggestion));
                    this.listbox.appendChild(option);
                });
                this.setAttribute('data-open', '');
            }

            selectSuggestion(suggestion) {
                this.value = suggestion.name;
                this.removeAttribute('data-open');
                const event = new Event('gmp-select');
                event.placePrediction = {
                    toPlace: () => ({
                        id: suggestion.id,
                        displayName: suggestion.name,
                        formattedAddress: suggestion.address || '',
                        location: suggestion.lat == null ? null : { lat: suggestion.lat, lng: suggestion.lng },
                        rating: suggestion.rating,
                        priceLevel: suggestion.priceLevel,
                        types: suggestion.types || [],
                        fetchFields: async () => {
                            if (suggestion.delay) await new Promise(resolve => setTimeout(resolve, suggestion.delay));
                            if (suggestion.failure) throw new Error('Synthetic provider failure.');
                        }
                    })
                };
                this.dispatchEvent(event);
            }
        }
        windowObject.customElements.define('gmp-place-autocomplete', SyntheticPlaceAutocompleteElement);
    }
    windowObject.google = windowObject.google || {};
    windowObject.google.maps = windowObject.google.maps || {};
    windowObject.google.maps.importLibrary = async () => ({
        PlaceAutocompleteElement: windowObject.customElements.get('gmp-place-autocomplete')
    });
}
