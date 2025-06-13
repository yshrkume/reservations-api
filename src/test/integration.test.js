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

describe('Seat-Based Reservation System Integration Tests', () => {
  const validReservation = {
    date: '2025-06-25',
    timeSlot: 4, // 19:00 (allows 3-hour reservation until 22:00)
    partySize: 2,
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

  describe('3-Hour Reservation System', () => {
    test('should block all slots for 3 hours when fully booked', async () => {
      // Book 6 people at 18:00 (slot 0)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 0, // 18:00
          partySize: 6
        })
        .expect(201);

      // Check that no slots are available for the next 3 hours
      const availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      // Should only have slots 12+ available (21:00+)
      const availableSlotNumbers = availability.body.availableSlots.map(s => s.slot);
      expect(availableSlotNumbers.every(slot => slot >= 12)).toBe(true);
    });

    test('should allow overlapping reservations within capacity', async () => {
      // Book 3 people at 18:00
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 0, // 18:00
          partySize: 3
        })
        .expect(201);

      // Book 2 people at 19:00 (should succeed - overlaps with first reservation)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 4, // 19:00
          partySize: 2,
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(201);

      // Try to book 2 more people at 20:00 (should fail - would exceed capacity)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 8, // 20:00
          partySize: 2,
          name: 'Customer 3',
          phone: '+1555555555'
        })
        .expect(409);
    });
  });

  describe('Seat Capacity Management', () => {
    test('should allow multiple reservations up to 6 seats per slot', async () => {
      // Book 2 seats
      const first = await request(app)
        .post('/reservations')
        .send(validReservation)
        .expect(201);

      expect(first.body.reservation.partySize).toBe(2);

      // Book 3 more seats (total 5)
      const second = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 3,
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(201);

      expect(second.body.reservation.partySize).toBe(3);

      // Book 1 more seat (total 6, at capacity)
      const third = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 1,
          name: 'Customer 3',
          phone: '+1555555555'
        })
        .expect(201);

      // Try to book 1 more seat (should fail)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 1,
          name: 'Customer 4',
          phone: '+1444444444'
        })
        .expect(409);
    });

    test('should reject reservations exceeding 6 seats per slot', async () => {
      // Try to book 7 seats in one reservation
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 7
        })
        .expect(400); // Validation error

      // Book 4 seats first
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 4
        })
        .expect(201);

      // Try to book 3 more seats (would exceed capacity)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 3,
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(409);
    });
  });

  describe('Time Slot Validation', () => {
    test('should accept valid time slots (0-27)', async () => {
      // Test first slot (18:00)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 0
        })
        .expect(201);

      // Test last slot (24:45-25:00)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 27,
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(201);
    });

    test('should reject invalid time slots', async () => {
      // Test slot beyond range (29+ not allowed for 3-hour reservations)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 29
        })
        .expect(400);

      // Test negative slot
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: -1
        })
        .expect(400);
    });
  });

  describe('Availability Endpoint', () => {
    test('should return correct availability with seat counts', async () => {
      // Book 4 seats in slot 8 (20:00)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 8,
          partySize: 4
        })
        .expect(201);

      // Check availability
      const availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      const slot8 = availability.body.availableSlots.find(s => s.slot === 8);
      expect(slot8).toBeDefined();
      expect(slot8.availableSeats).toBe(2);
      expect(slot8.maxCapacity).toBe(6);

      // Verify other slots have full capacity
      const slot0 = availability.body.availableSlots.find(s => s.slot === 0);
      expect(slot0.availableSeats).toBe(6);
    });

    test('should not show fully booked slots', async () => {
      // Book full capacity in slot 10
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 10,
          partySize: 6
        })
        .expect(201);

      const availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      // Slot 10 should not appear in available slots
      const slot10 = availability.body.availableSlots.find(s => s.slot === 10);
      expect(slot10).toBeUndefined();

      // Should have 28 available slots (29 total - 1 fully booked)
      expect(availability.body.availableSlots).toHaveLength(28);
    });
  });

  describe('Deletion and Seat Liberation', () => {
    test('should free up seats when reservation is deleted', async () => {
      // Book 4 seats
      const reservation = await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 4
        })
        .expect(201);

      // Verify only 2 seats available
      let availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      let slot = availability.body.availableSlots.find(s => s.slot === 4);
      expect(slot.availableSeats).toBe(2);

      // Delete the reservation
      await request(app)
        .delete(`/reservations/${reservation.body.reservation.id}`)
        .expect(204);

      // Verify all 6 seats are now available
      availability = await request(app)
        .get('/reservations/availability/2025-06-25')
        .expect(200);

      slot = availability.body.availableSlots.find(s => s.slot === 4);
      expect(slot.availableSeats).toBe(6);
    });
  });

  describe('Business Rules Validation', () => {
    test('should enforce date range (2025-06-20 to 2025-07-04)', async () => {
      // Test valid date
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          date: '2025-06-20'
        })
        .expect(201);

      // Test date before range
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          date: '2025-06-19',
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(400);

      // Test date after range
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          date: '2025-07-05',
          name: 'Customer 3',
          phone: '+1555555555'
        })
        .expect(400);
    });

    test('should enforce party size limits (1-6)', async () => {
      // Test minimum party size
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 1
        })
        .expect(201);

      // Test maximum party size (different time slot)
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          timeSlot: 9, // Different slot from the first reservation
          partySize: 6,
          name: 'Customer 2',
          phone: '+1987654321'
        })
        .expect(201);

      // Test zero party size
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 0,
          name: 'Customer 3',
          phone: '+1555555555'
        })
        .expect(400);

      // Test exceeding maximum
      await request(app)
        .post('/reservations')
        .send({
          ...validReservation,
          partySize: 7,
          name: 'Customer 4',
          phone: '+1444444444'
        })
        .expect(400);
    });
  });
});