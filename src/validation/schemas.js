const Joi = require('joi');

const createReservationSchema = Joi.object({
  date: Joi.date()
    .min('2025-06-20')
    .max('2025-07-04')
    .required()
    .messages({
      'date.min': '予約日は2025-06-20から2025-07-04の間で指定してください',
      'date.max': '予約日は2025-06-20から2025-07-04の間で指定してください'
    }),
  timeSlot: Joi.number()
    .integer()
    .min(0)
    .max(39)
    .required()
    .custom((value, helpers) => {
      // For slots 28+ (25:00+), need to ensure they don't book too late
      // All slots 0-39 are valid for booking, duration is handled in business logic
      if (value > 39) {
        return helpers.error('timeSlot.invalid');
      }
      return value;
    })
    .messages({
      'number.min': '時間枠は0（18:00）から39（27:45）の間で指定してください',
      'number.max': '時間枠は0（18:00）から39（27:45）の間で指定してください',
      'timeSlot.invalid': '時間枠は0（18:00）から39（27:45）の間で指定してください'
    }),
  partySize: Joi.number()
    .integer()
    .min(1)
    .max(6)
    .required()
    .messages({
      'number.min': '人数は1人以上で指定してください',
      'number.max': '人数は6人以下で指定してください'
    }),
  name: Joi.string()
    .min(2)
    .max(100)
    .required(),
  phone: Joi.string()
    .pattern(/^(0\d{1,4}-\d{1,4}-\d{4}|0\d{10}|\+?[1-9]\d{1,14})$/)
    .required()
    .messages({
      'string.pattern.base': '正しい電話番号形式で入力してください（例: 090-1234-5678, +819012345678）'
    }),
  email: Joi.string()
    .email()
    .optional(),
  notes: Joi.string()
    .max(500)
    .optional()
});

module.exports = {
  createReservationSchema
};