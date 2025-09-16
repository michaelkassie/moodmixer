
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./db');


const musicRoutes = require('./routes/music');

// NEW routes (add these files if you haven’t yet)
const aiRoutes = require('./routes/ai');             
const recRoutes = require('./routes/recs');          
const analyticsRoutes = require('./routes/analytics'); 
          

dotenv.config(); 

const app = express();

// Allow requests from your Vercel frontend + local dev
const allowedOrigins = [
  'http://localhost:5173',            
  process.env.FRONTEND_URL || '',     
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS blocked: ' + origin));
    }
  },
  credentials: true,
}));

app.use(express.json());

// connect to MongoDB
connectDB();

// health check route (Render will ping this)
app.get('/health', (_req, res) => res.send('ok'));
// TEMP: prove /music base path is reachable from server.js
app.get('/music/ping', (_req, res) => res.json({ ok: true, from: 'server.js' }));


// existing routes
app.use('/music', musicRoutes);

// NEW: DS/ML feature routes
app.use('/api/ai', aiRoutes);             
app.use('/api/recs', recRoutes);          
app.use('/api/analytics', analyticsRoutes);
//app.use('/api/dev', devRoutes);           

// basic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// use PORT from env or fallback to 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
