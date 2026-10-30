# Records checklist

What a certification auditor will ask to see, and when to start keeping it. Start the "Now" items
immediately: the auditor needs records that cover a period of operation, usually two to three months.

| Record | Start | How often | Where to keep it |
|---|---|---|---|
| Signed information security policy, scope and risk acceptance | Now | Yearly review | Signed PDF in company drive |
| Risk register review notes | Now | Quarterly | `RISK_METHOD_AND_REGISTER.md` history |
| Asset register (devices, accounts, cloud resources, suppliers) | Now | Update on change | Company spreadsheet |
| Access review of company accounts | Now | Quarterly | Short note per review |
| CI results for each release (tests and security scans) | Already kept | Every change | GitHub Actions history |
| Backup and restore drill results | First hosted environment | Quarterly drill | Drill log |
| Incident log and post-incident reviews | Now (empty is fine) | Per event | Incident log |
| Incident response exercise | Within two months | Yearly | Exercise notes |
| Supplier list with assurance documents | Now | Yearly review | Supplier spreadsheet |
| Staff onboarding briefing and signed agreements | First hire | Per person | HR folder |
| Legal and contractual requirements register | Now | On change | Spreadsheet |
| Penetration test report and fix evidence | First paid pilot | Yearly | Confidential folder |
| Internal audit report | Before booking Stage 1 | Yearly | Audit folder |
| Management review minutes (inputs: audit, incidents, risks, objectives; outputs: decisions) | Before booking Stage 1 | Yearly | Minutes |

## Internal audit

Before the certification audit, someone other than the person who wrote a control should check it.
In a one-person company this can be an external consultant for a day, or a structured self-audit
against `STATEMENT_OF_APPLICABILITY.md` with the evidence for each "In place" control opened and
confirmed. Record what was checked, what was found, and the fixes.
