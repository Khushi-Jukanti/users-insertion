const mongoose = require('mongoose');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// 🔥 IMPORT YOUR ACTUAL USER MODEL
const User = require('./User'); // <-- FIX PATH

// const MONGO_URI = "mongodb://monekluvyausr:TVqtQ161DGvlrT3bqXCmdGXrp@13.235.17.54:27017/mongekluvyastgdb";
const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";

// 🔥 DOB PARSER
function parseDOB(rawDob) {
  if (rawDob === undefined || rawDob === null || rawDob === "") {
    return null;
  }

  if (rawDob instanceof Date) {
    if (isNaN(rawDob.getTime())) {
      throw new Error(`Invalid DOB value: ${rawDob}`);
    }

    const dd = String(rawDob.getDate()).padStart(2, "0");
    const mm = String(rawDob.getMonth() + 1).padStart(2, "0");
    const yyyy = String(rawDob.getFullYear());

    return {
      dateObj: rawDob,
      formatted: `${dd}-${mm}-${yyyy}`
    };
  }

  if (typeof rawDob === "number") {
    const parsedFromExcel = XLSX.SSF.parse_date_code(rawDob);

    if (!parsedFromExcel) {
      throw new Error(`Invalid DOB value: ${rawDob}`);
    }

    const dd = String(parsedFromExcel.d).padStart(2, "0");
    const mm = String(parsedFromExcel.m).padStart(2, "0");
    const yyyy = String(parsedFromExcel.y);

    return {
      dateObj: new Date(parsedFromExcel.y, parsedFromExcel.m - 1, parsedFromExcel.d),
      formatted: `${dd}-${mm}-${yyyy}`
    };
  }

  const dobStr = rawDob.toString().trim();
  const parts = dobStr.split(/[-/.\s]+/);

  if (parts.length !== 3) throw new Error(`Invalid DOB format: ${dobStr}`);

  const [first, second, third] = parts;

  if (!first || !second || !third) {
    throw new Error(`Invalid DOB structure: ${dobStr}`);
  }

  let dd;
  let mm;
  let yyyy;

  if (first.length === 4) {
    yyyy = first;
    mm = second.padStart(2, "0");
    dd = third.padStart(2, "0");
  } else {
    dd = first.padStart(2, "0");
    mm = second.padStart(2, "0");
    yyyy = third;
  }

  if (yyyy.length !== 4) {
    throw new Error(`Invalid DOB structure: ${dobStr}`);
  }

  const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

  if (
    isNaN(parsed.getTime()) ||
    parsed.getDate() !== Number(dd) ||
    parsed.getMonth() !== Number(mm) - 1 ||
    parsed.getFullYear() !== Number(yyyy)
  ) {
    throw new Error(`Invalid DOB value: ${dobStr}`);
  }

  return {
    dateObj: parsed,
    formatted: `${dd}-${mm}-${yyyy}`
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

function getRowValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  return null;
}

function buildEmail(row, username) {
  const rawEmail = normalizeValue(row.email);

  if (rawEmail) {
    return rawEmail.toLowerCase();
  }

  return null;
}

function buildPhone(row) {
  const phoneKeys = [
    "phone",
    "Phone",
    "mobile",
    "Mobile",
    "mobile_no",
    "mobileNo",
    "mobile_number",
    "Mobile No",
    "Mobile No.",
    "mobile no",
    "Phone Number",
    "phone_number"
  ];

  for (const key of phoneKeys) {
    const rawPhone = normalizeValue(row[key]);

    if (!rawPhone) {
      continue;
    }

    const normalizedPhone = rawPhone.replace(/\.0+$/, "");
    const digitsOnly = normalizedPhone.replace(/\D/g, "");

    return digitsOnly || null;
  }

  return null;
}

async function ensureEmailIndexAllowsNulls() {
  const indexes = await User.collection.indexes();
  const emailIndex = indexes.find(index => index.name === "email_1");
  const expectedPartialFilter = { email: { $type: "string" } };

  if (
    emailIndex &&
    (
      emailIndex.unique !== true ||
      JSON.stringify(emailIndex.partialFilterExpression) !== JSON.stringify(expectedPartialFilter)
    )
  ) {
    await User.collection.dropIndex("email_1");
  }

  await User.collection.createIndex(
    { email: 1 },
    {
      unique: true,
      partialFilterExpression: expectedPartialFilter
    }
  );
}

async function run() {
  await mongoose.connect(MONGO_URI);
  await ensureEmailIndexAllowsNulls();

  const workbook = XLSX.readFile(path.join(__dirname, "kaism_students.xlsx"), {
    cellDates: true
  });
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
      const dobValue = row.dob;
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
        phone: buildPhone(row),

        school_code: schoolCode,
        school_name: normalizeValue(getRowValue(row, ["school name", "school_name", "School Name", "schoolName"])),
        school_address: normalizeValue(getRowValue(row, ["school address", "school_address", "School Address", "schoolAddress"])),
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

  fs.writeFileSync(path.join(__dirname, "user_mapping_Sloka_Teachers_Tukkuguda.csv"), csv);

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
