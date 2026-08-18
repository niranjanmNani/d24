function ok(res, data, status) { res.status(status || 200).json({ success: true, data: data }); }
function err(res, message, status) { res.status(status || 400).json({ success: false, error: message }); }
function paginate(res, data, meta) { res.json({ success: true, data: data, meta: meta }); }
module.exports = { ok: ok, err: err, paginate: paginate };
