const mongoose = require("mongoose");
const fs = require("fs");

const MONGO_URI = "mongodb://ekluvyamongo:GRWqLDESFT816lrsxG@13.127.118.60:27017/ekluvya?authSource=ekluvya&readPreference=primary&directConnection=true&ssl=false";

async function run() {
  await mongoose.connect(MONGO_URI);

  const ids = fs.readFileSync("class7.txt", "utf-8")
    .split("\n")
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => new mongoose.Types.ObjectId(id));

  const result = await mongoose.connection.collection("users").deleteMany({
    _id: { $in: ids }
  });

  console.log("Deleted:", result.deletedCount);

  process.exit();
}

run();