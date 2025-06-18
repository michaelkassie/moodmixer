const express = require('express');
const cors = require('cors');
require('dotenv').config();
const musicRoutes = require('./routes/music');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/music', musicRoutes);

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
