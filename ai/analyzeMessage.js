import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function analyzeMessage(text) {
const prompt = `
You're an assistant that analyzes Slack messages to determine if they contain a **design sport-related task**, such as a request for a new banner or asset based on a sports bet, match, player, or betting odds change.

Your job is to:
1. Understand all sports betting terminology and abbreviations like BTTS (Both Teams To Score), 1X2, Over/Under, Anytime Goalscorer, etc.
2. Detect if the message is **implicitly or explicitly** a request to create a sport-related asset (e.g., "GH: Franculino...").
3. Infer intent even if the message doesn't say "make banner", but includes odds, match details, player names, bet types, or changes in values (e.g., from 2.07 > 2.40).
4. Be sensitive to abbreviations and league/team names like BOB, CA Banfield, FC Midtjylland, etc.
5. Only respond if the message seems like a banner or creative task, not just a general discussion or betting chat.

Message:
"${text}"

Reply in valid JSON:
{
  "isTask": true or false,
  "summary": "Short description of what the task seems to be, such as 'Banner for Franculino anytime goalscorer with new odds vs Soenderjyske'"
}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return { isTask: false };
  }
}