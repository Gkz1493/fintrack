const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => {
  console.log('Health check hit');
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => res.json({ app: 'FinTrack', status: 'running' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
