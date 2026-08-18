var Joi = require('joi');
function validate(schema, target) {
  target = target || 'body';
  return function(req, res, next) {
    var result = schema.validate(req[target], { abortEarly: false, stripUnknown: true });
    if (result.error) {
      return res.status(400).json({ error: 'Validation failed', details: result.error.details.map(function(d){ return d.message; }) });
    }
    req[target] = result.value;
    next();
  };
}
module.exports = { validate: validate };
