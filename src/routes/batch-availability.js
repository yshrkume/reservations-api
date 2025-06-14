const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Batch availability endpoint for performance optimization
router.get('/batch', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'パラメータエラー',
        message: 'startDateとendDateが必要です'
      });
    }

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');

    // Validate date range
    if (start > end) {
      return res.status(400).json({
        error: 'パラメータエラー',
        message: '開始日は終了日より前である必要があります'
      });
    }

    // Fetch all reservations in the date range at once
    const endForQuery = new Date(end);
    endForQuery.setHours(23, 59, 59, 999);
    
    const existingReservations = await prisma.reservation.findMany({
      where: {
        date: {
          gte: start,
          lte: endForQuery
        },
        status: 'CONFIRMED'
      },
      select: {
        date: true,
        timeSlot: true,
        partySize: true
      }
    });

    const maxCapacity = 6;
    const availability = {};
    
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

    // Generate availability for each date in the range
    let currentDate = new Date(start);
    while (currentDate <= end) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const availableSlots = [];
      
      // Get reservations for this specific date
      const dateReservations = existingReservations.filter(res => {
        const resDate = new Date(res.date);
        resDate.setHours(0, 0, 0, 0);
        const currentDateCopy = new Date(currentDate);
        currentDateCopy.setHours(0, 0, 0, 0);
        return resDate.getTime() === currentDateCopy.getTime();
      });
      
      // Check slots from 18:00 to 27:45 (slot 0-39)
      for (let slot = 0; slot <= 39; slot++) {
        // Calculate maximum bookable seats for 3-hour reservation starting from this slot
        const occupiedSlotsForNewReservation = calculateOccupiedSlots(slot);
        let minAvailableSeats = maxCapacity;
        
        // Check capacity for each slot that would be occupied by a new reservation
        for (const checkSlot of occupiedSlotsForNewReservation) {
          let usedSeats = 0;
          
          dateReservations.forEach(reservation => {
            const resOccupiedSlots = calculateOccupiedSlots(reservation.timeSlot);
            
            // Check if this reservation overlaps with the current check slot
            if (resOccupiedSlots.includes(checkSlot)) {
              usedSeats += reservation.partySize;
            }
          });
          
          const availableSeatsForSlot = maxCapacity - usedSeats;
          minAvailableSeats = Math.min(minAvailableSeats, availableSeatsForSlot);
        }
        
        if (minAvailableSeats > 0) {
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
            availableSeats: minAvailableSeats,
            maxCapacity
          });
        }
      }

      availability[dateKey] = {
        date: dateKey,
        availableSlots
      };
      
      // Move to next date
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Set cache headers for performance
    res.set({
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'ETag': `"${JSON.stringify(availability).length}-${Date.now()}"`
    });

    res.json({
      startDate: startDate,
      endDate: endDate,
      availability
    });
  } catch (error) {
    console.error('Batch availability error:', error);
    res.status(500).json({
      error: 'サーバーエラー',
      message: 'バッチ空席状況の取得に失敗しました'
    });
  }
});

module.exports = router;