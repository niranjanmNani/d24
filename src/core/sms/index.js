const axios = require('axios');

const DEMO_MODE = process.env.OTP_DEMO_MODE === 'true';

const sms = {
  async sendOTP(phone, otp) {
    if (DEMO_MODE) {
      console.log(`[SMS DEMO] +91${phone} → OTP: ${otp}`);
      return { sent: true, demo: true };
    }

    if (process.env.SMS_PROVIDER === 'fast2sms') {
      const res = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
        params: {
          authorization: process.env.FAST2SMS_API_KEY,
          variables_values: otp,
          route: 'otp',
          numbers: phone
        }
      });
      return { sent: true, response: res.data };
    }

    throw new Error('No SMS provider configured');
  },

  generateOTP() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }
};

module.exports = sms;
