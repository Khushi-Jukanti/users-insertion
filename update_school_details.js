const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const User = require("./User");

const MONGO_URI = process.env.MONGO_URI || "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";
const FILE_PATH = path.join(__dirname, "class7.txt");

const SCHOOL_NAME = "Sloka International School";
const SCHOOL_ADDRESS = "Manneguda";

function loadUserIds() {
  const rawIds = fs.readFileSync(FILE_PATH, "utf-8")
    .split(/\r?\n/)
    .map(id => id.replace(/["',]/g, "").trim())
    .filter(Boolean);

  const validIds = [];
  const invalidIds = [];

  for (const id of rawIds) {
    if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
      validIds.push(id);
    } else {
      invalidIds.push(id);
    }
  }

  return {
    validIds: [...new Set(validIds)],
    invalidIds
  };
}

async function run() {
  const { validIds, invalidIds } = loadUserIds();

  if (validIds.length === 0) {
    throw new Error("No valid user IDs found in class7.txt");
  }

  await mongoose.connect(MONGO_URI);

  const existingUsers = await User.find(
    { _id: { $in: validIds } },
    { _id: 1 }
  ).lean();

  const existingIdSet = new Set(existingUsers.map(user => user._id.toString()));
  const missingIds = validIds.filter(id => !existingIdSet.has(id));

  const result = await User.updateMany(
    { _id: { $in: validIds } },
    {
      $set: {
        school_name: SCHOOL_NAME,
        school_address: SCHOOL_ADDRESS,
        updated_at: new Date()
      }
    }
  );

  console.log("Total IDs in file:", validIds.length + invalidIds.length);
  console.log("Valid unique IDs:", validIds.length);
  console.log("Invalid IDs skipped:", invalidIds.length);
  console.log("Users found:", existingUsers.length);
  console.log("Users matched:", result.matchedCount);
  console.log("Users modified:", result.modifiedCount);
  console.log("Missing users:", missingIds.length);

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
