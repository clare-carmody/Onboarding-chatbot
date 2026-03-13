const Anthropic = require("@anthropic-ai/sdk");

function parsePreferences(answers) {
  const moodMap = {
    "🤍 Tender, want to reconnect": "CONNECTION",
    "😄 Playful, light mood": "PLAYFUL",
    "🔥 Turned on, ready": "SENSUAL",
    "✨ Curious, open to something new": "PLAYFUL",
  };
  const topicMap = {
    "🕯️ Slow touch & massage": ["EROTIC_MASSAGE", "MINDFUL_AND_CONNECTED"],
    "💋 Oral pleasure": ["ORAL_PLEASURE"],
    "🎭 Power, roleplay, sensation": ["POWER_AND_CONTROL", "ROLE_PLAYING", "SENSORY_PLAY"],
    "🔄 New positions together": ["NEW_SEX_POSITIONS", "MINDFUL_AND_CONNECTED"],
  };
  const leadsMap = {
    "🌸 Be guided": "BOTH",
    "⚡ Take the lead": "HIM",
    "🫶 Discover together": "BOTH",
  };
  const spiceMap = {
    "🌶️ Soft & intimate": 1,
    "🌶️🌶️ A little spicy": 2,
    "🌶️🌶️🌶️ Turn it up": 3,
  };
  return {
    mood: moodMap[answers.mood] || "SENSUAL",
    topics: topicMap[answers.experience] || ["MINDFUL_AND_CONNECTED"],
    who_leads: leadsMap[answers.leads] || "BOTH",
    spice_level: spiceMap[answers.spice] || 1,
  };
}

// Fallback: pick best episode using JS logic if Claude returns a hallucinated ID
function fallbackMatch(preferences, episodes) {
  const moodOrder = ["CONNECTION", "PLAYFUL", "SENSUAL", "INTENSE"];
  const spiceEmoji = ["🌶️", "🌶️🌶️", "🌶️🌶️🌶️"];
  const targetSpice = spiceEmoji[preferences.spice_level - 1] || "🌶️";

  let scored = episodes.map((ep) => {
    let score = 0;
    // Mood match
    if (ep.mood === preferences.mood) score += 30;
    else {
      const diff = Math.abs(moodOrder.indexOf(ep.mood) - moodOrder.indexOf(preferences.mood));
      score += Math.max(0, 15 - diff * 5);
    }
    // Topic overlap
    const overlap = ep.topics.filter((t) => preferences.topics.includes(t)).length;
    score += overlap * 15;
    // Who is guided
    if (ep.who_is_guided === "BOTH") score += 10;
    else if (ep.who_is_guided === preferences.who_leads) score += 8;
    // Spice match
    if (ep.spice === targetSpice) score += 10;
    else if (ep.spice < targetSpice) score += 5;
    // Latest bonus
    if (ep.latest) score += 3;
    return { ep, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].ep;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    const { answers, episodes } = JSON.parse(event.body);
    const preferences = parsePreferences(answers);
    const client = new Anthropic();

    // Build a compact episode list for the prompt (id + key fields only)
    const episodeList = episodes.map((e) => ({
      id: e.id,
      name: e.name,
      mood: e.mood,
      topics: e.topics,
      who_is_guided: e.who_is_guided,
      spice: e.spice,
    }));

    const validIds = new Set(episodes.map((e) => e.id));

    const systemPrompt = `You are the matching engine for Melba, a couples intimacy app.
You will receive a user's preferences and a list of real episodes.

CRITICAL RULES:
- You MUST return an episode_id that exists EXACTLY in the provided episode list.
- NEVER invent, modify, or guess an episode ID. Copy it character-for-character from the list.
- If unsure, pick the closest match from the list rather than creating a new one.

MATCHING RULES (apply in order):
1. Mood match first (CONNECTION > PLAYFUL > SENSUAL > INTENSE — softer wins on conflict)
2. Topics match second — prefer episodes where at least one topic overlaps
3. Who is guided — prefer BOTH; otherwise match who_leads preference
4. Spice level: 1=🌶️, 2=🌶️🌶️, 3=🌶️🌶️🌶️ — default to lower on conflict

OUTPUT: ONLY valid JSON, no preamble, no markdown:
{"episode_id":"<exact id from the list>","reason":"2 warm sentences to the couple. Start with 'Tonight' or 'You both'. Intimate, never clinical."}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `User preferences: ${JSON.stringify(preferences)}\n\nEpisode list:\n${JSON.stringify(episodeList, null, 2)}\n\nReturn JSON with episode_id (must be from the list above) and reason.`
      }],
    });

    const clean = message.content[0].text.trim().replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(clean);

    // Validate: if Claude hallucinated an ID, use JS fallback
    let matchedEp;
    if (result.episode_id && validIds.has(result.episode_id)) {
      matchedEp = episodes.find((e) => e.id === result.episode_id);
    } else {
      console.warn("Claude returned invalid episode_id:", result.episode_id, "— using fallback");
      matchedEp = fallbackMatch(preferences, episodes);
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        episode_id: matchedEp.id,
        episode_name: matchedEp.name,
        reason: result.reason || "Tonight is the perfect moment to explore something beautiful together.",
        image: matchedEp.image || "",
        spice: matchedEp.spice || "🌶️",
        practice_tags: matchedEp.practice_tags || [],
        who_is_guided: matchedEp.who_is_guided || "",
      }),
    };
  } catch (err) {
    console.error("Match error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
