const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { createReservationSchema } = require('../validation/schemas');
const smsService = require('../services/sms');

const router = express.Router();
const prisma = new PrismaClient();

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'バリデーションエラー',
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

    // Check seat capacity for 3-hour duration using a transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Calculate occupied slots based on time slot position
      const occupiedSlots = [];
      const maxSlot = 39; // 27:45-28:00 is the last slot
      
      if (timeSlot <= 27) {
        // Regular hours: 3 hours (12 slots) but don't exceed maxSlot
        for (let i = 0; i < 12; i++) {
          const slot = timeSlot + i;
          if (slot <= maxSlot) {
            occupiedSlots.push(slot);
          }
        }
      } else {
        // Late night hours (25:00+): reserve until 28:00 (slot 39)
        for (let slot = timeSlot; slot <= maxSlot; slot++) {
          occupiedSlots.push(slot);
        }
      }

      const maxCapacity = 6;
      
      // Get all existing reservations for this date
      const existingReservations = await tx.reservation.findMany({
        where: {
          date: reservationDate,
          status: 'CONFIRMED'
        }
      });

      // Helper function to calculate occupied slots for any reservation
      const calculateOccupiedSlots = (reservationTimeSlot) => {
        const slots = [];
        const maxSlot = 39;
        
        if (reservationTimeSlot <= 27) {
          // Regular hours: 3 hours (12 slots) but don't exceed maxSlot
          for (let i = 0; i < 12; i++) {
            const slot = reservationTimeSlot + i;
            if (slot <= maxSlot) {
              slots.push(slot);
            }
          }
        } else {
          // Late night hours (25:00+): reserve until 28:00 (slot 39)
          for (let slot = reservationTimeSlot; slot <= maxSlot; slot++) {
            slots.push(slot);
          }
        }
        return slots;
      };

      // Check capacity for each slot that will be occupied by the new reservation
      for (const slot of occupiedSlots) {
        // Calculate occupied seats for this specific slot
        const slotOccupiedSeats = existingReservations
          .filter(res => {
            // Check if this existing reservation overlaps with the current slot
            const resOccupiedSlots = calculateOccupiedSlots(res.timeSlot);
            return resOccupiedSlots.includes(slot);
          })
          .reduce((sum, res) => sum + res.partySize, 0);
        
        if (slotOccupiedSeats + partySize > maxCapacity) {
          const availableSeats = maxCapacity - slotOccupiedSeats;
          const slotHour = Math.floor(slot / 4) + 18;
          const slotMin = (slot % 4) * 15;
          const timeString = `${slotHour >= 24 ? slotHour - 24 : slotHour}:${slotMin.toString().padStart(2, '0')}`;
          throw new Error(`座席が不足しています。${timeString}の時間帯の残席数: ${availableSeats}席`);
        }
      }

      return await tx.reservation.create({
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
    });

    // コスト削減: 条件付きSMS送信
    let smsResult = { success: false, reason: 'not_sent' };
    
    // 4名以上の予約のみSMS送信（コスト削減オプション）
    const shouldSendSMS = process.env.SMS_COST_SAVING === 'true' 
      ? result.partySize >= 4  // 4名以上のみ
      : true;  // 通常は全て送信
    
    if (shouldSendSMS) {
      smsResult = await smsService.sendConfirmation(phone, result);
    } else {
      console.log(`SMS送信スキップ（コスト削減）: ${result.partySize}名の予約`);
    }
    
    res.status(201).json({
      reservation: result,
      sms: smsResult.success ? 'sent' : smsResult.reason || 'failed'
    });

  } catch (error) {
    console.error('Create reservation error:', error);
    console.error('Error stack:', error.stack);
    
    // Handle capacity exceeded error
    if (error.message.includes('座席が不足しています')) {
      return res.status(409).json({
        error: '座席が不足しています',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'サーバーエラー',
      message: '予約の作成に失敗しました',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const { date, status, phone } = req.query;
    
    // Require phone number for security
    if (!phone) {
      return res.status(400).json({
        error: '電話番号が必要です',
        message: '予約を確認するには電話番号が必要です'
      });
    }
    
    const where = { phone }; // Only return reservations for this phone number
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
      error: 'サーバーエラー',
      message: '予約の取得に失敗しました'
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
        error: '予約が見つかりません'
      });
    }

    res.json(reservation);
  } catch (error) {
    console.error('Get reservation error:', error);
    res.status(500).json({
      error: 'サーバーエラー',
      message: '予約の取得に失敗しました'
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
        error: '予約が見つかりません'
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
      error: 'サーバーエラー',
      message: '予約の削除に失敗しました'
    });
  }
});

// Batch availability endpoint for performance optimization
const batchAvailabilityRouter = require('./batch-availability');
router.use('/availability', batchAvailabilityRouter);

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
        timeSlot: true,
        partySize: true
      }
    });

    const maxCapacity = 6;
    const availableSlots = [];
    
    // Helper function to calculate occupied slots for any reservation
    const calculateOccupiedSlots = (reservationTimeSlot) => {
      const slots = [];
      const maxSlot = 39;
      
      if (reservationTimeSlot <= 27) {
        // Regular hours: 3 hours (12 slots) but don't exceed maxSlot
        for (let i = 0; i < 12; i++) {
          const slot = reservationTimeSlot + i;
          if (slot <= maxSlot) {
            slots.push(slot);
          }
        }
      } else {
        // Late night hours (25:00+): reserve until 28:00 (slot 39)
        for (let slot = reservationTimeSlot; slot <= maxSlot; slot++) {
          slots.push(slot);
        }
      }
      return slots;
    };
    
    // Check slots from 18:00 to 27:45 (slot 0-39)
    for (let slot = 0; slot <= 39; slot++) {
      // Calculate occupied seats for this slot considering variable duration overlaps
      let usedSeats = 0;
      
      existingReservations.forEach(reservation => {
        const resOccupiedSlots = calculateOccupiedSlots(reservation.timeSlot);
        
        // Check if this reservation overlaps with the current slot
        if (resOccupiedSlots.includes(slot)) {
          usedSeats += reservation.partySize;
        }
      });
      
      const availableSeats = maxCapacity - usedSeats;
      
      if (availableSeats > 0) {
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
          time: `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`,
          availableSeats,
          maxCapacity
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
      error: 'サーバーエラー',
      message: '空席状況の取得に失敗しました'
    });
  }
});

module.exports = router;