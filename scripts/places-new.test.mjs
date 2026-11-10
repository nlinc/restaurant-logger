import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    autocompletePlaceToLocation,
    autocompletePlaceToSavedPlace,
    configureAutocompleteElement,
    createAutocompleteSelectionHandler,
    normalizeAutocompletePriceLevel,
    setAutocompleteLocationBias
} from '../public/js/places-new.js';

const require = createRequire(import.meta.url);
const {
    PLACES_FIELD_MASK,
    PLACES_TEXT_SEARCH_URL,
    isEligibleRecommendationPlace,
    normalizePlacesNewPlace,
    priceLevelsThrough,
    searchPlacesText
} = require('../functions/places-new.js');

const response = (data, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    json: async () => data
});

const newPlace = (overrides = {}) => ({
    id: 'place-1',
    displayName: { text: 'Juniper Table' },
    businessStatus: 'OPERATIONAL',
    rating: 4.7,
    formattedAddress: '1 Castro St, Mountain View, CA',
    currentOpeningHours: { openNow: true },
    location: { latitude: 37.39, longitude: -122.08 },
    types: ['restaurant', 'food'],
    priceLevel: 'PRICE_LEVEL_MODERATE',
    ...overrides
});

test('Text Search New sends one field-masked POST and normalizes full place data', async () => {
    const calls = [];
    const places = await searchPlacesText({
        apiKey: 'synthetic-key',
        textQuery: 'Juniper Table restaurant',
        lat: 37.39,
        lng: -122.08,
        radiusMeters: 8047,
        pageSize: 5,
        fetcher: async (...args) => {
            calls.push(args);
            return response({ places: [newPlace()] });
        }
    });

    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, PLACES_TEXT_SEARCH_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Goog-Api-Key'], 'synthetic-key');
    assert.equal(options.headers['X-Goog-FieldMask'], PLACES_FIELD_MASK);
    assert.deepEqual(JSON.parse(options.body), {
        textQuery: 'Juniper Table restaurant',
        includedType: 'restaurant',
        pageSize: 5,
        locationBias: {
            circle: {
                center: { latitude: 37.39, longitude: -122.08 },
                radius: 8047
            }
        }
    });
    assert.deepEqual(places, [{
        place_id: 'place-1',
        name: 'Juniper Table',
        business_status: 'OPERATIONAL',
        google_rating: 4.7,
        address: '1 Castro St, Mountain View, CA',
        is_open_now: true,
        types: ['restaurant', 'food'],
        price_level: 2,
        lat: 37.39,
        lng: -122.08
    }]);
});

