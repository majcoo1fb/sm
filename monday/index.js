import axios from "axios";

// ✅ Vytvorenie tasku pri novej Slack správe
export async function createTask(summary, slackUser, slackLink) {
  const columnValues = {
    text_mkt8cqag: slackUser,                         // Author (text)
    status: { label: "Working on it" },               // Status
    date4: { date: new Date().toISOString().split("T")[0] }, // Create Date
    // Slack link môžeš pridať ak máš link column
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
    if (!data) console.error("❌ Monday API response:", res.data);
    return data;
  } catch (err) {
    console.error("❌ Error while creating task:", err.response?.data || err.message);
    return null;
  }
}

// ✅ Označenie tasku ako dokončeného po doručení obrázka
export async function completeTask(taskId, slackUserId, timestamp, createdAt) {
  const finishDate = new Date(timestamp * 1000).toISOString().split("T")[0];
  const gapSeconds = Math.floor((timestamp * 1000 - new Date(createdAt).getTime()) / 1000);

  const columnValues = {
    status: { label: "Done" },                        // Status na Done
    date_mkt86fjx: { date: finishDate },              // Finish Date
    duration_mkt8v8yq: { duration: gapSeconds },      // Gap v sekundách
    text_mkt8jq0t: String(slackUserId),               // Designer (ako text)
  };

  const query = `
    mutation {
      change_multiple_column_values(
        item_id: ${taskId},
        board_id: ${process.env.MONDAY_BOARD_ID},
        column_values: "${JSON.stringify(columnValues).replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  try {
    await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("❌ Error while completing task:", err.response?.data || err.message);
  }
}
