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

describe('Capacity Overflow Bug Tests', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.reservation.deleteMany({});
  });

  test('should not allow booking 4 people when only 3 seats remain', async () => {
    const testDate = '2025-06-25';
    const testSlot = 4; // 19:00

    // First, book 3 people to leave 3 seats available
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: testSlot,
        partySize: 3,
        name: 'Customer 1',
        phone: '+1234567890'
      })
      .expect(201);

    // Verify 3 seats remain
    const availability = await request(app)
      .get(`/reservations/availability/${testDate}`)
      .expect(200);

    const slot4 = availability.body.availableSlots.find(s => s.slot === testSlot);
    expect(slot4.availableSeats).toBe(3);

    // Try to book 4 people (should fail)
    const response = await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: testSlot,
        partySize: 4,
        name: 'Customer 2',
        phone: '+1987654321'
      })
      .expect(409);

    expect(response.body.error).toContain('座席が不足しています');
  });

  test('should allow booking exactly the remaining seats', async () => {
    const testDate = '2025-06-25';
    const testSlot = 8; // 20:00

    // Book 2 people first
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: testSlot,
        partySize: 2,
        name: 'Customer 1',
        phone: '+1234567890'
      })
      .expect(201);

    // Book 4 more people (exactly the remaining seats)
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: testSlot,
        partySize: 4,
        name: 'Customer 2',
        phone: '+1987654321'
      })
      .expect(201);

    // Verify no seats remain
    const availability = await request(app)
      .get(`/reservations/availability/${testDate}`)
      .expect(200);

    const slot8 = availability.body.availableSlots.find(s => s.slot === testSlot);
    expect(slot8).toBeUndefined(); // Slot should not appear when fully booked
  });

  test('should handle 3-hour overlapping reservations correctly', async () => {
    const testDate = '2025-06-25';
    const slot18 = 0;  // 18:00
    const slot19 = 4;  // 19:00
    const slot20 = 8;  // 20:00

    // Book 4 people at 18:00 (affects 18:00-21:00)
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: slot18,
        partySize: 4,
        name: 'Customer 1',
        phone: '+1234567890'
      })
      .expect(201);

    // Try to book 3 more people at 19:00 (should fail - only 2 seats left)
    const response = await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: slot19,
        partySize: 3,
        name: 'Customer 2',
        phone: '+1987654321'
      })
      .expect(409);

    expect(response.body.error).toContain('座席が不足しています');

    // Book 2 people at 19:00 (should succeed)
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: slot19,
        partySize: 2,
        name: 'Customer 3',
        phone: '+1555555555'
      })
      .expect(201);

    // Try to book 1 more person at 20:00 (should fail - all seats taken for overlapping period)
    await request(app)
      .post('/reservations')
      .send({
        date: testDate,
        timeSlot: slot20,
        partySize: 1,
        name: 'Customer 4',
        phone: '+1444444444'
      })
      .expect(409);
  });
});