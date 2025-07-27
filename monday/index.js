import axios from "axios";

// ✅ Vytvorenie tasku
export async function createTask(summary, slackUser, slackLink) {
  const columnValues = {
    text_mkt8cqag: slackUser, // Author (text)
    status: { label: "Working on it" },
    date4: { date: new Date().toISOString().split("T")[0] },
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
      console.error("❌ Monday API response (createTask):", JSON.stringify(res.data, null, 2));
    } else {
      console.log("✅ Task created:", data);
    }
    return data;
  } catch (err) {
    console.error("❌ Error while creating task:", err.response?.data || err.message);
    return null;
  }
}

// ✅ Dokončenie tasku
export async function completeTask(taskId, slackUserName, timestamp, createdAt) {
  if (!taskId || !timestamp || !createdAt) {
    console.error("❌ Missing required parameters in completeTask()");
    return;
  }

  const finishDate = new Date(timestamp * 1000).toISOString().split("T")[0];
  const gapSeconds = Math.floor((timestamp * 1000 - new Date(createdAt).getTime()) / 1000);

  const columnValues = {
    status: { label: "Done" },
    date_mkt86fjx: { date: finishDate },
    duration_mkt8v8yq: { duration: gapSeconds },
    text_mkt8jq0t: String(slackUserName || "missing"),
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

  // 🧾 Debug log
  console.log("📤 Monday Query:");
  console.log(query);

  try {
    const res = await axios.post("https://api.monday.com/v2", { query }, {
      headers: {
        Authorization: process.env.MONDAY_API_KEY,
        "Content-Type": "application/json",
      },
    });

    console.log("📦 Monday Response:");
    console.log(JSON.stringify(res.data, null, 2));

    if (res.data.errors) {
      console.error("❌ GraphQL Errors:", res.data.errors);
    } else {
      console.log("✅ Task updated successfully:", res.data.data.change_multiple_column_values);
    }
  } catch (err) {
    console.error("❌ Error while completing task:", err.response?.data || err.message);
  }
}
