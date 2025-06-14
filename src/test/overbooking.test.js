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

describe('Overbooking Prevention Tests', () => {
  const validReservation = {
    date: '2025-06-25',
    timeSlot: 4,
    partySize: 4,
    name: 'Test Customer',
    phone: '+1234567890',
    email: 'test@example.com'
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.reservation.deleteMany({});
  });

  describe('Sequential Booking Attempts', () => {
    test('should allow multiple bookings until seat capacity is reached', async () => {
      const firstReservation = await request(app)
        .post('/reservations')
        .send(validReservation) // 4 seats
        .expect(201);

      expect(firstReservation.body.reservation).toBeDefined();
      expect(firstReservation.body.reservation.status).toBe('CONFIRMED');

      // Should allow second booking (2 more seats, total 6)
      const secondReservation = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 2,
          name: 'Another Customer',
          phone: '+1987654321'
        })
        .expect(201);

      expect(secondReservation.body.reservation.partySize).toBe(2);

      // Should reject third booking (would exceed capacity)
      const thirdReservation = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 1,
          name: 'Third Customer',
          phone: '+1555555555'
        })
        .expect(409);

      expect(thirdReservation.body.error).toBe('座席が不足しています');
    });

    test('should allow booking different time slots on same date', async () => {
      await request(app)
        .post('/reservations')
        .send(validReservation)
        .expect(201);

      const differentSlot = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 16, // 22:00 - non-overlapping with slot 4 (19:00-22:00)
          name: 'Another Customer',
          phone: '+1987654321'
        })
        .expect(201);

      expect(differentSlot.body.reservation.timeSlot).toBe(16);
    });

    test('should allow booking same time slot on different dates', async () => {
      const firstBooking = await request(app)
        .post('/reservations')
        .send(validReservation)
        .expect(201);

      const differentDate = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          date: '2025-06-26',
          name: 'Another Customer',
          phone: '+1987654321'
        })
        .expect(201);

      expect(differentDate.body.reservation.name).toBe('Another Customer');
      expect(differentDate.body.reservation.timeSlot).toBe(4);
      
      const firstDate = new Date(firstBooking.body.reservation.date);
      const secondDate = new Date(differentDate.body.reservation.date);
      expect(firstDate.getTime()).not.toBe(secondDate.getTime());
    });
  });

  describe('Concurrent Booking Attempts', () => {
    test('should handle concurrent requests for same slot gracefully', async () => {
      // Each reservation is 4 seats, so only 1 should succeed (6 seat limit)
      const promises = Array(3).fill().map((_, index) => 
        request(app)
          .post('/reservations')
          .send({
            ...validReservation,
            name: `Customer ${index + 1}`,
            phone: `+123456789${index}`
          })
      );

      const results = await Promise.allSettled(promises);
      
      const successfulBookings = results.filter(result => 
        result.status === 'fulfilled' && result.value.status === 201
      );
      const failedBookings = results.filter(result => 
        result.status === 'fulfilled' && result.value.status === 409
      );

      expect(successfulBookings).toHaveLength(1);
      expect(failedBookings.length).toBeGreaterThanOrEqual(1);
      
      const totalResults = results.filter(result => result.status === 'fulfilled');
      expect(totalResults.length).toBe(3);

      failedBookings.forEach(booking => {
        expect(booking.value.body.error).toBe('座席が不足しています');
      });
    });

    test('should handle rapid sequential requests correctly', async () => {
      const results = [];
      
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/reservations')
          .send({
            ...validReservation,
            name: `Customer ${i + 1}`,
            phone: `+123456789${i}`
          });
        results.push(response);
      }

      expect(results[0].status).toBe(201);
      expect(results[1].status).toBe(409);
      expect(results[2].status).toBe(409);
    });
  });

  describe('Database Constraint Tests', () => {
    test('should allow multiple reservations in same slot within capacity', async () => {
      const date = new Date('2025-06-25');
      date.setHours(0, 0, 0, 0);

      const firstReservation = await prisma.reservation.create({
        data: {
          date,
          timeSlot: 6,
          partySize: 3,
          name: 'First Customer',
          phone: '+1111111111',
          status: 'CONFIRMED'
        }
      });

      const secondReservation = await prisma.reservation.create({
        data: {
          date,
          timeSlot: 6,
          partySize: 3,
          name: 'Second Customer',
          phone: '+2222222222',
          status: 'CONFIRMED'
        }
      });

      expect(firstReservation.timeSlot).toBe(6);
      expect(secondReservation.timeSlot).toBe(6);
      expect(firstReservation.partySize + secondReservation.partySize).toBe(6);
    });

    test('should verify total party size never exceeds capacity per slot', async () => {
      // First reservation: 4 seats
      await request(app)
        .post('/reservations')
        .send(validReservation)
        .expect(201);

      // Try to book more seats than remaining capacity
      const promises = Array(5).fill().map((_, index) => 
        request(app)
          .post('/reservations')
          .send({
            ...validReservation,
            partySize: 1,
            name: `Customer ${index + 1}`,
            phone: `+123456789${index.toString().padStart(2, '0')}`
          })
      );

      const results = await Promise.allSettled(promises);
      
      const queryDate = new Date('2025-06-25');
      queryDate.setHours(0, 0, 0, 0);
      
      const reservations = await prisma.reservation.findMany({
        where: {
          date: queryDate,
          timeSlot: 4,
          status: 'CONFIRMED'
        }
      });

      const totalSeats = reservations.reduce((sum, res) => sum + res.partySize, 0);
      expect(totalSeats).toBeLessThanOrEqual(6);
    });
  });

  describe('Edge Cases', () => {

    test('should handle deleted reservations correctly', async () => {
      const firstBooking = await request(app)
        .post('/reservations')
        .send(validReservation)
        .expect(201);

      await request(app)
        .delete(`/reservations/${firstBooking.body.reservation.id}`)
        .expect(204);

      const newBooking = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          name: 'New Customer',
          phone: '+1987654321'
        })
        .expect(201);

      expect(newBooking.body.reservation.name).toBe('New Customer');
    });

    test('should allow booking multiple time slots with seat capacity management', async () => {
      // Book sequentially to avoid database locking issues
      const results = [];
      
      // Test non-overlapping slots only (every 12 slots = 3 hours apart)
      const nonOverlappingSlots = [0, 12, 24, 36]; // 18:00, 21:00, 24:00, 27:00
      for (let i = 0; i < nonOverlappingSlots.length; i++) {
        const slot = nonOverlappingSlots[i];
        const result = await request(app)
          .post('/reservations')
          .send({
            ...validReservation,
            timeSlot: slot,
            partySize: 6, // Full capacity
            name: `Customer ${i}`,
            phone: `+12345678${i.toString().padStart(2, '0')}`
          });
        results.push(result);
      }
      
      results.forEach(result => {
        expect(result.status).toBe(201);
      });

      // Should reject booking in slot 0 (already at capacity)
      const extraBooking = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 0,
          partySize: 1,
          name: 'Extra Customer',
          phone: '+1999999999'
        })
        .expect(409);

      expect(extraBooking.body.error).toBe('座席が不足しています');
    });

    test('should verify availability endpoint reflects bookings', async () => {
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 0,
          partySize: 6 // Full capacity
        })
        .expect(201);

      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 12, // 21:00 - non-overlapping with slot 0
          partySize: 6, // Full capacity
          name: 'Another Customer',
          phone: '+1987654321'
        })
        .expect(201);

      const availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      // Slot 0 blocks 0-11 (12 slots), Slot 12 blocks 12-23 (12 slots)
      // Total: 40 - 24 = 16 available slots
      expect(availability.body.availableSlots).toHaveLength(16);
      
      // Check that blocked slots don't appear
      const slot0 = availability.body.availableSlots.find(s => s.slot === 0);
      const slot12 = availability.body.availableSlots.find(s => s.slot === 12);
      
      expect(slot0).toBeUndefined(); // Slot 0 should not appear (fully booked)
      expect(slot12).toBeUndefined(); // Slot 12 should not appear (fully booked)
    });
  });
});