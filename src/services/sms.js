const twilio = require('twilio');

class SMSService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
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