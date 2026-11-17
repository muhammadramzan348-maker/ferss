export function aggregate(es) {
    let bought = 0, sold = 0, buyCost = 0, sellRev = 0, trades = 0, pnl = 0, winning = 0;
    es.forEach((e) => {
        bought += e.usdt_bought;
        buyCost += e.usdt_bought * e.buy_rate;
        sold += e.usdt_sold;
        sellRev += e.usdt_sold * e.sell_rate;
        trades += e.trades;
        pnl += e.pnl_pkr;
        if (e.pnl_pkr > 0)
            winning++;
    });
    return {
        bought, sold, trades, pnl,
        avgBuy: bought ? buyCost / bought : 0,
        avgSell: sold ? sellRev / sold : 0,
        entries: es.length,
        winning,
        buyPkr: buyCost,
        sellPkr: sellRev,
    };
}
/** Profit (PKR) on the quantity that was both bought and sold: min(buy,sell) × (sellRate − buyRate). */
export const estimatePnl = (bought, buyRate, sold, sellRate) => {
    const matched = Math.min(bought, sold);
    return matched > 0 && buyRate > 0 && sellRate > 0 ? matched * (sellRate - buyRate) : 0;
};
export const toPkr = (pnl, cur, rate) => cur === "PKR" ? pnl : pnl * rate;
