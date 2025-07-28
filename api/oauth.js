// /api/oauth.js – spracovanie Slack OAuth callbacku
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Missing code" });
  }

  const client_id = process.env.SLACK_CLIENT_ID;
  const client_secret = process.env.SLACK_CLIENT_SECRET;

  const result = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      code,
      redirect_uri: "https://sm-alpha.vercel.app/api/oauth",
    }),
  });

  const data = await result.json();

  if (!data.ok) {
    return res.status(500).json({ error: "OAuth failed", details: data });
  }

  // Vypíš token alebo ho môžeš uložiť do DB
  console.log("✅ OAuth success:", data);

  return res.status(200).send("OAuth successful, you can close this window.");
}
