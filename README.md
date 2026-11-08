# Telegram Lunch Expense Bot (zero-cost)

A Telegram bot that manages employees' lunch-reimbursement claims. It runs entirely on free services: **Telegram Bot API + Google Apps Script + Google Sheets + Google Drive**. All amounts are stored, calculated and reported in **Iranian Rial (IRR)**. The default cap is 3,500,000 IRR per person per day.

- Step-by-step claim wizard with two mandatory pieces of evidence (purchase receipt and payment proof).
- Per-person daily cap shared across orders. The entire allowed amount goes to the person who paid.
- Finance-admin review: approve, reject, request correction, adjust amount, mark paid. Approval re-checks the cap atomically. Every action is written to an audit log.
- Daily, monthly and custom-range reports as real XLSX and right-to-left Persian PDF, delivered privately. The admin's daily PDF appends every food receipt and payment receipt of the day, one large printable image per page, with the employee's note.
- Optional Gemini integration (off by default) for receipt OCR and Persian voice. It only suggests values and needs human confirmation.

📖 **Full Persian setup guide:** [README_FA.md](README_FA.md) · Security: [SECURITY.md](SECURITY.md) · Plan and status: [docs/PLAN_FA.md](docs/PLAN_FA.md)

```bash
npm test
```

```bash
npm run bundle
```

`npm test` runs 89 tests against an in-memory simulation of Apps Script and Telegram. `npm run bundle` writes `dist/LunchBot.gs`, a single file you can paste into the Apps Script editor.
