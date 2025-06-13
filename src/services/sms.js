const twilio = require('twilio');

class SMSService {
  constructor() {
    // SMS機能は現在無効化されています
    // Twilio設定が必要な場合は環境変数を設定してください
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
      this.enabled = true;
    } else {
      this.enabled = false;
      console.log('SMS機能は無効化されています (Twilio設定なし)');
    }
  }

  formatTimeSlot(timeSlot) {
    const startHour = Math.floor(timeSlot * 0.25) + 18;
    const startMin = (timeSlot % 4) * 15;
    const endHour = Math.floor((timeSlot + 1) * 0.25) + 18;
    const endMin = ((timeSlot + 1) % 4) * 15;
    
    const formatTime = (hour, min) => {
      const displayHour = hour > 24 ? hour - 24 : hour;
      return `${displayHour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    };
    
    return `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`;
  }

  async sendConfirmation(phone, reservation) {
    if (!this.enabled) {
      console.log('SMS送信をスキップ (Twilio未設定):', phone);
      return { success: true, messageId: 'disabled' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP');
    
    const message = `[Sushi Reservation] Your reservation is confirmed!
Date: ${date}
Time: ${timeRange} JST
Party: ${reservation.partySize} people
Name: ${reservation.name}
ID: ${reservation.id}

Thank you for choosing us!`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: phone
      });
      return { success: true, messageId: result.sid };
    } catch (error) {
      console.error('SMS send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendCancellation(phone, reservation) {
    if (!this.enabled) {
      console.log('SMS送信をスキップ (Twilio未設定):', phone);
      return { success: true, messageId: 'disabled' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP');
    
    const message = `[Sushi Reservation] Your reservation has been cancelled.
Date: ${date}
Time: ${timeRange} JST
Name: ${reservation.name}
ID: ${reservation.id}

We hope to see you again soon!`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: phone
      });
      return { success: true, messageId: result.sid };
    } catch (error) {
      console.error('SMS send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendReminder(phone, reservation) {
    if (!this.enabled) {
      console.log('SMS送信をスキップ (Twilio未設定):', phone);
      return { success: true, messageId: 'disabled' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP');
    
    const message = `[Sushi Reservation] Reminder: Your reservation is tomorrow!
Date: ${date}
Time: ${timeRange} JST
Party: ${reservation.partySize} people
Name: ${reservation.name}

Looking forward to serving you!`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: phone
      });
      return { success: true, messageId: result.sid };
    } catch (error) {
      console.error('SMS send error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SMSService();