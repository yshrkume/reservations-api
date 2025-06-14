require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
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
  
  // Run database migration only if explicitly requested
  if (process.env.RUN_MIGRATION === 'true') {
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

// CORS configuration - secure by default, configurable for different environments
const getAllowedOrigins = () => {
  // If ALLOWED_ORIGINS is explicitly set, use it
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  }
  
  // Default allowed origins based on environment
  const defaultOrigins = [
    'http://localhost:3001', // Local development (Next.js default)
    'http://localhost:3000', // Alternative local port
    'https://reservation-web-yshrkumes-projects.vercel.app', // Vercel deployment
  ];
  
  // In development, be more permissive but still secure
  if (process.env.NODE_ENV === 'development') {
    defaultOrigins.push('http://127.0.0.1:3000', 'http://127.0.0.1:3001');
  }
  
  return defaultOrigins;
};

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedOrigins();
    
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('CORS policy: Origin not allowed'), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

console.log('CORS allowed origins:', getAllowedOrigins());
app.use(cors(corsOptions));
app.use(express.json());

// Rate limiting configuration - protective but not overly restrictive
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'レート制限',
      message: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting in development if explicitly disabled
    skip: (req) => {
      return process.env.NODE_ENV === 'development' && process.env.DISABLE_RATE_LIMIT === 'true';
    }
  });
};

// General API rate limit - generous for normal usage
const generalRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per 15 minutes per IP
  'APIリクエストが多すぎます。15分後に再試行してください。'
);

// Admin endpoints - more restrictive
const adminRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  20, // 20 requests per 15 minutes for admin operations
  '管理者操作のリクエストが多すぎます。15分後に再試行してください。'
);

// Reservation creation - moderate restriction
const reservationRateLimit = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  10, // 10 reservation attempts per 5 minutes
  '予約リクエストが多すぎます。5分後に再試行してください。'
);

// Apply general rate limiting to all routes
app.use(generalRateLimit);

console.log('Rate limiting configured - General: 100 req/15min, Admin: 20 req/15min, Reservations: 10 req/5min');

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
  
  // Apply specific rate limits to routes
  app.use('/reservations', reservationsRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/admin', adminRateLimit, adminRouter);
  
  // Apply stricter rate limit to reservation creation endpoint
  app.post('/reservations', reservationRateLimit);
  app.post('/api/reservations', reservationRateLimit);
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