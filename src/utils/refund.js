function t7date() {
  var d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}
function refundSplit(order, refundAmt) {
  var total = Number(order.total);
  var walletUsed = Number(order.wallet_used || 0);
  var walFrac = total > 0 ? walletUsed / total : 0;
  var walletRefund = Math.min(walletUsed, Math.round(refundAmt * walFrac * 100) / 100);
  var sourceRefund = Math.max(0, Math.round((refundAmt - walletRefund) * 100) / 100);
  return {
    walletRefund: walletRefund,
    sourceRefund: sourceRefund,
    schedDate: sourceRefund > 0 ? t7date() : null,
    paidByWalletOnly: (total - walletUsed) <= 0
  };
}
module.exports = { t7date: t7date, refundSplit: refundSplit };
