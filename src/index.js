require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Health check with database connection test
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'OK', timestamp: new Date().toISOString(), database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'ERROR', timestamp: new Date().toISOString(), database: 'disconnected' });
  }
});

// Load routes after health check
const reservationsRouter = require('./routes/reservations');
const adminRouter = require('./routes/admin');

app.use('/reservations', reservationsRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/admin', adminRouter);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Database URL configured: ${!!process.env.DATABASE_URL}`);
});