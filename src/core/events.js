// Server-Sent Events manager
// Keeps a map of connected clients per order/shop/user
// When an action happens, broadcast to relevant clients instantly

var clients = {
  orders: {},   // orderId -> [res, res, ...]
  shops: {},    // shopId -> [res, res, ...]
  users: {},    // userId -> [res, res, ...]
};

function addClient(type, id, res) {
  if (!clients[type][id]) clients[type][id] = [];
  clients[type][id].push(res);
  console.log('[SSE] Client connected: ' + type + '/' + id + ' (total: ' + clients[type][id].length + ')');
}

function removeClient(type, id, res) {
  if (!clients[type][id]) return;
  clients[type][id] = clients[type][id].filter(function(r) { return r !== res; });
  if (!clients[type][id].length) delete clients[type][id];
}

function broadcast(type, id, event, data) {
  var list = clients[type][id];
  if (!list || !list.length) return;
  var msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  list.forEach(function(res) {
    try { res.write(msg); } catch(e) {}
  });
  console.log('[SSE] Broadcast ' + event + ' to ' + list.length + ' client(s) on ' + type + '/' + id);
}

// Broadcast to multiple IDs
function broadcastAll(type, ids, event, data) {
  ids.forEach(function(id) { broadcast(type, id, event, data); });
}

module.exports = { addClient: addClient, removeClient: removeClient, broadcast: broadcast, broadcastAll: broadcastAll, clients: clients };
