const express = require('express');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const smsService = require('../services/sms');

const router = express.Router();
const prisma = new PrismaClient();

// Secure admin authentication middleware with timing attack protection
const authenticateAdmin = (req, res, next) => {
  const { password } = req.body || req.headers;
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  // Input validation
  if (!password || typeof password !== 'string') {
    return res.status(401).json({
      error: '認証が必要です',
      message: '管理者パスワードが正しくありません'
    });
  }
  
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD environment variable is not set');
    return res.status(500).json({
      error: 'サーバーエラー',
      message: 'サーバー設定に問題があります'
    });
  }
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    const providedBuffer = Buffer.from(password, 'utf8');
    const expectedBuffer = Buffer.from(adminPassword, 'utf8');
    
    // Ensure both buffers have the same length to prevent timing attacks
    const isValidLength = providedBuffer.length === expectedBuffer.length;
    const isValidPassword = isValidLength && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    
    if (!isValidPassword) {
      return res.status(401).json({
        error: '認証が必要です',
        message: '管理者パスワードが正しくありません'
      });
    }
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      error: '認証が必要です',
      message: '管理者パスワードが正しくありません'
    });
  }
};

// Admin login endpoint
router.post('/login', authenticateAdmin, (req, res) => {
  res.json({
    message: '管理者認証に成功しました',
    token: 'admin-authenticated' // Simple token for session management
  });
});

// Get all reservations for admin dashboard
router.post('/reservations', authenticateAdmin, async (req, res) => {
  try {
    const { date } = req.body;
    
    const whereClause = {
      status: 'CONFIRMED'
    };
    
    if (date) {
      const queryDate = new Date(date);
      queryDate.setHours(0, 0, 0, 0);
      whereClause.date = queryDate;
    }

    const reservations = await prisma.reservation.findMany({
      where: whereClause,
      orderBy: [
        { date: 'asc' },
        { timeSlot: 'asc' }
      ]
    });

    // Format reservations for Gantt chart display
    const formattedReservations = reservations.map(reservation => {
      const startHour = Math.floor(reservation.timeSlot / 4) + 18;
      const startMin = (reservation.timeSlot % 4) * 15;
      const endHour = startHour + 3; // 3-hour reservation
      const endMin = startMin;
      
      const formatTime = (hour, min) => {
        const displayHour = hour >= 24 ? hour - 24 : hour;
        return `${displayHour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
      };
      
      return {
        ...reservation,
        startTime: formatTime(startHour, startMin),
        endTime: formatTime(endHour, endMin),
        duration: '3時間',
        dateString: reservation.date.toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long'
        })
      };
    });

    res.json({
      reservations: formattedReservations,
      totalCount: reservations.length
    });
  } catch (error) {
    console.error('Admin reservations fetch error:', error);
    res.status(500).json({
      error: 'サーバーエラー',
      message: '予約データの取得に失敗しました'
    });
  }
});

// Get daily summary for admin dashboard
router.post('/summary', authenticateAdmin, async (req, res) => {
  try {
    const { date } = req.body;
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    const reservations = await prisma.reservation.findMany({
      where: {
        date: queryDate,
        status: 'CONFIRMED'
      }
    });

    // Calculate hourly occupancy
    const hourlyOccupancy = {};
    const maxCapacity = 6;

    // Initialize all hours
    for (let hour = 18; hour <= 27; hour++) {
      const displayHour = hour >= 24 ? hour - 24 : hour;
      const timeKey = `${displayHour.toString().padStart(2, '0')}:00`;
      hourlyOccupancy[timeKey] = {
        occupiedSeats: 0,
        availableSeats: maxCapacity,
        reservations: []
      };
    }

    // Calculate actual occupancy for each hour
    for (let hour = 18; hour <= 27; hour++) {
      const displayHour = hour >= 24 ? hour - 24 : hour;
      const timeKey = `${displayHour.toString().padStart(2, '0')}:00`;
      
      if (hourlyOccupancy[timeKey]) {
        let totalOccupied = 0;
        
        // Check all reservations that overlap with this hour
        reservations.forEach(reservation => {
          const startSlot = reservation.timeSlot;
          const endSlot = startSlot + 11; // 3 hours = 12 slots (0-11)
          const hourStartSlot = (hour - 18) * 4; // Convert hour to slot
          const hourEndSlot = hourStartSlot + 3; // Hour covers 4 slots (0-3)
          
          // Check if reservation overlaps with this hour
          if (startSlot <= hourEndSlot && endSlot >= hourStartSlot) {
            totalOccupied += reservation.partySize;
            
            // Add reservation details only to the starting hour
            const resStartHour = Math.floor(startSlot / 4) + 18;
            if (resStartHour === hour) {
              const displayStartHour = resStartHour >= 24 ? resStartHour - 24 : resStartHour;
              hourlyOccupancy[timeKey].reservations.push({
                name: reservation.name,
                partySize: reservation.partySize,
                phone: reservation.phone,
                startTime: `${displayStartHour.toString().padStart(2, '0')}:${((startSlot % 4) * 15).toString().padStart(2, '0')}`,
                endTime: `${((resStartHour + 3) >= 24 ? (resStartHour + 3) - 24 : resStartHour + 3).toString().padStart(2, '0')}:${((startSlot % 4) * 15).toString().padStart(2, '0')}`
              });
            }
          }
        });
        
        hourlyOccupancy[timeKey].occupiedSeats = totalOccupied;
        hourlyOccupancy[timeKey].availableSeats = maxCapacity - totalOccupied;
      }
    }

    const summary = {
      date: queryDate.toLocaleDateString('ja-JP'),
      totalReservations: reservations.length,
      totalGuests: reservations.reduce((sum, res) => sum + res.partySize, 0),
      hourlyOccupancy
    };

    res.json(summary);
  } catch (error) {
    console.error('Admin summary fetch error:', error);
    res.status(500).json({
      error: 'サーバーエラー',
      message: 'サマリーデータの取得に失敗しました'
    });
  }
});

// Delete reservation (admin only)
router.delete('/reservations/:id', authenticateAdmin, async (req, res) => {
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

    // Send cancellation SMS before deleting
    let smsResult = { success: false };
    try {
      smsResult = await smsService.sendCancellation(existingReservation.phone, existingReservation);
      console.log('キャンセルSMS送信結果:', smsResult);
    } catch (smsError) {
      console.error('キャンセルSMS送信エラー:', smsError);
      // SMS送信失敗でも削除は続行
    }

    await prisma.reservation.delete({
      where: { id }
    });

    res.json({
      message: '予約を削除しました',
      sms: smsResult.success ? 'sent' : 'failed',
      reservation: existingReservation
    });
  } catch (error) {
    console.error('Admin delete reservation error:', error);
    res.status(500).json({
      error: 'サーバーエラー',
      message: '予約の削除に失敗しました'
    });
  }
});

module.exports = router;