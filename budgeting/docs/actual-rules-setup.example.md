# Actual Budget — Rules Setup Guide (Example)

This is a template/example guide generated from common transaction categorization patterns.
Each rule below is a candidate for automation. Work through this list in Actual under **More → Rules → New Rule**.

---

## ⚠️ Before You Start: Rule Priority

Actual applies rules **in order**. Two cases where order matters:

1. **Amazon Prime vs Amazon (Shopping):** Add the Prime rule *first* so it takes priority over the general Amazon → Shopping rule.
2. **Uber subscription vs Uber Eats/Trip (Food/Travel):** Use "is exactly" for the subscription rule so it doesn't swallow "Uber Eats" or "Uber Trip".

---

## Rules by Category

### 🛒 Shopping

| Condition | Match Type | Value | → Category |
|---|---|---|---|
| Payee | contains | `Amazon` | Shopping |
| Payee | contains | `eBay` | Shopping |
| Payee | contains | `Daiso` | Shopping |
| Payee | contains | `Target` | Shopping |

> **Note:** The `Amazon` contains rule will catch all Amazon subsidiaries. Make sure the Amazon Prime rule (below) is added first.

---

### 📋 Subscriptions

| Condition | Match Type | Value | → Category |
|---|---|---|---|
| Payee | contains | `Amazon Prime` | Subscriptions |
| Payee | contains | `Apple` | Subscriptions |
| Payee | contains | `Netflix` | Subscriptions |
| Payee | contains | `Spotify` | Subscriptions |

---

### 🏠 Bills (Fixed)

| Condition | Match Type | Value | → Category |
|---|---|---|---|
| Payee | is exactly | `Rent` | Bills |
| Payee | contains | `Electric Utility` | Bills |

---

### 🍕 Food / Dining

| Condition | Match Type | Value | → Category |
|---|---|---|---|
| Payee | contains | `Starbucks` | Food |
| Payee | contains | `McDonald's` | Food |
| Payee | contains | `Uber Eats` | Food |
| Payee | contains | `Local Grocery` | Food |

---

### 💰 Income

| Condition | Match Type | Value | → Category |
|---|---|---|---|
| Payee | contains | `Employer Corp` | Income |
| Payee | contains | `Tax Refund` | Income |

---

## 🚫 Leave Manual (Mixed / Ambiguous)

These payees appeared with different categories across transactions — don't create rules for them, categorize case by case:

| Payee | Seen as... |
|---|---|
| Walmart | Food (groceries) vs Shopping (electronics/clothes) |
| Local Pharmacy | Health (prescriptions) vs Shopping (convenience) |

---

## 📊 Expected Impact

Once these rules are active, the majority of recurring payees that currently require manual categorization will be handled automatically.
