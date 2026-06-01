const axios = require("axios");
const fs = require("fs");

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NmYzZDQxYzBjNDc1ZjFlMzdlMTVlNDEiLCJ1c2VybmFtZSI6ImpHa0tKbWVPa2kiLCJlbWFpbCI6Im90dGFkbWluQGVrbHV2eWEuZ3VydSIsImlzX3N1cGVyYWRtaW4iOnRydWUsImlhdCI6MTc3ODQzMTMyOCwiZXhwIjoxNzgxNTQxNzI4fQ.U5ayvfWHVTVq-Fy3qYJAssXKotxXFouCB7th0rtV2DU";
const PLAN_ID = "68ad5a79188ac01e47cf6d09";
const FILE_PATH = "class7.txt"; // your IDs file

const BATCH_SIZE = 150;
const MAX_RETRIES = 2;

// 🔥 clean + load IDs
function loadIds() {
  return fs.readFileSync(FILE_PATH, "utf-8")
    .split("\n")
    .map(id => id.replace(/["',]/g, "").trim())
    .filter(id => id.length === 24);
}

// 🔥 chunking
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// 🔥 API call with retry
async function callAPI(user_ids, attempt = 1) {
  try {
    const res = await axios.post(
      "https://ottapi.ekluvya.guru/payment/api/v1/payments/admin/bulk-subscription",
      {
        user_ids,
        plan_id: PLAN_ID
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    return { success: true, data: res.data };

  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      console.log(`🔁 Retry attempt ${attempt}...`);
      return callAPI(user_ids, attempt + 1);
    }

    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}

async function run() {
  const ids = loadIds();

  if (ids.length === 0) {
    console.log("❌ No valid IDs found");
    return;
  }

  console.log("Total IDs:", ids.length);

  const batches = chunkArray(ids, BATCH_SIZE);

  const successLog = [];
  const failedLog = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`\n🚀 Batch ${i + 1}/${batches.length}`);

    const result = await callAPI(batches[i]);

    if (result.success) {
      const resData = result.data.response;

      console.log("✅ Success:", resData);

      successLog.push({
        batch: i + 1,
        users: batches[i],
        response: resData
      });

      // track failed inside API response
      if (resData.failed > 0) {
        failedLog.push({
          batch: i + 1,
          errors: result.data.response.errors
        });
      }

    } else {
      console.log("❌ Batch failed completely");

      failedLog.push({
        batch: i + 1,
        users: batches[i],
        error: result.error
      });
    }
  }

  // 🔥 write logs
  fs.writeFileSync("success_log_SR5.json", JSON.stringify(successLog, null, 2));
  fs.writeFileSync("failed_log.json", JSON.stringify(failedLog, null, 2));

  console.log("\n🎯 DONE");
  console.log("✅ Success log saved");
  console.log("❌ Failed log saved");
}

run();