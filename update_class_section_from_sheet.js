const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

const User = require("./User");

const MONGO_URI = process.env.MONGO_URI || "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";
const FILE_PATH = path.join(__dirname, "Class section.xlsx");

function normalizeValue(value) {
  if (value === undefined || value === null) return null;

  const trimmed = value.toString().trim();
  return trimmed === "" ? null : trimmed;
}

function loadRows() {
  const workbook = XLSX.readFile(FILE_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    userId: normalizeValue(row.user_id),
    classValue: normalizeValue(row.Class),
    sectionValue: normalizeValue(row.section)
  }));
}

async function run() {
  const rows = loadRows();

  if (rows.length === 0) {
    throw new Error("No rows found in Class section.xlsx");
  }

  const invalidRows = [];
  const updatesByUserId = new Map();

  for (const row of rows) {
    if (!row.userId || !mongoose.Types.ObjectId.isValid(row.userId) || row.userId.length !== 24) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        userId: row.userId,
        error: "invalid user_id"
      });
      continue;
    }

    if (!row.classValue || !row.sectionValue) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        userId: row.userId,
        error: "Class or section missing"
      });
      continue;
    }

    updatesByUserId.set(row.userId, {
      classValue: row.classValue,
      sectionValue: row.sectionValue
    });
  }

  const validUserIds = [...updatesByUserId.keys()];

  if (validUserIds.length === 0) {
    throw new Error("No valid rows to update");
  }

  await mongoose.connect(MONGO_URI);

  const existingUsers = await User.find(
    { _id: { $in: validUserIds } },
    { _id: 1 }
  ).lean();

  const existingIdSet = new Set(existingUsers.map(user => user._id.toString()));
  const missingIds = validUserIds.filter(id => !existingIdSet.has(id));

  let modifiedCount = 0;
  let matchedCount = 0;

  for (const userId of validUserIds) {
    if (!existingIdSet.has(userId)) {
      continue;
    }

    const update = updatesByUserId.get(userId);
    const result = await User.updateOne(
      { _id: userId },
      {
        $set: {
          class: update.classValue,
          section: update.sectionValue,
          updated_at: new Date()
        }
      }
    );

    matchedCount += result.matchedCount;
    modifiedCount += result.modifiedCount;
  }

  console.log("Rows in sheet:", rows.length);
  console.log("Valid unique users:", validUserIds.length);
  console.log("Invalid rows skipped:", invalidRows.length);
  console.log("Users found:", existingUsers.length);
  console.log("Users matched:", matchedCount);
  console.log("Users modified:", modifiedCount);
  console.log("Missing users:", missingIds.length);

  if (invalidRows.length > 0) {
    console.log("Invalid rows:");
    invalidRows.forEach(row => {
      console.log(`Row ${row.rowNumber}: ${row.error} (${row.userId || "blank"})`);
    });
  }

  if (missingIds.length > 0) {
    console.log("Missing user IDs:");
    missingIds.forEach(id => console.log(id));
  }

  await mongoose.disconnect();
}

run().catch(async err => {
  console.error("Error:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