test('fallback Text Search preserves open-now, budget ceiling, distance bias, and ranking', async () => {
    let body;
    await searchPlacesText({
        apiKey: 'synthetic-key',
        textQuery: 'restaurants',
        lat: 37.39,
        lng: -122.08,
        radiusMeters: 90000,
        openNow: true,
        maximumPriceLevel: 2,
        pageSize: 99,
        rankPreference: 'DISTANCE',
        fetcher: async (_url, options) => {
            body = JSON.parse(options.body);
            return response({ places: [] });
        }
    });
    assert.deepEqual(body.priceLevels, ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE']);
    assert.equal(body.openNow, true);
    assert.equal(body.rankPreference, 'DISTANCE');
    assert.equal(body.pageSize, 20);
    assert.equal(body.locationBias.circle.radius, 50000);
});

test('Text Search surfaces provider failures without leaking response details', async () => {
    await assert.rejects(() => searchPlacesText({
        apiKey: 'synthetic-key',
        textQuery: 'restaurants',
        fetcher: async () => response({ error: { status: 'PERMISSION_DENIED', message: 'secret detail' } }, { ok: false, status: 403 })
    }), /Places Text Search failed \(PERMISSION_DENIED\)/);
});

test('Places New response normalization keeps absent values explicit', () => {
    assert.deepEqual(priceLevelsThrough(4), [
        'PRICE_LEVEL_INEXPENSIVE',
        'PRICE_LEVEL_MODERATE',
        'PRICE_LEVEL_EXPENSIVE',
        'PRICE_LEVEL_VERY_EXPENSIVE'
    ]);
    assert.equal(priceLevelsThrough(null), undefined);
    assert.deepEqual(normalizePlacesNewPlace({ id: 'minimal', displayName: { text: 'Minimal' } }), {
        place_id: 'minimal',
        name: 'Minimal',
        business_status: '',
        google_rating: null,
        address: '',
        is_open_now: null,
        types: [],
        price_level: null,
        lat: null,
        lng: null
    });
});

test('hard recommendation validation preserves circle, status, feedback, lane, price, and dedupe rules', () => {
    const base = {
        place_id: 'candidate',
        name: 'Candidate Cafe',
        business_status: 'OPERATIONAL',
        is_open_now: true,
        price_level: 2,
        lat: 37.39,
        lng: -122.08
    };
    const context = {
        lane: 'new',
        mode: 'three_lanes',
        lat: 37.39,
        lng: -122.08,
        maxDistanceKm: 8,
        priceLevel: 2,
        visitedIds: new Set(),
        visitedNames: new Set(),
        dismissedIds: new Set(),
        dismissedNames: new Set(),
        recentIds: new Set(),
        recentNames: new Set(),
        seenPlaceIds: new Set()
    };
    assert.equal(isEligibleRecommendationPlace(base, context), true);
    assert.equal(isEligibleRecommendationPlace({ ...base, lat: 38 }, context), false, 'outside exact circle');
    assert.equal(isEligibleRecommendationPlace({ ...base, business_status: 'CLOSED_PERMANENTLY' }, context), false);
    assert.equal(isEligibleRecommendationPlace({ ...base, is_open_now: false }, context), false);
    assert.equal(isEligibleRecommendationPlace({ ...base, price_level: 3 }, context), false);
    assert.equal(isEligibleRecommendationPlace(base, { ...context, seenPlaceIds: new Set(['candidate']) }), false);
    assert.equal(isEligibleRecommendationPlace(base, { ...context, dismissedNames: new Set(['candidate cafe']) }), false);
    assert.equal(isEligibleRecommendationPlace(base, { ...context, recentIds: new Set(['candidate']) }), false);
    assert.equal(isEligibleRecommendationPlace(base, { ...context, visitedIds: new Set(['candidate']) }), false);
    assert.equal(isEligibleRecommendationPlace(base, { ...context, lane: 'reliable', visitedIds: new Set(['candidate']) }), true);
    assert.equal(isEligibleRecommendationPlace({ ...base, price_level: null }, context), true, 'unknown price remains eligible');
});

test('autocomplete adapters preserve saved-place and manual-location contracts', () => {
    const place = {
        id: 'widget-place',
        displayName: 'Cafe Orbit',
        rating: 4.5,
        formattedAddress: '2 Hope St',
        priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
        types: ['cafe'],
        location: { lat: () => 40.1, lng: () => -73.9 }
    };
    assert.equal(normalizeAutocompletePriceLevel('PRICE_LEVEL_INEXPENSIVE'), 1);
    assert.deepEqual(autocompletePlaceToSavedPlace(place), {
        place_id: 'widget-place',
        name: 'Cafe Orbit',
        google_rating: 4.5,
        types: ['cafe'],
        address: '2 Hope St',
        price_level: 1,
        lat: 40.1,
        lng: -73.9
    });
    assert.deepEqual(autocompletePlaceToLocation(place), {
        lat: 40.1,
        lng: -73.9,
        label: '2 Hope St',
        source: 'manual',
        accuracy: null
    });
    assert.throws(() => autocompletePlaceToSavedPlace({ id: 'missing-location' }), /suggestion list/);
});

test('autocomplete selection requests only declared fields and ignores stale races', async () => {
    const selected = [];
    const errors = [];
    const pending = new Map();
    const handler = createAutocompleteSelectionHandler({
        fields: ['id', 'displayName', 'location'],
        normalize: place => place.id,
        onSelect: value => selected.push(value),
        onError: error => errors.push(error.message)
    });
    const eventFor = id => ({
        placePrediction: {
            toPlace: () => ({
                id,
                fetchFields: ({ fields }) => new Promise(resolve => {
                    assert.deepEqual(fields, ['id', 'displayName', 'location']);
                    pending.set(id, resolve);
                })
            })
        }
    });

    const first = handler(eventFor('first'));
    const second = handler(eventFor('second'));
    pending.get('second')();
    await second;
    pending.get('first')();
    await first;
    assert.deepEqual(selected, ['second']);
    assert.deepEqual(errors, []);
});

test('latest autocomplete failure is reported while an older failure is ignored', async () => {
    const errors = [];
    const handler = createAutocompleteSelectionHandler({
        fields: ['location'],
        normalize: place => place,
        onSelect: () => assert.fail('failed selections must not complete'),
        onError: error => errors.push(error.message)
    });
    const deferred = {};
    const first = handler({ placePrediction: { toPlace: () => ({
        fetchFields: () => new Promise((_, reject) => { deferred.reject = reject; })
    }) } });
    await handler({ placePrediction: { toPlace: () => ({
        fetchFields: async () => { throw new Error('latest failed'); }
    }) } });
    deferred.reject(new Error('stale failed'));
    await first;
    assert.deepEqual(errors, ['latest failed']);
});

test('autocomplete invalidation ignores details that resolve after user edits or app resets', async () => {
    const selected = [];
    const errors = [];
    let resolveFields;
    const handler = createAutocompleteSelectionHandler({
        fields: ['id', 'location'],
        normalize: place => place.id,
        onSelect: value => selected.push(value),
        onError: error => errors.push(error.message)
    });
    const pending = handler({
        placePrediction: {
            toPlace: () => ({
                id: 'stale-place',
                fetchFields: () => new Promise(resolve => { resolveFields = resolve; })
            })
        }
    });

    handler.invalidate();
    resolveFields();
    await pending;
    assert.deepEqual(selected, []);
    assert.deepEqual(errors, []);
});

test('widget configuration preserves primary types, selection listener, and soft bias', () => {
    const listeners = new Map();
    const element = {
        addEventListener: (name, listener) => listeners.set(name, listener)
    };
    const selection = () => {};
    configureAutocompleteElement(element, {
        includedPrimaryTypes: ['restaurant', 'cafe', 'bar'],
        onSelection: selection
    });
    setAutocompleteLocationBias(element, { lat: 37.39, lng: -122.08 }, 8047);
    assert.deepEqual(element.includedPrimaryTypes, ['restaurant', 'cafe', 'bar']);
    assert.equal(listeners.get('gmp-select'), selection);
    assert.deepEqual(element.locationBias, {
        center: { lat: 37.39, lng: -122.08 },
        radius: 8047
    });
});

test('runtime source has no legacy Places endpoints and cache versions move together', async () => {
    const [functionsSource, appSource, html, worker] = await Promise.all([
        readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
        readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
        readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
        readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
    ]);
    assert.doesNotMatch(functionsSource, /findplacefromtext|nearbysearch|place\/details\/json/);
    assert.doesNotMatch(appSource, /places\.Autocomplete\(|place_changed|getPlace\(\)/);
    assert.match(html, /gmp-place-autocomplete id="restaurant-search"/);
    assert.match(html, /gmp-place-autocomplete id="location-override-search"/);
    assert.match(html, /css\/styles\.css\?v=27/);
    assert.match(html, /js\/app\.js\?v=27/);
    assert.match(appSource, /firebase-config\.js\?v=27/);
    assert.match(appSource, /places-new\.js\?v=27/);
    assert.match(appSource, /sw\.js\?v=27/);
    assert.match(worker, /lincoln-eats-v27/);
    assert.match(worker, /'\/js\/places-new\.js'/);
});
