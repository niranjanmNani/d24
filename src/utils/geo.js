function distanceKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
          Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function deliveryCharge(distKm, tiers) {
  var sorted = tiers.slice().sort(function(a,b){ return a.upto_km - b.upto_km; });
  for (var i=0; i<sorted.length; i++) { if (distKm <= sorted[i].upto_km) return sorted[i].charge; }
  return sorted[sorted.length-1] ? sorted[sorted.length-1].charge : 0;
}
function computeCashback(orderTotal, shop) {
  if (shop.cashback_type === 'percent') return Math.min(orderTotal * shop.cashback_value / 100, shop.cashback_max);
  return Math.min(shop.cashback_value, shop.cashback_max);
}
function gstBreakdown(price, gstPercent) {
  var gstAmt = Math.round(price * gstPercent / (100 + gstPercent) * 100) / 100;
  return { base: Math.round((price - gstAmt)*100)/100, gstAmt: gstAmt, gstPercent: gstPercent };
}
module.exports = { distanceKm: distanceKm, deliveryCharge: deliveryCharge, computeCashback: computeCashback, gstBreakdown: gstBreakdown };
