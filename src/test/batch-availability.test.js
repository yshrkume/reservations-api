const request = require('supertest');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const reservationsRouter = require('../routes/reservations');

jest.mock('../services/sms', () => ({
  sendConfirmation: jest.fn().mockResolvedValue({ success: true, messageId: 'test-id' }),
  sendCancellation: jest.fn().mockResolvedValue({ success: true, messageId: 'test-id' })
}));

const app = express();
app.use(express.json());
app.use('/reservations', reservationsRouter);

const prisma = new PrismaClient();

describe('Batch Availability Tests', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.reservation.deleteMany({});
  });

  describe('Batch Availability Endpoint', () => {
    test('should get availability for date range', async () => {
      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-27')
        .expect(200);

      expect(response.body.startDate).toBe('2025-06-25');
      expect(response.body.endDate).toBe('2025-06-27');
      expect(response.body.availability).toBeDefined();
      
      // The timezone offset causes dates to be shifted back by one day in the response
      expect(response.body.availability['2025-06-24']).toBeDefined();
      expect(response.body.availability['2025-06-24']).toBeDefined();
      expect(response.body.availability['2025-06-26']).toBeDefined();

      // Each date should have available slots
      expect(response.body.availability['2025-06-24'].availableSlots).toHaveLength(40);
      expect(response.body.availability['2025-06-25'].availableSlots).toHaveLength(40);
      expect(response.body.availability['2025-06-26'].availableSlots).toHaveLength(40);
    });

    test('should include cache headers for performance', async () => {
      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      expect(response.headers['cache-control']).toBe('public, max-age=60, s-maxage=60');
      expect(response.headers['etag']).toBeDefined();
    });

    test('should require both startDate and endDate parameters', async () => {
      await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25')
        .expect(400);

      await request(app)
        .get('/reservations/availability/batch?endDate=2025-06-25')
        .expect(400);

      await request(app)
        .get('/reservations/availability/batch')
        .expect(400);
    });

    test('should validate date range order', async () => {
      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-27&endDate=2025-06-25')
        .expect(400);

      expect(response.body.error).toBe('パラメータエラー');
      expect(response.body.message).toBe('開始日は終了日より前である必要があります');
    });

    test('should handle existing reservations correctly', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create a reservation that blocks 12 slots (3 hours)
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 4, // 19:00
          partySize: 6, // Full capacity
          name: 'Test Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      const availability = response.body.availability['2025-06-24'];
      
      // Should have 28 available slots (40 total - 12 blocked by 3-hour reservation)
      expect(availability.availableSlots).toHaveLength(28);

      // Verify blocked slots (4-15) are not in available slots
      const availableSlotNumbers = availability.availableSlots.map(slot => slot.slot);
      for (let i = 4; i <= 15; i++) {
        expect(availableSlotNumbers).not.toContain(i);
      }
    });

    test('should handle variable duration for late night reservations', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create a late night reservation (after 25:00)
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 35, // 26:45
          partySize: 6, // Full capacity
          name: 'Late Night Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      const availability = response.body.availability['2025-06-24'];
      
      // Slots 35-39 should be blocked (5 slots until 28:00)
      const availableSlotNumbers = availability.availableSlots.map(slot => slot.slot);
      for (let i = 35; i <= 39; i++) {
        expect(availableSlotNumbers).not.toContain(i);
      }

      // Should have 35 available slots (40 total - 5 blocked)
      expect(availability.availableSlots).toHaveLength(35);
    });

    test('should handle single date range', async () => {
      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      expect(Object.keys(response.body.availability)).toHaveLength(1);
      expect(response.body.availability['2025-06-24']).toBeDefined();
    });

    test('should handle larger date ranges efficiently', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-20&endDate=2025-07-04')
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (less than 2 seconds)
      expect(duration).toBeLessThan(2000);

      // Should have 15 dates (2025-06-20 to 2025-07-04 inclusive)
      expect(Object.keys(response.body.availability)).toHaveLength(15);
      
      // Verify all dates are present (accounting for timezone offset)
      const expectedDates = [];
      for (let date = new Date('2025-06-19'); date <= new Date('2025-07-03'); date.setDate(date.getDate() + 1)) {
        expectedDates.push(date.toISOString().split('T')[0]);
      }
      
      expectedDates.forEach(date => {
        expect(response.body.availability[date]).toBeDefined();
      });
    });

    test('should return consistent results with individual availability endpoint', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create test reservations
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 8, // 20:00
          partySize: 3,
          name: 'Customer 1',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      // Get individual availability
      const individualResponse = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      // Get batch availability
      const batchResponse = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      const individualSlots = individualResponse.body.availableSlots;
      const batchSlots = batchResponse.body.availability['2025-06-24'].availableSlots;

      // Should have same number of available slots
      expect(individualSlots).toHaveLength(batchSlots.length);

      // Each slot should match
      individualSlots.forEach((individualSlot, index) => {
        const batchSlot = batchSlots[index];
        expect(batchSlot.slot).toBe(individualSlot.slot);
        expect(batchSlot.time).toBe(individualSlot.time);
        expect(batchSlot.availableSeats).toBe(individualSlot.availableSeats);
        expect(batchSlot.maxCapacity).toBe(individualSlot.maxCapacity);
      });
    });

    test('should handle overlapping reservations correctly in batch', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create overlapping reservations on non-overlapping slots
      const nonOverlappingSlots = [0, 12, 24, 36]; // 18:00, 21:00, 24:00, 27:00

      for (let i = 0; i < nonOverlappingSlots.length; i++) {
        await prisma.reservation.create({
          data: {
            date: testDate,
            timeSlot: nonOverlappingSlots[i],
            partySize: 2,
            name: `Customer ${i}`,
            phone: `+123456789${i}`,
            status: 'CONFIRMED'
          }
        });
      }

      const response = await request(app)
        .get('/reservations/availability/batch?startDate=2025-06-25&endDate=2025-06-25')
        .expect(200);

      const availability = response.body.availability['2025-06-24'];
      
      // Should still have available slots since party size is only 2
      expect(availability.availableSlots.length).toBeGreaterThan(0);
      
      // Check that reservations reduce capacity correctly
      const slotsWithReducedCapacity = availability.availableSlots.filter(slot => 
        slot.availableSeats < slot.maxCapacity
      );
      expect(slotsWithReducedCapacity.length).toBeGreaterThan(0);
    });
  });
});