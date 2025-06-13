require('dotenv').config();
const express = require('express');
const cors = require('cors');
const reservationsRouter = require('./routes/reservations');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/reservations', reservationsRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/admin', adminRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});