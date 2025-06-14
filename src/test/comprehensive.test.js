// Disable Twilio for tests before any imports
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const cors = require('cors');

// Create Express app for testing (similar to index.js)
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

describe('Comprehensive Reservation System Tests', () => {
  beforeAll(() => {
    // Disable Twilio for tests
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  beforeEach(async () => {
    // Clean database before each test
    await prisma.reservation.deleteMany({});
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Capacity Management Tests', () => {
    test('should allow 4 people + 2 people reservation (total 6 - at capacity)', async () => {
      const date = '2025-06-25';
      const timeSlot = 8; // 20:00

      // Create first reservation for 4 people
      const firstRes = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 4,
          name: 'First Party',
          phone: '+1234567890',
          email: 'first@example.com'
        })
        .expect(201);

      expect(firstRes.body.reservation.partySize).toBe(4);

      // Create second reservation for 2 people (should succeed - total 6)
      const secondRes = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 2,
          name: 'Second Party',
          phone: '+1987654321',
          email: 'second@example.com'
        })
        .expect(201);

      expect(secondRes.body.reservation.partySize).toBe(2);
    });

    test('should reject 4 people + 3 people reservation (total 7 - over capacity)', async () => {
      const date = '2025-06-25';
      const timeSlot = 8; // 20:00

      // Create first reservation for 4 people
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 4,
          name: 'First Party',
          phone: '+1234567890',
          email: 'first@example.com'
        })
        .expect(201);

      // Try to create second reservation for 3 people (should fail - total 7)
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 3,
          name: 'Second Party',
          phone: '+1987654321',
          email: 'second@example.com'
        })
        .expect(409);

      expect(response.body.error).toBe('座席が不足しています');
      expect(response.body.message).toContain('残席数: 2席');
    });

    test('should handle multiple small reservations up to capacity', async () => {
      const date = '2025-06-25';
      const timeSlot = 8; // 20:00

      // Create 6 reservations of 1 person each
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/reservations')
          .send({
            date,
            timeSlot,
            partySize: 1,
            name: `Party ${i + 1}`,
            phone: `+123456789${i}`,
            email: `party${i + 1}@example.com`
          })
          .expect(201);
      }

      // 7th reservation should fail
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot,
          partySize: 1,
          name: 'Overflow Party',
          phone: '+1999999999',
          email: 'overflow@example.com'
        })
        .expect(409);

      expect(response.body.error).toBe('座席が不足しています');
    });
  });

  describe('Time Slot Overlap Tests', () => {
    test('should handle overlapping 3-hour reservations correctly', async () => {
      const date = '2025-06-25';
      
      // First reservation at 18:00 (slots 0-11)
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 0, // 18:00
          partySize: 3,
          name: 'Early Party',
          phone: '+1234567890',
          email: 'early@example.com'
        })
        .expect(201);

      // Second reservation at 19:00 (slots 4-15) - overlaps with first
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 4, // 19:00
          partySize: 2,
          name: 'Mid Party',
          phone: '+1987654321',
          email: 'mid@example.com'
        })
        .expect(201);

      // Third reservation at 19:00 should fail (total 5 people in overlapping slots)
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 4, // 19:00
          partySize: 2,
          name: 'Conflict Party',
          phone: '+1555555555',
          email: 'conflict@example.com'
        })
        .expect(409);

      expect(response.body.error).toBe('座席が不足しています');
    });

    test('should allow non-overlapping reservations at full capacity', async () => {
      const date = '2025-06-25';
      
      // First reservation at 18:00-21:00 (slots 0-11)
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 0, // 18:00
          partySize: 6,
          name: 'Early Full Party',
          phone: '+1234567890',
          email: 'early@example.com'
        })
        .expect(201);

      // Second reservation at 21:00-24:00 (slots 12-23) - no overlap
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 12, // 21:00
          partySize: 6,
          name: 'Late Full Party',
          phone: '+1987654321',
          email: 'late@example.com'
        })
        .expect(201);
    });
  });

  describe('Availability Endpoint Tests', () => {
    test('should show correct available seats with existing reservations', async () => {
      const date = '2025-06-25';
      
      // Create a 4-person reservation at 20:00
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8, // 20:00
          partySize: 4,
          name: 'Test Party',
          phone: '+1234567890',
          email: 'test@example.com'
        })
        .expect(201);

      // Check availability
      const response = await request(app)
        .get(`/reservations/availability/${date}`)
        .expect(200);

      const availableSlots = response.body.availableSlots;
      
      // Find slots affected by the reservation (slots 8-19: 20:00-23:00)
      const affectedSlots = availableSlots.filter(slot => 
        slot.slot >= 8 && slot.slot <= 19
      );

      // All affected slots should show 2 available seats (6 - 4 = 2)
      affectedSlots.forEach(slot => {
        expect(slot.availableSeats).toBe(2);
        expect(slot.maxCapacity).toBe(6);
      });

      // Unaffected slots should show full capacity
      const unaffectedSlots = availableSlots.filter(slot => 
        slot.slot < 8 || slot.slot > 19
      );

      unaffectedSlots.forEach(slot => {
        expect(slot.availableSeats).toBe(6);
        expect(slot.maxCapacity).toBe(6);
      });
    });

    test('should not show fully booked slots', async () => {
      const date = '2025-06-25';
      
      // Create a 6-person reservation at 20:00 (full capacity)
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8, // 20:00
          partySize: 6,
          name: 'Full Party',
          phone: '+1234567890',
          email: 'full@example.com'
        })
        .expect(201);

      // Check availability
      const response = await request(app)
        .get(`/reservations/availability/${date}`)
        .expect(200);

      const availableSlots = response.body.availableSlots;
      
      // Slots 8-19 should not be in available slots (fully booked)
      const fullyBookedSlots = availableSlots.filter(slot => 
        slot.slot >= 8 && slot.slot <= 19
      );

      expect(fullyBookedSlots).toHaveLength(0);
      
      // Other slots should still be available
      expect(availableSlots.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle maximum party size (6 people)', async () => {
      const date = '2025-06-25';
      
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8,
          partySize: 6,
          name: 'Max Party',
          phone: '+1234567890',
          email: 'max@example.com'
        })
        .expect(201);

      expect(response.body.reservation.partySize).toBe(6);
    });

    test('should reject party size over 6', async () => {
      const date = '2025-06-25';
      
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8,
          partySize: 7,
          name: 'Over Party',
          phone: '+1234567890',
          email: 'over@example.com'
        })
        .expect(400);

      expect(response.body.error).toBe('バリデーションエラー');
    });

    test('should reject party size under 1', async () => {
      const date = '2025-06-25';
      
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8,
          partySize: 0,
          name: 'Zero Party',
          phone: '+1234567890',
          email: 'zero@example.com'
        })
        .expect(400);

      expect(response.body.error).toBe('バリデーションエラー');
    });

    test('should handle end-of-day time slots correctly', async () => {
      const date = '2025-06-25';
      
      // Last possible time slot that allows 3 hours (slot 16: 22:00-01:00)
      const response = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 16, // 22:00
          partySize: 4,
          name: 'Late Party',
          phone: '+1234567890',
          email: 'late@example.com'
        })
        .expect(201);

      expect(response.body.reservation.timeSlot).toBe(16);
    });
  });

  describe('Business Rules', () => {
    test('should enforce date range (2025-06-20 to 2025-07-04)', async () => {
      // Valid date
      await request(app)
        .post('/reservations')
        .send({
          date: '2025-06-25',
          timeSlot: 8,
          partySize: 2,
          name: 'Valid Date Party',
          phone: '+1234567890',
          email: 'valid@example.com'
        })
        .expect(201);

      // Date before range
      const beforeResponse = await request(app)
        .post('/reservations')
        .send({
          date: '2025-06-19',
          timeSlot: 8,
          partySize: 2,
          name: 'Before Range Party',
          phone: '+1234567890',
          email: 'before@example.com'
        })
        .expect(400);

      expect(beforeResponse.body.error).toBe('バリデーションエラー');

      // Date after range
      const afterResponse = await request(app)
        .post('/reservations')
        .send({
          date: '2025-07-05',
          timeSlot: 8,
          partySize: 2,
          name: 'After Range Party',
          phone: '+1234567890',
          email: 'after@example.com'
        })
        .expect(400);

      expect(afterResponse.body.error).toBe('バリデーションエラー');
    });

    test('should enforce business hours (18:00-28:00 JST)', async () => {
      const date = '2025-06-25';
      
      // Valid time slot (20:00)
      await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: 8,
          partySize: 2,
          name: 'Valid Time Party',
          phone: '+1234567890',
          email: 'valid@example.com'
        })
        .expect(201);

      // Invalid time slot (before 18:00)
      const invalidResponse = await request(app)
        .post('/reservations')
        .send({
          date,
          timeSlot: -1,
          partySize: 2,
          name: 'Invalid Time Party',
          phone: '+1234567890',
          email: 'invalid@example.com'
        })
        .expect(400);

      expect(invalidResponse.body.error).toBe('バリデーションエラー');
    });
  });
});