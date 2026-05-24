const api = require('@actual-app/api');
const { q, runQuery } = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.BUDGET_CACHE_DIR || path.join(__dirname, '.actual-cache');

// Category classification mapping
const CATEGORY_MAP = {
  'Groceries': 'groceries',
  'Dining / Takeout': 'dining',
  'Transport': 'transport',
  'Bills': 'recurring',
  'Bills (Flexible) Subscriptions': 'recurring',
  'Stocks': 'savings',
  'Bitcoin': 'savings',
  'Savings': 'savings',
};

// Fixed vs Variable classification lists
const FIXED_CATEGORIES = ['Bills', 'Bills (Flexible) Subscriptions', 'Stocks', 'Bitcoin', 'Savings'];
const VARIABLE_CATEGORIES = ['Groceries', 'Dining / Takeout', 'Transport', 'Shopping', 'General', 'Health', 'Cash/ATM', 'Donation'];

// Helper to check if account is a credit card
function isCreditCard(accountName) {
  if (!accountName) return false;
  const name = accountName.toLowerCase();
  return name.includes('visa') || name.includes('mastercard') || name.includes('amex') || name.includes('credit');
}

// Card reward configurations and simulation logic
const CARD_CONFIGS = [
  {
    id: 'bmo_cashback',
    name: 'BMO CashBack Mastercard (Current)',
    annualFee: 0,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '3% up to $500/mo, then 0.5%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '1% up to $500/mo, then 0.5%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        // Groceries
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        if (groc > 500) {
          breakdown.groceries.rewards += (500 * 0.03) + ((groc - 500) * 0.005);
          breakdown.groceries.capExceededMonths++;
        } else {
          breakdown.groceries.rewards += groc * 0.03;
        }

        // Recurring
        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        if (rec > 500) {
          breakdown.recurring.rewards += (500 * 0.01) + ((rec - 500) * 0.005);
          breakdown.recurring.capExceededMonths++;
        } else {
          breakdown.recurring.rewards += rec * 0.01;
        }

        // Dining, Transport, Other
        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.005;

        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        breakdown.transport.rewards += trans * 0.005;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.005;
      }

      return breakdown;
    }
  },
  {
    id: 'tangerine_moneyback',
    name: 'Tangerine Money-Back',
    annualFee: 0,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        breakdown.groceries.rewards += groc * 0.02;

        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        breakdown.recurring.rewards += rec * 0.02;

        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.02;

        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        breakdown.transport.rewards += trans * 0.005;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.005;
      }

      return breakdown;
    }
  },
  {
    id: 'scotia_momentum',
    name: 'Scotia Momentum Visa Infinite',
    annualFee: 120,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '4% (combo cap $25k/yr, then 1%)', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '4% (combo cap $25k/yr, then 1%)', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '2% (combo cap $25k/yr, then 1%)', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 }
      };

      let cumulativeTierSpend = 0;

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        const rec = m.recurring || 0;
        const trans = m.transport || 0;
        const din = m.dining || 0;
        const oth = m.other || 0;

        breakdown.groceries.spend += groc;
        breakdown.recurring.spend += rec;
        breakdown.transport.spend += trans;
        breakdown.dining.spend += din;
        breakdown.other.spend += oth;

        // Base 1% categories
        breakdown.dining.rewards += din * 0.01;
        breakdown.other.rewards += oth * 0.01;

        // 4% and 2% categories with combined $25,000 cap
        let month4Spend = groc + rec;
        let month2Spend = trans;
        let capBreachedThisMonth = false;

        // Calculate groceries and recurring (4% tier)
        if (cumulativeTierSpend >= 25000) {
          breakdown.groceries.rewards += groc * 0.01;
          breakdown.recurring.rewards += rec * 0.01;
          capBreachedThisMonth = true;
        } else if (cumulativeTierSpend + month4Spend > 25000) {
          const remaining = 25000 - cumulativeTierSpend;
          // Prorate rewards based on proportion of groceries and recurring in the month's spend
          const ratioGroc = month4Spend > 0 ? groc / month4Spend : 0.5;
          const ratioRec = month4Spend > 0 ? rec / month4Spend : 0.5;
          
          const remainingGroc = remaining * ratioGroc;
          const remainingRec = remaining * ratioRec;

          breakdown.groceries.rewards += (remainingGroc * 0.04) + ((groc - remainingGroc) * 0.01);
          breakdown.recurring.rewards += (remainingRec * 0.04) + ((rec - remainingRec) * 0.01);
          
          cumulativeTierSpend = 25000;
          capBreachedThisMonth = true;
        } else {
          breakdown.groceries.rewards += groc * 0.04;
          breakdown.recurring.rewards += rec * 0.04;
          cumulativeTierSpend += month4Spend;
        }

        // Calculate transport (2% tier)
        if (cumulativeTierSpend >= 25000) {
          breakdown.transport.rewards += trans * 0.01;
          capBreachedThisMonth = true;
        } else if (cumulativeTierSpend + month2Spend > 25000) {
          const remaining = 25000 - cumulativeTierSpend;
          breakdown.transport.rewards += (remaining * 0.02) + ((trans - remaining) * 0.01);
          cumulativeTierSpend = 25000;
          capBreachedThisMonth = true;
        } else {
          breakdown.transport.rewards += trans * 0.02;
          cumulativeTierSpend += month2Spend;
        }

        if (capBreachedThisMonth) {
          breakdown.groceries.capExceededMonths++;
          breakdown.recurring.capExceededMonths++;
          breakdown.transport.capExceededMonths++;
        }
      }

      return breakdown;
    }
  },
  {
    id: 'rogers_world_elite',
    name: 'Rogers World Elite',
    annualFee: 0,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '1.5%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '1.5%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '1.5%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '1.5%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '1.5%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        breakdown.groceries.rewards += groc * 0.015;

        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        breakdown.recurring.rewards += rec * 0.015;

        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.015;

        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        breakdown.transport.rewards += trans * 0.015;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.015;
      }

      return breakdown;
    }
  },
  {
    id: 'amex_simplycash_preferred',
    name: 'Amex SimplyCash Preferred',
    annualFee: 120,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '4%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '4%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '2%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        breakdown.groceries.rewards += groc * 0.04;

        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        breakdown.recurring.rewards += rec * 0.02;

        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.02;

        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        breakdown.transport.rewards += trans * 0.04;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.02;
      }

      return breakdown;
    }
  },
  {
    id: 'bmo_cashback_world_elite',
    name: 'BMO CashBack World Elite',
    annualFee: 120,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '5% up to $500/mo, then 1%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '2% up to $500/mo, then 1%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '4% up to $300/mo, then 1%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        // Groceries: 5% up to $500/mo, then 1%
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        if (groc > 500) {
          breakdown.groceries.rewards += (500 * 0.05) + ((groc - 500) * 0.01);
          breakdown.groceries.capExceededMonths++;
        } else {
          breakdown.groceries.rewards += groc * 0.05;
        }

        // Transport: 4% up to $300/mo, then 1%
        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        if (trans > 300) {
          breakdown.transport.rewards += (300 * 0.04) + ((trans - 300) * 0.01);
          breakdown.transport.capExceededMonths++;
        } else {
          breakdown.transport.rewards += trans * 0.04;
        }

        // Recurring Bills: 2% up to $500/mo, then 1%
        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        if (rec > 500) {
          breakdown.recurring.rewards += (500 * 0.02) + ((rec - 500) * 0.01);
          breakdown.recurring.capExceededMonths++;
        } else {
          breakdown.recurring.rewards += rec * 0.02;
        }

        // Dining & Other
        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.01;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.01;
      }

      return breakdown;
    }
  },
  {
    id: 'neo_credit',
    name: 'Neo Credit (Standard)',
    annualFee: 0,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '0.5%', capExceededMonths: 0 }
      };

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        breakdown.groceries.spend += groc;
        breakdown.groceries.rewards += groc * 0.01;

        const trans = m.transport || 0;
        breakdown.transport.spend += trans;
        breakdown.transport.rewards += trans * 0.01;

        const rec = m.recurring || 0;
        breakdown.recurring.spend += rec;
        breakdown.recurring.rewards += rec * 0.005;

        const din = m.dining || 0;
        breakdown.dining.spend += din;
        breakdown.dining.rewards += din * 0.005;

        const oth = m.other || 0;
        breakdown.other.spend += oth;
        breakdown.other.rewards += oth * 0.005;
      }

      return breakdown;
    }
  },
  {
    id: 'neo_world_elite',
    name: 'Neo World Elite',
    annualFee: 125,
    simulate: (monthlySpends) => {
      const breakdown = {
        groceries: { spend: 0, rewards: 0, rateLabel: '5% (cap $12k/yr, then 1%)', capExceededMonths: 0 },
        recurring: { spend: 0, rewards: 0, rateLabel: '4% (cap $6k/yr, then 1%)', capExceededMonths: 0 },
        dining: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 },
        transport: { spend: 0, rewards: 0, rateLabel: '3% (cap $12k/yr, then 1%)', capExceededMonths: 0 },
        other: { spend: 0, rewards: 0, rateLabel: '1%', capExceededMonths: 0 }
      };

      let cumulativeGroc = 0;
      let cumulativeRec = 0;
      let cumulativeTrans = 0;

      for (const m of monthlySpends) {
        const groc = m.groceries || 0;
        const rec = m.recurring || 0;
        const trans = m.transport || 0;
        const din = m.dining || 0;
        const oth = m.other || 0;

        breakdown.groceries.spend += groc;
        breakdown.recurring.spend += rec;
        breakdown.transport.spend += trans;
        breakdown.dining.spend += din;
        breakdown.other.spend += oth;

        // Base 1% categories
        breakdown.dining.rewards += din * 0.01;
        breakdown.other.rewards += oth * 0.01;

        // Groceries: 5% up to $12,000/yr, then 1%
        if (cumulativeGroc >= 12000) {
          breakdown.groceries.rewards += groc * 0.01;
          breakdown.groceries.capExceededMonths++;
        } else if (cumulativeGroc + groc > 12000) {
          const remaining = 12000 - cumulativeGroc;
          breakdown.groceries.rewards += (remaining * 0.05) + ((groc - remaining) * 0.01);
          cumulativeGroc = 12000;
          breakdown.groceries.capExceededMonths++;
        } else {
          breakdown.groceries.rewards += groc * 0.05;
          cumulativeGroc += groc;
        }

        // Recurring Bills: 4% up to $6,000/yr, then 1%
        if (cumulativeRec >= 6000) {
          breakdown.recurring.rewards += rec * 0.01;
          breakdown.recurring.capExceededMonths++;
        } else if (cumulativeRec + rec > 6000) {
          const remaining = 6000 - cumulativeRec;
          breakdown.recurring.rewards += (remaining * 0.04) + ((rec - remaining) * 0.01);
          cumulativeRec = 6000;
          breakdown.recurring.capExceededMonths++;
        } else {
          breakdown.recurring.rewards += rec * 0.04;
          cumulativeRec += rec;
        }

        // Gas & Transit (Transport): 3% up to $12,000/yr, then 1%
        if (cumulativeTrans >= 12000) {
          breakdown.transport.rewards += trans * 0.01;
          breakdown.transport.capExceededMonths++;
        } else if (cumulativeTrans + trans > 12000) {
          const remaining = 12000 - cumulativeTrans;
          breakdown.transport.rewards += (remaining * 0.03) + ((trans - remaining) * 0.01);
          cumulativeTrans = 12000;
          breakdown.transport.capExceededMonths++;
        } else {
          breakdown.transport.rewards += trans * 0.03;
          cumulativeTrans += trans;
        }
      }

      return breakdown;
    }
  }
];

