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
      this.isTrialAccount = process.env.TWILIO_TRIAL_MODE === 'true';
      
      // トライアルアカウントの警告
      if (this.isTrialAccount) {
        console.warn('⚠️  Twilioトライアルアカウントモード');
        console.warn('検証済み電話番号にのみSMS送信可能です。');
        console.log('検証済み番号リスト:', process.env.TWILIO_VERIFIED_NUMBERS || '未設定');
      }
      
      // 海外番号使用時の警告
      if (this.fromNumber && this.fromNumber.startsWith('+1')) {
        console.warn('⚠️  アメリカの番号から日本へSMS送信中。配信率に影響する可能性があります。');
        console.log('推奨: 日本のTwilio番号の取得を検討してください。');
      }
    } else {
      this.enabled = false;
      console.log('SMS機能は無効化されています (Twilio設定なし)');
    }
  }

  // トライアルアカウントで番号が検証済みかチェック
  isVerifiedNumber(phone) {
    if (!this.isTrialAccount) return true;
    
    const verifiedNumbers = process.env.TWILIO_VERIFIED_NUMBERS;
    if (!verifiedNumbers) {
      console.warn('TWILIO_VERIFIED_NUMBERS環境変数が未設定です');
      return false;
    }
    
    const verifiedList = verifiedNumbers.split(',').map(n => n.trim());
    const isVerified = verifiedList.includes(phone);
    
    if (!isVerified) {
      console.warn(`未検証の電話番号: ${phone}`);
      console.log('検証済み番号リスト:', verifiedList);
    }
    
    return isVerified;
  }

  // 電話番号をE164形式に正規化
  normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    // 文字列に変換し、空白・ハイフン・括弧を除去
    let cleanPhone = phone.toString().replace(/[\s\-\(\)]/g, '');
    
    // 既にE164形式（+から始まる）の場合はそのまま返す
    if (cleanPhone.startsWith('+')) {
      return cleanPhone;
    }
    
    // 日本の番号の場合の処理
    if (cleanPhone.startsWith('0')) {
      // 先頭の0を除去して+81を追加
      return '+81' + cleanPhone.substring(1);
    }
    
    // 81から始まる場合（国際形式だが+がない）
    if (cleanPhone.startsWith('81')) {
      return '+' + cleanPhone;
    }
    
    // その他の場合は日本の番号として扱う
    if (cleanPhone.length >= 10) {
      return '+81' + cleanPhone;
    }
    
    // 無効な番号
    console.warn('無効な電話番号形式:', phone);
    return null;
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

    // 電話番号を正規化
    const normalizedPhone = this.normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.error('無効な電話番号:', phone);
      return { success: false, error: '無効な電話番号形式です' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      weekday: 'long'
    });
    
    const message = `【義田鮨 ご予約確認】

${reservation.name}様

ご予約を承りました。

■ご予約内容
日時：${date} ${timeRange}
人数：${reservation.partySize}名様
お名前：${reservation.name}様
予約ID：${reservation.id}

当日お待ちしております。

※このメッセージは自動送信です
※ご質問は店舗まで直接お電話ください

義田鮨`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: normalizedPhone
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

    // 電話番号を正規化
    const normalizedPhone = this.normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.error('無効な電話番号:', phone);
      return { success: false, error: '無効な電話番号形式です' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      weekday: 'long'
    });
    
    const message = `【義田鮨 ご予約キャンセル】

${reservation.name}様

下記ご予約をキャンセルいたしました。

■キャンセルした予約
日時：${date} ${timeRange}
人数：${reservation.partySize}名様
お名前：${reservation.name}様
予約ID：${reservation.id}

またのご利用をお待ちしております。

※このメッセージは自動送信です
※ご質問は店舗まで直接お電話ください

義田鮨`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: normalizedPhone
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

    // 電話番号を正規化
    const normalizedPhone = this.normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.error('無効な電話番号:', phone);
      return { success: false, error: '無効な電話番号形式です' };
    }

    const timeRange = this.formatTimeSlot(reservation.timeSlot);
    const date = new Date(reservation.date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      weekday: 'long'
    });
    
    const message = `【義田鮨 ご予約リマインダー】

${reservation.name}様

明日のご予約をお忘れなく。

■ご予約内容
日時：${date} ${timeRange}
人数：${reservation.partySize}名様
お名前：${reservation.name}様

お待ちしております。

義田鮨`;

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: normalizedPhone
      });
      return { success: true, messageId: result.sid };
    } catch (error) {
      console.error('SMS send error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SMSService();