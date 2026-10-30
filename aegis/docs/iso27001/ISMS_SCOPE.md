# ISMS scope (draft)

**Organization:** Nexus AI Assurance, United Arab Emirates
**Owner of this document:** Jonathan Zaky, Founder and CEO
**Status:** Draft for approval

## Scope statement

The information security management system covers the design, development, testing, release,
hosting and support of the AEGIS platform (the AI action control, evidence and audit software), and
the company information, people, devices, accounts and suppliers that support it.

## Included

- The AEGIS source code, build pipeline (GitHub and GitHub Actions) and release artifacts, including
  offline installation bundles
- Hosted demonstration and pilot environments operated by the company
- Customer data the company processes when it operates AEGIS for a customer
- Company laptops, cloud and software accounts, email, and documents
- Staff and contractors, and the AI coding assistant used to write code under the founder's direction

## Excluded, and why

- **AEGIS installed and operated by a customer in its own environment.** The customer operates it
  under its own management system; the company supplies the software, documentation and support.
- **Physical data centres.** Run by hosting providers; their controls are inherited and their
  assurances recorded (see `STATEMENT_OF_APPLICABILITY.md`, theme A.7).

## Roles

| Role | Holder | Responsibilities |
|---|---|---|
| Top management | Founder and CEO | Approves policy, scope and risk acceptance; runs management review; provides resources |
| Security lead | Founder and CEO until a hire is made | Runs the ISMS day to day: risk register, records, incidents, supplier reviews |
| Engineering | Founder, with an AI coding assistant | Builds AEGIS to the secure development rules; every change passes CI |
| Staff and contractors | As hired | Follow the policies, report incidents |

A single person holding several roles is normal for a company of this size. Separation of duties is
provided by automated CI gates, the product's own approval controls, and independent testing.

## Interested parties and what they expect

| Party | Expectations |
|---|---|
| Customers (government and regulated entities) | Their data protected; AEGIS reliable and secure; evidence for their own audits; data in the UAE where required |
| Regulators (UAE Cyber Security Council, TDRA, data protection authorities, sector regulators) | Compliance with applicable law and regulation, including the UAE Information Assurance Regulation and the UAE PDPL where relevant |
| Investors | Security that does not block sales; honest reporting |
| Suppliers | Contract terms respected |
| Staff | Clear rules; safe working practices |

## Context

AEGIS is security and governance software: a weakness in it would undermine customers' own controls.
The main external issues are the fast change in AI agent attacks, customer requirements for local
hosting and certification, and the small size of the company.
