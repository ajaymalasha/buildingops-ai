# BuildingOps AI — API

FastAPI service that owns business logic, authorization and data access. Setup and
conventions are in the repository's `README.md` and `docs/development.md`.

```bash
uv sync                    # install dependencies into .venv
uv run pytest              # tests (needs the roles from `make db-bootstrap`)
uv run buildingops --help  # seed, openapi, create-admin
```
