const mongoose = require('mongoose');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// IMPORT YOUR ACTUAL USER MODEL
const User = require('./User'); // <-- FIX PATH

// const MONGO_URI = "mongodb://monekluvyausr:TVqtQ161DGvlrT3bqXCmdGXrp@13.235.17.54:27017/mongekluvyastgdb";
const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";
const INPUT_FILE = "kaism_students.xlsx";
const OUTPUT_CSV = "user_mapping_Mahendra_School.csv";
const FAILED_CSV = "failed_rows.csv";

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

function formatDateForCsv(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);

  if (isNaN(date.getTime())) return null;

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());

  return `${dd}-${mm}-${yyyy}`;
}

function csvValue(value) {
  const normalized = value === undefined || value === null ? "null" : value.toString();
  return `"${normalized.replace(/"/g, '""')}"`;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];

  rows.forEach(row => {
    lines.push(headers.map(header => csvValue(row[header])).join(","));
  });

  return `${lines.join("\n")}\n`;
}

async function run() {
  await mongoose.connect(MONGO_URI);

  const workbook = XLSX.readFile(path.join(__dirname, INPUT_FILE), {
    cellDates: true
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const userEntries = [];
  const failedRows = [];
  const seenUsernames = new Set();

  for (const row of data) {
    try {
      const rawPassword = normalizeValue(
        getRowValue(row, ["password", "Password"])
      );
      const hashedPassword = rawPassword ? await bcrypt.hash(rawPassword, 10) : null;
      const admissionNumber = normalizeValue(
        getRowValue(row, ["admission_number", "Admission Number"])
      );
      const schoolCode = normalizeValue(
        getRowValue(row, ["school_code", "School Code"])
      );
      const firstName = normalizeValue(
        getRowValue(row, ["first_name", "First Name", "firstname"])
      );
      const lastName = normalizeValue(
        getRowValue(row, ["last_name", "Last Name", "lastname"])
      );
      const branch = normalizeValue(getRowValue(row, ["branch", "Branch"]));
      const className = normalizeValue(getRowValue(row, ["class", "Class", "grade", "Grade"]));
      const section = normalizeValue(getRowValue(row, ["section", "Section"]));
      const preparingFor = normalizeValue(
        getRowValue(row, ["preparing_for", "Preparing For"])
      );
      const rawGender = getRowValue(row, ["gender", "Gender"]);
      const rawDob = getRowValue(row, ["dob", "DOB", "date_of_birth", "Date of Birth"]);
      const username = schoolCode && admissionNumber ? `${schoolCode}_${admissionNumber}` : null;
      const parsedDOB = parseDOB(
        rawDob
      );

      if (username && seenUsernames.has(username)) {
        throw new Error(`duplicate username in sheet: ${username}`);
      }

      if (username) {
        seenUsernames.add(username);
      }

      const user = {
        username,
        user_type: "b2b",

        first_name: firstName,
        last_name: lastName,

        email: buildEmail(row, username),
        phone: buildPhone(row),

        school_code: schoolCode,
        branch,
        class: className,
        section,
        preparing_for: preparingFor,

        password: hashedPassword,
        must_change_password: rawPassword ? 1 : 0,

        dob: parsedDOB,
        gender: mapGender(rawGender),

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

        auth_methods: rawPassword ? ["password"] : [],
        login_type: rawPassword ? "password" : null,

        created_at: new Date(),
        updated_at: new Date()
      };

      userEntries.push({
        user,
        csvDetails: {
          admission_number: admissionNumber,
          username,
          user_id: null,
          first_name: firstName,
          last_name: lastName,
          password: rawPassword,
          gender: normalizeValue(rawGender),
          school_code: schoolCode,
          branch,
          dob: formatDateForCsv(parsedDOB),
          phone: user.phone,
          email: user.email,
          class: className,
          section,
          preparing_for: preparingFor
        }
      });

    } catch (err) {
      failedRows.push({
        admission_number: getRowValue(row, ["admission_number", "Admission Number"]) || "UNKNOWN",
        username: "UNKNOWN",
        error: err.message
      });
    }
  }

  if (userEntries.length === 0) {
    throw new Error("No valid users to insert");
  }

  const usernamesToCheck = userEntries
    .map(entry => entry.user.username)
    .filter(Boolean);

  const existingUsers = usernamesToCheck.length > 0
    ? await User.find(
      { username: { $in: usernamesToCheck } },
      { username: 1 }
    ).lean()
    : [];

  const existingUsernameSet = new Set(
    existingUsers.map(user => user.username).filter(Boolean)
  );

  const newUserEntries = [];

  for (const entry of userEntries) {
    if (entry.user.username && existingUsernameSet.has(entry.user.username)) {
      failedRows.push({
        admission_number: entry.csvDetails.admission_number,
        username: entry.user.username,
        error: "username already exists in database"
      });
      continue;
    }

    newUserEntries.push(entry);
  }

  if (newUserEntries.length === 0) {
    throw new Error("No new users to insert; all rows already exist or failed validation");
  }

  // INSERT USING MONGOOSE (IMPORTANT)
  const insertedUsers = await User.insertMany(newUserEntries.map(entry => entry.user));

  const csvHeaders = [
    "admission_number",
    "username",
    "user_id",
    "first_name",
    "last_name",
    "password",
    "gender",
    "school_code",
    "branch",
    "dob",
    "phone",
    "email",
    "class",
    "section",
    "preparing_for"
  ];

  const mapping = insertedUsers.map((user, index) => ({
    ...newUserEntries[index].csvDetails,
    username: user.username,
    user_id: user._id.toString(),
    first_name: user.first_name,
    last_name: user.last_name,
    gender: newUserEntries[index].csvDetails.gender,
    school_code: user.school_code,
    branch: user.branch,
    dob: formatDateForCsv(user.dob),
    phone: user.phone,
    email: user.email,
    class: user.class,
    section: user.section,
    preparing_for: user.preparing_for
  }));

  // EXPORT SUCCESS
  fs.writeFileSync(path.join(__dirname, OUTPUT_CSV), toCsv(mapping, csvHeaders));

  // EXPORT FAILURES
  if (failedRows.length > 0) {
    fs.writeFileSync(
      path.join(__dirname, FAILED_CSV),
      toCsv(failedRows, ["admission_number", "username", "error"])
    );
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
