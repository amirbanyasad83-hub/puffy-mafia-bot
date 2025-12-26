const connectDB = require("./db");

(async () => {
  global.db = await connectDB();
})();
