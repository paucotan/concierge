# Budgeting Dashboard Plan

## Overview
Create a Google Sheets dashboard to visualize Actual budgeting data with pivot tables and charts.

## Action Plan

1. **Export CSV from Actual**
   - Export all transactions and account data from Actual

2. **Import into Google Sheets**
   - Create new Google Sheet
   - Import CSV data into a "Raw Data" sheet

3. **Build Pivot Tables**
   - Slice by category, date, account
   - Useful for analysis and pulling summary data

4. **Create Charts**
   - Line chart: spending trends over time
   - Bar chart: category breakdown
   - Pie chart: account distribution
   - Other combination charts as needed

5. **Dashboard Sheet**
   - Create a clean "Dashboard" sheet
   - Pull summaries from pivot tables using formulas
   - Keep it simple and readable

## Pro Tips

- Keep raw data on a separate sheet from your dashboard
- Use formulas to reference pivot tables, not hardcoded numbers
- Add a date on your dashboard so you know how fresh the data is
- Don't overthink it — start with 3-4 charts that answer your most pressing questions

## Future Optimization

Once you find yourself re-exporting regularly, consider automating:
- Google Apps Script to auto-export and upload
- Scheduled cron job
- API integration with Actual (if available)

## Questions to Answer First

- How often does the data need to be updated? (daily/weekly/monthly?)
- What's your primary goal? (spending visibility, savings tracking, category analysis?)
- Which metrics matter most to you?
