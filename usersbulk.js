const mongoose = require('mongoose');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// IMPORT YOUR ACTUAL USER MODEL
const User = require('./User'); // <-- FIX PATH

// const MONGO_URI = "mongodb://monekluvyausr:TVqtQ161DGvlrT3bqXCmdGXrp@13.235.17.54:27017/mongekluvyastgdb";
const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";

function normalizeKey(key) {
  return key.toString().trim().toLowerCase().replace(/[\s_.-]+/g, "");
}

function getRowValue(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  const normalizedEntries = Object.keys(row).map(key => [normalizeKey(key), row[key]]);
  const normalizedKeyMap = new Map(normalizedEntries);

  for (const key of possibleKeys) {
    const normalizedKey = normalizeKey(key);

    if (normalizedKeyMap.has(normalizedKey)) {
      return normalizedKeyMap.get(normalizedKey);
    }
  }

  return undefined;
}

// DOB PARSER
function parseDOB(rawDob) {
  if (rawDob === undefined || rawDob === null || rawDob === "") {
    return null;
  }

  if (rawDob instanceof Date) {
    if (isNaN(rawDob.getTime())) {
      throw new Error(`Invalid DOB value: ${rawDob}`);
    }

    return rawDob;
  }

  if (typeof rawDob === "number") {
    const parsedFromExcel = XLSX.SSF.parse_date_code(rawDob);

    if (!parsedFromExcel) {
      throw new Error(`Invalid DOB value: ${rawDob}`);
    }

    return new Date(
      parsedFromExcel.y,
      parsedFromExcel.m - 1,
      parsedFromExcel.d
    );
  }

  const dobStr = rawDob.toString().trim();
  const parts = dobStr.split(/[-/.\s]+/);

  if (parts.length !== 3) {
    throw new Error(`Invalid DOB format: ${dobStr}`);
  }

  const [first, second, third] = parts;

  if (!first || !second || !third) {
    throw new Error(`Invalid DOB structure: ${dobStr}`);
  }

  if (first.length === 4) {
    const parsed = new Date(
      Number(first),
      Number(second) - 1,
      Number(third)
    );

    if (
      isNaN(parsed.getTime()) ||
      parsed.getDate() !== Number(third) ||
      parsed.getMonth() !== Number(second) - 1 ||
      parsed.getFullYear() !== Number(first)
    ) {
      throw new Error(`Invalid DOB value: ${dobStr}`);
    }

    return parsed;
  }

  const dd = first.padStart(2, "0");
  const mm = second.padStart(2, "0");
  const yyyy = third;
  const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

  if (
    yyyy.length !== 4 ||
    isNaN(parsed.getTime()) ||
    parsed.getDate() !== Number(dd) ||
    parsed.getMonth() !== Number(mm) - 1 ||
    parsed.getFullYear() !== Number(yyyy)
  ) {
    throw new Error(`Invalid DOB value: ${dobStr}`);
  }

  return parsed;
}

// GENDER MAPPING
function mapGender(gender) {
  if (!gender) return null;

  const g = gender.toString().trim().toLowerCase();

  if (g === "male") return "1";
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
  const rawEmail = normalizeValue(
    getRowValue(row, ["email", "Email", "email_id", "Email ID", "E-mail"])
  );

  if (rawEmail) {
    return rawEmail.toLowerCase();
  }

  // The production collection has a unique index on `email`, so multiple
  // `null` values will fail. Use a deterministic placeholder for students
  // who do not have a real email address.
  return `${username.toLowerCase()}@students.ekluvya.local`;
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
    const rawPhone = normalizeValue(getRowValue(row, [key]));

    if (!rawPhone) {
      continue;
    }

    const normalizedPhone = rawPhone.replace(/\.0+$/, "");
    const digitsOnly = normalizedPhone.replace(/\D/g, "");

    return digitsOnly || null;
  }

  return null;
}

function buildUsername(schoolCode, admissionNumber) {
  return `${schoolCode}_${admissionNumber}`;
}

function buildTempPassword(row, schoolCode, admissionNumber) {
  const rawPassword = normalizeValue(
    getRowValue(row, ["password", "Password"])
  );

  return rawPassword || `${schoolCode}@${admissionNumber}`;
}

