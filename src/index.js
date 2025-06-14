require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting application...');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`PORT: ${PORT}`);
console.log(`DATABASE_URL exists: ${!!process.env.DATABASE_URL}`);

let prisma;
try {
  prisma = new PrismaClient({
    log: ['error', 'warn'],
  });
  console.log('Prisma client initialized successfully');
  
  // Run database migration in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Running database migration...');
    const { execSync } = require('child_process');
    try {
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
      console.log('Database migration completed successfully');
    } catch (migrationError) {
      console.error('Migration failed:', migrationError);
      console.log('Continuing without migration - database might already be set up');
    }
  }
} catch (error) {
  console.error('Failed to initialize Prisma client:', error);
  process.exit(1);
}

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Base URL:', req.baseUrl);
  console.log('Original URL:', req.originalUrl);
  if (req.method === 'POST') {
    console.log('Request body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Health check with database test
app.get('/health', async (req, res) => {
  console.log('Health check endpoint hit');
  try {
    await prisma.$queryRaw`SELECT 1 as test`;
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      port: PORT,
      env: process.env.NODE_ENV,
      database: 'connected'
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Load routes after health check
try {
  console.log('Loading routes...');
  const reservationsRouter = require('./routes/reservations');
  const adminRouter = require('./routes/admin');
  console.log('Routes loaded successfully');
  
  app.use('/reservations', reservationsRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/admin', adminRouter);
  console.log('Routes registered successfully');
} catch (error) {
  console.error('Failed to load routes:', error);
  process.exit(1);
}

// 404 handler - catch all unmatched routes
app.use((req, res, next) => {
  console.log(`404 - Not Found: ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Database URL configured: ${!!process.env.DATABASE_URL}`);
  console.log(`Actually listening on port: ${server.address().port}`);
  console.log('Application started successfully');
});

server.on('error', (error) => {
  console.error('Server error:', error);
});