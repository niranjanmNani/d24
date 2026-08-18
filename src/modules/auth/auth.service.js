var db = require('../../core/db/client');
var sms = require('../../core/sms');
var jwt = require('jsonwebtoken');
var SUPERADMIN_PHONE = process.env.SUPERADMIN_PHONE || '9949808388';

var authService = {
  requestOTP: function(phone, purpose) {
    purpose = purpose || 'login';
    return db.query('UPDATE otp_sessions SET verified=true WHERE phone=$1 AND purpose=$2 AND verified=false', [phone, purpose])
      .then(function() {
        var otp = sms.generateOTP();
        var expires = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES)||10)*60000);
        return db.query('INSERT INTO otp_sessions(phone,otp,purpose,expires_at) VALUES($1,$2,$3,$4)', [phone, otp, purpose, expires])
          .then(function() { return sms.sendOTP(phone, otp); });
      });
  },

  verifyOTP: function(phone, otp, purpose) {
    purpose = purpose || 'login';
    return db.one('SELECT * FROM otp_sessions WHERE phone=$1 AND purpose=$2 AND verified=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [phone, purpose])
      .then(function(session) {
        if (!session) throw new Error('OTP expired or not found — request a new one');
        if (session.attempts >= 5) throw new Error('Too many attempts — request a new OTP');
        return db.query('UPDATE otp_sessions SET attempts=attempts+1 WHERE id=$1', [session.id])
          .then(function() {
            if (session.otp !== String(otp)) throw new Error('Incorrect OTP');
            return db.query('UPDATE otp_sessions SET verified=true WHERE id=$1', [session.id]);
          });
      });
  },

  loginOrRegister: function(phone, name, role) {
    role = role || 'customer';
    return db.one('SELECT * FROM users WHERE phone=$1', [phone])
      .then(function(user) {
        if (user) {
          if (!user.is_active) throw new Error('Account is blocked. Contact support.');
          var token = jwt.sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
          return { user: user, token: token };
        }
        // New user — set role
        var actualRole = phone === SUPERADMIN_PHONE ? 'superadmin' : role;
        return db.one('INSERT INTO users(phone,name,role) VALUES($1,$2,$3) RETURNING *', [phone, name || 'User', actualRole])
          .then(function(newUser) {
            return db.query('INSERT INTO wallets(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING', [newUser.id])
              .then(function() {
                var token = jwt.sign({ userId: newUser.id, phone: newUser.phone }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
                return { user: newUser, token: token };
              });
          });
      });
  }
};
module.exports = authService;