function escapeCsv(value) {
  if (value === undefined || value === null) return "";

  const stringValue = value.toString();

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

async function run() {
  await mongoose.connect(MONGO_URI);

  const workbook = XLSX.readFile(path.join(__dirname, "kaism_students.xlsx"), {
    cellDates: true
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const users = [];
  const failedRows = [];
  const seenUsernames = new Set();
  const seenEmails = new Set();

  for (const row of data) {
    try {
      const schoolCode = normalizeValue(
        getRowValue(row, ["school_code", "School Code"])
      );
      const admissionNumber = normalizeValue(
        getRowValue(row, ["admission_number", "Admission Number", "admission no", "admission_no"])
      );
      const firstName = normalizeValue(
        getRowValue(row, ["first_name", "First Name", "firstname", "name"])
      );
      const email = normalizeValue(
        getRowValue(row, ["email", "Email", "email_id", "Email ID", "E-mail"])
      )?.toLowerCase();
      const dobValue = getRowValue(row, ["dob", "DOB", "date_of_birth", "Date of Birth"]);

      if (!schoolCode) {
        throw new Error("school_code missing");
      }

      if (!admissionNumber) {
        throw new Error("admission_number missing");
      }

      if (!firstName) {
        throw new Error("first_name missing");
      }

      if (!email) {
        throw new Error("email missing");
      }

      if (seenEmails.has(email)) {
        throw new Error(`duplicate email in sheet: ${email}`);
      }

      seenEmails.add(email);

      const username = buildUsername(schoolCode, admissionNumber);
      const tempPassword = buildTempPassword(row, schoolCode, admissionNumber);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      if (seenUsernames.has(username)) {
        throw new Error(`duplicate username in sheet: ${username}`);
      }

      seenUsernames.add(username);

      users.push({
        username,
        user_type: "b2b",

        first_name: firstName,
        last_name: normalizeValue(
          getRowValue(row, ["last_name", "Last Name", "lastname"])
        ),

        email,
        phone: buildPhone(row),

        school_code: schoolCode,
        branch: normalizeValue(getRowValue(row, ["branch", "Branch"])),
        class: normalizeValue(getRowValue(row, ["class", "Class"])),
        section: normalizeValue(getRowValue(row, ["section", "Section"])),
        preparing_for: normalizeValue(
          getRowValue(row, ["preparing_for", "Preparing For"])
        ),

        password: hashedPassword,
        must_change_password: 1,

        dob: dobValue ? parseDOB(dobValue) : null,
        gender: mapGender(getRowValue(row, ["gender", "Gender"])),

        // CRITICAL DEFAULTS (backup even if schema exists)
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

        temp_password: tempPassword,
        created_at: new Date(),
        updated_at: new Date()
      });

    } catch (err) {
      failedRows.push({
        username: normalizeValue(
          getRowValue(row, ["admission_number", "Admission Number", "admission no", "admission_no"])
        ) || normalizeValue(
          getRowValue(row, ["email", "Email", "email_id", "Email ID", "E-mail"])
        ) || "UNKNOWN",
        error: err.message
      });
    }
  }

  if (users.length === 0) {
    throw new Error("No valid users to insert");
  }

  const existingUsers = await User.find(
    {
      $or: [
        { username: { $in: users.map(user => user.username) } },
        { email: { $in: users.map(user => user.email) } }
      ]
    },
    { username: 1, email: 1 }
  ).lean();

  const existingUsernameSet = new Set(
    existingUsers.map(user => user.username).filter(Boolean)
  );
  const existingEmailSet = new Set(
    existingUsers.map(user => user.email).filter(Boolean)
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

    if (existingEmailSet.has(user.email)) {
      failedRows.push({
        username: user.email,
        error: "email already exists in database"
      });
      continue;
    }

    newUsers.push(user);
  }

  if (newUsers.length === 0) {
    throw new Error("No new users to insert; all rows already exist or failed validation");
  }

  // INSERT USING MONGOOSE (IMPORTANT)
  const insertedUsers = await User.insertMany(newUsers);

  // CREATE MAPPING
  const mapping = insertedUsers.map(user => ({
    firstname: user.first_name,
    email: user.email,
    username: user.username,
    temp_password: user.temp_password,
    school_code: user.school_code,
    user_id: user._id.toString()
  }));

  // EXPORT SUCCESS
  let csv = "firstname,email,username,temp_password,school_code,user_id\n";
  mapping.forEach(row => {
    csv += `${escapeCsv(row.firstname)},${escapeCsv(row.email)},${escapeCsv(row.username)},${escapeCsv(row.temp_password)},${escapeCsv(row.school_code)},${escapeCsv(row.user_id)}\n`;
  });

  fs.writeFileSync(path.join(__dirname, "MahendraTeachers2.csv"), csv);

  // EXPORT FAILURES
  if (failedRows.length > 0) {
    let errorCsv = "username,error\n";
    failedRows.forEach(row => {
      errorCsv += `${row.username},${row.error}\n`;
    });
    fs.writeFileSync(path.join(__dirname, "failed_rows.csv"), errorCsv);
  }

  console.log("Users inserted:", insertedUsers.length);
  console.log("Mapping file created");

  if (failedRows.length > 0) {
    console.log("Failed rows file created");
  }

  process.exit();
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
