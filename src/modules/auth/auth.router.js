const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { ok, err } = require('../../utils/response');
const authService = require('./auth.service');

// POST /api/auth/otp/request
router.post('/otp/request', validate(Joi.object({
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).required().messages({ 'string.pattern.base': 'Enter a valid 10-digit Indian mobile number' }),
  purpose: Joi.string().valid('login','register','reset').default('login')
})), async (req, res) => {
  try {
    const result = await authService.requestOTP(req.body.phone, req.body.purpose);
    ok(res, result);
  } catch (e) { err(res, e.message); }
});

// POST /api/auth/otp/verify — returns token + user
router.post('/otp/verify', validate(Joi.object({
  phone: Joi.string().required(),
  otp: Joi.string().length(4).required(),
  name: Joi.string().min(2).max(60),
  role: Joi.string().valid('customer','merchant','agent').default('customer'),
  purpose: Joi.string().default('login')
})), async (req, res) => {
  try {
    const { phone, otp, name, role, purpose } = req.body;
    await authService.verifyOTP(phone, otp, purpose);
    const result = await authService.loginOrRegister(phone, name, role);
    ok(res, result);
  } catch (e) { err(res, e.message, 401); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  ok(res, { user: req.user });
});

// PATCH /api/auth/profile
router.patch('/profile', authenticate, validate(Joi.object({
  name: Joi.string().min(2).max(60),
  email: Joi.string().email()
})), async (req, res) => {
  try {
    const db = require('../../core/db/client');
    const sets = Object.keys(req.body).map((k,i) => `${k}=$${i+2}`).join(',');
    const vals = Object.values(req.body);
    if (!sets) return ok(res, { user: req.user });
    const user = await db.one(`UPDATE users SET ${sets} WHERE id=$1 RETURNING *`, [req.user.id, ...vals]);
    ok(res, { user });
  } catch (e) { err(res, e.message); }
});

module.exports = router;
