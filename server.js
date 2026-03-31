require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');

// âââ Bootstrap DB âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// âââ Middleware âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve uploaded files
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// âââ API Routes âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/expenses',  require('./routes/expenses'));
app.use('/api/projects',  require('./routes/projects'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/ocr',       require('./routes/ocr'));

// âââ Health check âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// âââ Serve React App ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ message: 'FinTrack API. Run `npm run build` to serve the React frontend.' });
  });
}

// âââ Error handler âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nð FinTrack running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
