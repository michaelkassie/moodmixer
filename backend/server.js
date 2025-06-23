const express = require('express');
const cors = require('cors');
const musicRoutes = require('./routes/music');
const connectDB = require('./db');

const app = express();
app.use(cors());
app.use(express.json()); // ⬅️ important for POST/PUT later

connectDB(); // ✅ connect to MongoDB

app.use('/music', musicRoutes);

app.listen(5000, () => {
  console.log('Server running on http://localhost:5000');
});
