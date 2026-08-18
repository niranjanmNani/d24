var express = require('express');
var router = express.Router();
var Joi = require('joi');
var validate = require('../../middleware/validate').validate;
var authenticate = require('../../middleware/auth').authenticate;
var ok = require('../../utils/response').ok;
var err = require('../../utils/response').err;
var authService = require('./auth.service');
var db = require('../../core/db/client');

// POST /api/auth/otp/request
router.post('/otp/request', validate(Joi.object({
  phone: Joi.string().min(10).max(10).pattern(/^[0-9]+$/).required().messages({
    'string.pattern.base': 'Enter a valid 10-digit mobile number',
    'string.min': 'Phone number must be 10 digits',
    'string.max': 'Phone number must be 10 digits'
  }),
  purpose: Joi.string().valid('login', 'register').default('login')
})), function(req, res) {
  authService.requestOTP(req.body.phone, req.body.purpose)
    .then(function(result) { ok(res, result); })
    .catch(function(e) { err(res, e.message); });
});

// POST /api/auth/otp/verify
router.post('/otp/verify', validate(Joi.object({
  phone: Joi.string().min(10).max(10).required(),
  otp: Joi.string().length(4).required(),
  name: Joi.string().min(2).max(60),
  role: Joi.string().valid('customer', 'merchant', 'agent').default('customer'),
  purpose: Joi.string().default('login')
})), function(req, res) {
  var body = req.body;
  authService.verifyOTP(body.phone, body.otp, body.purpose)
    .then(function() { return authService.loginOrRegister(body.phone, body.name, body.role); })
    .then(function(result) { ok(res, result); })
    .catch(function(e) { err(res, e.message, 401); });
});

// GET /api/auth/me
router.get('/me', authenticate, function(req, res) {
  ok(res, { user: req.user });
});

// PATCH /api/auth/profile
router.patch('/profile', authenticate, validate(Joi.object({
  name: Joi.string().min(2).max(60),
  email: Joi.string().email()
})), function(req, res) {
  var fields = Object.keys(req.body);
  if (!fields.length) return ok(res, { user: req.user });
  var sets = fields.map(function(k, i) { return k + '=$' + (i + 2); }).join(',');
  var vals = fields.map(function(f) { return req.body[f]; });
  db.one('UPDATE users SET ' + sets + ' WHERE id=$1 RETURNING *', [req.user.id].concat(vals))
    .then(function(user) { ok(res, { user: user }); })
    .catch(function(e) { err(res, e.message); });
});

module.exports = router;
