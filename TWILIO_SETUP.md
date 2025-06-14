# Twilio SMS設定ガイド

## 🚨 Error 21608 対応方法

Twilioトライアルアカウントでは、事前に検証した電話番号にのみSMS送信が可能です。

### 1. 電話番号の検証手順

1. **Twilioコンソールにログイン**
   - https://console.twilio.com/

2. **検証済み番号の追加**
   - Phone Numbers → Verified Caller IDs
   - または: https://console.twilio.com/us1/develop/phone-numbers/manage/verified

3. **番号を追加**
   - 「Add a new Caller ID」をクリック
   - 国: Japan (+81)
   - 電話番号: 090-1234-5678（ハイフンあり/なし両方OK）

4. **検証コード受信**
   - SMSまたは音声通話で6桁のコード受信
   - コードを入力して検証完了

### 2. 環境変数の設定

**Railway側の設定:**

```bash
# 必須設定
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+12705617860

# トライアルアカウント設定
TWILIO_TRIAL_MODE=true
TWILIO_VERIFIED_NUMBERS=+819012345678,+818098765432
```

**TWILIO_VERIFIED_NUMBERS**には検証済みの電話番号をE164形式（+81から始まる）で設定してください。

### 3. トライアルアカウントの制限

- **送信先制限**: 検証済み番号のみ
- **メッセージ制限**: 「Sent from your Twilio trial account」が自動追加
- **クレジット制限**: $15.50まで（約200通）

### 4. 本番環境への移行

本格運用時は以下を推奨：

1. **アカウントアップグレード**
   - クレジットカード登録で制限解除
   - 月額料金なし、使用分のみ課金

2. **日本番号の取得**
   - 月額約$1で日本の番号取得可能
   - 配信率向上、信頼性向上

3. **環境変数の更新**
   ```bash
   TWILIO_TRIAL_MODE=false  # または削除
   # TWILIO_VERIFIED_NUMBERSは不要に
   ```

### 5. トラブルシューティング

**よくあるエラー:**

- **Error 21608**: 未検証番号への送信
  - 解決: 番号を検証するか、アップグレード

- **Error 21211**: 無効な電話番号形式
  - 解決: 自動でE164形式に変換されるはず

- **配信されない**: キャリアブロック
  - 解決: 日本番号の取得を検討

### 6. 開発時のテスト

開発時は実際の電話番号を使わずに：

1. **検証済み番号を環境変数に設定**
2. **ログで送信内容を確認**
3. **本番環境でのみ実送信**

---

## 📞 サポート

問題が解決しない場合：
- Twilioサポート: https://support.twilio.com/
- 日本語ドキュメント: https://www.twilio.com/ja/docs