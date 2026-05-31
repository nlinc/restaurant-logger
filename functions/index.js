const { onCall } = require("firebase-functions/v2/https");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore } = require("firebase-admin/firestore");
const { initializeApp } = require("firebase-admin/app");

initializeApp();
const db = getFirestore();
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const mapsApiKey = defineSecret("MAPS_API_KEY");

exports.recommend = onCall({ secrets: [geminiApiKey, mapsApiKey], cors: true, invoker: "public" }, async (request) => {
    try {
        // Auth check
        if (!request.auth) {
            throw new Error("User must be authenticated.");
        }

        const uid = request.auth.uid;
        const { lat, lng, message, history } = request.data;

        // Fetch user's visit history
        const snapshot = await db
            .collection("saved_places")
            .where("uid", "==", uid)
            .orderBy("visited_at", "desc")
            .limit(50)
            .get();

        const visits = [];
        const wishlist = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.status || data.status === 'visited') {
                visits.push(data);
            } else if (data.status === 'wishlist') {
                wishlist.push(data);
            }
        });

        if (visits.length === 0 && wishlist.length === 0) {
            return {
                reply: "You haven't logged any visits or saved any wishlist items yet! Start by searching for a few places, and I'll learn your taste profile.",
                recommendations: []
            };
        }

        // Build taste profile
        const allTags = visits.flatMap(v => v.tags || []);
        const allTypes = visits.flatMap(v => v.types || []);
        const topRated = visits
            .filter(v => v.user_rating && v.user_rating >= 4)
            .map(v => `${v.name} (${v.user_rating}★, tags: ${(v.tags || []).join(", ") || "none"})`)
            .slice(0, 10);
        const visitedIds = visits.map(v => v.place_id).filter(Boolean);

        const tagCounts = {};
        allTags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
        const topTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([tag, count]) => `${tag} (${count}x)`);

        const typeCounts = {};
        allTypes.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
        const topTypes = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type]) => type);

        const wishlistSummary = wishlist.map(w => `${w.name} (${(w.tags || []).join(", ") || "no tags"})`).slice(0, 10);

        const locationContext = lat && lng
            ? `The user is currently located at latitude ${lat}, longitude ${lng}. Prioritize recommendations near this location.`
            : "No location provided. Give general recommendations based on taste profile.";

        const activeMessage = message || "Recommend 2-3 NEW restaurants for me.";
        const historyText = (history || []).map(h => `${h.role === 'user' ? 'User' : 'Concierge'}: ${h.parts?.[0]?.text || ''}`).join('\n');

        const apiKey = geminiApiKey.value();
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `You are a dining concierge AI for the "Lincoln Eats" app named "Lincoln".

TASK: You are having an interactive chat with the user. Help them with their specific dining query: "${activeMessage}". Recommend 2-3 NEW restaurants if appropriate, or answer their direct questions about their taste profile or places in their area.

CONVERSATION HISTORY:
${historyText || "No chat history yet."}

USER TASTE PROFILE:
- Total visits logged: ${visits.length}
- Wishlist items: ${wishlist.length}
- Top-rated places: ${topRated.join("; ") || "None rated 4+ stars yet"}
- Favorite tags: ${topTags.join(", ") || "No tags yet"}
- Frequent cuisine types: ${topTypes.join(", ") || "Mixed"}
- Average user rating: ${(visits.reduce((s, v) => s + (v.user_rating || 0), 0) / visits.filter(v => v.user_rating).length || 0).toFixed(1)}

USER WISHLIST (Potential places they want to try):
${wishlistSummary.join("; ") || "None yet"}

${locationContext}

ALREADY VISITED (do NOT recommend these):
${visits.map(v => v.name).join(", ")}

RULES:
1. Respond to the user's latest query or selected mood in a warm, helpful conversational tone.
2. Recommend REAL, existing restaurants matching their likely area.
3. If they asked a general question (e.g., "what's my top cuisine?"), answer it accurately based on their profile. You don't necessarily have to return new recommendations if their query doesn't warrant it, but if you don't return recommendations, leave the "recommendations" array empty in the JSON output.
4. Each recommendation must include a specific "reasoning" on why they would enjoy it (1-2 sentences).
5. If you do not have enough location context to find real physical places, suggest specific cuisine styles or famous neighborhoods instead.

OUTPUT: Return ONLY valid JSON matching this schema:
{
  "reply": "Your warm, helpful conversational response to the user's latest message (1-3 sentences max).",
  "recommendations": [
    {
      "name": "Restaurant Name",
      "cuisine": "Cuisine Type",
      "price_range": "$$ or $$$ etc.",
      "reasoning": "Why this matches their profile or latest request (1-2 sentences)"
    }
  ]
}
Return ONLY valid JSON without Markdown formatting brackets.`;

        // Call Gemini with retry logic
        const MAX_RETRIES = 2;
        let responseText;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`Attempt ${attempt + 1} with gemini-2.5-flash`);
                const result = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: prompt,
                });
                responseText = result.text;
                break;
            } catch (err) {
                const status = err.status || err.code;
                console.warn(`Attempt ${attempt + 1} failed (${status}): ${err.message?.substring(0, 200)}`);

                if (status === 429) {
                    return {
                        reply: "✨ The AI is at its daily limit. This resets automatically — try again soon!",
                        recommendations: []
                    };
                }

                if (status === 503 && attempt < MAX_RETRIES) {
                    const delay = (attempt + 1) * 3000;
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                throw err;
            }
        }

        if (!responseText) {
            return {
                reply: "✨ The AI is temporarily busy. Please try again in a minute!",
                recommendations: []
            };
        }

        let jsonResponse;
        try {
            // Strip markdown fences and any thinking/preamble text
            let cleaned = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();

            // Extract the JSON object: find first { to last }
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }

            jsonResponse = JSON.parse(cleaned);
        } catch (e) {
            console.warn("Failed to parse Gemini JSON:", e.message, "Raw:", responseText.substring(0, 200));
            jsonResponse = {
                reply: responseText,
                recommendations: []
            };
        }

        // Validate recommendations against Google Places API
        if (jsonResponse.recommendations && jsonResponse.recommendations.length > 0) {
            const apiKey = mapsApiKey.value();
            const validated = [];

            for (const rec of jsonResponse.recommendations) {
                try {
                    // Step 1: Find the place using just the name (no cuisine to avoid wrong matches)
                    const findParams = new URLSearchParams({
                        input: rec.name,
                        inputtype: 'textquery',
                        fields: 'place_id',
                        key: apiKey
                    });

                    if (lat && lng) {
                        findParams.set('locationbias', `circle:8000@${lat},${lng}`);
                    }

                    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${findParams}`;
                    const findRes = await fetch(findUrl);
                    const findData = await findRes.json();

                    if (findData.candidates && findData.candidates.length > 0) {
                        const placeId = findData.candidates[0].place_id;

                        // Step 2: Get full details including business_status
                        const detailParams = new URLSearchParams({
                            place_id: placeId,
                            fields: 'place_id,name,business_status,rating,formatted_address,opening_hours',
                            key: apiKey
                        });

                        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?${detailParams}`;
                        const detailRes = await fetch(detailUrl);
                        const detailData = await detailRes.json();
                        const place = detailData.result;

                        if (!place || place.business_status === 'CLOSED_PERMANENTLY') {
                            console.log(`Filtered out ${rec.name}: permanently closed`);
                            continue;
                        }

                        validated.push({
                            ...rec,
                            verified: true,
                            google_rating: place.rating || null,
                            address: place.formatted_address || null,
                            is_open_now: place.opening_hours?.open_now ?? null,
                            place_id: place.place_id
                        });
                    } else {
                        // Place not found in Google — still include but mark unverified
                        validated.push({ ...rec, verified: false });
                    }
                } catch (err) {
                    console.warn(`Places API check failed for ${rec.name}:`, err.message);
                    validated.push({ ...rec, verified: false });
                }
            }

            jsonResponse.recommendations = validated;
        }

        return jsonResponse;
    } catch (error) {
        console.error("recommend error:", error);
        throw new Error(error.message);
    }
});

