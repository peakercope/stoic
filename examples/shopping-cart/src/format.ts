const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (amount: number): string => usd.format(amount);
