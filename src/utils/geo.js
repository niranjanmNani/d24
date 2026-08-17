// Haversine distance between two lat/lng points — returns km
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Compute delivery charge from shop's tiers
function deliveryCharge(distKm, tiers) {
  const sorted = [...tiers].sort((a, b) => a.upto_km - b.upto_km);
  for (const tier of sorted) {
    if (distKm <= tier.upto_km) return tier.charge;
  }
  return sorted[sorted.length - 1]?.charge || 0;
}

// Compute cashback amount
function computeCashback(orderTotal, shop) {
  if (shop.cashback_type === 'percent') {
    return Math.min(orderTotal * shop.cashback_value / 100, shop.cashback_max);
  }
  return Math.min(shop.cashback_value, shop.cashback_max);
}

// Compute GST on a price
function gstBreakdown(price, gstPercent) {
  const gstAmt = Math.round(price * gstPercent / (100 + gstPercent) * 100) / 100;
  const base = Math.round((price - gstAmt) * 100) / 100;
  return { base, gstAmt, gstPercent };
}

module.exports = { distanceKm, deliveryCharge, computeCashback, gstBreakdown };