exports.scanReceipt = onCall({ secrets: [geminiApiKey], cors: true, invoker: "public" }, async (request) => {
    try {
        if (!request.auth) {
            throw new Error("User must be authenticated.");
        }

        const { base64, mimeType } = request.data;
        if (!base64 || !mimeType) {
            throw new Error("Base64 string and mimeType are required.");
        }

        const apiKey = geminiApiKey.value();
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Analyze this uploaded image (which is a restaurant receipt or menu) and extract:
1. The restaurant's name.
2. An inferred dining rating on our 1 to 3 scale (3: Loved it / High spending/great dishes, 2: Good/standard, 1: Disliked/Skip it). If you can't tell, default to 2.
3. Relevant cuisine tags (e.g. "sushi", "tacos", "italian", "dessert") and dining style tags (e.g., "brunch", "fine-dining", "dinner"). Output 2-4 tags.
4. Auto-generated friendly visit notes based on the items listed in the receipt or dishes on the menu (e.g., "Ordered the spicy tuna roll and truffle fries. Spent $45. Great quick dinner!").
5. The price level (1: Cheap, 2: Moderate, 3: Expensive, 4: Ultra Luxury).
6. Estimated address or area if visible, otherwise null.

OUTPUT: Return ONLY a valid JSON object matching this schema, without Markdown formatting brackets:
{
  "restaurantName": "Name of Restaurant",
  "rating": 3,
  "tags": ["tag1", "tag2"],
  "notes": "What was ordered / visit summary",
  "priceLevel": 2,
  "address": "Street Address if visible, otherwise null",
  "suggestedCuisines": ["cuisine_type_1", "cuisine_type_2"]
}`;

        // Call Gemini with multimodal support
        console.log("Calling gemini-2.5-flash with image content...");
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    inlineData: {
                        data: base64,
                        mimeType: mimeType
                    }
                },
                prompt
            ]
        });

        const responseText = result.text;
        if (!responseText) {
            throw new Error("Gemini returned an empty response.");
        }

        let cleaned = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        return JSON.parse(cleaned);

    } catch (error) {
        console.error("scanReceipt error:", error);
        return { error: error.message };
    }
});