// Helper functions for date math
function monthStart(m) { return `${m}-01`; }
function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  const em = mo === 12 ? 1 : mo + 1;
  const ey = mo === 12 ? y + 1 : y;
  return `${ey}-${String(em).padStart(2, '0')}-01`;
}
function prevMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  let pm = mo - n, py = y;
  while (pm <= 0) { pm += 12; py--; }
  return `${py}-${String(pm).padStart(2, '0')}`;
}
function daysInMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}
function daysElapsed(m) {
  const today = new Date();
  const [y, mo] = m.split('-').map(Number);
  if (today.getFullYear() === y && today.getMonth() + 1 === mo) return today.getDate();
  return daysInMonth(m);
}

/**
 * Main insights analyzer logic
 */
async function runAnalysis(focusMonth, skipApiInit = false) {
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const targetMonth = focusMonth || currentMonthStr;

  // Initialize Actual API
  if (!skipApiInit) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
    await api.init({
      dataDir: CACHE_DIR,
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_PASSWORD,
    });
    await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
  }

  // Fetch Lookups
  const accounts = await api.getAccounts();
  const payees = await api.getPayees();
  const categories = await api.getCategories();

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const categoryMap = Object.fromEntries(categories.filter(c => !c.hidden).map(c => [c.id, c.name]));
  const payeeMap = Object.fromEntries(payees.map(p => [p.id, p]));
  const transferPayees = new Set(payees.filter(p => p.transfer_acct).map(p => p.id));

  // Determine all available months for CC simulation
  const { data: allDates } = await runQuery(
    q('transactions').filter({ is_parent: false }).select(['date'])
  );
  const allMonths = [...new Set(allDates.map(t => t.date.slice(0, 7)))].sort();
  
  const targetMonthIdx = allMonths.indexOf(targetMonth);
  let simMonths = [];
  if (targetMonthIdx === -1) {
    simMonths = allMonths.slice(-12);
  } else {
    simMonths = allMonths.slice(Math.max(0, targetMonthIdx - 11), targetMonthIdx + 1);
  }

  // 1. Fetch transactions for CC simulation (rolling 12 months)
  const monthlySpends = [];
  let ccTransactionsCount = 0;
  let totalCcSpend = 0;

  for (const m of simMonths) {
    const { data } = await runQuery(
      q('transactions')
        .filter({ is_parent: false })
        .filter({ date: { $gte: monthStart(m) } })
        .filter({ date: { $lt: monthEnd(m) } })
        .select(['amount', 'payee', 'category', 'account'])
    );

    const mSpend = { groceries: 0, dining: 0, transport: 0, recurring: 0, other: 0 };

    for (const t of data) {
      if (transferPayees.has(t.payee)) continue;
      if (t.amount >= 0) continue; 
      
      const accName = accountMap[t.account] || '';
      if (!isCreditCard(accName)) continue; 

      const amt = Math.abs(t.amount / 100);
      totalCcSpend += amt;
      ccTransactionsCount++;

      const catName = t.category ? (categoryMap[t.category] || '') : '';
      const mappedType = CATEGORY_MAP[catName] || 'other';
      mSpend[mappedType] += amt;
    }

    monthlySpends.push(mSpend);
  }

  // Run detailed CC Simulations
  const simResults = CARD_CONFIGS.map(card => {
    const categoryBreakdown = card.simulate(monthlySpends);
    
    // Sum rewards across categories
    let rewards = 0;
    for (const key of Object.keys(categoryBreakdown)) {
      rewards += categoryBreakdown[key].rewards;
      categoryBreakdown[key].rewards = +categoryBreakdown[key].rewards.toFixed(2);
      categoryBreakdown[key].spend = +categoryBreakdown[key].spend.toFixed(2);
    }

    const monthsSimulated = simMonths.length;
    const proratedFee = card.annualFee * (monthsSimulated / 12);
    const net = rewards - proratedFee;

    return {
      id: card.id,
      name: card.name,
      rewards: +rewards.toFixed(2),
      fees: +proratedFee.toFixed(2),
      net: +net.toFixed(2),
      annualFee: card.annualFee,
      categoryBreakdown
    };
  });

  // Identify Current Card and Winner
  const currentCardRes = simResults.find(r => r.id === 'bmo_cashback');
  const currentNet = currentCardRes ? currentCardRes.net : 0;

  // Rank cards by net yield
  simResults.sort((a, b) => b.net - a.net);
  simResults.forEach(r => {
    r.diffFromCurrent = +(r.net - currentNet).toFixed(2);
    r.isWinner = r.net === simResults[0].net;
    r.isCurrent = r.id === 'bmo_cashback';
  });

  // 2. Coaching Diagnostics: Momentum (focusMonth vs. rolling 3-month average)
  const prev3 = [prevMonth(targetMonth, 3), prevMonth(targetMonth, 2), prevMonth(targetMonth, 1)];
  
  const fetchMonthTotalSpend = async (m) => {
    const { data } = await runQuery(
      q('transactions')
        .filter({ is_parent: false })
        .filter({ date: { $gte: monthStart(m) } })
        .filter({ date: { $lt: monthEnd(m) } })
        .select(['amount', 'payee'])
    );
    return data
      .filter(t => !transferPayees.has(t.payee) && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount / 100), 0);
  };

  const [b1, b2, b3] = await Promise.all(prev3.map(fetchMonthTotalSpend));
  const baseline = (b1 + b2 + b3) / 3;

  // Fetch current focus month transactions
  const { data: focusTxns } = await runQuery(
    q('transactions')
      .filter({ is_parent: false })
      .filter({ date: { $gte: monthStart(targetMonth) } })
      .filter({ date: { $lt: monthEnd(targetMonth) } })
      .select(['amount', 'payee', 'category', 'date'])
  );

  const focusSpendTransactions = focusTxns.filter(t => !transferPayees.has(t.payee) && t.amount < 0);
  const totalFocusSpend = focusSpendTransactions.reduce((sum, t) => sum + Math.abs(t.amount / 100), 0);

  const elapsed = daysElapsed(targetMonth);
  const totalDays = daysInMonth(targetMonth);
  const isCurrentMonth = targetMonth === currentMonthStr;
  const isProrated = isCurrentMonth && elapsed < totalDays;

  let compBaseline = baseline;
  if (isProrated) {
    compBaseline = baseline * (elapsed / totalDays);
  }

  const momentumDiff = totalFocusSpend - compBaseline;
  const momentumPct = compBaseline !== 0 ? (momentumDiff / compBaseline) * 100 : 0;

  // Category breakdown for momentum checks
  const focusCatTotals = {};
  focusSpendTransactions.forEach(t => {
    const catName = t.category ? (categoryMap[t.category] || 'Uncategorized') : 'Uncategorized';
    focusCatTotals[catName] = (focusCatTotals[catName] || 0) + Math.abs(t.amount / 100);
  });

  // 3. Creeping Leaks
  const payeeFrequency = {};
  focusSpendTransactions.forEach(t => {
    const payeeName = t.payee ? (payeeMap[t.payee]?.name || 'Unknown') : 'Unknown';
    if (payeeName === 'Unknown') return;
    
    if (!payeeFrequency[payeeName]) {
      payeeFrequency[payeeName] = { name: payeeName, count: 0, total: 0 };
    }
    payeeFrequency[payeeName].count++;
    payeeFrequency[payeeName].total += Math.abs(t.amount / 100);
  });

  const leaks = Object.values(payeeFrequency)
    .map(p => ({
      payee: p.name,
      count: p.count,
      total: +p.total.toFixed(2),
      average: +(p.total / p.count).toFixed(2),
    }))
    .filter(p => p.count >= 5 && p.average <= 15)
    .sort((a, b) => b.total - a.total);

  // 4. Fixed vs. Variable spending
  let fixedSpend = 0;
  let variableSpend = 0;
  
  focusSpendTransactions.forEach(t => {
    const catName = t.category ? (categoryMap[t.category] || '') : '';
    const amt = Math.abs(t.amount / 100);
    if (FIXED_CATEGORIES.includes(catName)) {
      fixedSpend += amt;
    } else {
      variableSpend += amt;
    }
  });

  const totalClassifiedSpend = fixedSpend + variableSpend;
  const fixedRatio = totalClassifiedSpend !== 0 ? (fixedSpend / totalClassifiedSpend) * 100 : 0;
  const variableRatio = totalClassifiedSpend !== 0 ? (variableSpend / totalClassifiedSpend) * 100 : 0;

  if (!skipApiInit) {
    await api.shutdown();
  }

  return {
    month: targetMonth,
    simPeriod: simMonths,
    ccMetrics: {
      totalCcSpend: +totalCcSpend.toFixed(2),
      ccTransactionsCount,
      cards: simResults,
    },
    pulseCheck: {
      actualSpend: +totalFocusSpend.toFixed(2),
      baselineSpend: +baseline.toFixed(2),
      compBaseline: +compBaseline.toFixed(2),
      diff: +momentumDiff.toFixed(2),
      percentage: +momentumPct.toFixed(1),
      isProrated,
      elapsedDays: elapsed,
      totalDays,
      categoryBreakdown: Object.entries(focusCatTotals)
        .map(([name, total]) => ({ name, total: +total.toFixed(2) }))
        .sort((a, b) => b.total - a.total),
    },
    leaks,
    ratios: {
      fixed: +fixedSpend.toFixed(2),
      variable: +variableSpend.toFixed(2),
      fixedRatio: +fixedRatio.toFixed(1),
      variableRatio: +variableRatio.toFixed(1),
    }
  };
}

module.exports = { runAnalysis };
