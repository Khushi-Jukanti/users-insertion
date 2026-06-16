const mongoose = require('mongoose');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');


// const MONGO_URI = "mongodb://monekluvyausr:TVqtQ161DGvlrT3bqXCmdGXrp@13.235.17.54:27017/mongekluvyastgdb";
const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";
const INPUT_FILE = process.argv[2] || "offline_receipt_users.xlsx";

const UserSchema = new mongoose.Schema(
  {},
  {
    collection: "users",
    strict: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  }
);

const User = mongoose.model("users", UserSchema);

function normalizeKey(key) {
  return key.toString().trim().toLowerCase().replace(/[\s_.-]+/g, "");
}

function getRowValue(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  const normalizedKeyMap = new Map(
    Object.keys(row).map(key => [normalizeKey(key), row[key]])
  );

  for (const key of possibleKeys) {
    const normalizedKey = normalizeKey(key);

    if (normalizedKeyMap.has(normalizedKey)) {
      return normalizedKeyMap.get(normalizedKey);
    }
  }

  return undefined;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return "";

  const normalized = value.toString().trim();
  return normalized === "" ? "" : normalized;
}

function normalizeEmail(value) {
  return normalizeValue(value).toLowerCase();
}

function normalizePhone(value) {
  const normalized = normalizeValue(value).replace(/\.0+$/, "");
  const digitsOnly = normalized.replace(/\D/g, "");
  return digitsOnly;
}

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

  if (!/^(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/(19|20)\d{2}$/.test(dobStr)) {
    throw new Error(`DOB must be in dd/mm/yyyy format: ${dobStr}`);
  }

  const [day, month, year] = dobStr.split("/");
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    isNaN(parsed.getTime()) ||
    parsed.getDate() !== Number(day) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getFullYear() !== Number(year)
  ) {
    throw new Error(`Invalid DOB value: ${dobStr}`);
  }

  return parsed;
}

function mapGender(gender) {
  const normalizedGender = normalizeValue(gender).toLowerCase();

  if (!normalizedGender) return null;
  if (normalizedGender === "male") return "1";
  if (normalizedGender === "female") return "2";
  if (normalizedGender === "other" || normalizedGender === "others") return "3";

  return normalizeValue(gender);
}

function buildAuthMethods(authMethods) {
  const methods = Array.isArray(authMethods) ? authMethods.filter(Boolean) : [];
  return methods.includes("otp") ? methods : [...methods, "otp"];
}

function buildUsername(receiptNo) {
  const safeReceiptNo = receiptNo
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `offline_${safeReceiptNo}`;
}

