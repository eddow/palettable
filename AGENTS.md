# Development Protocol & Architectural Guidelines

## Documentation & Planning Workflow (`/plans/` vs `/docs/`)

The repository relies on a strict lifecycle for tracking tasks and recording architectural decisions:

* **The `/plans/` Directory:** Houses all active TODOs, roadmap items, and feature implementation checklists.
* **The `/docs/` Directory:** Houses permanent documentation covering foundational choices, architectural blueprints, security specs, and coding standards.

### Execution Rule

When implementing features, tasks must be pulled directly from `/plans/`. Once a task is fully implemented, verified, and tested:

1. **Remove** the completed item from the active file inside `/plans/`.
2. **Migrate or update** any permanent technical details, rules, or system documentation into the appropriate file inside `/docs/`.

## Local recipes

- `sandbox/` folder is git-ignored and should be used as temporary scripts, generated data, ... instead of `/tmp/`
- `git` can be used but read-only - no stash, commit, checkout, ...