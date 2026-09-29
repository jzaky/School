# Requirements research

Tooling for sourcing university entry requirements from official pages.

- `fetch-key.pub`: public key used by the GitHub Actions fetch job to encrypt page text. The matching private key is not in the repository.
- `*-list.json`: lists of official page URLs to fetch.
- `cache/<label>/`: encrypted page snapshots written by `.github/workflows/research-fetch.yml`. They cannot be read without the private key, so no page text is published here.

Only short quotes that support each requirement are published, in the catalog seed data, with a link to the official page.
