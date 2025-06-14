// Disable Twilio for tests before any imports
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const cors = require('cors');

// Create Express app for testing
const app = express();

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

// Load routes
const reservationsRouter = require('../routes/reservations');
const adminRouter = require('../routes/admin');
app.use('/reservations', reservationsRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/admin', adminRouter);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

describe('Extended Hours Reservation Tests (25:00-28:00)', () => {
  beforeEach(async () => {
    // Clean database before each test
    await prisma.reservation.deleteMany({});
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Late Night Time Slots (25:00-28:00)', () => {
    test('should allow reservation at 25:00 (slot 28) with duration until 28:00', async () => {
      const date = '2025-06-25';
      const timeSlot = 28; // 25:00

      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 4,
          name: 'Late Night Party',
          phone: '+1234567890',
          email: 'latenight@example.com'
        })
        .expect(201);

      expect(response.body.reservation.timeSlot).toBe(28);
      expect(response.body.reservation.partySize).toBe(4);
    });

    test('should allow reservation at 26:00 (slot 32) with shorter duration', async () => {
      const date = '2025-06-25';
      const timeSlot = 32; // 26:00

      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 2,
          name: 'Very Late Party',
          phone: '+1234567890',
          email: 'verylate@example.com'
        })
        .expect(201);

      expect(response.body.reservation.timeSlot).toBe(32);
    });

    test('should allow reservation at 27:45 (slot 39) - last slot', async () => {
      const date = '2025-06-25';
      const timeSlot = 39; // 27:45-28:00

      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 1,
          name: 'Last Minute Party',
          phone: '+1234567890',
          email: 'lastminute@example.com'
        })
        .expect(201);

      expect(response.body.reservation.timeSlot).toBe(39);
    });

    test('should reject reservation beyond 27:45 (slot 40)', async () => {
      const date = '2025-06-25';
      const timeSlot = 40; // Beyond 28:00

      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 2,
          name: 'Too Late Party',
          phone: '+1234567890',
          email: 'toolate@example.com'
        })
        .expect(400);

      expect(response.body.error).toBe('バリデーションエラー');
    });
  });

  describe('Late Night Capacity Management', () => {
    test('should handle capacity correctly for late night slots', async () => {
      const date = '2025-06-25';
      const timeSlot = 30; // 25:30

      // Fill capacity with 6 people
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 6,
          name: 'Full Capacity Party',
          phone: '+1234567890',
          email: 'full@example.com'
        })
        .expect(201);

      // Try to add one more person - should fail
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 1,
          name: 'Overflow Party',
          phone: '+1987654321',
          email: 'overflow@example.com'
        })
        .expect(409);

      expect(response.body.error).toBe('座席が不足しています');
    });

    test('should handle overlapping reservations with late night slots', async () => {
      const date = '2025-06-25';
      
      // Reservation at 24:30 (slot 26) - overlaps with late night
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 26, // 24:30
          partySize: 3,
          name: 'Evening Party',
          phone: '+1234567890',
          email: 'evening@example.com'
        })
        .expect(201);

      // Reservation at 25:00 (slot 28) - should work if capacity allows
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 28, // 25:00
          partySize: 2,
          name: 'Late Night Party',
          phone: '+1987654321',
          email: 'latenight@example.com'
        })
        .expect(201);

      // Try to add another 2 people at 25:15 (slot 29) - total would be 7
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 29, // 25:15
          partySize: 2,
          name: 'Overflow Party',
          phone: '+1555555555',
          email: 'overflow@example.com'
        })
        .expect(409);

      expect(response.body.error).toBe('座席が不足しています');
    });
  });

  describe('Availability Endpoint for Extended Hours', () => {
    test('should show availability for all slots including late night (up to 27:45)', async () => {
      const date = '2025-06-25';
      
      const response = await request(app)
        .get(`/reservations/availability/${date}`)
        .expect(200);

      const availableSlots = response.body.availableSlots;
      
      // Should include slots 0-39 (18:00-27:45)
      expect(availableSlots.length).toBeGreaterThanOrEqual(40);
      
      // Check that late night slots are included
      const lateNightSlots = availableSlots.filter(slot => slot.slot >= 28);
      expect(lateNightSlots.length).toBeGreaterThan(0);
      
      // Last slot should be 39 (27:45-28:00)
      const lastSlot = Math.max(...availableSlots.map(slot => slot.slot));
      expect(lastSlot).toBe(39);
    });

    test('should show correct available seats for late night slots with existing reservations', async () => {
      const date = '2025-06-25';
      
      // Create a reservation at 25:30 (slot 30)
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 30, // 25:30
          partySize: 4,
          name: 'Late Party',
          phone: '+1234567890',
          email: 'late@example.com'
        })
        .expect(201);

      const response = await request(app)
        .get(`/reservations/availability/${date}`)
        .expect(200);

      const availableSlots = response.body.availableSlots;
      
      // Find slots affected by the late night reservation
      // For a reservation starting at slot 30, it should affect slots until the end of service or 3 hours
      const affectedSlots = availableSlots.filter(slot => 
        slot.slot >= 30 && slot.slot <= 39 // Until end of service
      );

      // All affected slots should show 2 available seats (6 - 4 = 2)
      affectedSlots.forEach(slot => {
        expect(slot.availableSeats).toBe(2);
        expect(slot.maxCapacity).toBe(6);
      });
    });
  });

  describe('Business Rules for Extended Hours', () => {
    test('should enforce valid time slot range (0-39)', async () => {
      const date = '2025-06-25';
      
      // Valid early slot
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 0, // 18:00
          partySize: 2,
          name: 'Early Party',
          phone: '+1234567890',
          email: 'early@example.com'
        })
        .expect(201);

      // Valid late slot
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 39, // 27:45
          partySize: 2,
          name: 'Latest Party',
          phone: '+1987654321',
          email: 'latest@example.com'
        })
        .expect(201);

      // Invalid slot (too late)
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 40, // Beyond 28:00
          partySize: 2,
          name: 'Invalid Party',
          phone: '+1555555555',
          email: 'invalid@example.com'
        })
        .expect(400);

      expect(response.body.error).toBe('バリデーションエラー');
    });
  });
});