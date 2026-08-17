function t7date() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// Compute how a refund splits across wallet vs source
function refundSplit(order, refundAmt) {
  const total = Number(order.total);
  const walletUsed = Number(order.wallet_used || 0);
  const sourceAmt = total - walletUsed;
  const walFrac = total > 0 ? walletUsed / total : 0;
  const walletRefund = Math.min(walletUsed, Math.round(refundAmt * walFrac * 100) / 100);
  const sourceRefund = Math.max(0, Math.round((refundAmt - walletRefund) * 100) / 100);
  return {
    walletRefund,
    sourceRefund,
    schedDate: sourceRefund > 0 ? t7date() : null,
    paidByWalletOnly: sourceAmt <= 0
  };
}

module.exports = { t7date, refundSplit };
