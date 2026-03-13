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

    const systemPrompt = `You are the matching engine for Melba, a couples intimacy app.
Given a user's preferences and an episode library, return the single best episode match.

MATCHING RULES (apply in order):
1. Mood match first (CONNECTION > PLAYFUL > SENSUAL > INTENSE — softer wins on conflict)
2. Topics match second — at least one topic must overlap
3. Who is guided — prefer BOTH; otherwise match who_leads
4. Spice: 1=🌶️, 2=🌶️🌶️, 3=🌶️🌶️🌶️ — default to lower on conflict
5. Prefer latest=true on ties

OUTPUT: ONLY valid JSON, no preamble, no markdown fences:
{"episode_id":"...","episode_name":"...","reason":"2 warm sentences to the couple, e.g. Tonight feels like... — intimate, never clinical"}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Preferences: ${JSON.stringify(preferences)}\n\nEpisodes: ${JSON.stringify(episodes)}\n\nReturn best match as JSON.`
      }],
    });

    const clean = message.content[0].text.trim().replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(clean);
    const matchedEp = episodes.find((e) => e.id === result.episode_id) || {};

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        episode_id: result.episode_id,
        episode_name: result.episode_name || matchedEp.name,
        reason: result.reason,
        image: matchedEp.image || "",
        spice: matchedEp.spice || "🌶️",
        practice_tags: matchedEp.practice_tags || [],
        duration: matchedEp.duration || "",
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
