const request = require('supertest');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const adminRouter = require('../routes/admin');

jest.mock('../services/sms', () => ({
  sendConfirmation: jest.fn().mockResolvedValue({ success: true, messageId: 'test-id' }),
  sendCancellation: jest.fn().mockResolvedValue({ success: true, messageId: 'test-id' })
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const prisma = new PrismaClient();

describe('Admin API Tests', () => {
  const testPassword = 'test-admin-password';
  const originalEnv = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = testPassword;
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env.ADMIN_PASSWORD = originalEnv;
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.reservation.deleteMany({});
  });

  describe('Authentication', () => {
    test('should authenticate admin with correct password', async () => {
      const response = await request(app)
        .post('/admin/login')
        .send({ password: testPassword })
        .expect(200);

      expect(response.body.message).toBe('管理者認証に成功しました');
      expect(response.body.token).toBe('admin-authenticated');
    });

    test('should reject admin with incorrect password', async () => {
      const response = await request(app)
        .post('/admin/login')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(response.body.error).toBe('認証が必要です');
      expect(response.body.message).toBe('管理者パスワードが正しくありません');
    });

    test('should reject admin with no password', async () => {
      const response = await request(app)
        .post('/admin/login')
        .send({})
        .expect(401);

      expect(response.body.error).toBe('認証が必要です');
    });
  });

  describe('Admin Reservations', () => {
    test('should get all reservations for admin', async () => {
      // Create test reservation
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 4, // 19:00
          partySize: 2,
          name: 'Test Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .post('/admin/reservations')
        .send({ password: testPassword })
        .expect(200);

      expect(response.body.reservations).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
      expect(response.body.reservations[0].name).toBe('Test Customer');
      expect(response.body.reservations[0].startTime).toBe('19:00');
      expect(response.body.reservations[0].endTime).toBe('22:00');
      expect(response.body.reservations[0].duration).toBe('3時間');
    });

    test('should filter reservations by date', async () => {
      const testDate1 = new Date('2025-06-25');
      const testDate2 = new Date('2025-06-26');
      testDate1.setHours(0, 0, 0, 0);
      testDate2.setHours(0, 0, 0, 0);

      // Create reservations on different dates
      await prisma.reservation.create({
        data: {
          date: testDate1,
          timeSlot: 4,
          partySize: 2,
          name: 'Customer 1',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      await prisma.reservation.create({
        data: {
          date: testDate2,
          timeSlot: 8,
          partySize: 3,
          name: 'Customer 2',
          phone: '+1987654321',
          status: 'CONFIRMED'
        }
      });

      // Filter by first date
      const response = await request(app)
        .post('/admin/reservations')
        .send({ 
          password: testPassword,
          date: '2025-06-25'
        })
        .expect(200);

      expect(response.body.reservations).toHaveLength(1);
      expect(response.body.reservations[0].name).toBe('Customer 1');
    });

    test('should require authentication for reservations', async () => {
      const response = await request(app)
        .post('/admin/reservations')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(response.body.error).toBe('認証が必要です');
    });
  });

  describe('Admin Summary', () => {
    test('should get daily summary with hourly occupancy', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create test reservations
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 0, // 18:00
          partySize: 3,
          name: 'Customer 1',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 16, // 22:00
          partySize: 2,
          name: 'Customer 2',
          phone: '+1987654321',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .post('/admin/summary')
        .send({ 
          password: testPassword,
          date: '2025-06-25'
        })
        .expect(200);

      expect(response.body.totalReservations).toBe(2);
      expect(response.body.totalGuests).toBe(5);
      expect(response.body.hourlyOccupancy).toBeDefined();
      expect(response.body.hourlyOccupancy['18:00']).toBeDefined();
      expect(response.body.hourlyOccupancy['18:00'].reservations).toHaveLength(1);
      expect(response.body.hourlyOccupancy['22:00']).toBeDefined();
      expect(response.body.hourlyOccupancy['22:00'].reservations).toHaveLength(1);
    });

    test('should require authentication for summary', async () => {
      const response = await request(app)
        .post('/admin/summary')
        .send({ 
          password: 'wrong-password',
          date: '2025-06-25'
        })
        .expect(401);

      expect(response.body.error).toBe('認証が必要です');
    });
  });

  describe('Admin Delete Reservation', () => {
    test('should delete reservation as admin', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      const reservation = await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 4,
          partySize: 2,
          name: 'Test Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      await request(app)
        .delete(`/admin/reservations/${reservation.id}`)
        .send({ password: testPassword })
        .expect(204);

      // Verify deletion
      const deletedReservation = await prisma.reservation.findUnique({
        where: { id: reservation.id }
      });
      expect(deletedReservation).toBeNull();
    });

    test('should return 404 for non-existent reservation', async () => {
      const response = await request(app)
        .delete('/admin/reservations/non-existent-id')
        .send({ password: testPassword })
        .expect(404);

      expect(response.body.error).toBe('予約が見つかりません');
    });

    test('should require authentication for deletion', async () => {
      const response = await request(app)
        .delete('/admin/reservations/some-id')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(response.body.error).toBe('認証が必要です');
    });
  });

  describe('Time Formatting Edge Cases', () => {
    test('should handle late night hours correctly in admin responses', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create reservation at 25:00 (1:00 AM)
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 28, // 25:00
          partySize: 2,
          name: 'Late Night Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .post('/admin/reservations')
        .send({ password: testPassword })
        .expect(200);

      expect(response.body.reservations[0].startTime).toBe('01:00');
      expect(response.body.reservations[0].endTime).toBe('04:00');
    });

    test('should handle 27:45 (last slot) correctly', async () => {
      const testDate = new Date('2025-06-25');
      testDate.setHours(0, 0, 0, 0);

      // Create reservation at 27:45 (3:45 AM)
      await prisma.reservation.create({
        data: {
          date: testDate,
          timeSlot: 39, // 27:45
          partySize: 1,
          name: 'Very Late Customer',
          phone: '+1234567890',
          status: 'CONFIRMED'
        }
      });

      const response = await request(app)
        .post('/admin/reservations')
        .send({ password: testPassword })
        .expect(200);

      expect(response.body.reservations[0].startTime).toBe('03:45');
      expect(response.body.reservations[0].endTime).toBe('06:45');
    });
  });
});