function escapeCsv(value) {
  if (value === undefined || value === null) return "";

  const stringValue = value.toString();

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function readInputRows() {
  const inputPath = path.isAbsolute(INPUT_FILE)
    ? INPUT_FILE
    : path.join(__dirname, INPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet);
}

function buildReceiptFields(row) {
  const receiptNo = normalizeValue(getRowValue(row, ["receipt_no", "Receipt No", "Receipt Number"]));
  const executiveName = normalizeValue(getRowValue(row, ["executive_name", "Executive Name"]));
  const executivePhone = normalizePhone(getRowValue(row, ["executive_phone", "Executive Phone"]));
  const schoolType = normalizeValue(getRowValue(row, ["school_type", "School Type"])).toUpperCase();
  const schoolName = normalizeValue(getRowValue(row, ["school_name", "School Name"]));
  const subscriberName = normalizeValue(getRowValue(row, ["subscriber_name", "Subscriber Name"]));
  const firstName = normalizeValue(getRowValue(row, ["first_name", "First Name", "firstname"])) || subscriberName.split(" ")[0];
  const lastName = normalizeValue(getRowValue(row, ["last_name", "Last Name", "lastname"])) || (
    subscriberName.split(" ").length > 1
      ? subscriberName.split(" ").slice(1).join(" ")
      : ""
  );
  const email = normalizeEmail(getRowValue(row, ["email", "Email", "email_id", "Email ID", "E-mail"]));
  const phone = normalizePhone(getRowValue(row, ["phone", "Phone", "mobile", "Mobile", "Phone Number"]));
  const dob = parseDOB(getRowValue(row, ["dob", "DOB", "Date of Birth"]));
  const studentClass = normalizeValue(getRowValue(row, ["class", "Class", "student_class", "Student Class"]));
  const gender = mapGender(getRowValue(row, ["gender", "Gender"]));
  const preparingFor = normalizeValue(getRowValue(row, ["preparing_for", "Preparing For"]));

  if (!receiptNo) throw new Error("receipt_no missing");
  if (!executiveName) throw new Error("executive_name missing");
  if (!executivePhone) throw new Error("executive_phone missing");
  if (!["SR", "SR1"].includes(schoolType)) throw new Error("school_type must be SR or SR1");
  if (!schoolName) throw new Error("school_name missing");
  if (!firstName) throw new Error("first_name missing");
  if (!email && !phone) throw new Error("email or phone missing");

  return {
    user_type: "b2c",
    registration_source: "offline_receipt",
    school_type: schoolType,
    school_name: schoolName,
    receipt_no: receiptNo,
    executive_name: executiveName,
    executive_phone: executivePhone,
    first_name: firstName,
    last_name: lastName || null,
    email: email || null,
    phone: phone || null,
    class: studentClass || null,
    gender,
    preparing_for: preparingFor || null,
    dob,
    password: null,
    must_change_password: 0,
    is_phone_verified: 0,
    is_email_verified: 0,
    is_active: 1,
    is_archived: 0,
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
    is_partner_blocked: 0,
    is_contact_sync: 0,
    is_fbsync: 0,
    push_notification_status: 2,
    email_notification_status: 2,
    login_type: "offline_receipt"
  };
}

async function createOrUpdateReceiptUser(receiptFields) {
  const existingReceipt = await User.findOne({
    receipt_no: receiptFields.receipt_no
  }).lean();

  if (existingReceipt) {
    throw new Error("receipt_no already exists in database");
  }

  const existingUserByEmail = receiptFields.email
    ? await User.findOne({ email: receiptFields.email }).lean()
    : null;
  const existingUserByPhone = receiptFields.phone
    ? await User.findOne({ phone: receiptFields.phone }).lean()
    : null;

  if (
    existingUserByEmail &&
    existingUserByPhone &&
    existingUserByEmail._id.toString() !== existingUserByPhone._id.toString()
  ) {
    throw new Error("email and phone belong to different users");
  }

  const existingUser = existingUserByEmail || existingUserByPhone;

  if (existingUser) {
    if (existingUser.receipt_no) {
      throw new Error("this user already has a receipt_no");
    }

    const updatedUser = await User.findByIdAndUpdate(
      existingUser._id,
      {
        $set: {
          ...receiptFields,
          auth_methods: buildAuthMethods(existingUser.auth_methods),
          updated_at: new Date()
        }
      },
      { new: true }
    ).lean();

    return { action: "updated", user: updatedUser };
  }

  const username = buildUsername(receiptFields.receipt_no);
  const existingUsername = await User.findOne({ username }).lean();

  if (existingUsername) {
    throw new Error(`generated username already exists: ${username}`);
  }

  const insertedUser = await User.create({
    ...receiptFields,
    username,
    auth_methods: ["otp"],
    created_at: new Date(),
    updated_at: new Date()
  });

  return { action: "created", user: insertedUser.toObject() };
}

async function run() {
  await mongoose.connect(MONGO_URI);

  const rows = readInputRows();
  const successfulRows = [];
  const failedRows = [];
  const seenReceipts = new Set();

  for (const row of rows) {
    try {
      const receiptFields = buildReceiptFields(row);

      if (seenReceipts.has(receiptFields.receipt_no)) {
        throw new Error(`duplicate receipt_no in sheet: ${receiptFields.receipt_no}`);
      }

      seenReceipts.add(receiptFields.receipt_no);

      const result = await createOrUpdateReceiptUser(receiptFields);

      successfulRows.push({
        action: result.action,
        receipt_no: result.user.receipt_no,
        first_name: result.user.first_name,
        last_name: result.user.last_name,
        email: result.user.email,
        phone: result.user.phone,
        username: result.user.username,
        user_id: result.user._id.toString()
      });
    } catch (err) {
      failedRows.push({
        receipt_no: normalizeValue(getRowValue(row, ["receipt_no", "Receipt No", "Receipt Number"])) || "UNKNOWN",
        error: err.message
      });
    }
  }

  const successCsvRows = [
    "action,receipt_no,first_name,last_name,email,phone,username,user_id",
    ...successfulRows.map(row => [
      row.action,
      row.receipt_no,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.username,
      row.user_id
    ].map(escapeCsv).join(","))
  ];

  fs.writeFileSync(
    path.join(__dirname, "/mapping/offline_receipt_user_mapping1.csv"),
    `${successCsvRows.join("\n")}\n`
  );

  if (failedRows.length > 0) {
    const failedCsvRows = [
      "receipt_no,error",
      ...failedRows.map(row => [row.receipt_no, row.error].map(escapeCsv).join(","))
    ];

    fs.writeFileSync(
      path.join(__dirname, "/failed/offline_receipt_failed_rows.csv"),
      `${failedCsvRows.join("\n")}\n`
    );
  }

  console.log("Offline receipt users processed:", rows.length);
  console.log("Successful rows:", successfulRows.length);
  console.log("Failed rows:", failedRows.length);
  console.log("Mapping file created: offline_receipt_user_mapping.csv");

  if (failedRows.length > 0) {
    console.log("Failed rows file created: offline_receipt_failed_rows.csv");
  }

  await mongoose.disconnect();
}

run().catch(async err => {
  console.error("Error:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});
