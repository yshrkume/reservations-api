const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { createReservationSchema, updateReservationSchema } = require('../validation/schemas');
const smsService = require('../services/sms');

const router = express.Router();
const prisma = new PrismaClient();

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(detail => detail.message)
      });
    }
    next();
  };
};

router.post('/', validateRequest(createReservationSchema), async (req, res) => {
  try {
    const { date, timeSlot, partySize, name, phone, email, notes } = req.body;
    
    const reservationDate = new Date(date);
    reservationDate.setHours(0, 0, 0, 0);

    const existingReservation = await prisma.reservation.findUnique({
      where: {
        date_timeSlot: {
          date: reservationDate,
          timeSlot: timeSlot
        }
      }
    });

    if (existingReservation) {
      return res.status(409).json({
        error: 'Time slot already booked',
        message: 'This time slot is no longer available'
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        date: reservationDate,
        timeSlot,
        partySize,
        name,
        phone,
        email,
        notes,
        status: 'CONFIRMED'
      }
    });

    const smsResult = await smsService.sendConfirmation(phone, reservation);
    
    res.status(201).json({
      reservation,
      sms: smsResult.success ? 'sent' : 'failed'
    });

  } catch (error) {
    console.error('Create reservation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to create reservation'
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const { date, status, phone } = req.query;
    
    // Require phone number for security\n    if (!phone) {\n      return res.status(400).json({\n        error: 'Phone number required',\n        message: 'Phone number is required to view reservations'\n      });\n    }\n    \n    const where = { phone }; // Only return reservations for this phone number
    if (date) {
      const queryDate = new Date(date);
      queryDate.setHours(0, 0, 0, 0);
      where.date = queryDate;
    }
    if (status) {
      where.status = status;
    }

    const reservations = await prisma.reservation.findMany({
      where,
      orderBy: [
        { date: 'asc' },
        { timeSlot: 'asc' }
      ]
    });

    res.json(reservations);
  } catch (error) {
    console.error('Get reservations error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch reservations'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const reservation = await prisma.reservation.findUnique({
      where: { id }
    });

    if (!reservation) {
      return res.status(404).json({
        error: 'Reservation not found'
      });
    }

    res.json(reservation);
  } catch (error) {
    console.error('Get reservation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch reservation'
    });
  }
});

router.patch('/:id', validateRequest(updateReservationSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const existingReservation = await prisma.reservation.findUnique({
      where: { id }
    });

    if (!existingReservation) {
      return res.status(404).json({
        error: 'Reservation not found'
      });
    }

    const reservation = await prisma.reservation.update({
      where: { id },
      data: updates
    });

    if (updates.status === 'CANCELLED') {
      await smsService.sendCancellation(existingReservation.phone, reservation);
    }

    res.json(reservation);
  } catch (error) {
    console.error('Update reservation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to update reservation'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existingReservation = await prisma.reservation.findUnique({
      where: { id }
    });

    if (!existingReservation) {
      return res.status(404).json({
        error: 'Reservation not found'
      });
    }

    await prisma.reservation.delete({
      where: { id }
    });

    await smsService.sendCancellation(existingReservation.phone, existingReservation);

    res.status(204).send();
  } catch (error) {
    console.error('Delete reservation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to delete reservation'
    });
  }
});

router.get('/availability/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    const existingReservations = await prisma.reservation.findMany({
      where: {
        date: queryDate,
        status: 'CONFIRMED'
      },
      select: {
        timeSlot: true
      }
    });

    const bookedSlots = existingReservations.map(r => r.timeSlot);
    const availableSlots = [];
    
    for (let slot = 0; slot <= 39; slot++) {
      if (!bookedSlots.includes(slot)) {
        const startHour = Math.floor(slot / 4) + 18;
        const startMin = (slot % 4) * 15;
        const endHour = Math.floor((slot + 1) / 4) + 18;
        const endMin = ((slot + 1) % 4) * 15;
        
        const formatTime = (hour, min) => {
          const displayHour = hour > 24 ? hour - 24 : hour;
          return `${displayHour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        };
        
        availableSlots.push({
          slot,
          time: `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`
        });
      }
    }

    res.json({
      date: queryDate.toISOString().split('T')[0],
      availableSlots
    });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch availability'
    });
  }
});

module.exports = router;