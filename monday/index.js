import axios from "axios";

// ✅ Vytvorenie tasku pri Slack správe
export async function createTask(summary, slackUser, slackLink) {
  const columnValues = {
    text_mkt8cqag: slackUser, // Author (text)
    status: { label: "Working on it" },
    date4: { date: new Date().toISOString().split("T")[0] }, // Create Date
  };

  const query = `
    mutation {
      create_item(
        board_id: ${process.env.MONDAY_BOARD_ID},
        item_name: "${summary}",
        column_values: "${JSON.stringify(columnValues).replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  try {
    const res = await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const data = res.data?.data?.create_item;
    if (!data) {
      console.error("❌ Monday API error (createTask):", JSON.stringify(res.data, null, 2));
    } else {
      console.log("✅ Task created:", data);
    }
    return data;
  } catch (err) {
    console.error("❌ Axios error (createTask):", err.response?.data || err.message);
    return null;
  }
}

// ✅ Dokončenie tasku po dodaní obrázka
export async function completeTask(taskId, slackUserId, timestamp, createdAt) {
  if (!taskId || !timestamp || !createdAt) {
    console.error("❌ Missing arguments in completeTask");
    return;
  }

  const finishDate = new Date(timestamp * 1000).toISOString().split("T")[0];
  const gapSeconds = Math.floor((timestamp * 1000 - new Date(createdAt).getTime()) / 1000);

  const columnValues = {
    status: { label: "Done" },
    date_mkt86fjx: { date: finishDate },
    duration_mkt8v8yq: { duration: gapSeconds },
    text_mkt8jq0t: String(slackUserId), // Designer as text
  };

  const query = `
    mutation {
      change_multiple_column_values(
        board_id: ${process.env.MONDAY_BOARD_ID},
        item_id: ${taskId},
        column_values: "${JSON.stringify(columnValues).replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  console.log("📤 Sending completeTask query to Monday...");
  console.log("🧾 Query:", query);

  try {
    const res = await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });

    if (res.data.errors) {
      console.error("❌ Monday API error (completeTask):", JSON.stringify(res.data.errors, null, 2));
    } else {
      console.log("✅ Task updated successfully:", res.data.data.change_multiple_column_values);
    }
  } catch (err) {
    console.error("❌ Axios error (completeTask):", err.response?.data || err.message);
  }
}
