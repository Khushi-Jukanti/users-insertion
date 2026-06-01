const mongoose = require('mongoose');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// 🔥 IMPORT YOUR ACTUAL USER MODEL
const User = require('./User'); // <-- FIX PATH

const MONGO_URI = "mongodb://monekluvyausr:TVqtQ161DGvlrT3bqXCmdGXrp@13.235.17.54:27017/mongekluvyastgdb";
// const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";

// 🔥 DOB PARSER
function parseDOB(dobStr) {
  const parts = dobStr.split('-');

  if (parts.length !== 3) throw new Error(`Invalid DOB format: ${dobStr}`);

  const [dd, mm, yyyy] = parts;

  if (
    !dd || !mm || !yyyy ||
    dd.length !== 2 ||
    mm.length !== 2 ||
    yyyy.length !== 4
  ) {
    throw new Error(`Invalid DOB structure: ${dobStr}`);
  }

  const isoDate = `${yyyy}-${mm}-${dd}`;
  const parsed = new Date(isoDate);

  if (isNaN(parsed)) throw new Error(`Invalid DOB value: ${dobStr}`);

  return {
    dateObj: parsed,
    formatted: `${dd}-${mm}-${yyyy}` // used for password
  };
}

// 🔥 GENDER MAPPING
function mapGender(gender) {
  if (!gender) return null;

  const g = gender.toString().trim().toLowerCase();

  if (g === "male") return "1";     // match your working DB (STRING)
  if (g === "female") return "2";
  if (g === "other" || g === "others") return "3";

  return null;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;

  const trimmed = value.toString().trim();
  return trimmed === "" ? null : trimmed;
}

function buildEmail(row, username) {
  const rawEmail = normalizeValue(row.email);

  if (rawEmail) {
    return rawEmail.toLowerCase();
  }

  // The production collection has a unique index on `email`, so multiple
  // `null` values will fail. Use a deterministic placeholder for students
  // who do not have a real email address.
  return `${username.toLowerCase()}@students.ekluvya.local`;
}

async function run() {
  await mongoose.connect(MONGO_URI);

  const workbook = XLSX.readFile(path.join(__dirname, "kaism_students.xlsx"));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const users = [];
  const failedRows = [];
  const seenUsernames = new Set();

  for (const row of data) {
    try {
      const rawPassword = normalizeValue(row.password);

      if (!rawPassword) {
        throw new Error("password missing");
      }

      const hashedPassword = await bcrypt.hash(rawPassword, 10);

      if (!row.admission_number) {
        throw new Error("admission_number missing");
      }

      const schoolCode = normalizeValue(row.school_code);
      const admissionNumber = normalizeValue(row.admission_number);

      if (!schoolCode) {
        throw new Error("school_code missing");
      }

      const username = `${schoolCode}_${admissionNumber}`;
      const dobValue = normalizeValue(row.dob);
      const parsedDOB = dobValue ? parseDOB(dobValue).dateObj : null;

      if (seenUsernames.has(username)) {
        throw new Error(`duplicate username in sheet: ${username}`);
      }

      seenUsernames.add(username);

      users.push({
        username,
        user_type: "b2b",

        first_name: normalizeValue(row.first_name),
        last_name: normalizeValue(row.last_name),

        email: buildEmail(row, username),
        phone: null,

        school_code: schoolCode,
        branch: normalizeValue(row.branch),
        class: normalizeValue(row.class),
        section: normalizeValue(row.section),
        preparing_for: normalizeValue(row.preparing_for),

        password: hashedPassword,
        must_change_password: 1,

        dob: parsedDOB,
        gender: mapGender(row.gender),

        // 🔥 CRITICAL DEFAULTS (backup even if schema exists)
        profile_picture: "",
        roles_user: [],
        studio_user: [],

        notification_status: 1,
        notify_videos: 1,
        notify_newsletter: 1,
        notify_email: 1,

        coins: 0,
        is_coins_credited: 0,
        device_limit: 0,

        access_otp_token: null,
        expiry_at: null,
        otp_hit_count: 0,
        otp: 0,

        is_email_verified: 0,
        is_phone_verified: 0,
        is_active: 1,
        is_archived: 0,

        is_partner_blocked: 0,
        is_contact_sync: 0,
        is_fbsync: 0,

        push_notification_status: 2,
        email_notification_status: 2,

        auth_methods: ["password"],
        login_type: "password",

        created_at: new Date(),
        updated_at: new Date()
      });

    } catch (err) {
      failedRows.push({
        username: row.admission_number || "UNKNOWN",
        error: err.message
      });
    }
  }

  if (users.length === 0) {
    throw new Error("No valid users to insert");
  }

  const existingUsers = await User.find(
    { username: { $in: users.map(user => user.username) } },
    { username: 1 }
  ).lean();

  const existingUsernameSet = new Set(
    existingUsers.map(user => user.username).filter(Boolean)
  );

  const newUsers = [];

  for (const user of users) {
    if (existingUsernameSet.has(user.username)) {
      failedRows.push({
        username: user.username,
        error: "username already exists in database"
      });
      continue;
    }

    newUsers.push(user);
  }

  if (newUsers.length === 0) {
    throw new Error("No new users to insert; all rows already exist or failed validation");
  }

  // 🔥 INSERT USING MONGOOSE (IMPORTANT)
  const insertedUsers = await User.insertMany(newUsers);

  // 🔥 CREATE MAPPING
  const mapping = insertedUsers.map(user => ({
    firstname: user.first_name,
    username: user.username,
    school_code: user.school_code,
    user_id: user._id.toString()
  }));

  // 🔥 EXPORT SUCCESS
  let csv = "username,school_code,user_id\n";
  mapping.forEach(row => {
    csv += `${row.firstname},${row.username},${row.school_code},${row.user_id}\n`;
  });

  fs.writeFileSync(path.join(__dirname, "user_mapping_grade_remap3.csv"), csv);

  // 🔥 EXPORT FAILURES
  if (failedRows.length > 0) {
    let errorCsv = "username,error\n";
    failedRows.forEach(row => {
      errorCsv += `${row.username},${row.error}\n`;
    });
    fs.writeFileSync(path.join(__dirname, "failed_rows.csv"), errorCsv);
  }

  console.log("✅ Users inserted:", insertedUsers.length);
  console.log("📄 Mapping file created");

  if (failedRows.length > 0) {
    console.log("⚠️ Failed rows file created");
  }

  process.exit();
}

run().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
