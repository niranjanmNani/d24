const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const err = (res, message, status = 400) => res.status(status).json({ success: false, error: message });
const paginate = (res, data, meta) => res.json({ success: true, data, meta });

module.exports = { ok, err, paginate };
