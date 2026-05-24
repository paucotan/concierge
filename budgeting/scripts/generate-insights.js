require('dotenv').config({ quiet: true });
const { runAnalysis } = require('./insights-engine');
const { callAI } = require('./ai-provider');

const focusMonth = process.argv[2];

if (!focusMonth) {
  console.error('Usage: node generate-insights.js <YYYY-MM>');
  process.exit(1);
}

function fmt(n) {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

async function run() {
  try {
    console.log(`Running Antigravity Engine analysis for ${focusMonth}...`);
    const data = await runAnalysis(focusMonth);

    // Build the mathematical context for the LLM
    const pulse = data.pulseCheck;
    const cc = data.ccMetrics;
    const ratios = data.ratios;
    const leaks = data.leaks;

    // CC Comparison Text table
    const ccTable = cc.cards.map((c, idx) => {
      const winnerMarker = c.isWinner ? '★ WINNER' : ' ';
      const diffStr = c.isCurrent ? 'Current' : (c.diffFromCurrent >= 0 ? `+${fmt(c.diffFromCurrent)}` : fmt(c.diffFromCurrent));
      return `${idx + 1}. ${c.name.padEnd(35)} | Net: ${fmt(c.net).padStart(8)} | Rewards: ${fmt(c.rewards).padStart(8)} | Fee: ${fmt(c.fees).padStart(6)} | vs. Current: ${diffStr.padStart(8)} ${winnerMarker}`;
    }).join('\n');

    // Leaks text
    const leaksText = leaks.length > 0 
      ? leaks.map(l => `- **${l.payee}**: ${l.count} visits, total spend ${fmt(l.total)} (avg. ${fmt(l.average)} per visit)`).join('\n')
      : 'No creeping leaks detected (high frequency, small transactions).';

    // Ratios text
    const ratiosText = `Fixed Spending: ${fmt(ratios.fixed)} (${ratios.fixedRatio}%)\nVariable Spending: ${fmt(ratios.variable)} (${ratios.variableRatio}%)`;

    // Category breakdown
    const catBreakdownText = pulse.categoryBreakdown.map(c => `- **${c.name}**: ${fmt(c.total)}`).join('\n');

    // Construct the LLM Prompt
    const prompt = `You are a financial advisor and coach. Your role is to provide empathetic, non-shaming, and mindful lifestyle observations based on the user's spending data.
    
=== SYSTEM DESIGN CONSTRAINTS ===
- DO NOT perform or modify any calculations yourself. The calculations are exact, deterministic, and provided below.
- Keep your tone completely objective, supportive, and non-judgmental. Do not use shaming or punitive language. Focus on observing habits and reflecting patterns.

=== CALCULATED INSIGHTS DATA ===
Focus Month: ${focusMonth}
Simulation Period: ${data.simPeriod.join(', ')}

1. PULSE CHECK
- Focus Month Spending: ${fmt(pulse.actualSpend)}
- Rolling 3-Month Average Baseline: ${fmt(pulse.baselineSpend)}
${pulse.isProrated ? `- Prorated Baseline (up to Day ${pulse.elapsedDays} of ${pulse.totalDays}): ${fmt(pulse.compBaseline)}` : ''}
- Absolute Difference: ${pulse.diff >= 0 ? '+' : ''}${fmt(pulse.diff)}
- Percentage Change vs Baseline: ${pulse.percentage >= 0 ? '+' : ''}${pulse.percentage}%
- Category Breakdown:
${catBreakdownText}

2. FIXED VS VARIABLE RATIO
${ratiosText}

3. CREEPING LEAKS (High frequency, low average cost)
${leaksText}

4. CREDIT CARD REWARD SIMULATION (Rolling 12 Months)
Total Credit Card Transactions: ${cc.ccTransactionsCount}
Total Credit Card Spend: ${fmt(cc.totalCcSpend)}
Card Rankings (highest net benefit first):
${ccTable}

=== YOUR TASK ===
Generate the "Mindful Prompt" observations for the user based strictly on the data above.
Your response should be in clean Markdown and contain two short sections:
1. **Lifestyle Reflections**: Empathetic, data-backed observations about their spending momentum, fixed/variable ratio, or specific category accelerations. Avoid generic advice; refer directly to the numbers.
2. **Creeping Leaks & Commitments**: Point out any creeping small expenses (leaks) and what they add up to, framing it as an invitation to reflect on whether these choices align with their needs.

Do not repeat or recompute the credit card optimizer results in your section since they are shown separately. Focus entirely on behavioral coaching. Keep it concise, high-signal, and supportive.`;

    console.log('\nGenerating AI coach synthesis...');
    const aiOutput = callAI(prompt);

    // Print the final consolidated report
    console.log('\n================================================================================');
    console.log(`               ANTIGRAVITY PERSONAL FINANCE REPORT: ${focusMonth}`);
    console.log('================================================================================\n');

    console.log('## 1. The Pulse Check');
    console.log(`- **Actual Spending**: ${fmt(pulse.actualSpend)}`);
    console.log(`- **Historical Baseline**: ${fmt(pulse.baselineSpend)} (rolling 3-month average)`);
    if (pulse.isProrated) {
      console.log(`- **Prorated Baseline**: ${fmt(pulse.compBaseline)} (adjusted for ${pulse.elapsedDays}/${pulse.totalDays} days elapsed)`);
      console.log(`- **Status**: ${pulse.diff >= 0 ? '🔴' : '🟢'} ${pulse.diff >= 0 ? 'Above' : 'Below'} prorated baseline by **${fmt(pulse.diff)}** (${pulse.percentage >= 0 ? '+' : ''}${pulse.percentage}%)`);
    } else {
      console.log(`- **Status**: ${pulse.diff >= 0 ? '🔴' : '🟢'} ${pulse.diff >= 0 ? 'Above' : 'Below'} baseline by **${fmt(pulse.diff)}** (${pulse.percentage >= 0 ? '+' : ''}${pulse.percentage}%)`);
    }
    console.log('\n**Category Spend Breakdown:**');
    console.log(catBreakdownText);
    console.log('\n**Fixed vs. Variable Spending:**');
    console.log(`- Fixed Costs (Bills, Subscriptions, Savings): **${fmt(ratios.fixed)}** (${ratios.fixedRatio}%)`);
    console.log(`- Variable Lifestyle: **${fmt(ratios.variable)}** (${ratios.variableRatio}%)`);
    console.log('\n--------------------------------------------------------------------------------\n');

    console.log('## 2. The Optimization Alpha (Credit Card Reward Simulation)');
    console.log(`Simulated over a ${data.simPeriod.length}-month period ending in ${focusMonth} across credit card transactions only.`);
    console.log(`- Total Card Spending Analyzed: **${fmt(cc.totalCcSpend)}** (${cc.ccTransactionsCount} transactions)\n`);
    console.log('Card | Annual Fee | Total Rewards | Net Annual Benefit | Optimization Alpha');
    console.log('---|---|---|---|---');
    cc.cards.forEach(c => {
      const winnerBadge = c.isWinner ? '🏆 **Winner**' : '';
      const diffStr = c.isCurrent ? '*Current Card*' : (c.diffFromCurrent >= 0 ? `+${fmt(c.diffFromCurrent)}` : fmt(c.diffFromCurrent));
      console.log(`${c.name} | ${fmt(c.annualFee)} | ${fmt(c.rewards)} | **${fmt(c.net)}** | ${diffStr} ${winnerBadge}`);
    });
    console.log('\n--------------------------------------------------------------------------------\n');

    console.log('## 3. The Mindful Coach');
    console.log(aiOutput.trim());
    console.log('\n================================================================================');

  } catch (err) {
    console.error('Error running insights report:', err);
  }
}

run();
