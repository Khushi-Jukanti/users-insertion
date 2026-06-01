const axios = require("axios");
const fs = require("fs");

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NmYzZDQxYzBjNDc1ZjFlMzdlMTVlNDEiLCJ1c2VybmFtZSI6ImpHa0tKbWVPa2kiLCJlbWFpbCI6Im90dGFkbWluQGVrbHV2eWEuZ3VydSIsImlzX3N1cGVyYWRtaW4iOnRydWUsImlhdCI6MTc3NjY3NTE5NCwiZXhwIjoxNzc5Nzg1NTk0fQ.Kgr8Ks-nIAZcAZ70d9rFsanniMMlIy5InXBiAT2dfVk";
const FILE = "user_passwords.txt";

const MAX_RETRIES = 2;

// 🔥 load mapping
function loadData() {
  const lines = fs.readFileSync(FILE, "utf-8").split("\n");

  const seen = new Set();
  const data = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const [username, password] = line.split(",");

    if (!username || !password) continue;

    if (seen.has(username)) {
      console.log("⚠️ Duplicate skipped:", username);
      continue;
    }

    seen.add(username);

    data.push({
      username: username.trim(),
      password: password.trim()
    });
  }

  return data;
}

// 🔥 API call with retry
async function changePassword(user, attempt = 1) {
  try {
    const res = await axios.post(
      "https://ottapi.ekluvya.guru/users/api/v1/auth/change-password-admin",
      {
        username: user.username,
        password: user.password,
        password_confirmation: user.password
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    return { success: true };

  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      console.log(`🔁 Retry ${user.username}`);
      return changePassword(user, attempt + 1);
    }

    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}

async function run() {
  const users = loadData();

  console.log("Total users:", users.length);

  const success = [];
  const failed = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    console.log(`🔄 ${i + 1}/${users.length} → ${user.username}`);

    const result = await changePassword(user);

    if (result.success) {
      success.push(user);
    } else {
      failed.push({ user, error: result.error });
    }
  }

  fs.writeFileSync("success.json", JSON.stringify(success, null, 2));
  fs.writeFileSync("failed_pass.json", JSON.stringify(failed, null, 2));

  console.log("\n✅ Done");
  console.log("Success:", success.length);
  console.log("Failed:", failed.length);
}

run();