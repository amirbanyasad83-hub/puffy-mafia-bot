const { MongoClient } = require("mongodb");

const uri = process.env.MONGO_URI; // رشته اتصال از Environment Variables

const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
    return client.db("puffy_mafia");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

module.exports = connectDB;
