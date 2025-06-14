const SMSService = require('../services/sms');

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn(() => ({
    messages: {
      create: jest.fn()
    }
  }));
});

describe('SMS Service Tests', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER
    };
  });

  afterAll(() => {
    process.env.TWILIO_ACCOUNT_SID = originalEnv.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = originalEnv.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_PHONE_NUMBER = originalEnv.TWILIO_PHONE_NUMBER;
  });

  describe('SMS Service Initialization', () => {
    test('should be disabled when Twilio credentials are not provided', () => {
      // Save original values
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      const originalPhone = process.env.TWILIO_PHONE_NUMBER;
      
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_PHONE_NUMBER;

      // Re-require to get fresh instance
      jest.resetModules();
      const freshSMSService = require('../services/sms');
      
      expect(freshSMSService.enabled).toBe(false);
      
      // Restore original values
      if (originalSid) process.env.TWILIO_ACCOUNT_SID = originalSid;
      if (originalToken) process.env.TWILIO_AUTH_TOKEN = originalToken;
      if (originalPhone) process.env.TWILIO_PHONE_NUMBER = originalPhone;
    });

    test('should be enabled when Twilio credentials are provided', () => {
      process.env.TWILIO_ACCOUNT_SID = 'test_sid';
      process.env.TWILIO_AUTH_TOKEN = 'test_token';
      process.env.TWILIO_PHONE_NUMBER = '+1234567890';

      jest.resetModules();
      const freshSMSService = require('../services/sms');
      
      expect(freshSMSService.enabled).toBe(true);
    });
  });

  describe('Phone Number Normalization', () => {
    test('should normalize Japanese mobile numbers', () => {
      expect(SMSService.normalizePhoneNumber('090-1234-5678')).toBe('+819012345678');
      expect(SMSService.normalizePhoneNumber('080 1234 5678')).toBe('+818012345678');
      expect(SMSService.normalizePhoneNumber('07012345678')).toBe('+817012345678');
    });

    test('should handle already normalized numbers', () => {
      expect(SMSService.normalizePhoneNumber('+819012345678')).toBe('+819012345678');
      expect(SMSService.normalizePhoneNumber('+818012345678')).toBe('+818012345678');
    });

    test('should normalize landline numbers', () => {
      expect(SMSService.normalizePhoneNumber('03-1234-5678')).toBe('+81312345678');
      expect(SMSService.normalizePhoneNumber('0612345678')).toBe('+81612345678');
    });

    test('should handle numbers starting with 81', () => {
      expect(SMSService.normalizePhoneNumber('819012345678')).toBe('+819012345678');
    });

    test('should return null for invalid numbers', () => {
      expect(SMSService.normalizePhoneNumber('')).toBe(null);
      expect(SMSService.normalizePhoneNumber(null)).toBe(null);
      expect(SMSService.normalizePhoneNumber('123')).toBe(null);
    });

    test('should handle numbers with various formatting', () => {
      expect(SMSService.normalizePhoneNumber('(090) 1234-5678')).toBe('+819012345678');
      expect(SMSService.normalizePhoneNumber('090 - 1234 - 5678')).toBe('+819012345678');
    });
  });

  describe('Time Slot Formatting', () => {
    test('should format regular hours correctly', () => {
      const formatted = SMSService.formatTimeSlot(0); // 18:00
      expect(formatted).toBe('18:00-18:15');
    });

    test('should format late night hours correctly', () => {
      const formatted = SMSService.formatTimeSlot(28); // 25:00 -> 1:00
      expect(formatted).toBe('01:00-01:15');
    });

    test('should format last slot correctly', () => {
      const formatted = SMSService.formatTimeSlot(39); // 27:45 -> 3:45
      expect(formatted).toBe('03:45-04:00');
    });

    test('should handle midnight transition', () => {
      const formatted = SMSService.formatTimeSlot(24); // 24:00 stays as 24:00 (midnight)
      expect(formatted).toBe('24:00-24:15');
    });
  });

  describe('SMS Sending (Disabled Mode)', () => {
    beforeEach(() => {
      // Ensure SMS is disabled for these tests
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      jest.resetModules();
    });

    test('should skip confirmation SMS when disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const freshSMSService = require('../services/sms');
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 4,
        partySize: 2,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendConfirmation('+1234567890', reservation);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('disabled');
      expect(consoleSpy).toHaveBeenCalledWith('SMS送信をスキップ (Twilio未設定):', '+1234567890');
      
      consoleSpy.mockRestore();
    });

    test('should skip cancellation SMS when disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const freshSMSService = require('../services/sms');
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 8,
        partySize: 3,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendCancellation('+1234567890', reservation);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('disabled');
      expect(consoleSpy).toHaveBeenCalledWith('SMS送信をスキップ (Twilio未設定):', '+1234567890');
      
      consoleSpy.mockRestore();
    });

    test('should skip reminder SMS when disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const freshSMSService = require('../services/sms');
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 12,
        partySize: 4,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendReminder('+1234567890', reservation);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('disabled');
      expect(consoleSpy).toHaveBeenCalledWith('SMS送信をスキップ (Twilio未設定):', '+1234567890');
      
      consoleSpy.mockRestore();
    });
  });

  describe('SMS Sending (Enabled Mode)', () => {
    let mockCreate;
    let freshSMSService;

    beforeEach(() => {
      // Enable SMS for these tests
      process.env.TWILIO_ACCOUNT_SID = 'test_sid';
      process.env.TWILIO_AUTH_TOKEN = 'test_token';
      process.env.TWILIO_PHONE_NUMBER = '+1234567890';

      mockCreate = jest.fn();
      
      // Mock twilio module
      jest.resetModules();
      jest.doMock('twilio', () => {
        return jest.fn(() => ({
          messages: {
            create: mockCreate
          }
        }));
      });
      
      freshSMSService = require('../services/sms');
    });

    test('should send confirmation SMS when enabled', async () => {
      mockCreate.mockResolvedValue({ sid: 'test-message-id' });
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 4, // 19:00
        partySize: 2,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendConfirmation('+1234567890', reservation);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-message-id');
      expect(mockCreate).toHaveBeenCalledWith({
        body: expect.stringContaining('【義田鮨 ご予約確認】'),
        from: '+1234567890',
        to: '+1234567890'
      });
    });

    test('should send cancellation SMS when enabled', async () => {
      mockCreate.mockResolvedValue({ sid: 'cancel-message-id' });
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 8, // 20:00
        partySize: 3,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendCancellation('+1234567890', reservation);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('cancel-message-id');
      expect(mockCreate).toHaveBeenCalledWith({
        body: expect.stringContaining('【義田鮨 ご予約キャンセル】'),
        from: '+1234567890',
        to: '+1234567890'
      });
    });

    test('should handle SMS sending errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockCreate.mockRejectedValue(new Error('Twilio API Error'));
      
      const reservation = {
        id: 'test-id',
        date: new Date('2025-06-25'),
        timeSlot: 4,
        partySize: 2,
        name: 'Test Customer'
      };

      const result = await freshSMSService.sendConfirmation('+1234567890', reservation);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Twilio API Error');
      expect(consoleSpy).toHaveBeenCalledWith('SMS send error:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('Message Content Validation', () => {
    test('should include all required information in confirmation message', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'test_sid';
      process.env.TWILIO_AUTH_TOKEN = 'test_token';
      process.env.TWILIO_PHONE_NUMBER = '+1234567890';

      const mockCreate = jest.fn().mockResolvedValue({ sid: 'test-id' });
      
      jest.resetModules();
      jest.doMock('twilio', () => {
        return jest.fn(() => ({
          messages: {
            create: mockCreate
          }
        }));
      });
      
      const freshSMSService = require('../services/sms');
      
      const reservation = {
        id: 'res-123',
        date: new Date('2025-06-25'),
        timeSlot: 4, // 19:00
        partySize: 2,
        name: 'Test Customer'
      };

      await freshSMSService.sendConfirmation('+1234567890', reservation);
      
      const messageBody = mockCreate.mock.calls[0][0].body;
      expect(messageBody).toContain('【義田鮨 ご予約確認】');
      expect(messageBody).toContain('2025年6月25日');
      expect(messageBody).toContain('19:00-19:15');
      expect(messageBody).toContain('2名様');
      expect(messageBody).toContain('Test Customer');
      expect(messageBody).toContain('res-123');
    });
  });
});