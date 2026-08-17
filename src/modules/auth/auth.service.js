const db = require('../../core/db/client');
const sms = require('../../core/sms');
const jwt = require('jsonwebtoken');

const SUPERADMIN_PHONE = process.env.SUPERADMIN_PHONE || '9949808388';

const authService = {
  async requestOTP(phone, purpose = 'login') {
    // Expire old OTPs
    await db.query(
      "UPDATE otp_sessions SET verified=true WHERE phone=$1 AND purpose=$2 AND verified=false",
      [phone, purpose]
    );
    const otp = sms.generateOTP();
    const expires = new Date(Date.now() + parseInt(process.env.OTP_EXPIRY_MINUTES || 10) * 60000);
    await db.query(
      "INSERT INTO otp_sessions(phone,otp,purpose,expires_at) VALUES($1,$2,$3,$4)",
      [phone, otp, purpose, expires]
    );
    await sms.sendOTP(phone, otp);
    return { sent: true, demo: process.env.OTP_DEMO_MODE === 'true', otp: process.env.OTP_DEMO_MODE === 'true' ? otp : undefined };
  },

  async verifyOTP(phone, otp, purpose = 'login') {
    const session = await db.one(
      "SELECT * FROM otp_sessions WHERE phone=$1 AND purpose=$2 AND verified=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
      [phone, purpose]
    );
    if (!session) throw new Error('OTP expired or not found');
    if (session.attempts >= 5) throw new Error('Too many attempts — request a new OTP');
    await db.query("UPDATE otp_sessions SET attempts=attempts+1 WHERE id=$1", [session.id]);
    if (session.otp !== otp) throw new Error('Incorrect OTP');
    await db.query("UPDATE otp_sessions SET verified=true WHERE id=$1", [session.id]);
    return true;
  },

  async loginOrRegister(phone, name, role = 'customer') {
    let user = await db.one("SELECT * FROM users WHERE phone=$1", [phone]);
    if (!user) {
      // Auto-set superadmin role
      const actualRole = phone === SUPERADMIN_PHONE ? 'superadmin' : role;
      user = await db.one(
        "INSERT INTO users(phone,name,role) VALUES($1,$2,$3) RETURNING *",
        [phone, name || 'User', actualRole]
      );
      // Create wallet
      await db.query("INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
    }
    if (!user.is_active) throw new Error('Account is blocked. Contact support.');
    const token = jwt.sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d'
    });
    return { user, token };
  },

  async refreshToken(userId) {
    const user = await db.one("SELECT * FROM users WHERE id=$1 AND is_active=true", [userId]);
    if (!user) throw new Error('User not found');
    const token = jwt.sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d'
    });
    return { user, token };
  }
};

module.exports = authService;
