const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DEFAULT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NmYzZDQxYzBjNDc1ZjFlMzdlMTVlNDEiLCJ1c2VybmFtZSI6ImpHa0tKbWVPa2kiLCJlbWFpbCI6Im90dGFkbWluQGVrbHV2eWEuZ3VydSIsImlzX3N1cGVyYWRtaW4iOnRydWUsImlhdCI6MTc4MTU4NzY3MCwiZXhwIjoxNzg0Njk4MDcwfQ.5J58vjc6XFcF5eHXUnksDSjngTKSPMuoba_d2Ui08iA";
const TOKEN = process.env.EKLUVYA_TOKEN || DEFAULT_TOKEN;
const PLAN_ID = "6a1e795e9b62646258f7b71c"; // SR1 plan ID
// const PLAN_ID = "6a1e795e9b62646258f7b71c";

const FILE_PATH = "class7.txt"; // IDs file

const BATCH_SIZE = 150;
const MAX_RETRIES = 2;
const SUCCESS_DIR = path.join(__dirname, "success");
const FAILED_DIR = path.join(__dirname, "failed");

function loadIds() {
  return fs.readFileSync(FILE_PATH, "utf-8")
    .split("\n")
    .map(id => id.replace(/["',]/g, "").trim())
    .filter(id => id.length === 24);
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  if (!payload) return null;

  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(
    normalizedPayload.length + ((4 - normalizedPayload.length % 4) % 4),
    "="
  );

  return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf-8"));
}

function getTokenExpiry(token) {
  try {
    const payload = decodeJwtPayload(token);
    return payload?.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

function getErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || JSON.stringify(error);
}

function shouldRetry(err) {
  const statusCode = err.response?.status || err.response?.data?.statusCode;
  return statusCode !== 401 && statusCode !== 403;
}

async function callAPI(userIds, attempt = 1) {
  try {
    const res = await axios.post(
      "https://ottapi.ekluvya.guru/payment/api/v1/payments/admin/bulk-subscription",
      {
        user_ids: userIds,
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
    const error = err.response?.data || err.message;

    if (attempt <= MAX_RETRIES && shouldRetry(err)) {
      console.log(`Retry attempt ${attempt}: ${getErrorMessage(error)}`);
      return callAPI(userIds, attempt + 1);
    }

    return {
      success: false,
      error
    };
  }
}

async function run() {
  const tokenExpiry = getTokenExpiry(TOKEN);
  if (tokenExpiry) {
    console.log("Token expires at:", tokenExpiry.toISOString());
  }

  const ids = loadIds();

  if (ids.length === 0) {
    console.log("No valid IDs found");
    return;
  }

  console.log("Total IDs:", ids.length);

  const batches = chunkArray(ids, BATCH_SIZE);

  const successLog = [];
  const failedLog = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`\nBatch ${i + 1}/${batches.length}`);

    const result = await callAPI(batches[i]);

    if (result.success) {
      const resData = result.data.response;

      console.log("Success:", resData);

      successLog.push({
        batch: i + 1,
        users: batches[i],
        response: resData
      });

      if (resData.failed > 0) {
        failedLog.push({
          batch: i + 1,
          errors: result.data.response.errors
        });
      }
    } else {
      console.log("Batch failed completely:", getErrorMessage(result.error));

      failedLog.push({
        batch: i + 1,
        users: batches[i],
        error: result.error
      });
    }
  }

  fs.mkdirSync(SUCCESS_DIR, { recursive: true });
  fs.mkdirSync(FAILED_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SUCCESS_DIR, "success_log_Sloka_Teachers_Tukkuguda.json"),
    JSON.stringify(successLog, null, 2)
  );
  fs.writeFileSync(
    path.join(FAILED_DIR, "failed_log_Sloka_Teachers_Tukkuguda.json"),
    JSON.stringify(failedLog, null, 2)
  );

  console.log("\nDONE");
  console.log("Success log saved");
  console.log("Failed log saved");
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
